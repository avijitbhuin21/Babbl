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

## 3. Round 2 (2026-09-30)

- [~] **Mouse lag while recording (intermittent, also with online provider).** Not fixed yet; diagnostics added. `src-tauri/src/perf_monitor.rs` logs `[perf]` WARN lines (slow input hook, scheduler delay, high system/Babbl CPU, high input event rate, slow VAD / level emit) and one INFO summary per recording. Next occurrence: grep the log for `[perf]`. Suspects: rdev low-level hook (mouse5 binding) + CPU starvation (VAD ORT threads) / double `mic-level` emit.
- [x] **OpenRouter transcription models.** New `fetch_online_transcription_models` lists audio-input/text-output models from OpenRouter's public catalogue, merged after the curated list. Refine/post-process OpenRouter list filtered to text-output models.
- [x] **History limit 5 -> 50.** New default 50; one-time migration (`history_limit_migrated`) moves users still on 5 to 50.
- [x] **Model download breaks after stopping.** Real cancellation (per-model cancel flag checked per chunk, partial kept for resume), one download per model, HTTP 416 handled (complete partial accepted, otherwise discarded + restart), up to 3 auto-retries on network drops, Cancel button + "Resume" label in the model dropdown, stuck progress cleared on failure.
- [x] **Toggle state stuck after failed start (Escape unregister errors).** `ShortcutAction::start` now returns whether it started; keyboard/mouse/SIGUSR2 toggles use it. Also removed a re-entrant toggle-mutex lock in the "pipeline busy" path that could deadlock the shortcut handler.
- [x] **Empty audio sent to cloud ("audio too short").** Skipped when VAD keeps no speech.
- [x] **No-microphone message.** Specific message when no input device exists.
- [x] **`has_any_models_or_downloads` / `is_model_loading`** now match their names.
- [~] **tao "cannot move state from Destroyed" panic.** Happens during app teardown (quit/logoff/shutdown), a tao 0.34 issue; downgraded to a WARN log instead of an error pop-up. A real fix needs a tao/tauri upgrade.

---

## 4. Clipboard sync (new feature, 2026-09-30)

- [x] **Engine** (`src-tauri/src/clipboard_sync/`): text, images (<=10 MB PNG), files (<=1-100 MB, default 50) via `arboard`; auto (every copy) or manual ("Send clipboard now" button + tray item). Babbl's own paste / selection probe is excluded (`suppress_local_changes`); Windows password-manager copies (ExcludeClipboardContentFromMonitorProcessing) are skipped. Received files land in `Downloads/Babbl Clipboard/<timestamp>/` and are put on the clipboard as files.
- [x] **Security:** 6-digit PIN pairing via SPAKE2 (5 wrong attempts close pairing, 5 min expiry); one shared group key (stored in `%APPDATA%/com.babbl.app/clipboard_sync.json`, not in settings); every frame XChaCha20-Poly1305 encrypted end-to-end (relay/Cloudflare only see ciphertext).
- [x] **Local network:** mDNS discovery (`_babbl-clip._tcp`), auto-connect to same-group devices, "Pair by address" fallback; server on port 47821 (fallback random).
- [x] **Internet:** Cloudflare quick tunnel (downloads official `cloudflared` on first use, public `*.trycloudflare.com` URL, changes on restart) and Railway relay (`relay/`, Node `ws`, rooms derived from group key). Unlimited devices; every node forwards with dedupe so hubs/relays reach everyone.
- [x] **UI:** new "Clipboard" sidebar section (`src/components/settings/clipboard/ClipboardSettings.tsx`).
- [x] **Tests:** unit tests + two-engine end-to-end tests (`clipboard_sync/e2e_tests.rs`: LAN pairing incl. wrong PIN, text both ways, image, 1.3 MB multi-chunk file; relay pairing + sync when `BABBL_TEST_RELAY` is set).
- [ ] **Deploy the relay** to Railway and put its URL in Clipboard -> Internet -> Relay URL (awaiting approval).
- [ ] **macOS/Linux:** code is cross-platform but CI only builds Windows; add mac/linux jobs to verify. Password-manager exclusion and change detection are Windows-optimised (others poll).
- [ ] **Follow-ups:** global shortcut for "Send clipboard now"; folders (currently skipped); stable tunnel URL via named Cloudflare tunnel; key rotation to revoke a device (today: "Leave group" + re-pair).

---

## 5. Hosting & CI (2026-09-30)

- [x] **Railway project `babbl`** (workspace avijitbhuin21's Projects, region Singapore):
  - `website` service -> https://website-production-0dbd.up.railway.app (deployed from `website/` via `railway up`).
  - `relay` service -> https://relay-production-fea1.up.railway.app (deployed from `relay/`; now the app's default relay URL). Kept separate from the website so website deploys don't drop live sync connections.
  - `babbl-models` bucket (private, free egress). `GET /models/<file>` on the website 302-redirects to a 1-hour presigned bucket URL (resume/Range works). Upload models with `cd website && railway run node scripts/upload-model.mjs <files>`; app model URLs become `https://<site>/models/<file>`.
- [ ] **Auto-deploy on push:** services were deployed with the CLI. After `relay/` is pushed, connect the GitHub repo to both services with root directories `website` and `relay`.
- [ ] **Custom domain** (e.g. babbl.app) for website/relay; then update `DEFAULT_RELAY_URL` and model URLs.
- [x] **CI** `.github/workflows/ci.yml`: every push/PR builds the frontend and runs Rust tests on Windows, macOS (Apple Silicon) and Linux; Linux also runs the relay e2e test against a local relay.
- [x] **Release** `.github/workflows/release.yml`: tag `v*` builds and publishes Windows (NSIS), macOS (.app/.dmg, ad-hoc signed) and Linux (deb/AppImage/rpm) with updater `latest.json`. Needs repo secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`.
- [ ] **macOS Intel** not built (ONNX Runtime has no prebuilt x86_64-apple binary; needs brew onnxruntime). **macOS notarization** needs an Apple Developer ID; without it users must right-click -> Open the first time.

---

## 6. Model catalog upgrade (2026-09-30)

- [x] **Engine:** `transcribe-rs` 0.1.4 -> 0.3.11 (`onnx` + `whisper-cpp`; Whisper GPU = Vulkan on Windows/Linux, Metal on macOS). `vad-rs` moved to the commit using `ort` 2.0.0-rc.12 so only one ONNX Runtime is linked. `TranscriptionManager` rewritten for the new API (8 engine types).
- [x] **Retired:** Whisper Medium, Whisper Large. Users who had one selected are switched to Turbo / Parakeet V3 / Small (whichever is downloaded) on startup. Their old model files stay on disk (not deleted).
- [x] **Kept:** Whisper Small, Whisper Turbo, Parakeet V2, Parakeet V3.
- [x] **Added:** Moonshine V2 Tiny/Small/Medium (English), SenseVoice (zh/yue/en/ja/ko), Canary 1B v2 (25 European languages + translation, pick language manually), GigaAM v3 (Russian), Cohere Transcribe (most accurate, 14 languages, 1.7 GB, needs 8 GB+ RAM).
- [x] **Hosting:** all 11 files mirrored into the `babbl-models` bucket and served from `https://website-production-0dbd.up.railway.app/models/<file>` (`MODEL_BASE_URL` in `managers/model.rs`). Re-mirror/refresh: `POST /admin/mirror-models` with header `x-admin-token: $ADMIN_TOKEN` (Railway variable on the website service), progress via `GET` on the same path.
- [x] **Archive fix:** upstream archives were packed on macOS and contain AppleDouble `._*` files; extraction now deletes them (`remove_apple_double`) so loaders can't pick up fake model files.
- [ ] **Licensing/attribution:** Parakeet & Canary are CC-BY-4.0 (attribution required when redistributing), SenseVoice uses the FunASR model license, Cohere Apache-2.0, Moonshine MIT, GigaAM MIT, Whisper MIT. Add a model credits/licenses page (website + About).
- [ ] **Old files cleanup:** optionally offer to delete retired `ggml-large-v3-q5_0.bin` / `whisper-medium-q4_1.bin` from users' model folders.

---

## 7. transcribe.cpp migration: GPU for every model, live text, Qwen3-ASR (2026-09-30)

- [x] **Engine.** `transcribe-rs` removed; all local models run through `transcribe-cpp` 0.2.4 (GGUF). GPU backends linked statically: Vulkan on Windows/Linux, Metal on macOS (`src-tauri/Cargo.toml`). `Backend::Auto` falls back to CPU; new **GPU acceleration** toggle (`use_gpu`, Advanced) forces CPU and shows the active device (`get_transcription_device`).
- [x] **Catalog.** 19 curated single-file GGUF models generated from the transcribe.cpp catalog into `src-tauri/src/managers/catalog.rs` (pinned HF revision, size, SHA-256, languages, capabilities). Includes Qwen3-ASR 1.7B / 0.6B, Parakeet Live, Nemotron Live (28 langs), Moonshine Live, Voxtral Realtime, Whisper Turbo/Small, Parakeet V2/V3, Canary, Cohere, Granite, Fun-ASR, SenseVoice, GigaAM. Downloads are SHA-256 verified. Old ids (`turbo`, `small`, `sense-voice-int8`, ...) migrate to their replacements; old model files on disk are left untouched.
- [x] **Live streaming.** Recorder feeds every 16 kHz frame to a stream worker (`StreamRouter` in `managers/transcription.rs`); committed/tentative text is emitted as `stream-text` and shown in an enlarged overlay caption. Final text comes from the stream; falls back to batch if the model can't stream or the stream fails. Toggle: **Live text while speaking** (`live_transcription`).
- [x] **Frontend gating by capability.** Translate toggle and language picker use `supports_translate` / `languages` from `ModelInfo` instead of hard-coded id lists; "Live" badge on streaming models; onboarding recommends Parakeet Live.
- [x] **Hosting.** `website/mirror.mjs` mirrors the GGUF files from Hugging Face into the bucket with in-flight SHA-256 checks.
- [ ] **Follow-ups.** Old archives (`*.tar.gz`, `ggml-*.bin`) still sit in the bucket and on existing users' disks; non-English locales lack the new strings; GPU path not yet exercised on real hardware (local checks are CPU-only).

## 8. Notes

- Only `babbl.log` exists in the logs folder; no crash dumps or secondary logs were present.
- Existing `TODO.md` in root may overlap - consolidate later.
- `src/bindings.ts` was updated by hand for the new commands/types; it will be regenerated automatically on the next `tauri dev` run.
- `.keys/pass` stores the signing password in plaintext next to the key (gitignored). Consider keeping it only in a password manager / CI secrets.
