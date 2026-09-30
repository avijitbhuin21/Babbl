//! Always-on, low-overhead diagnostics for intermittent input lag.
//!
//! A watchdog thread samples scheduler delay, CPU usage and the cost of the global input hook,
//! voice detection and level emission. It writes a `[perf]` WARN line only when something looks
//! abnormal, plus one INFO summary per recording, so the default INFO log stays quiet.

use log::{info, warn};
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, Once};
use std::thread;
use std::time::{Duration, Instant};

const PROBE_INTERVAL: Duration = Duration::from_millis(100);
const REPORT_INTERVAL: Duration = Duration::from_secs(1);
const WARN_COOLDOWN: Duration = Duration::from_secs(10);

// Windows low-level hooks must return fast; anything above a few ms is felt as cursor lag.
const HOOK_SLOW_US: u64 = 5_000;
// Default Windows timer resolution is ~15.6 ms, so smaller overshoots are normal.
const SCHED_DELAY_WARN_MS: u64 = 40;
const SYSTEM_CPU_WARN_PCT: f64 = 90.0;
const PROCESS_CPU_WARN_PCT: f64 = 30.0;
const HOOK_RATE_WARN_PER_SEC: u64 = 2_000;
const VAD_SLOW_US: u64 = 10_000;
const EMIT_SLOW_US: u64 = 10_000;

struct Stat {
    count: AtomicU64,
    total_us: AtomicU64,
    max_us: AtomicU64,
    slow: AtomicU64,
}

impl Stat {
    const fn new() -> Self {
        Self {
            count: AtomicU64::new(0),
            total_us: AtomicU64::new(0),
            max_us: AtomicU64::new(0),
            slow: AtomicU64::new(0),
        }
    }

    fn record(&self, us: u64, slow_threshold_us: u64) {
        self.count.fetch_add(1, Ordering::Relaxed);
        self.total_us.fetch_add(us, Ordering::Relaxed);
        self.max_us.fetch_max(us, Ordering::Relaxed);
        if us >= slow_threshold_us {
            self.slow.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn take(&self) -> Snapshot {
        Snapshot {
            count: self.count.swap(0, Ordering::Relaxed),
            total_us: self.total_us.swap(0, Ordering::Relaxed),
            max_us: self.max_us.swap(0, Ordering::Relaxed),
            slow: self.slow.swap(0, Ordering::Relaxed),
        }
    }
}

#[derive(Default, Clone, Copy)]
struct Snapshot {
    count: u64,
    total_us: u64,
    max_us: u64,
    slow: u64,
}

impl Snapshot {
    fn avg_us(&self) -> u64 {
        if self.count == 0 {
            0
        } else {
            self.total_us / self.count
        }
    }
}

static HOOK_WINDOW: Stat = Stat::new();
static VAD_WINDOW: Stat = Stat::new();
static EMIT_WINDOW: Stat = Stat::new();

static HOOK_SESSION: Stat = Stat::new();
static VAD_SESSION: Stat = Stat::new();
static EMIT_SESSION: Stat = Stat::new();

static RECORDING: AtomicBool = AtomicBool::new(false);
static SESSION_MAX_SCHED_DELAY_MS: AtomicU64 = AtomicU64::new(0);
static SESSION_MAX_SYS_CPU_X10: AtomicU64 = AtomicU64::new(0);
static SESSION_MAX_PROC_CPU_X10: AtomicU64 = AtomicU64::new(0);
static SESSION_MAX_HOOK_RATE: AtomicU64 = AtomicU64::new(0);
static SESSION_WARNINGS: AtomicU64 = AtomicU64::new(0);
static SESSION_START: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));

static START: Once = Once::new();

/// Starts the background watchdog thread (idempotent).
pub fn start() {
    START.call_once(|| {
        let spawned = thread::Builder::new()
            .name("perf-monitor".into())
            .spawn(watchdog_loop);
        match spawned {
            Ok(_) => info!(
                "[perf] monitor started (warn thresholds: hook>{}ms, sched_delay>{}ms, sys_cpu>{}%, babbl_cpu>{}%, hook_rate>{}/s)",
                HOOK_SLOW_US / 1000,
                SCHED_DELAY_WARN_MS,
                SYSTEM_CPU_WARN_PCT,
                PROCESS_CPU_WARN_PCT,
                HOOK_RATE_WARN_PER_SEC
            ),
            Err(e) => warn!("[perf] failed to start monitor thread: {}", e),
        }
    });
}

/// Records how long one global input-hook callback took.
pub fn record_hook(elapsed: Duration) {
    let us = elapsed.as_micros() as u64;
    HOOK_WINDOW.record(us, HOOK_SLOW_US);
    if RECORDING.load(Ordering::Relaxed) {
        HOOK_SESSION.record(us, HOOK_SLOW_US);
    }
}

/// Records how long one voice-activity-detection frame took.
pub fn record_vad(elapsed: Duration) {
    let us = elapsed.as_micros() as u64;
    VAD_WINDOW.record(us, VAD_SLOW_US);
    if RECORDING.load(Ordering::Relaxed) {
        VAD_SESSION.record(us, VAD_SLOW_US);
    }
}

/// Records how long one mic-level emission to the webviews took.
pub fn record_level_emit(elapsed: Duration) {
    let us = elapsed.as_micros() as u64;
    EMIT_WINDOW.record(us, EMIT_SLOW_US);
    if RECORDING.load(Ordering::Relaxed) {
        EMIT_SESSION.record(us, EMIT_SLOW_US);
    }
}

/// Marks the start of a recording and resets the per-recording aggregates.
pub fn recording_started() {
    HOOK_SESSION.take();
    VAD_SESSION.take();
    EMIT_SESSION.take();
    SESSION_MAX_SCHED_DELAY_MS.store(0, Ordering::Relaxed);
    SESSION_MAX_SYS_CPU_X10.store(0, Ordering::Relaxed);
    SESSION_MAX_PROC_CPU_X10.store(0, Ordering::Relaxed);
    SESSION_MAX_HOOK_RATE.store(0, Ordering::Relaxed);
    SESSION_WARNINGS.store(0, Ordering::Relaxed);
    *SESSION_START.lock().unwrap() = Some(Instant::now());
    RECORDING.store(true, Ordering::Relaxed);
}

/// Marks the end of a recording and logs a one-line summary of what happened during it.
pub fn recording_stopped(reason: &str) {
    if !RECORDING.swap(false, Ordering::Relaxed) {
        return;
    }
    let duration = SESSION_START
        .lock()
        .unwrap()
        .take()
        .map(|t| t.elapsed())
        .unwrap_or_default();
    let hook = HOOK_SESSION.take();
    let vad = VAD_SESSION.take();
    let emit = EMIT_SESSION.take();
    info!(
        "[perf] recording {} after {:.1}s | hook: {} events, avg {}us, max {}us, slow {}, peak {}/s | vad: {} frames, avg {}us, max {}us | level_emit: {} calls, avg {}us, max {}us | sched_delay_max {}ms | peak cpu sys {:.1}% babbl {:.1}% | warnings {}",
        reason,
        duration.as_secs_f64(),
        hook.count,
        hook.avg_us(),
        hook.max_us,
        hook.slow,
        SESSION_MAX_HOOK_RATE.load(Ordering::Relaxed),
        vad.count,
        vad.avg_us(),
        vad.max_us,
        emit.count,
        emit.avg_us(),
        emit.max_us,
        SESSION_MAX_SCHED_DELAY_MS.load(Ordering::Relaxed),
        SESSION_MAX_SYS_CPU_X10.load(Ordering::Relaxed) as f64 / 10.0,
        SESSION_MAX_PROC_CPU_X10.load(Ordering::Relaxed) as f64 / 10.0,
        SESSION_WARNINGS.load(Ordering::Relaxed),
    );
}

/// Samples the probes every `PROBE_INTERVAL` and logs anomalies once per `REPORT_INTERVAL`.
fn watchdog_loop() {
    let mut cpu = CpuSampler::new();
    let mut last_report = Instant::now();
    let mut max_sched_delay_ms: u64 = 0;
    let mut last_warn: Option<Instant> = None;
    let mut suppressed: u64 = 0;

    loop {
        let before = Instant::now();
        thread::sleep(PROBE_INTERVAL);
        let delay_ms = before
            .elapsed()
            .saturating_sub(PROBE_INTERVAL)
            .as_millis() as u64;
        max_sched_delay_ms = max_sched_delay_ms.max(delay_ms);

        let window = last_report.elapsed();
        if window < REPORT_INTERVAL {
            continue;
        }
        last_report = Instant::now();

        let hook = HOOK_WINDOW.take();
        let vad = VAD_WINDOW.take();
        let emit = EMIT_WINDOW.take();
        let (sys_cpu, proc_cpu) = cpu.sample();
        let hook_rate = (hook.count as f64 / window.as_secs_f64()) as u64;
        let recording = RECORDING.load(Ordering::Relaxed);

        if recording {
            SESSION_MAX_SCHED_DELAY_MS.fetch_max(max_sched_delay_ms, Ordering::Relaxed);
            SESSION_MAX_HOOK_RATE.fetch_max(hook_rate, Ordering::Relaxed);
            if let Some(s) = sys_cpu {
                SESSION_MAX_SYS_CPU_X10.fetch_max((s * 10.0) as u64, Ordering::Relaxed);
            }
            if let Some(p) = proc_cpu {
                SESSION_MAX_PROC_CPU_X10.fetch_max((p * 10.0) as u64, Ordering::Relaxed);
            }
        }

        let mut reasons: Vec<&str> = Vec::new();
        if hook.slow > 0 {
            reasons.push("slow input hook");
        }
        if max_sched_delay_ms >= SCHED_DELAY_WARN_MS {
            reasons.push("thread scheduling delayed (CPU starvation?)");
        }
        if sys_cpu.is_some_and(|s| s >= SYSTEM_CPU_WARN_PCT) {
            reasons.push("system CPU high");
        }
        if proc_cpu.is_some_and(|p| p >= PROCESS_CPU_WARN_PCT) {
            reasons.push("Babbl CPU high");
        }
        if hook_rate >= HOOK_RATE_WARN_PER_SEC {
            reasons.push("very high input event rate");
        }
        if vad.slow > 0 {
            reasons.push("slow VAD frame");
        }
        if emit.slow > 0 {
            reasons.push("slow level emit");
        }

        if !reasons.is_empty() {
            if recording {
                SESSION_WARNINGS.fetch_add(1, Ordering::Relaxed);
            }
            let cooled_down = last_warn.map_or(true, |t| t.elapsed() >= WARN_COOLDOWN);
            if cooled_down {
                warn!(
                    "[perf] possible lag: {} | recording={} | hook: {}/s, avg {}us, max {}us, slow {} | sched_delay_max {}ms | cpu sys {} babbl {} | vad: {} frames, max {}us | level_emit: {} calls, max {}us | suppressed_since_last {}",
                    reasons.join(", "),
                    recording,
                    hook_rate,
                    hook.avg_us(),
                    hook.max_us,
                    hook.slow,
                    max_sched_delay_ms,
                    fmt_pct(sys_cpu),
                    fmt_pct(proc_cpu),
                    vad.count,
                    vad.max_us,
                    emit.count,
                    emit.max_us,
                    suppressed,
                );
                last_warn = Some(Instant::now());
                suppressed = 0;
            } else {
                suppressed += 1;
            }
        }

        max_sched_delay_ms = 0;
    }
}

fn fmt_pct(value: Option<f64>) -> String {
    value.map_or_else(|| "n/a".to_string(), |v| format!("{:.1}%", v))
}

#[cfg(target_os = "windows")]
struct CpuSampler {
    last: Option<(u64, u64, u64)>,
}

#[cfg(target_os = "windows")]
impl CpuSampler {
    fn new() -> Self {
        Self { last: None }
    }

    /// Returns (system busy %, this process % of the whole machine) since the previous call.
    fn sample(&mut self) -> (Option<f64>, Option<f64>) {
        use windows::Win32::Foundation::FILETIME;
        use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes, GetSystemTimes};

        fn ticks(ft: FILETIME) -> u64 {
            ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
        }

        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let mut p_create = FILETIME::default();
        let mut p_exit = FILETIME::default();
        let mut p_kernel = FILETIME::default();
        let mut p_user = FILETIME::default();

        let ok = unsafe {
            GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_ok()
                && GetProcessTimes(
                    GetCurrentProcess(),
                    &mut p_create,
                    &mut p_exit,
                    &mut p_kernel,
                    &mut p_user,
                )
                .is_ok()
        };
        if !ok {
            return (None, None);
        }

        // System kernel time already includes idle time.
        let sys_total = ticks(kernel) + ticks(user);
        let sys_idle = ticks(idle);
        let proc_total = ticks(p_kernel) + ticks(p_user);
        let current = (sys_total, sys_idle, proc_total);

        let result = match self.last {
            Some((last_total, last_idle, last_proc)) => {
                let d_total = sys_total.saturating_sub(last_total);
                if d_total == 0 {
                    (None, None)
                } else {
                    let d_idle = sys_idle.saturating_sub(last_idle);
                    let d_proc = proc_total.saturating_sub(last_proc);
                    let sys = (d_total.saturating_sub(d_idle)) as f64 * 100.0 / d_total as f64;
                    let proc = d_proc as f64 * 100.0 / d_total as f64;
                    (Some(sys), Some(proc))
                }
            }
            None => (None, None),
        };
        self.last = Some(current);
        result
    }
}

#[cfg(not(target_os = "windows"))]
struct CpuSampler;

#[cfg(not(target_os = "windows"))]
impl CpuSampler {
    fn new() -> Self {
        Self
    }

    /// CPU sampling is only implemented on Windows.
    fn sample(&mut self) -> (Option<f64>, Option<f64>) {
        (None, None)
    }
}
