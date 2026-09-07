# Babbl - Issues & Feature Tracker

Source log: `C:\Users\user\AppData\Local\com.babbl.app\logs\babbl.log` (4,791 lines, 387 KB, single session 2026-09-07).
Log level breakdown: 4,668 DEBUG / 91 INFO / 0 WARN / 0 ERROR.

Legend: `[x]` done, `[~]` partially done / needs manual step, `[ ]` open, `[-]` verified not a bug.

---

## 1. Issues found in logs

### Logging / diagnostics

- [x] **No errors are ever logged.** Transcribe / refine / post-process / paste failures now go through `notify::report_error` (`src-tauri/src/notify.rs`) which logs at `error!` and emits `babbl://error`. Recording-start failure is also reported (`src-tauri/src/actions.rs`).
- [x] **No panic hook.** `notify::install_panic_hook()` is installed first thing in `run()` (`src-tauri/src/lib.rs`); panics are logged with thread + location and surfaced as a pop-up.
- [x] **Keystroke-level logging in the log file.** All per-key `rdev` / `Currently pressed` / `After release` lines moved to `trace!` in `src-tauri/src/input_hook.rs`; only shortcut-match lines remain at INFO/DEBUG.
- [x] **Full transcription text logged.** Raw API responses and transcript text are no longer written; only byte/char counts are logged.
- [x] **API key metadata logged.** Length log removed; only an `error!` if the key is empty.
- [x] **Malformed multi-line log entry.** `recorder.rs` now logs a single line with the unwrapped device name.
- [x] **Single log file, no rotation.** `max_file_size(5 MB)` + `RotationStrategy::KeepSome(5)`.
- [x] **Timestamps are UTC.** `TimezoneStrategy::UseLocal`.
- [x] **Default log level DEBUG.** Default is now `Info` (`settings.rs` + `FILE_LOG_LEVEL`). Existing users who already have `debug` stored keep it until they change it in Debug settings.

### App behaviour

- [x] **`favicon.ico` not found.** Added `public/favicon.ico` and `<link rel="icon">` in `index.html`.
- [-] **Cloud transcription hits `/audio/translations`.** Verified: only used when `translate_to_english` is on AND the model is Whisper; otherwise `/audio/transcriptions`. The user had Translate-to-English enabled. Not a bug.
- [x] **Redundant translation step logged per request.** Silent when language is not zh-Hans/zh-Hant.
- [-] **Shortcut release fires after both start and stop.** Verified: in toggle mode `trigger_shortcut` ignores `is_press == false`, so the release does no work.
- [ ] **Microphone stream re-initialised on every recording.** Left as-is (expected in on-demand mode; "Always-on microphone" setting already exists for users who want zero start latency).
- [x] **Update check runs on every launch.** Automatic check now runs at most once per 24 h (`localStorage` timestamp); manual clicks always check.
- [x] **Stray binaries in `src-tauri/icons/`.** Deleted both `.exe` files; `*.exe` added to `.gitignore`.

### Updater / release pipeline (GitHub)

- [~] **Make GitHub updates work end-to-end.** Added `.github/workflows/release.yml` (tag `v*` -> version check -> `tauri-action` build, sign, publish with `latest.json`). **Manual step:** add repo secrets `TAURI_SIGNING_PRIVATE_KEY` (contents of `.keys/babbl.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, then push a tag matching the version (e.g. `v0.1.4`).
- [x] **Signature verification / version identity.** Updater already enforces the embedded `pubkey`. About page now shows version, git commit (`BABBL_GIT_HASH` from `build.rs`) and the last 12 chars of the signing pubkey (`commands::get_build_info`).
- [x] **"Check for updates" button behaviour.** `UpdateChecker.tsx` shows "Update to vX.Y.Z", "Up to date", or "Update check failed: <no release published | offline | signature mismatch | ...>" (clickable to retry).
- [x] **Version bump consistency.** `scripts/check-version.ts` (run `bun run scripts/check-version.ts [vX.Y.Z]`); also runs in the release workflow. It immediately caught real drift: `package.json` was `0.1.1` while Tauri/Cargo were `0.1.3` - synced to `0.1.3`.

---

## 2. New features

- [x] **OpenRouter support.** Post-processing already had OpenRouter. Added it to Online Transcription (chat-completions audio flow with `input_audio`, default `google/gemini-2.5-flash`, `HTTP-Referer`/`X-Title` headers). Provider + model list in `OnlineProviderSettings/index.tsx`.
- [x] **Skip "Download models" popup when Online mode is on.** `App.tsx` skips onboarding when `use_online_provider` is true.
- [x] **UI clean-up and polish.** Section title header in content area, sidebar border, narrower content column, themed rich toasts with close button (bottom-right).
- [x] **Surface errors to the user.** `babbl://error` event -> sonner toast in main window (`App.tsx`) and a 2.5 s red state in the overlay (`RecordingOverlay.tsx`).
- [x] **Context-aware shortcut: transcribe vs. refine selected text**
  - [x] **New `refine` binding** (default = same key as transcribe) in `settings.rs`; recorder shown in General -> "Refine selection".
  - [x] **Shared-key mode.** `shortcut.rs::sync_transcribe_and_refine` registers only `transcribe` when both bindings match; `change_binding`/`suspend`/`resume` handle both ids together so no duplicate registration occurs.
  - [x] **Dedicated-key mode.** Refine key with nothing selected -> pop-up "Select some text first"; transcribe key never probes.
  - [x] **Selection detection on press.** `clipboard.rs::capture_selected_text` (snapshot -> clear -> Ctrl+C -> 120 ms -> read -> restore).
  - [x] **Transcribe mode** unchanged.
  - [x] **Refine mode.** Transcript becomes the instruction; `actions.rs::refine_selected_text` calls the post-processing provider with a dedicated rewrite prompt; result pasted over the selection.
  - [x] **Requires an LLM provider.** Uses post-processing provider/model/key even if the toggle is off; clear error pop-up if missing (no fallback paste, so the selection is never overwritten with a raw transcript).
  - [x] **Strip em dashes.** `strip_em_dashes`: `—`, `–`, `--` -> `, ` (trailing/line-end -> `.`), duplicate commas collapsed. Unit-tested.
  - [x] **Overlay feedback.** Amber bars while recording in refine mode, "Refining..." while processing.
  - [~] **Edge cases.** Selection capped at 20,000 chars; cancel clears the pending selection; clipboard restored on every path. **Not implemented:** focused-window-change detection while recording (would need per-OS window APIs).
  - [x] **Setting to disable** refine mode: "Refine selected text with voice" toggle in General.

---

## 3. Notes

- Only `babbl.log` exists in the logs folder; no crash dumps or secondary logs were present.
- Existing `TODO.md` in root may overlap - consolidate later.
- `src/bindings.ts` was updated by hand for the new commands/types; it will be regenerated automatically on the next `tauri dev` run.
- `.keys/pass` stores the signing password in plaintext next to the key (gitignored). Consider keeping it only in a password manager / CI secrets.
