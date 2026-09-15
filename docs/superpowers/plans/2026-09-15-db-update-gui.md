# `db update` in the GUI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stale markers, "update stale / selected" with live per-database progress, safe cancel, stop-update-restart of a running server, a stale count on the dashboard, and a fixed bulk-drop report — odoodev-gui 1.8.0.

**Architecture:** Rust spawns `odoodev db update … --output ndjson`, parses each stdout line into a typed event and re-emits it as a global Tauri event carrying the version. A `DbUpdateManager` tracks one run per version and cancels with SIGTERM. The frontend keeps per-version run state in a zustand store driven by a pure, unit-tested reducer; listeners live once in `App`, so the non-modal progress panel survives view changes.

**Tech Stack:** Tauri v2, Rust (tokio, serde, `libc` on unix), React 19 + TypeScript, zustand, i18next, vitest, lucide-react, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-15-db-update-gui-design.md`. CLI side: `/Users/picard/gitbase/PyPi-Projects/odoo-dev/docs/superpowers/plans/2026-09-15-db-update-ndjson.md` (must be released first).

## Global Constraints

- Repository `/Users/picard/gitbase/odoodev-gui`, branch `feat/db-update`. Package manager **pnpm**; Rust commands run in `src-tauri/`.
- Requires **odoodev ≥ 0.69.0** for every update feature: constant `MIN_ODOODEV_DB_UPDATE = "0.69.0"`; below it the buttons are disabled with the hint.
- CLI invocation always ends with `--output ndjson`; database names and modules pass `reject_flag_like`.
- Tauri command struct args deserialize camelCase (`#[serde(rename_all = "camelCase")]`); event payloads keep the CLI's snake_case keys.
- Global event names (amends the spec — see Task 9): `db-update-event` `{version, event}`, `db-update-log` `{version, line}`, `db-update-exited` `{version, exit_code}` (`exit_code: number | null`, same key as `server-exited`).
- Cancel sends **SIGTERM** (unix). SIGKILL only via the explicit "Force stop" (offered 20 s after cancel). App exit: SIGTERM all runs, wait ≤ 10 s.
- `read_update_log` accepts only `~/odoodev-logs/update_v*.log` (canonicalized); the editor allowlist is **not** widened.
- Stopping a server for an update uses `stopServer(version, true)` — `keepDocker` must stay `true`.
- Dashboard stale fetch: when the card is active and PostgreSQL runs, every 300 s (`POLL_INTERVALS.stale`), and after `db-update-exited`.
- Every new UI string in `src/locales/en.json` **and** `de.json` (German with correct umlauts; no ASCII `"` as a German closing quote). `pnpm test` enforces parity and key resolution.
- Progress is not a modal. Issues capped at 500 per database, console at 2000 lines.
- Versions: GUI `1.8.0` in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.
- Commit prefixes `[ADD]`/`[CHG]`/`[FIX]`. Repo is mirrored to GitHub: no customer names, hostnames, IPs, e-mails in code, tests, docs, commits.
- Checks per task as listed; before the release: `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `cargo fmt --check`, `cargo clippy`, `cargo test`.

## File Structure

**Rust (`src-tauri/src/`)**
- Create `db_update.rs` — pure: `DbUpdateArgs`/`DbUpdateMode`, `build_db_update_args`, event types + `parse_event`, `update_log_dir`, `validate_update_log_path`, `tail_text`.
- Create `db_update_manager.rs` — `DbUpdateManager` (runs per version, cancel, shutdown).
- Create `commands/db_update.rs` — `plan_db_update`, `start_db_update`, `cancel_db_update`, `list_db_updates`, `read_update_log`; `plan_from_output`.
- Modify `odoodev.rs` (`build_odoodev_command` → `pub`), `models.rs` (`DbListResponse.stale`), `commands/mod.rs`, `lib.rs` (modules, state, handlers, exit hook), `Cargo.toml` (`libc`).

**Frontend (`src/`)**
- Create `lib/version.ts` (+ test), `lib/dbUpdateReducer.ts` (+ test), `lib/dbUpdateRunner.ts`, `store/dbUpdateStore.ts`, `hooks/useDbUpdateEvents.ts`.
- Create `components/database/DbUpdateDialog.tsx`, `DbUpdatePanel.tsx`, `UpdateLogDialog.tsx`, `bulkDrop.ts` (+ test), `components/DbUpdateIndicator.tsx`.
- Modify `types/index.ts`, `components/database/DatabasePanel.tsx`, `components/playbook/PlaybookPanel.tsx`, `store/appStore.ts`, `components/Header.tsx`, `App.tsx`, `components/dashboard/VersionCard.tsx`, `lib/constants.ts`, `locales/en.json`, `locales/de.json`.

**Docs:** `docs/TAURI_API.md`, `docs/CLI_INTEGRATION.md`, `docs/superpowers/specs/2026-09-15-db-update-gui-design.md` (amendments), `CLAUDE.md`, `RELEASE_NOTES.md`.

---

### Task 1: Rust building blocks — args, events, log-path guard

**Files:**
- Create: `src-tauri/src/db_update.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod db_update;`)

**Interfaces:**
- Consumes: `crate::odoodev::{reject_flag_like, home_dir}`.
- Produces (used by Tasks 2 and 3):
  - `pub enum DbUpdateMode { Names, Stale, All }` (serde lowercase)
  - `pub struct DbUpdateArgs { version: String, mode: DbUpdateMode, names: Vec<String>, modules: String, stop_on_error: bool, timeout_seconds: Option<u32> }` (serde camelCase)
  - `pub fn build_db_update_args(args: &DbUpdateArgs, dry_run: bool) -> Result<Vec<String>, String>`
  - `pub struct PlanTarget { database: String, reason: Option<String> }`
  - `pub struct DbUpdatePlan { version, modules, targets: Vec<PlanTarget>, skipped_current: Vec<String>, server_running: bool }`
  - `pub struct DbUpdateResult { database, ok, exit_code: i32, duration_s: f64, warnings: u32, errors: u32, last_error: Option<String>, timed_out: bool, log: String }`
  - `pub enum DbUpdateEvent { Plan(DbUpdatePlan), Start{database,index,total,log}, Issue{database,level,text}, DbResult(DbUpdateResult) /* "result" */, Summary{results,skipped_current,exit_code}, Interrupted{database: Option<String>}, Error{message} }` (serde tag `event`, snake_case)
  - `pub fn parse_event(line: &str) -> Option<DbUpdateEvent>`
  - `pub fn update_log_dir() -> PathBuf`, `pub fn validate_update_log_path(path: &Path, log_dir: &Path) -> Result<PathBuf, String>`, `pub fn tail_text(bytes: &[u8], limit: usize) -> String`, `pub const LOG_VIEW_LIMIT: usize = 2_000_000`

- [ ] **Step 1: Write the module with its tests (tests first in the file's `mod tests`, implementation stubs returning `todo!()` are not needed — write the tests, then run them against an empty module to see the compile failure)**

Create `src-tauri/src/db_update.rs` containing only the test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn args(mode: DbUpdateMode) -> DbUpdateArgs {
        DbUpdateArgs {
            version: "19".into(),
            mode,
            names: vec![],
            modules: "all".into(),
            stop_on_error: false,
            timeout_seconds: None,
        }
    }

    #[test]
    fn stale_mode_builds_the_ndjson_invocation() {
        assert_eq!(
            build_db_update_args(&args(DbUpdateMode::Stale), false).unwrap(),
            vec!["db", "update", "19", "--stale", "-u", "all", "--output", "ndjson"]
        );
    }

    #[test]
    fn names_mode_passes_each_database_and_every_option() {
        let mut a = args(DbUpdateMode::Names);
        a.names = vec!["v19_a".into(), "v19_b".into()];
        a.modules = " eq_base,eq_sale ".into();
        a.stop_on_error = true;
        a.timeout_seconds = Some(1800);
        assert_eq!(
            build_db_update_args(&a, true).unwrap(),
            vec![
                "db", "update", "19", "-n", "v19_a", "-n", "v19_b", "-u", "eq_base,eq_sale",
                "--stop-on-error", "--timeout", "1800", "--dry-run", "--output", "ndjson",
            ]
        );
    }

    #[test]
    fn rejects_invalid_input() {
        assert!(build_db_update_args(&args(DbUpdateMode::Names), false).is_err()); // no names
        let mut flag_name = args(DbUpdateMode::Names);
        flag_name.names = vec!["--all".into()];
        assert!(build_db_update_args(&flag_name, false).is_err());
        let mut blank = args(DbUpdateMode::All);
        blank.modules = "  ".into();
        assert!(build_db_update_args(&blank, false).is_err());
        let mut flag_modules = args(DbUpdateMode::All);
        flag_modules.modules = "-x".into();
        assert!(build_db_update_args(&flag_modules, false).is_err());
        let mut zero = args(DbUpdateMode::All);
        zero.timeout_seconds = Some(0);
        assert!(build_db_update_args(&zero, false).is_err());
        let mut flag_version = args(DbUpdateMode::All);
        flag_version.version = "-d".into();
        assert!(build_db_update_args(&flag_version, false).is_err());
    }

    #[test]
    fn args_deserialize_from_camel_case() {
        let a: DbUpdateArgs = serde_json::from_str(
            r#"{"version":"19","mode":"names","names":["v19_a"],"modules":"all","stopOnError":true,"timeoutSeconds":600}"#,
        )
        .unwrap();
        assert_eq!(a.mode, DbUpdateMode::Names);
        assert!(a.stop_on_error);
        assert_eq!(a.timeout_seconds, Some(600));
    }

    const RESULT_LINE: &str = r#"{"event":"result","database":"v19_a","ok":true,"exit_code":0,"duration_s":12.5,"warnings":1,"errors":0,"last_error":null,"timed_out":false,"log":"/logs/update_v19_v19_a.log"}"#;

    #[test]
    fn parses_every_event_type() {
        let plan = parse_event(
            r#"{"event":"plan","version":"19","modules":"all","targets":[{"database":"v19_a","reason":"never updated"},{"database":"v19_b","reason":null}],"skipped_current":["v19_c"],"server_running":true}"#,
        );
        match plan {
            Some(DbUpdateEvent::Plan(p)) => {
                assert_eq!(p.targets[0].reason.as_deref(), Some("never updated"));
                assert_eq!(p.targets[1].reason, None);
                assert!(p.server_running);
            }
            other => panic!("expected plan, got {other:?}"),
        }
        assert!(matches!(
            parse_event(r#"{"event":"start","database":"v19_a","index":1,"total":2,"log":"/l.log"}"#),
            Some(DbUpdateEvent::Start { index: 1, total: 2, .. })
        ));
        assert!(matches!(
            parse_event(r#"{"event":"issue","database":"v19_a","level":"RAW","text":"Traceback"}"#),
            Some(DbUpdateEvent::Issue { .. })
        ));
        assert!(matches!(parse_event(RESULT_LINE), Some(DbUpdateEvent::DbResult(r)) if r.warnings == 1));
        assert!(matches!(
            parse_event(&format!(r#"{{"event":"summary","results":[{{{}],"skipped_current":[],"exit_code":0}}"#, &RESULT_LINE[18..])),
            Some(DbUpdateEvent::Summary { exit_code: 0, .. })
        ));
        assert!(matches!(
            parse_event(r#"{"event":"interrupted","database":null}"#),
            Some(DbUpdateEvent::Interrupted { database: None })
        ));
        assert!(matches!(
            parse_event(r#"{"event":"error","message":"not ready"}"#),
            Some(DbUpdateEvent::Error { .. })
        ));
    }

    #[test]
    fn unknown_or_malformed_lines_are_not_events() {
        assert!(parse_event(r#"{"event":"progress"}"#).is_none());
        assert!(parse_event("[WARN] An Odoo server is running").is_none());
        assert!(parse_event(r#"{"event":"start","database":"v19_a"}"#).is_none());
        assert!(parse_event("").is_none());
    }

    #[test]
    fn events_serialize_back_with_the_event_tag() {
        let issue = parse_event(r#"{"event":"issue","database":"v19_a","level":"WARNING","text":"x"}"#).unwrap();
        let value = serde_json::to_value(&issue).unwrap();
        assert_eq!(value["event"], "issue");
        assert_eq!(value["level"], "WARNING");
        let result = serde_json::to_value(parse_event(RESULT_LINE).unwrap()).unwrap();
        assert_eq!(result["event"], "result");
        assert_eq!(result["duration_s"], 12.5);
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("odoodev-gui-test-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_update_logs_in_the_log_dir() {
        let dir = temp_dir("log-ok");
        let file = dir.join("update_v19_v19_a_20260915_101010.log");
        std::fs::write(&file, "x").unwrap();
        assert!(validate_update_log_path(&file, &dir).is_ok());
    }

    #[test]
    fn rejects_other_names_subdirectories_and_traversal() {
        let dir = temp_dir("log-names");
        let other = dir.join("odoo_19_v19_a.log");
        std::fs::write(&other, "x").unwrap();
        assert!(validate_update_log_path(&other, &dir).is_err());

        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let nested = sub.join("update_v19_a.log");
        std::fs::write(&nested, "x").unwrap();
        assert!(validate_update_log_path(&nested, &dir).is_err());

        let outside_dir = temp_dir("log-outside");
        std::fs::write(outside_dir.join("update_v19_b.log"), "x").unwrap();
        let traversal = dir.join("..").join(outside_dir.file_name().unwrap()).join("update_v19_b.log");
        assert!(validate_update_log_path(&traversal, &dir).is_err());

        assert!(validate_update_log_path(&dir.join("update_v19_missing.log"), &dir).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlink_pointing_outside() {
        let dir = temp_dir("log-link");
        let outside_dir = temp_dir("log-link-target");
        let secret = outside_dir.join("secret.txt");
        std::fs::write(&secret, "x").unwrap();
        let link = dir.join("update_v19_link.log");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        assert!(validate_update_log_path(&link, &dir).is_err());
    }

    #[test]
    fn tail_text_keeps_small_files_and_cuts_large_ones_from_the_front() {
        assert_eq!(tail_text(b"short", 100), "short");
        let text = tail_text(b"0123456789", 4);
        assert!(text.ends_with("6789"));
        assert!(text.starts_with("… (showing the last 4 bytes"));
    }
}
```

Add `mod db_update;` to `src-tauri/src/lib.rs` next to the other `mod` lines.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src-tauri && cargo test db_update::tests`
Expected: compile errors — `cannot find type DbUpdateArgs`, `cannot find function build_db_update_args`, …

- [ ] **Step 3: Implement** — insert above the test module in `src-tauri/src/db_update.rs`:

```rust
//! Pure building blocks for `odoodev db update --output ndjson` (odoodev >= 0.69.0):
//! CLI arguments, the event-stream contract and the update-log path guard.
//! Process handling lives in `db_update_manager.rs` and `commands/db_update.rs`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::odoodev::{home_dir, reject_flag_like};

/// Largest log excerpt sent to the webview; an `-u all` log can reach tens of MB.
pub const LOG_VIEW_LIMIT: usize = 2_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DbUpdateMode {
    Names,
    Stale,
    All,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbUpdateArgs {
    pub version: String,
    pub mode: DbUpdateMode,
    #[serde(default)]
    pub names: Vec<String>,
    pub modules: String,
    #[serde(default)]
    pub stop_on_error: bool,
    #[serde(default)]
    pub timeout_seconds: Option<u32>,
}

pub fn build_db_update_args(args: &DbUpdateArgs, dry_run: bool) -> Result<Vec<String>, String> {
    reject_flag_like("version", &args.version)?;
    let modules = args.modules.trim();
    if modules.is_empty() {
        return Err("Modules must not be empty".to_string());
    }
    reject_flag_like("modules", modules)?;

    let mut cli = vec!["db".to_string(), "update".to_string(), args.version.clone()];
    match args.mode {
        DbUpdateMode::Names => {
            if args.names.is_empty() {
                return Err("Select at least one database".to_string());
            }
            for name in &args.names {
                reject_flag_like("name", name)?;
                cli.push("-n".to_string());
                cli.push(name.clone());
            }
        }
        DbUpdateMode::Stale => cli.push("--stale".to_string()),
        DbUpdateMode::All => cli.push("--all".to_string()),
    }
    cli.push("-u".to_string());
    cli.push(modules.to_string());
    if args.stop_on_error {
        cli.push("--stop-on-error".to_string());
    }
    if let Some(seconds) = args.timeout_seconds {
        if seconds == 0 {
            return Err("Timeout must be at least one second".to_string());
        }
        cli.push("--timeout".to_string());
        cli.push(seconds.to_string());
    }
    if dry_run {
        cli.push("--dry-run".to_string());
    }
    cli.push("--output".to_string());
    cli.push("ndjson".to_string());
    Ok(cli)
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct PlanTarget {
    pub database: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct DbUpdatePlan {
    pub version: String,
    pub modules: String,
    pub targets: Vec<PlanTarget>,
    pub skipped_current: Vec<String>,
    pub server_running: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
pub struct DbUpdateResult {
    pub database: String,
    pub ok: bool,
    pub exit_code: i32,
    pub duration_s: f64,
    pub warnings: u32,
    pub errors: u32,
    pub last_error: Option<String>,
    pub timed_out: bool,
    pub log: String,
}

/// One line of `db update --output ndjson`. Unknown events fail to parse and are
/// shown as console text instead — never dropped, never a crash.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum DbUpdateEvent {
    Plan(DbUpdatePlan),
    Start {
        database: String,
        index: u32,
        total: u32,
        log: String,
    },
    Issue {
        database: String,
        level: String,
        text: String,
    },
    #[serde(rename = "result")]
    DbResult(DbUpdateResult),
    Summary {
        results: Vec<DbUpdateResult>,
        skipped_current: Vec<String>,
        exit_code: i32,
    },
    Interrupted {
        database: Option<String>,
    },
    Error {
        message: String,
    },
}

pub fn parse_event(line: &str) -> Option<DbUpdateEvent> {
    serde_json::from_str(line.trim()).ok()
}

pub fn update_log_dir() -> PathBuf {
    home_dir().join("odoodev-logs")
}

/// Only `update_v*.log` files directly inside the log directory. Both sides are
/// canonicalized first, so `..` segments and symlinks cannot escape it.
pub fn validate_update_log_path(path: &Path, log_dir: &Path) -> Result<PathBuf, String> {
    const DENIED: &str = "Only update logs in ~/odoodev-logs can be opened";
    let canon = path.canonicalize().map_err(|e| format!("Log file not found: {e}"))?;
    let dir = log_dir
        .canonicalize()
        .map_err(|e| format!("Log directory not found: {e}"))?;
    let name = canon.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    if canon.parent() != Some(dir.as_path()) || !name.starts_with("update_v") || !name.ends_with(".log") {
        return Err(DENIED.to_string());
    }
    Ok(canon)
}

pub fn tail_text(bytes: &[u8], limit: usize) -> String {
    if bytes.len() <= limit {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    let tail = &bytes[bytes.len() - limit..];
    format!(
        "… (showing the last {limit} bytes of {} — open the file for the rest)\n{}",
        bytes.len(),
        String::from_utf8_lossy(tail)
    )
}
```

Note for the `summary` assertion in the test: `&RESULT_LINE[18..]` strips the leading `{"event":"result",` (18 bytes) so the object nests as a result entry; if you change `RESULT_LINE`, adjust the offset.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test db_update::tests`
Expected: all PASS. (`cargo build` may warn that the new items are unused — they are wired in Task 2.)

- [ ] **Step 5: Format and commit**

```bash
cd src-tauri && cargo fmt && cd ..
git add src-tauri/src/db_update.rs src-tauri/src/lib.rs
git commit -m "[ADD] db update: CLI args, NDJSON event types and update-log guard (Rust)"
```

---

### Task 2: Run management and Tauri commands

**Files:**
- Create: `src-tauri/src/db_update_manager.rs`, `src-tauri/src/commands/db_update.rs`
- Modify: `src-tauri/src/odoodev.rs:125`, `src-tauri/src/models.rs` (`DbListResponse`), `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

**Interfaces:**
- Consumes: everything `pub` from `db_update.rs` (Task 1).
- Produces:
  - `DbUpdateManager::{new, is_running(&str) -> bool, versions() -> Vec<String> /* sorted */, insert(String, u32, UnboundedSender<()>) -> Result<(), String>, remove(&str), cancel(&str, force: bool) -> Result<(), String>, begin_shutdown() -> bool, terminate_all_and_wait(Duration)}`
  - Commands (frontend names): `plan_db_update({ args }) -> DbUpdatePlan`, `start_db_update({ args }) -> ()`, `cancel_db_update({ version, force }) -> ()`, `list_db_updates() -> string[]`, `read_update_log({ path }) -> string`
  - Events: `db-update-event` `{version, event}`, `db-update-log` `{version, line}`, `db-update-exited` `{version, exit_code: i32 | null}`
  - `DbListResponse.stale: Option<HashMap<String, String>>` (serialized as `null` when absent)

- [ ] **Step 1: Add the dependency** — append to `src-tauri/Cargo.toml` (if a `[target.'cfg(unix)'.dependencies]` table already exists, add only the `libc` line to it):

```toml
[target.'cfg(unix)'.dependencies]
libc = "0.2"
```

- [ ] **Step 2: Write the manager with failing tests** — create `src-tauri/src/db_update_manager.rs`:

```rust
//! Running `odoodev db update` processes — at most one per Odoo version.
//!
//! The spawned task owns the `Child` (it awaits the exit and emits
//! `db-update-exited`); the manager only keeps the pid and a channel to ask
//! that task for a forced kill, so no lock is ever held across an await.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc::UnboundedSender;

#[derive(Clone)]
struct RunHandle {
    pid: u32,
    force_kill: UnboundedSender<()>,
}

#[derive(Clone, Default)]
pub struct DbUpdateManager {
    runs: Arc<Mutex<HashMap<String, RunHandle>>>,
    shutting_down: Arc<AtomicBool>,
}

impl DbUpdateManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self, version: &str) -> bool {
        self.runs.lock().unwrap().contains_key(version)
    }

    pub fn versions(&self) -> Vec<String> {
        let mut versions: Vec<String> = self.runs.lock().unwrap().keys().cloned().collect();
        versions.sort();
        versions
    }

    pub fn insert(&self, version: String, pid: u32, force_kill: UnboundedSender<()>) -> Result<(), String> {
        let mut runs = self.runs.lock().unwrap();
        if runs.contains_key(&version) {
            return Err(format!("An update is already running for v{version}"));
        }
        runs.insert(version, RunHandle { pid, force_kill });
        Ok(())
    }

    pub fn remove(&self, version: &str) {
        self.runs.lock().unwrap().remove(version);
    }

    /// `force = false`: SIGTERM, so odoodev kills Odoo's process group and exits
    /// 130. `force = true` (or no signals, i.e. Windows): the owning task kills
    /// odoodev directly — odoo-bin may survive that.
    pub fn cancel(&self, version: &str, force: bool) -> Result<(), String> {
        let handle = self
            .runs
            .lock()
            .unwrap()
            .get(version)
            .cloned()
            .ok_or_else(|| format!("No update running for v{version}"))?;
        if force || !cfg!(unix) {
            handle
                .force_kill
                .send(())
                .map_err(|_| "The update has already finished".to_string())
        } else {
            terminate(handle.pid)
        }
    }

    /// True exactly once — the first exit request starts the graceful shutdown,
    /// the follow-up exit is let through.
    pub fn begin_shutdown(&self) -> bool {
        !self.shutting_down.swap(true, Ordering::SeqCst)
    }

    pub async fn terminate_all_and_wait(&self, timeout: Duration) {
        for version in self.versions() {
            let _ = self.cancel(&version, false);
        }
        let deadline = tokio::time::Instant::now() + timeout;
        while !self.versions().is_empty() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

#[cfg(unix)]
fn terminate(pid: u32) -> Result<(), String> {
    // SAFETY: kill(2) on a pid this process spawned and still tracks; no memory is involved.
    let rc = unsafe { libc::kill(pid as libc::pid_t, libc::SIGTERM) };
    if rc == 0 {
        Ok(())
    } else {
        Err(format!(
            "Could not signal odoodev (pid {pid}): {}",
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(not(unix))]
fn terminate(_pid: u32) -> Result<(), String> {
    Err("Signals are not supported on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn rejects_a_second_run_on_the_same_version() {
        let m = DbUpdateManager::new();
        let (tx, _rx) = unbounded_channel();
        m.insert("19".into(), 1, tx.clone()).unwrap();
        assert!(m.insert("19".into(), 2, tx.clone()).is_err());
        assert!(m.insert("18".into(), 3, tx).is_ok());
        assert_eq!(m.versions(), vec!["18", "19"]);
        assert!(m.is_running("19"));
        m.remove("19");
        assert!(!m.is_running("19"));
    }

    #[test]
    fn force_cancel_asks_the_owning_task_to_kill() {
        let m = DbUpdateManager::new();
        let (tx, mut rx) = unbounded_channel();
        m.insert("19".into(), 1, tx).unwrap();
        m.cancel("19", true).unwrap();
        assert!(rx.try_recv().is_ok());
    }

    #[test]
    fn cancel_without_a_run_is_an_error() {
        assert!(DbUpdateManager::new().cancel("19", false).is_err());
    }

    #[test]
    fn shutdown_begins_only_once() {
        let m = DbUpdateManager::new();
        assert!(m.begin_shutdown());
        assert!(!m.begin_shutdown());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminate_all_sends_sigterm_and_waits_for_the_exit() {
        let m = DbUpdateManager::new();
        let mut child = tokio::process::Command::new("sleep").arg("30").spawn().unwrap();
        let pid = child.id().unwrap();
        let (tx, _rx) = unbounded_channel();
        m.insert("19".into(), pid, tx).unwrap();
        let owner = m.clone();
        let waiter = tokio::spawn(async move {
            let status = child.wait().await.unwrap();
            owner.remove("19");
            status
        });
        let started = std::time::Instant::now();
        m.terminate_all_and_wait(Duration::from_secs(5)).await;
        assert!(m.versions().is_empty());
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(!waiter.await.unwrap().success());
    }
}
```

Add `mod db_update_manager;` to `src-tauri/src/lib.rs`.

- [ ] **Step 3: Run the manager tests**

Run: `cd src-tauri && cargo test db_update_manager::tests`
Expected: all PASS (the module is self-contained; if `libc` is missing the build fails — check Step 1).

- [ ] **Step 4: Make the command builder reusable and extend the db list model**

In `src-tauri/src/odoodev.rs` change `fn build_odoodev_command(args: &[&str]) -> Command {` to `pub fn build_odoodev_command(args: &[&str]) -> Command {`.

In `src-tauri/src/models.rs` replace the `DbListResponse` struct:

```rust
// === db list --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DbListResponse {
    pub version: String,
    pub host: String,
    pub port: u16,
    pub databases: Vec<String>,
    /// Database → reason it needs `db update` (odoodev >= 0.68.0). Absent until a
    /// `db update` state file exists; serialized as null so the GUI can tell
    /// "nothing recorded yet" from "all current".
    #[serde(default)]
    pub stale: Option<HashMap<String, String>>,
}
```

- [ ] **Step 5: Write the commands with failing tests** — create `src-tauri/src/commands/db_update.rs`:

```rust
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::db_update::{
    build_db_update_args, parse_event, tail_text, update_log_dir, validate_update_log_path, DbUpdateArgs,
    DbUpdateEvent, DbUpdatePlan, LOG_VIEW_LIMIT,
};
use crate::db_update_manager::DbUpdateManager;
use crate::odoodev;

const REQUIRES_0_69: &str = "odoodev >= 0.69.0 is required for database updates";

#[derive(Clone, Serialize)]
struct EventPayload {
    version: String,
    event: DbUpdateEvent,
}

#[derive(Clone, Serialize)]
struct LogPayload {
    version: String,
    line: String,
}

#[derive(Clone, Serialize)]
struct ExitedPayload {
    version: String,
    exit_code: Option<i32>,
}

/// Turn the output of `db update --dry-run --output ndjson` into the plan, or the
/// most useful error: the CLI's own `error` event, the "too old" hint, or the
/// last stderr line.
pub(crate) fn plan_from_output(stdout: &str, stderr: &str) -> Result<DbUpdatePlan, String> {
    let mut error = None;
    for line in stdout.lines() {
        match parse_event(line) {
            Some(DbUpdateEvent::Plan(plan)) => return Ok(plan),
            Some(DbUpdateEvent::Error { message }) => error = Some(message),
            _ => {}
        }
    }
    if let Some(message) = error {
        return Err(message);
    }
    if stderr.contains("No such option: --output") {
        return Err(REQUIRES_0_69.to_string());
    }
    let tail = stderr
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("odoodev returned no update plan");
    Err(tail.trim().to_string())
}

#[tauri::command]
pub async fn plan_db_update(args: DbUpdateArgs) -> Result<DbUpdatePlan, String> {
    let cli = build_db_update_args(&args, true)?;
    let refs: Vec<&str> = cli.iter().map(String::as_str).collect();
    let output = odoodev::build_odoodev_command(&refs)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    plan_from_output(
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    )
}

#[tauri::command]
pub async fn start_db_update(
    args: DbUpdateArgs,
    app: AppHandle,
    manager: State<'_, DbUpdateManager>,
) -> Result<(), String> {
    let cli = build_db_update_args(&args, false)?;
    let version = args.version.clone();
    if manager.is_running(&version) {
        return Err(format!("An update is already running for v{version}"));
    }

    let refs: Vec<&str> = cli.iter().map(String::as_str).collect();
    let mut child = odoodev::build_odoodev_command(&refs)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(false)
        .spawn()
        .map_err(|e| format!("Failed to spawn odoodev: {e}"))?;
    let pid = child.id().ok_or_else(|| "Failed to get the odoodev PID".to_string())?;

    let (force_tx, mut force_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    if let Err(e) = manager.insert(version.clone(), pid, force_tx) {
        let _ = child.start_kill();
        return Err(e);
    }

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    let (app_out, version_out) = (app.clone(), version.clone());
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = parse_event(&line) {
                let _ = app_out.emit(
                    "db-update-event",
                    EventPayload { version: version_out.clone(), event },
                );
            } else if !line.trim().is_empty() {
                let _ = app_out.emit(
                    "db-update-log",
                    LogPayload { version: version_out.clone(), line },
                );
            }
        }
    });

    let (app_err, version_err) = (app.clone(), version.clone());
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                let _ = app_err.emit(
                    "db-update-log",
                    LogPayload { version: version_err.clone(), line },
                );
            }
        }
    });

    let runs = manager.inner().clone();
    tokio::spawn(async move {
        let exited = tokio::select! {
            status = child.wait() => Some(status),
            _ = force_rx.recv() => None,
        };
        let status = match exited {
            Some(status) => status,
            None => {
                let _ = child.start_kill();
                child.wait().await
            }
        };
        let _ = stdout_task.await;
        let _ = stderr_task.await;
        runs.remove(&version);
        let exit_code = status.ok().and_then(|s| s.code());
        let _ = app.emit("db-update-exited", ExitedPayload { version, exit_code });
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_db_update(version: String, force: bool, manager: State<'_, DbUpdateManager>) -> Result<(), String> {
    manager.cancel(&version, force)
}

#[tauri::command]
pub fn list_db_updates(manager: State<'_, DbUpdateManager>) -> Vec<String> {
    manager.versions()
}

#[tauri::command]
pub fn read_update_log(path: String) -> Result<String, String> {
    let canon = validate_update_log_path(std::path::Path::new(&path), &update_log_dir())?;
    let bytes = std::fs::read(&canon).map_err(|e| format!("Could not read the log: {e}"))?;
    Ok(tail_text(&bytes, LOG_VIEW_LIMIT))
}

#[cfg(test)]
mod tests {
    use super::plan_from_output;
    use crate::models::DbListResponse;

    #[test]
    fn plan_is_taken_from_the_plan_event() {
        let stdout = r#"{"event":"plan","version":"19","modules":"all","targets":[],"skipped_current":["v19_a"],"server_running":false}"#;
        let plan = plan_from_output(stdout, "").unwrap();
        assert_eq!(plan.skipped_current, vec!["v19_a"]);
    }

    #[test]
    fn the_cli_error_event_wins() {
        let stdout = r#"{"event":"error","message":"PostgreSQL on 127.0.0.1:19432 is not reachable"}"#;
        assert_eq!(
            plan_from_output(stdout, "[ERROR] PostgreSQL on 127.0.0.1:19432 is not reachable").unwrap_err(),
            "PostgreSQL on 127.0.0.1:19432 is not reachable"
        );
    }

    #[test]
    fn an_old_odoodev_gets_an_upgrade_hint() {
        let err = plan_from_output("", "Error: No such option: --output\n").unwrap_err();
        assert!(err.contains("0.69.0"));
    }

    #[test]
    fn otherwise_the_last_stderr_line_is_reported() {
        assert_eq!(plan_from_output("", "first\nboom\n\n").unwrap_err(), "boom");
        assert!(!plan_from_output("", "").unwrap_err().is_empty());
    }

    #[test]
    fn db_list_stale_map_is_optional() {
        let without: DbListResponse =
            serde_json::from_str(r#"{"version":"19","host":"localhost","port":19432,"databases":["a"]}"#).unwrap();
        assert!(without.stale.is_none());
        let with: DbListResponse = serde_json::from_str(
            r#"{"version":"19","host":"localhost","port":19432,"databases":["a"],"stale":{"a":"never updated"}}"#,
        )
        .unwrap();
        assert_eq!(with.stale.unwrap()["a"], "never updated");
    }
}
```

Add `pub mod db_update;` to `src-tauri/src/commands/mod.rs` (alphabetical: after `pub mod database;`).

- [ ] **Step 6: Register state, commands and the exit hook** — in `src-tauri/src/lib.rs`:

1. Imports: add `use commands::db_update as db_update_cmd;`, `use db_update_manager::DbUpdateManager;` and `use tauri::Manager;`.
2. After `.manage(ServerManager::new())` add `.manage(DbUpdateManager::new())`.
3. In `generate_handler!` after `database::rename_db,` add:

```rust
            // database updates (odoodev >= 0.69.0)
            db_update_cmd::plan_db_update,
            db_update_cmd::start_db_update,
            db_update_cmd::cancel_db_update,
            db_update_cmd::list_db_updates,
            db_update_cmd::read_update_log,
```

4. Replace the final

```rust
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
```

with

```rust
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                let updates = app.state::<DbUpdateManager>().inner().clone();
                // Closing the GUI must not orphan odoo-bin: SIGTERM every running
                // update, wait up to 10 s, then exit for real. begin_shutdown() is
                // one-shot, so the exit triggered below passes straight through.
                if !updates.versions().is_empty() && updates.begin_shutdown() {
                    api.prevent_exit();
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        updates
                            .terminate_all_and_wait(std::time::Duration::from_secs(10))
                            .await;
                        handle.exit(0);
                    });
                }
            }
        });
```

- [ ] **Step 7: Run all Rust checks**

Run: `cd src-tauri && cargo fmt && cargo test && cargo clippy`
Expected: all tests PASS (existing + `db_update`, `db_update_manager`, `commands::db_update`); clippy reports no new warnings in the new files.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src
git commit -m "[ADD] db update: run manager, Tauri commands, SIGTERM cancel, graceful exit (Rust)"
```

---

### Task 3: Frontend foundation — version gate, types, reducer

**Files:**
- Create: `src/lib/version.ts`, `src/lib/version.test.ts`, `src/lib/dbUpdateReducer.ts`, `src/lib/dbUpdateReducer.test.ts`
- Modify: `src/types/index.ts`, `src/components/playbook/PlaybookPanel.tsx:30-40,66-71`, `src/store/appStore.ts`

**Interfaces:**
- Consumes: event shapes from Task 2 (snake_case payload keys).
- Produces:
  - `MIN_ODOODEV_DB_UPDATE = "0.69.0"`, `isAtLeast(installed: string | null | undefined, required: string): boolean`
  - Types: `DbUpdateMode`, `DbUpdateArgs`, `DbUpdatePlanTarget`, `DbUpdatePlan`, `DbUpdateResult`, `DbUpdateEvent`; `DbListResponse.stale: Record<string, string> | null`
  - Reducer: `ISSUE_CAP`, `CONSOLE_CAP`, types `DbUpdateRowStatus`, `DbUpdatePhase`, `DbUpdateIssue`, `DbUpdateRow`, `DbUpdateRun`; functions `newRun(modules, startedAt, restartServer?)`, `attachedRun(now)`, `applyEvent(run, event, now)`, `applyConsoleLine(run, line)`, `markCancelling(run, now)`, `applyExit(run, exitCode)`, `rowStatusFor(result)`, `isActive(run)`, `finishedCount(run)`

- [ ] **Step 1: Write the failing version test** — `src/lib/version.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAtLeast } from "./version";

describe("isAtLeast", () => {
  it("compares numerically, not as strings", () => {
    expect(isAtLeast("0.69.0", "0.69.0")).toBe(true);
    expect(isAtLeast("0.70.0", "0.69.0")).toBe(true);
    expect(isAtLeast("0.100.0", "0.69.0")).toBe(true);
    expect(isAtLeast("1.0.0", "0.69.0")).toBe(true);
    expect(isAtLeast("0.68.1", "0.69.0")).toBe(false);
  });

  it("ignores anything after the patch number and fills missing parts with zero", () => {
    expect(isAtLeast("0.69.0.dev1", "0.69.0")).toBe(true);
    expect(isAtLeast("0.69", "0.69.0")).toBe(true);
  });

  it("never satisfies a requirement with an unknown version", () => {
    expect(isAtLeast(null, "0.1.0")).toBe(false);
    expect(isAtLeast(undefined, "0.1.0")).toBe(false);
    expect(isAtLeast("", "0.1.0")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm test src/lib/version.test.ts` → FAIL (`Failed to resolve import "./version"`).

- [ ] **Step 3: Implement** — `src/lib/version.ts`:

```ts
/** odoodev release that introduced `db update --output ndjson`. */
export const MIN_ODOODEV_DB_UPDATE = "0.69.0";

/** True when `installed` ("0.69.1", "0.70.0.dev1") is at least `required`
 *  ("major.minor.patch"). An unknown version never satisfies a requirement. */
export function isAtLeast(installed: string | null | undefined, required: string): boolean {
  if (!installed) return false;
  const parse = (v: string) =>
    v
      .split(".")
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(installed);
  const b = parse(required);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
```

Run `pnpm test src/lib/version.test.ts` → PASS.

- [ ] **Step 4: Fix the playbook gate** (it read `odoodevVersion`, which nothing ever sets)

Confirm the field is otherwise unused: `grep -rn "odoodevVersion" src` → only `PlaybookPanel.tsx` and `store/appStore.ts`.

In `src/components/playbook/PlaybookPanel.tsx`: delete the local `isOlderThan` function (and its doc comment), add `import { isAtLeast } from "../../lib/version";`, and replace

```ts
  const odoodevVersion = useAppStore((s) => s.odoodevVersion);
```
with
```ts
  const odoodevVersion = useAppStore((s) => s.odoodevInfo?.version ?? null);
```
and
```ts
  const legacyStreaming = isOlderThan(odoodevVersion, "0.51.0");
```
with
```ts
  // Unknown version: don't nag (same as before) — only a known old CLI is "legacy".
  const legacyStreaming = odoodevVersion !== null && !isAtLeast(odoodevVersion, "0.51.0");
```

In `src/store/appStore.ts` remove `odoodevVersion: string | null;` from `AppState` and `odoodevVersion: null,` from the initial state.

- [ ] **Step 5: Types** — in `src/types/index.ts` replace `DbListResponse` and add the update types directly below it:

```ts
export interface DbListResponse {
  version: string;
  host: string;
  port: number;
  databases: string[];
  /** Database → reason it needs `db update`; null until odoodev recorded any update. */
  stale: Record<string, string> | null;
}

export type DbUpdateMode = "names" | "stale" | "all";

/** Argument of plan_db_update / start_db_update (camelCase on the wire). */
export interface DbUpdateArgs {
  version: string;
  mode: DbUpdateMode;
  names: string[];
  modules: string;
  stopOnError: boolean;
  timeoutSeconds: number | null;
}

export interface DbUpdatePlanTarget {
  database: string;
  reason: string | null;
}

export interface DbUpdatePlan {
  version: string;
  modules: string;
  targets: DbUpdatePlanTarget[];
  skipped_current: string[];
  server_running: boolean;
}

export interface DbUpdateResult {
  database: string;
  ok: boolean;
  exit_code: number;
  duration_s: number;
  warnings: number;
  errors: number;
  last_error: string | null;
  timed_out: boolean;
  log: string;
}

/** One `db update --output ndjson` event as re-emitted by the backend. */
export type DbUpdateEvent =
  | ({ event: "plan" } & DbUpdatePlan)
  | { event: "start"; database: string; index: number; total: number; log: string }
  | { event: "issue"; database: string; level: string; text: string }
  | ({ event: "result" } & DbUpdateResult)
  | { event: "summary"; results: DbUpdateResult[]; skipped_current: string[]; exit_code: number }
  | { event: "interrupted"; database: string | null }
  | { event: "error"; message: string };
```

- [ ] **Step 6: Write the failing reducer tests** — `src/lib/dbUpdateReducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { DbUpdateEvent, DbUpdateResult } from "../types";
import {
  CONSOLE_CAP,
  ISSUE_CAP,
  applyConsoleLine,
  applyEvent,
  applyExit,
  finishedCount,
  isActive,
  markCancelling,
  newRun,
  rowStatusFor,
  type DbUpdateRun,
} from "./dbUpdateReducer";

const plan: DbUpdateEvent = {
  event: "plan",
  version: "19",
  modules: "all",
  targets: [
    { database: "v19_a", reason: "never updated" },
    { database: "v19_b", reason: null },
  ],
  skipped_current: ["v19_c"],
  server_running: false,
};

const resultFields = (database: string, over: Partial<DbUpdateResult> = {}): DbUpdateResult => ({
  database,
  ok: true,
  exit_code: 0,
  duration_s: 12.5,
  warnings: 0,
  errors: 0,
  last_error: null,
  timed_out: false,
  log: `/logs/update_v19_${database}.log`,
  ...over,
});
const result = (database: string, over: Partial<DbUpdateResult> = {}): DbUpdateEvent => ({
  event: "result",
  ...resultFields(database, over),
});
const start = (database: string, index: number): DbUpdateEvent => ({
  event: "start",
  database,
  index,
  total: 2,
  log: `/logs/update_v19_${database}.log`,
});
const replay = (...events: DbUpdateEvent[]): DbUpdateRun =>
  events.reduce((run, e) => applyEvent(run, e, 1000), newRun("all", 0));

describe("applyEvent", () => {
  it("creates pending rows in plan order", () => {
    const run = replay(plan);
    expect(run.order).toEqual(["v19_a", "v19_b"]);
    expect(run.rows.v19_a).toMatchObject({ status: "pending", reason: "never updated" });
    expect(run.skippedCurrent).toEqual(["v19_c"]);
  });

  it("follows a complete run", () => {
    const run = replay(
      plan,
      start("v19_a", 1),
      { event: "issue", database: "v19_a", level: "WARNING", text: "odoo.x: dubious" },
      result("v19_a", { warnings: 1 }),
      start("v19_b", 2),
      result("v19_b", { errors: 2, last_error: "odoo.y: boom" }),
      { event: "summary", results: [], skipped_current: ["v19_c"], exit_code: 0 },
    );
    expect(run.phase).toBe("finished");
    expect(run.rows.v19_a).toMatchObject({ status: "ok", warnings: 1, startedAt: 1000, durationS: 12.5 });
    expect(run.rows.v19_a.issues).toEqual([{ level: "WARNING", text: "odoo.x: dubious" }]);
    expect(run.rows.v19_b).toMatchObject({ status: "okWithErrors", lastError: "odoo.y: boom" });
    expect(finishedCount(run)).toBe(2);
    expect(isActive(run)).toBe(false);
  });

  it("caps issues per database and counts the rest", () => {
    let run = replay(plan, start("v19_a", 1));
    for (let i = 0; i <= ISSUE_CAP; i++) {
      run = applyEvent(run, { event: "issue", database: "v19_a", level: "RAW", text: `line ${i}` }, 1000);
    }
    expect(run.rows.v19_a.issues).toHaveLength(ISSUE_CAP);
    expect(run.rows.v19_a.issuesTruncated).toBe(1);
  });

  it("marks the interrupted database and keeps finished ones", () => {
    const run = replay(plan, start("v19_a", 1), result("v19_a"), start("v19_b", 2), {
      event: "interrupted",
      database: "v19_b",
    });
    expect(run.phase).toBe("interrupted");
    expect(run.rows.v19_a.status).toBe("ok");
    expect(run.rows.v19_b.status).toBe("interrupted");
    expect(applyExit(run, 130).phase).toBe("interrupted");
  });

  it("keeps the CLI's error message", () => {
    const run = applyExit(replay({ event: "error", message: "Development environment not ready" }), 1);
    expect(run.phase).toBe("error");
    expect(run.errorMessage).toBe("Development environment not ready");
  });

  it("creates a row for a start without a plan (re-attached after a reload)", () => {
    const run = replay(start("v19_x", 1));
    expect(run.order).toEqual(["v19_x"]);
    expect(run.rows.v19_x.status).toBe("running");
  });
});

describe("rowStatusFor", () => {
  it("distinguishes failure and timeout", () => {
    expect(rowStatusFor(resultFields("a", { ok: false, exit_code: 255 }))).toBe("failed");
    expect(rowStatusFor(resultFields("a", { ok: false, exit_code: 124, timed_out: true }))).toBe("timedOut");
  });
});

describe("applyExit", () => {
  it("turns an exit without summary into an error and stops running rows", () => {
    const run = applyExit(replay(plan, start("v19_a", 1)), 1);
    expect(run.phase).toBe("error");
    expect(run.rows.v19_a.status).toBe("interrupted");
    expect(run.errorMessage).toBe("odoodev exited with code 1");
  });

  it("treats any exit after a cancel request as interrupted (forced kill has no code)", () => {
    const run = applyExit(markCancelling(replay(plan, start("v19_a", 1)), 5000), null);
    expect(run.phase).toBe("interrupted");
    expect(run.rows.v19_a.status).toBe("interrupted");
  });

  it("does not override a finished run", () => {
    const finished = replay(plan, { event: "summary", results: [], skipped_current: [], exit_code: 1 });
    expect(applyExit(finished, 1).phase).toBe("finished");
  });
});

describe("applyConsoleLine", () => {
  it("keeps the newest lines up to the cap", () => {
    let run = newRun("all", 0);
    for (let i = 0; i <= CONSOLE_CAP; i++) run = applyConsoleLine(run, `line ${i}`);
    expect(run.console).toHaveLength(CONSOLE_CAP);
    expect(run.console[0]).toBe("line 1");
  });
});
```

- [ ] **Step 7: Run it** — `pnpm test src/lib/dbUpdateReducer.test.ts` → FAIL (`Failed to resolve import "./dbUpdateReducer"`).

- [ ] **Step 8: Implement** — `src/lib/dbUpdateReducer.ts`:

```ts
import type { DbUpdateEvent, DbUpdateResult, StartServerArgs } from "../types";

export const ISSUE_CAP = 500;
export const CONSOLE_CAP = 2000;

export type DbUpdateRowStatus =
  | "pending"
  | "running"
  | "ok"
  | "okWithErrors"
  | "failed"
  | "timedOut"
  | "interrupted";

export type DbUpdatePhase = "running" | "cancelling" | "finished" | "interrupted" | "error";

export interface DbUpdateIssue {
  level: string;
  text: string;
}

export interface DbUpdateRow {
  database: string;
  status: DbUpdateRowStatus;
  reason: string | null;
  startedAt: number | null;
  durationS: number | null;
  warnings: number;
  errors: number;
  lastError: string | null;
  log: string | null;
  issues: DbUpdateIssue[];
  issuesTruncated: number;
}

export interface DbUpdateRun {
  phase: DbUpdatePhase;
  modules: string;
  startedAt: number;
  order: string[];
  rows: Record<string, DbUpdateRow>;
  skippedCurrent: string[];
  console: string[];
  exitCode: number | null;
  errorMessage: string | null;
  cancelRequestedAt: number | null;
  /** Server config to start again when the run ends ("stop, update, restart"). */
  restartServer: StartServerArgs | null;
  /** Re-attached after a webview reload — earlier events were not seen. */
  detailsLost: boolean;
}

export function newRun(modules: string, startedAt: number, restartServer: StartServerArgs | null = null): DbUpdateRun {
  return {
    phase: "running",
    modules,
    startedAt,
    order: [],
    rows: {},
    skippedCurrent: [],
    console: [],
    exitCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    restartServer,
    detailsLost: false,
  };
}

export function attachedRun(now: number): DbUpdateRun {
  return { ...newRun("?", now), detailsLost: true };
}

function emptyRow(database: string, reason: string | null = null): DbUpdateRow {
  return {
    database,
    status: "pending",
    reason,
    startedAt: null,
    durationS: null,
    warnings: 0,
    errors: 0,
    lastError: null,
    log: null,
    issues: [],
    issuesTruncated: 0,
  };
}

function withRow(run: DbUpdateRun, database: string, update: (row: DbUpdateRow) => DbUpdateRow): DbUpdateRun {
  const existing = run.rows[database];
  return {
    ...run,
    order: existing ? run.order : [...run.order, database],
    rows: { ...run.rows, [database]: update(existing ?? emptyRow(database)) },
  };
}

function interruptRunningRows(run: DbUpdateRun): DbUpdateRun {
  const rows = { ...run.rows };
  for (const db of run.order) {
    if (rows[db].status === "running") rows[db] = { ...rows[db], status: "interrupted" };
  }
  return { ...run, rows };
}

export function rowStatusFor(result: DbUpdateResult): DbUpdateRowStatus {
  if (result.timed_out) return "timedOut";
  if (!result.ok) return "failed";
  return result.errors > 0 ? "okWithErrors" : "ok";
}

export function isActive(run: DbUpdateRun | undefined): boolean {
  return run !== undefined && (run.phase === "running" || run.phase === "cancelling");
}

export function finishedCount(run: DbUpdateRun): number {
  return run.order.filter((db) => {
    const status = run.rows[db].status;
    return status !== "pending" && status !== "running";
  }).length;
}

export function applyEvent(run: DbUpdateRun, event: DbUpdateEvent, now: number): DbUpdateRun {
  switch (event.event) {
    case "plan": {
      const rows: Record<string, DbUpdateRow> = {};
      for (const target of event.targets) rows[target.database] = emptyRow(target.database, target.reason);
      return {
        ...run,
        modules: event.modules,
        order: event.targets.map((target) => target.database),
        rows,
        skippedCurrent: event.skipped_current,
      };
    }
    case "start":
      return withRow(run, event.database, (row) => ({ ...row, status: "running", startedAt: now, log: event.log }));
    case "issue":
      return withRow(run, event.database, (row) =>
        row.issues.length >= ISSUE_CAP
          ? { ...row, issuesTruncated: row.issuesTruncated + 1 }
          : { ...row, issues: [...row.issues, { level: event.level, text: event.text }] },
      );
    case "result":
      return withRow(run, event.database, (row) => ({
        ...row,
        status: rowStatusFor(event),
        durationS: event.duration_s,
        warnings: event.warnings,
        errors: event.errors,
        lastError: event.last_error,
        log: event.log,
      }));
    case "summary":
      return { ...run, phase: "finished", exitCode: event.exit_code, skippedCurrent: event.skipped_current };
    case "interrupted": {
      const marked = event.database
        ? withRow(run, event.database, (row) => ({ ...row, status: "interrupted" }))
        : run;
      return { ...interruptRunningRows(marked), phase: "interrupted" };
    }
    case "error":
      return { ...run, phase: "error", errorMessage: event.message };
  }
}

export function applyConsoleLine(run: DbUpdateRun, line: string): DbUpdateRun {
  const lines = run.console.length >= CONSOLE_CAP ? [...run.console.slice(1), line] : [...run.console, line];
  return { ...run, console: lines };
}

export function markCancelling(run: DbUpdateRun, now: number): DbUpdateRun {
  return isActive(run) ? { ...run, phase: "cancelling", cancelRequestedAt: now } : run;
}

export function applyExit(run: DbUpdateRun, exitCode: number | null): DbUpdateRun {
  if (!isActive(run)) return { ...run, exitCode: run.exitCode ?? exitCode };
  if (exitCode === 0) return { ...run, phase: "finished", exitCode };
  if (exitCode === 130 || run.phase === "cancelling") {
    return { ...interruptRunningRows(run), phase: "interrupted", exitCode };
  }
  return {
    ...interruptRunningRows(run),
    phase: "error",
    exitCode,
    errorMessage: run.errorMessage ?? `odoodev exited with code ${exitCode ?? "unknown"}`,
  };
}
```

- [ ] **Step 9: Run tests, types, lint**

Run: `pnpm test && pnpm run typecheck && pnpm run lint`
Expected: all PASS (`DatabasePanel` still compiles: it only reads `databases`/`host`/`port`).

- [ ] **Step 10: Commit**

```bash
git add src/lib/version.ts src/lib/version.test.ts src/lib/dbUpdateReducer.ts src/lib/dbUpdateReducer.test.ts src/types/index.ts src/components/playbook/PlaybookPanel.tsx src/store/appStore.ts
git commit -m "[ADD] db update: version gate, event types and run reducer; fix never-firing playbook gate"
```

---

### Task 4: Run store, runner and global event listeners

**Files:**
- Create: `src/store/dbUpdateStore.ts`, `src/store/dbUpdateStore.test.ts`, `src/lib/dbUpdateRunner.ts`, `src/hooks/useDbUpdateEvents.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: reducer functions and types from Task 3; commands/events from Task 2; `useAppStore` (`servers`, `stopServer(version, keepDocker)`, `startServer(args)`); toasts `toast`, `toastSuccess`, `toastError` from `store/toastStore`.
- Produces:
  - `useDbUpdateStore` with `runs: Record<string, DbUpdateRun>` and actions `begin(version, modules, restartServer)`, `event(version, event)`, `consoleLine(version, line)`, `exited(version, exitCode) => DbUpdateRun | undefined`, `cancelling(version)`, `clearRestart(version)`, `dismiss(version)`, `attach(versions)`
  - `type ServerChoice = "restart" | "ignore"`; `startDbUpdate(args: DbUpdateArgs, serverChoice: ServerChoice | null): Promise<void>`; `restartServerAfterUpdate(version): Promise<boolean>`; `cancelDbUpdate(version, force): Promise<void>`
  - `useDbUpdateEvents()` — call once in `App`
  - i18n keys used here (added in Task 5): `database.updateFinishedOk`, `database.updateFinishedFailed`, `database.updateInterrupted`, `database.updateFailed`, `database.updateRestartingServer`, `database.updateRestartFailed`

- [ ] **Step 1: Write the failing store test** — `src/store/dbUpdateStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useDbUpdateStore } from "./dbUpdateStore";

describe("dbUpdateStore", () => {
  beforeEach(() => useDbUpdateStore.setState({ runs: {} }));

  it("keeps runs per version and reports the run that exited", () => {
    const s = useDbUpdateStore.getState();
    s.begin("19", "all", null);
    s.begin("18", "eq_base", null);
    s.event("19", { event: "start", database: "v19_a", index: 1, total: 1, log: "/l.log" });
    const exited = useDbUpdateStore.getState().exited("19", 0);
    expect(exited?.phase).toBe("finished");
    expect(useDbUpdateStore.getState().runs["18"].phase).toBe("running");
  });

  it("returns undefined when an unknown version exits", () => {
    expect(useDbUpdateStore.getState().exited("17", 0)).toBeUndefined();
  });

  it("attaches unknown running versions without touching known runs", () => {
    const s = useDbUpdateStore.getState();
    s.begin("19", "all", null);
    s.attach(["19", "18"]);
    const runs = useDbUpdateStore.getState().runs;
    expect(runs["19"].detailsLost).toBe(false);
    expect(runs["18"].detailsLost).toBe(true);
  });

  it("clears the restart config exactly once and dismisses a run", () => {
    const s = useDbUpdateStore.getState();
    s.begin("19", "all", { version: "19", database: "v19_a" });
    s.clearRestart("19");
    expect(useDbUpdateStore.getState().runs["19"].restartServer).toBeNull();
    s.dismiss("19");
    expect(useDbUpdateStore.getState().runs["19"]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it** — `pnpm test src/store/dbUpdateStore.test.ts` → FAIL (`Failed to resolve import "./dbUpdateStore"`).

- [ ] **Step 3: Implement the store** — `src/store/dbUpdateStore.ts`:

```ts
import { create } from "zustand";
import type { DbUpdateEvent, StartServerArgs } from "../types";
import {
  applyConsoleLine,
  applyEvent,
  applyExit,
  attachedRun,
  markCancelling,
  newRun,
  type DbUpdateRun,
} from "../lib/dbUpdateReducer";

interface DbUpdateState {
  runs: Record<string, DbUpdateRun>;
  begin: (version: string, modules: string, restartServer: StartServerArgs | null) => void;
  event: (version: string, event: DbUpdateEvent) => void;
  consoleLine: (version: string, line: string) => void;
  exited: (version: string, exitCode: number | null) => DbUpdateRun | undefined;
  cancelling: (version: string) => void;
  clearRestart: (version: string) => void;
  dismiss: (version: string) => void;
  attach: (versions: string[]) => void;
}

/** Per-version `db update` runs. Lives outside any view so progress survives navigation. */
export const useDbUpdateStore = create<DbUpdateState>((set, get) => ({
  runs: {},

  begin: (version, modules, restartServer) =>
    set((s) => ({ runs: { ...s.runs, [version]: newRun(modules, Date.now(), restartServer) } })),

  event: (version, event) =>
    set((s) => ({
      runs: { ...s.runs, [version]: applyEvent(s.runs[version] ?? attachedRun(Date.now()), event, Date.now()) },
    })),

  consoleLine: (version, line) =>
    set((s) => ({
      runs: { ...s.runs, [version]: applyConsoleLine(s.runs[version] ?? attachedRun(Date.now()), line) },
    })),

  exited: (version, exitCode) => {
    const run = get().runs[version];
    if (!run) return undefined;
    const next = applyExit(run, exitCode);
    set((s) => ({ runs: { ...s.runs, [version]: next } }));
    return next;
  },

  cancelling: (version) =>
    set((s) => {
      const run = s.runs[version];
      return run ? { runs: { ...s.runs, [version]: markCancelling(run, Date.now()) } } : s;
    }),

  clearRestart: (version) =>
    set((s) => {
      const run = s.runs[version];
      return run ? { runs: { ...s.runs, [version]: { ...run, restartServer: null } } } : s;
    }),

  dismiss: (version) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[version];
      return { runs };
    }),

  attach: (versions) =>
    set((s) => {
      const runs = { ...s.runs };
      for (const version of versions) {
        if (!runs[version]) runs[version] = attachedRun(Date.now());
      }
      return { runs };
    }),
}));
```

Run `pnpm test src/store/dbUpdateStore.test.ts` → PASS. (If TypeScript rejects the partial `StartServerArgs` literal in the test, it is complete: `version` is its only required field.)

- [ ] **Step 4: Implement the runner** — `src/lib/dbUpdateRunner.ts`:

```ts
import { invokeCmd } from "./tauri";
import { useAppStore } from "../store/appStore";
import { useDbUpdateStore } from "../store/dbUpdateStore";
import type { DbUpdateArgs, StartServerArgs } from "../types";

/** What to do with an Odoo server running on the version: stop it and start it
 *  again afterwards, or leave it running. `null` = no server running. */
export type ServerChoice = "restart" | "ignore";

export async function startDbUpdate(args: DbUpdateArgs, serverChoice: ServerChoice | null): Promise<void> {
  const app = useAppStore.getState();
  const updates = useDbUpdateStore.getState();
  let restart: StartServerArgs | null = null;
  if (serverChoice === "restart") {
    restart = app.servers[args.version]?.config ?? null;
    // keepDocker must stay true: the update needs PostgreSQL.
    await app.stopServer(args.version, true);
  }
  updates.begin(args.version, args.modules, restart);
  try {
    await invokeCmd("start_db_update", { args });
  } catch (e) {
    updates.event(args.version, { event: "error", message: String(e) });
    updates.exited(args.version, 1);
    await restartServerAfterUpdate(args.version);
    throw e;
  }
}

/** Start the server again with the configuration it had before the update — once. */
export async function restartServerAfterUpdate(version: string): Promise<boolean> {
  const updates = useDbUpdateStore.getState();
  const config = updates.runs[version]?.restartServer;
  if (!config) return false;
  updates.clearRestart(version);
  await useAppStore.getState().startServer(config);
  return true;
}

/** SIGTERM (force = false) lets odoodev stop odoo-bin cleanly; force kills odoodev only. */
export async function cancelDbUpdate(version: string, force: boolean): Promise<void> {
  useDbUpdateStore.getState().cancelling(version);
  await invokeCmd("cancel_db_update", { version, force });
}
```

- [ ] **Step 5: Implement the listeners** — `src/hooks/useDbUpdateEvents.ts`:

```ts
import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../lib/tauri";
import { finishedCount } from "../lib/dbUpdateReducer";
import { restartServerAfterUpdate } from "../lib/dbUpdateRunner";
import { useDbUpdateStore } from "../store/dbUpdateStore";
import { toast, toastError, toastSuccess } from "../store/toastStore";
import type { DbUpdateEvent } from "../types";

/** Global listeners for `db update` runs — mount once in App. */
export function useDbUpdateEvents() {
  const { t } = useTranslation();

  useEffect(() => {
    const store = useDbUpdateStore.getState;
    let disposed = false;
    let unlistens: UnlistenFn[] = [];

    (async () => {
      const subscriptions = await Promise.all([
        listen<{ version: string; event: DbUpdateEvent }>("db-update-event", (e) =>
          store().event(e.payload.version, e.payload.event),
        ),
        listen<{ version: string; line: string }>("db-update-log", (e) =>
          store().consoleLine(e.payload.version, e.payload.line),
        ),
        listen<{ version: string; exit_code: number | null }>("db-update-exited", (e) => {
          const { version, exit_code } = e.payload;
          const run = store().exited(version, exit_code);
          if (!run) return;
          const failed = run.order.filter((db) => ["failed", "timedOut"].includes(run.rows[db].status)).length;
          if (run.phase === "finished" && failed === 0) {
            toastSuccess(t("database.updateFinishedOk", { count: finishedCount(run) }));
          } else if (run.phase === "finished") {
            toastError(t("database.updateFinishedFailed", { failed, total: run.order.length }));
          } else if (run.phase === "interrupted") {
            toast("info", t("database.updateInterrupted"));
          } else {
            toastError(t("database.updateFailed"), run.errorMessage ?? undefined);
          }
          if (run.restartServer) {
            toast("info", t("database.updateRestartingServer", { version }));
            restartServerAfterUpdate(version).catch((err) =>
              toastError(t("database.updateRestartFailed"), String(err)),
            );
          }
        }),
      ]);
      if (disposed) {
        subscriptions.forEach((unlisten) => unlisten());
        return;
      }
      unlistens = subscriptions;
      // After a webview reload the backend may still be running updates.
      const running = await invokeCmd<string[]>("list_db_updates").catch(() => [] as string[]);
      if (!disposed) store().attach(running);
    })();

    return () => {
      disposed = true;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, [t]);
}
```

- [ ] **Step 6: Mount it** — in `src/App.tsx` add `import { useDbUpdateEvents } from "./hooks/useDbUpdateEvents";` and, as the first line inside `App()` after the `useState` declarations, `useDbUpdateEvents();`.

- [ ] **Step 7: Add all translation keys now** — the hook uses `database.update*` keys, and `locales.test.ts` fails on any unresolved key. Perform **Task 5, Step 1 and Step 2** (the English and German key blocks) as part of this task.

- [ ] **Step 8: Checks** — `pnpm test && pnpm run typecheck && pnpm run lint` → PASS (including `locales.test.ts`).

- [ ] **Step 9: Commit**

```bash
git add src/store/dbUpdateStore.ts src/store/dbUpdateStore.test.ts src/lib/dbUpdateRunner.ts src/hooks/useDbUpdateEvents.ts src/App.tsx src/locales/en.json src/locales/de.json
git commit -m "[ADD] db update: run store, runner with stop-update-restart, global event listeners, DE/EN strings"
```

---

### Task 5: Translations and the start dialog

**Files:**
- Create: `src/components/database/DbUpdateDialog.tsx`
- Modify (done in Task 4, Step 7): `src/locales/en.json:241`, `src/locales/de.json:241`

**Interfaces:**
- Consumes: `startDbUpdate`, `ServerChoice` (Task 4); `DbUpdateArgs`, `DbUpdateMode`, `DbUpdatePlan` (Task 3); UI `Dialog`, `DialogHeader`, `DialogTitle`, `DialogFooter`, `Button`, `Input`, `Checkbox`.
- Produces: `<DbUpdateDialog open onClose version mode names />` — mount it only while open (it snapshots `names` on mount); all `database.*` update/bulk-drop keys (used by Tasks 4, 6, 7, 8).

> Steps 1 and 2 are executed in Task 4 (Step 7). When you reach this task, verify with `grep -c '"updateRunningIndicator"' src/locales/en.json src/locales/de.json` (expected `1` each) and continue with Step 3.

- [ ] **Step 1: Add the English keys** — in `src/locales/en.json` replace the line

```json
    "dropSelectedCount": "Drop selected ({{count}})"
```
with
```json
    "dropSelectedCount": "Drop selected ({{count}})",
    "bulkDropping": "Dropping {{count}} database(s)...",
    "bulkDropDone": "Dropped {{count}} database(s)",
    "bulkDropFailed": "{{failed}} of {{total}} database(s) could not be dropped",
    "staleBadge": "stale",
    "updateAll": "Update all",
    "updateStaleCount": "Update stale ({{count}})",
    "updateSelectedCount": "Update selected ({{count}})",
    "updateRequiresVersion": "Requires odoodev ≥ {{version}} — update it in Settings",
    "updateRunningHere": "An update is already running for this version",
    "updateDialogTitle": "Update databases (v{{version}})",
    "updatePlanLoading": "Checking which databases need an update…",
    "updatePlanTargets": "Will be updated",
    "updatePlanSkipped": "Up to date, skipped: {{names}}",
    "updateNothingToDo": "All selected databases are up to date.",
    "updateModules": "Modules",
    "updateModulesHint": "all = full update. A partial update never marks a database as current.",
    "updateStopOnError": "Stop at the first failed database",
    "updateTimeout": "Timeout per database (minutes)",
    "updateServerRunning": "An Odoo server is running on v{{version}}.",
    "updateServerRestart": "Stop the server, update, then restart it",
    "updateServerIgnore": "Update anyway (restart the server yourself afterwards)",
    "updateServerExternal": "The server was not started from this app — restart it yourself after the update.",
    "updateStart": "Start update",
    "updatePanelTitle": "Update v{{version}} · -u {{modules}}",
    "updateProgress": "{{done}}/{{total}}",
    "updateCancelTitle": "Cancel the running update?",
    "updateCancelDescription": "{{database}} will not be marked as current.",
    "updateCancelDescriptionIdle": "The remaining databases will not be updated.",
    "updateCancelConfirm": "Stop update",
    "updateCancelling": "Stopping…",
    "updateCancelFailed": "Could not cancel the update",
    "updateForceStop": "Force stop",
    "updateForceStopHint": "odoodev is not responding. A forced stop may leave odoo-bin running on the database.",
    "updateWindowsCancelHint": "On Windows cancelling stops odoodev only; odoo-bin may keep running.",
    "updateStatusPending": "waiting",
    "updateStatusRunning": "running",
    "updateStatusOk": "updated",
    "updateStatusOkWithErrors": "errors in the log",
    "updateStatusFailed": "failed",
    "updateStatusTimedOut": "timed out",
    "updateStatusInterrupted": "interrupted",
    "updateWarnings_one": "{{count}} warning",
    "updateWarnings_other": "{{count}} warnings",
    "updateErrors_one": "{{count}} error",
    "updateErrors_other": "{{count}} errors",
    "updateIssuesTruncated": "{{count}} more entries — see the log",
    "updateOpenLog": "Open log",
    "updateConsole": "Console",
    "updateDetailsLost": "Details from before the reload are unavailable.",
    "updateFinishedOk": "Update finished: {{count}} database(s) updated",
    "updateFinishedFailed": "Update finished: {{failed}} of {{total}} database(s) failed",
    "updateInterrupted": "Update interrupted",
    "updateFailed": "Update failed",
    "updateRestartingServer": "Restarting the Odoo server v{{version}}…",
    "updateRestartFailed": "Could not restart the Odoo server",
    "updateLogTitle": "Update log",
    "updateRunningIndicator": "Update v{{version}} running ({{done}}/{{total}})"
```

- [ ] **Step 2: Add the German keys** — in `src/locales/de.json` replace the line

```json
    "dropSelectedCount": "Ausgewählte löschen ({{count}})"
```
with
```json
    "dropSelectedCount": "Ausgewählte löschen ({{count}})",
    "bulkDropping": "{{count}} Datenbank(en) werden gelöscht …",
    "bulkDropDone": "{{count}} Datenbank(en) gelöscht",
    "bulkDropFailed": "{{failed}} von {{total}} Datenbank(en) konnten nicht gelöscht werden",
    "staleBadge": "veraltet",
    "updateAll": "Alle aktualisieren",
    "updateStaleCount": "Veraltete aktualisieren ({{count}})",
    "updateSelectedCount": "Ausgewählte aktualisieren ({{count}})",
    "updateRequiresVersion": "Benötigt odoodev ≥ {{version}} – bitte in den Einstellungen aktualisieren",
    "updateRunningHere": "Für diese Version läuft bereits ein Update",
    "updateDialogTitle": "Datenbanken aktualisieren (v{{version}})",
    "updatePlanLoading": "Prüfe, welche Datenbanken ein Update brauchen …",
    "updatePlanTargets": "Wird aktualisiert",
    "updatePlanSkipped": "Aktuell, übersprungen: {{names}}",
    "updateNothingToDo": "Alle ausgewählten Datenbanken sind aktuell.",
    "updateModules": "Module",
    "updateModulesHint": "all = vollständiges Update. Ein Teil-Update markiert eine Datenbank nie als aktuell.",
    "updateStopOnError": "Bei der ersten fehlgeschlagenen Datenbank abbrechen",
    "updateTimeout": "Zeitlimit je Datenbank (Minuten)",
    "updateServerRunning": "Auf v{{version}} läuft ein Odoo-Server.",
    "updateServerRestart": "Server stoppen, aktualisieren, danach neu starten",
    "updateServerIgnore": "Trotzdem aktualisieren (Server danach selbst neu starten)",
    "updateServerExternal": "Der Server wurde nicht aus dieser App gestartet – nach dem Update bitte selbst neu starten.",
    "updateStart": "Update starten",
    "updatePanelTitle": "Update v{{version}} · -u {{modules}}",
    "updateProgress": "{{done}}/{{total}}",
    "updateCancelTitle": "Laufendes Update abbrechen?",
    "updateCancelDescription": "{{database}} wird nicht als aktuell markiert.",
    "updateCancelDescriptionIdle": "Die übrigen Datenbanken werden nicht aktualisiert.",
    "updateCancelConfirm": "Update stoppen",
    "updateCancelling": "Wird gestoppt …",
    "updateCancelFailed": "Update konnte nicht abgebrochen werden",
    "updateForceStop": "Hart beenden",
    "updateForceStopHint": "odoodev reagiert nicht. Hartes Beenden kann odoo-bin auf der Datenbank weiterlaufen lassen.",
    "updateWindowsCancelHint": "Unter Windows beendet Abbrechen nur odoodev; odoo-bin kann weiterlaufen.",
    "updateStatusPending": "wartet",
    "updateStatusRunning": "läuft",
    "updateStatusOk": "aktualisiert",
    "updateStatusOkWithErrors": "Fehler im Log",
    "updateStatusFailed": "fehlgeschlagen",
    "updateStatusTimedOut": "Zeitlimit überschritten",
    "updateStatusInterrupted": "abgebrochen",
    "updateWarnings_one": "{{count}} Warnung",
    "updateWarnings_other": "{{count}} Warnungen",
    "updateErrors_one": "{{count}} Fehler",
    "updateErrors_other": "{{count}} Fehler",
    "updateIssuesTruncated": "{{count}} weitere Einträge – siehe Log",
    "updateOpenLog": "Log öffnen",
    "updateConsole": "Konsole",
    "updateDetailsLost": "Details von vor dem Neuladen sind nicht verfügbar.",
    "updateFinishedOk": "Update abgeschlossen: {{count}} Datenbank(en) aktualisiert",
    "updateFinishedFailed": "Update abgeschlossen: {{failed}} von {{total}} Datenbank(en) fehlgeschlagen",
    "updateInterrupted": "Update abgebrochen",
    "updateFailed": "Update fehlgeschlagen",
    "updateRestartingServer": "Odoo-Server v{{version}} wird neu gestartet …",
    "updateRestartFailed": "Odoo-Server konnte nicht neu gestartet werden",
    "updateLogTitle": "Update-Log",
    "updateRunningIndicator": "Update v{{version}} läuft ({{done}}/{{total}})"
```

Run `pnpm test src/locales/locales.test.ts` → PASS (identical key sets, same placeholders, the hook's keys resolve).

- [ ] **Step 3: Implement the dialog** — `src/components/database/DbUpdateDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { invokeCmd } from "../../lib/tauri";
import { startDbUpdate, type ServerChoice } from "../../lib/dbUpdateRunner";
import { useAppStore } from "../../store/appStore";
import { toastError } from "../../store/toastStore";
import type { DbUpdateArgs, DbUpdateMode, DbUpdatePlan } from "../../types";

/** Mount only while open: the target list is taken once, and the plan is a
 *  `db update --dry-run` of exactly that selection. */
export function DbUpdateDialog({
  open,
  onClose,
  version,
  mode,
  names,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  mode: DbUpdateMode;
  names: string[];
}) {
  const { t } = useTranslation();
  const [targetNames] = useState(() => names);
  const serverConfig = useAppStore((s) =>
    s.servers[version]?.status?.running ? (s.servers[version]?.config ?? null) : null,
  );
  const [plan, setPlan] = useState<DbUpdatePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [modules, setModules] = useState("all");
  const [stopOnError, setStopOnError] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState("60");
  const [serverChoice, setServerChoice] = useState<ServerChoice>("restart");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const planArgs: DbUpdateArgs = {
      version,
      mode,
      names: targetNames,
      modules: "all",
      stopOnError: false,
      timeoutSeconds: null,
    };
    invokeCmd<DbUpdatePlan>("plan_db_update", { args: planArgs })
      .then((p) => {
        if (!cancelled) setPlan(p);
      })
      .catch((e) => {
        if (!cancelled) setPlanError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [version, mode, targetNames]);

  const targets = plan?.targets ?? [];

  const handleStart = async () => {
    const minutes = parseInt(timeoutMinutes, 10);
    const args: DbUpdateArgs = {
      version,
      mode,
      names: targetNames,
      modules: modules.trim() || "all",
      stopOnError,
      timeoutSeconds: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null,
    };
    setStarting(true);
    try {
      await startDbUpdate(args, plan?.server_running && serverConfig ? serverChoice : null);
      onClose();
    } catch (e) {
      toastError(t("database.updateFailed"), String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("database.updateDialogTitle", { version })}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        {!plan && !planError && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("database.updatePlanLoading")}
          </div>
        )}
        {planError && <p className="text-destructive">{planError}</p>}
        {plan && (
          <div className="space-y-2">
            {targets.length === 0 ? (
              <p className="text-muted-foreground">{t("database.updateNothingToDo")}</p>
            ) : (
              <>
                <p className="font-medium">{t("database.updatePlanTargets")}</p>
                <ul className="max-h-40 overflow-auto rounded-md border border-border p-2 font-mono text-xs">
                  {targets.map((target) => (
                    <li key={target.database}>
                      {target.database}
                      {target.reason && <span className="ml-2 text-muted-foreground">({target.reason})</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.skipped_current.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("database.updatePlanSkipped", { names: plan.skipped_current.join(", ") })}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label className="font-medium" htmlFor="db-update-modules">
            {t("database.updateModules")}
          </label>
          <Input
            id="db-update-modules"
            value={modules}
            onChange={(e) => setModules(e.target.value)}
            className="h-8 font-mono"
          />
          <p className="text-xs text-muted-foreground">{t("database.updateModulesHint")}</p>
        </div>

        <Checkbox checked={stopOnError} onChange={setStopOnError} label={t("database.updateStopOnError")} />

        <div className="flex items-center gap-2">
          <label htmlFor="db-update-timeout">{t("database.updateTimeout")}</label>
          <Input
            id="db-update-timeout"
            type="number"
            min={1}
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(e.target.value)}
            className="h-8 w-20"
          />
        </div>

        {plan?.server_running && (
          <div className="space-y-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3">
            <p className="font-medium">{t("database.updateServerRunning", { version })}</p>
            {serverConfig ? (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="db-update-server"
                    checked={serverChoice === "restart"}
                    onChange={() => setServerChoice("restart")}
                  />
                  {t("database.updateServerRestart")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="db-update-server"
                    checked={serverChoice === "ignore"}
                    onChange={() => setServerChoice("ignore")}
                  />
                  {t("database.updateServerIgnore")}
                </label>
              </>
            ) : (
              <p className="text-xs">{t("database.updateServerExternal")}</p>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleStart} disabled={!plan || targets.length === 0 || starting}>
          {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("database.updateStart")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
```

(If `Input` does not forward `id`/`type`/`min`, check `src/components/ui/input.tsx` — it is a thin wrapper around `<input>` with `...props`.)

- [ ] **Step 4: Checks** — `pnpm test && pnpm run typecheck && pnpm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locales/en.json src/locales/de.json src/components/database/DbUpdateDialog.tsx
git commit -m "[ADD] db update: start dialog with dry-run plan, server choice; DE/EN strings"
```

---

### Task 6: Progress panel, log viewer and the database view

**Files:**
- Create: `src/components/database/DbUpdatePanel.tsx`, `src/components/database/UpdateLogDialog.tsx`
- Modify: `src/components/database/DatabasePanel.tsx`

**Interfaces:**
- Consumes: `useDbUpdateStore`, `cancelDbUpdate` (Task 4); `finishedCount`, `isActive`, `DbUpdateRow`, `DbUpdateRowStatus` (Task 3); `DbUpdateDialog` (Task 5); `isAtLeast`, `MIN_ODOODEV_DB_UPDATE` (Task 3); `ConfirmDialog`, `Card`, `Button`; `useAppStore((s) => s.platform?.os)` (`"windows"` on Windows).
- Produces: `<DbUpdatePanel version onOpenLog />`, `<UpdateLogDialog path onClose />` (mount with `key={path}` while a path is set).

- [ ] **Step 1: Implement the log viewer** — `src/components/database/UpdateLogDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { invokeCmd } from "../../lib/tauri";

/** Read-only view of one `~/odoodev-logs/update_v*.log`. Mount with key={path}. */
export function UpdateLogDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invokeCmd<string>("read_update_log", { path })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <Dialog open onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{t("database.updateLogTitle")}</DialogTitle>
      </DialogHeader>
      <p className="mb-2 truncate font-mono text-xs text-muted-foreground" title={path}>
        {path}
      </p>
      <div className="h-[60vh] overflow-auto rounded-md border border-border bg-muted/50 p-2">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <pre className="whitespace-pre font-mono text-xs">{content ?? t("common.loading")}</pre>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogFooter>
    </Dialog>
  );
}
```

- [ ] **Step 2: Implement the progress panel** — `src/components/database/DbUpdatePanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, ChevronDown, ChevronRight, CircleCheckBig, CircleX, Clock, Loader2, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cancelDbUpdate } from "../../lib/dbUpdateRunner";
import { finishedCount, isActive, type DbUpdateRow, type DbUpdateRowStatus } from "../../lib/dbUpdateReducer";
import { useDbUpdateStore } from "../../store/dbUpdateStore";
import { useAppStore } from "../../store/appStore";
import { toastError } from "../../store/toastStore";
import { cn } from "../../lib/utils";

/** "Force stop" is offered only when odoodev ignored the SIGTERM this long. */
const FORCE_STOP_AFTER_MS = 20_000;

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

function StatusIcon({ status }: { status: DbUpdateRowStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "ok":
      return <CircleCheckBig className="h-4 w-4 text-green-500" />;
    case "okWithErrors":
      return <TriangleAlert className="h-4 w-4 text-yellow-500" />;
    case "failed":
      return <CircleX className="h-4 w-4 text-red-500" />;
    case "timedOut":
      return <Clock className="h-4 w-4 text-red-500" />;
    case "interrupted":
      return <Ban className="h-4 w-4 text-muted-foreground" />;
    default:
      return <span className="inline-block h-4 w-4 text-center text-muted-foreground">·</span>;
  }
}

export function DbUpdatePanel({ version, onOpenLog }: { version: string; onOpenLog: (path: string) => void }) {
  const { t } = useTranslation();
  const run = useDbUpdateStore((s) => s.runs[version]);
  const dismiss = useDbUpdateStore((s) => s.dismiss);
  const isWindows = useAppStore((s) => s.platform?.os === "windows");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showConsole, setShowConsole] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const active = isActive(run);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!run) return null;

  const statusLabel: Record<DbUpdateRowStatus, string> = {
    pending: t("database.updateStatusPending"),
    running: t("database.updateStatusRunning"),
    ok: t("database.updateStatusOk"),
    okWithErrors: t("database.updateStatusOkWithErrors"),
    failed: t("database.updateStatusFailed"),
    timedOut: t("database.updateStatusTimedOut"),
    interrupted: t("database.updateStatusInterrupted"),
  };
  const done = finishedCount(run);
  const total = run.order.length;
  const canForceStop =
    run.phase === "cancelling" && run.cancelRequestedAt !== null && now - run.cancelRequestedAt >= FORCE_STOP_AFTER_MS;
  const runningDb = run.order.find((db) => run.rows[db].status === "running") ?? null;

  const toggle = (db: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      return next;
    });

  const cancel = async (force: boolean) => {
    setConfirmCancel(false);
    try {
      await cancelDbUpdate(version, force);
    } catch (e) {
      toastError(t("database.updateCancelFailed"), String(e));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            {active ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            ) : run.phase === "finished" ? (
              <CircleCheckBig className="h-4 w-4 text-green-500" />
            ) : (
              <CircleX className="h-4 w-4 text-red-500" />
            )}
            {t("database.updatePanelTitle", { version, modules: run.modules })}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {t("database.updateProgress", { done, total })} · {formatDuration((now - run.startedAt) / 1000)}
            </span>
            {active ? (
              canForceStop ? (
                <Button size="sm" variant="destructive" onClick={() => cancel(true)}>
                  {t("database.updateForceStop")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={run.phase === "cancelling"}
                  onClick={() => setConfirmCancel(true)}
                >
                  {run.phase === "cancelling" ? t("database.updateCancelling") : t("common.cancel")}
                </Button>
              )
            ) : (
              <Button size="sm" variant="outline" onClick={() => dismiss(version)}>
                {t("common.close")}
              </Button>
            )}
          </div>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
          />
        </div>

        {run.detailsLost && <p className="text-xs text-muted-foreground">{t("database.updateDetailsLost")}</p>}
        {run.errorMessage && <p className="text-sm text-destructive">{run.errorMessage}</p>}
        {canForceStop && <p className="text-xs text-destructive">{t("database.updateForceStopHint")}</p>}
        {isWindows && active && <p className="text-xs text-muted-foreground">{t("database.updateWindowsCancelHint")}</p>}

        <ul className="space-y-1 text-sm">
          {run.order.map((db) => (
            <UpdateRow
              key={db}
              row={run.rows[db]}
              label={statusLabel[run.rows[db].status]}
              now={now}
              expanded={expanded.has(db)}
              onToggle={() => toggle(db)}
              onOpenLog={onOpenLog}
            />
          ))}
        </ul>

        {run.skippedCurrent.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("database.updatePlanSkipped", { names: run.skippedCurrent.join(", ") })}
          </p>
        )}

        {run.console.length > 0 && (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowConsole((open) => !open)}
            >
              {showConsole ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t("database.updateConsole")}
            </button>
            {showConsole && (
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-2 font-mono text-xs">
                {run.console.join("\n")}
              </pre>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t("database.updateCancelTitle")}
        description={
          runningDb
            ? t("database.updateCancelDescription", { database: runningDb })
            : t("database.updateCancelDescriptionIdle")
        }
        confirmLabel={t("database.updateCancelConfirm")}
        danger
        onConfirm={() => cancel(false)}
      />
    </Card>
  );
}

function UpdateRow({
  row,
  label,
  now,
  expanded,
  onToggle,
  onOpenLog,
}: {
  row: DbUpdateRow;
  label: string;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenLog: (path: string) => void;
}) {
  const { t } = useTranslation();
  const seconds =
    row.durationS ?? (row.status === "running" && row.startedAt !== null ? (now - row.startedAt) / 1000 : null);
  const hasDetails = row.issues.length > 0 || row.lastError !== null;
  const log = row.log;

  return (
    <li className="rounded-md border border-border/60">
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          className={cn("flex h-4 w-4 items-center justify-center", !hasDetails && "invisible")}
          onClick={onToggle}
          aria-label={label}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <StatusIcon status={row.status} />
        <span className="font-mono">{row.database}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
        {seconds !== null && <span className="text-xs text-muted-foreground">{formatDuration(seconds)}</span>}
        {row.warnings > 0 && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400">
            {t("database.updateWarnings", { count: row.warnings })}
          </span>
        )}
        {row.errors > 0 && (
          <span className="text-xs text-destructive">{t("database.updateErrors", { count: row.errors })}</span>
        )}
        {log && (
          <button className="ml-auto text-xs text-primary hover:underline" onClick={() => onOpenLog(log)}>
            {t("database.updateOpenLog")}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="border-t border-border/60 px-2 py-1 font-mono text-xs">
          {row.lastError && <p className="text-destructive">{row.lastError}</p>}
          {row.issues.map((issue, i) => (
            <p
              key={i}
              className={cn(
                issue.level === "RAW" && "pl-6 text-muted-foreground",
                issue.level === "WARNING" && "text-yellow-600 dark:text-yellow-400",
                (issue.level === "ERROR" || issue.level === "CRITICAL") && "text-destructive",
              )}
            >
              {issue.level !== "RAW" && `${issue.level} `}
              {issue.text}
            </p>
          ))}
          {row.issuesTruncated > 0 && (
            <p className="text-muted-foreground">
              {t("database.updateIssuesTruncated", { count: row.issuesTruncated })}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 3: Integrate into `DatabasePanel.tsx`** — apply these edits in order:

1. Icons: replace `import { RefreshCw, HardDriveDownload, HardDriveUpload, Trash2, Copy, Pencil, Loader2, Plus } from "lucide-react";` with `import { RefreshCw, RefreshCcw, HardDriveDownload, HardDriveUpload, Trash2, Copy, Pencil, Loader2, Plus } from "lucide-react";`
2. Types: replace `import type { DbListResponse, OpResult, VersionsResponse } from "../../types";` with `import type { DbListResponse, DbUpdateMode, OpResult, VersionsResponse } from "../../types";`
3. After `import { TagInput } from "../ui/tag-input";` add:

```tsx
import { DbUpdateDialog } from "./DbUpdateDialog";
import { DbUpdatePanel } from "./DbUpdatePanel";
import { UpdateLogDialog } from "./UpdateLogDialog";
import { useDbUpdateStore } from "../../store/dbUpdateStore";
import { isActive } from "../../lib/dbUpdateReducer";
import { isAtLeast, MIN_ODOODEV_DB_UPDATE } from "../../lib/version";
```

4. After `const [progressMessage, setProgressMessage] = useState<string | undefined>(undefined);` add:

```tsx
  const [updateDialog, setUpdateDialog] = useState<{ mode: DbUpdateMode; names: string[] } | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const odoodevVersion = useAppStore((s) => s.odoodevInfo?.version ?? null);
  const updateSupported = isAtLeast(odoodevVersion, MIN_ODOODEV_DB_UPDATE);
  const updateRun = useDbUpdateStore((s) => s.runs[selectedVersion]);
  const updateActive = isActive(updateRun);
  const updatePhase = updateRun?.phase;
```

5. After the effect ending in `}, [selectedVersion]);` add:

```tsx
  // A finished, failed or interrupted update changes the stale markers.
  useEffect(() => {
    if (updatePhase && updatePhase !== "running" && updatePhase !== "cancelling") fetchDatabases();
    // fetchDatabases is a plain function (see above); only the phase change matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatePhase]);
```

6. After `const selectedInfo = versions?.[selectedVersion] ?? null;` add:

```tsx
  const stale = dbResp?.stale ?? null;
  const staleCount = stale ? dbList.filter((d) => stale[d]).length : dbList.length;
  const updateBlockedReason = !updateSupported
    ? t("database.updateRequiresVersion", { version: MIN_ODOODEV_DB_UPDATE })
    : updateActive
      ? t("database.updateRunningHere")
      : undefined;
```

7. Replace the restore button

```tsx
          <Button size="sm" variant="outline" onClick={() => setShowRestore(true)}>
            <HardDriveUpload className="h-3.5 w-3.5" />
            {t("database.restore")}
          </Button>
```
with
```tsx
          <Button size="sm" variant="outline" onClick={() => setShowRestore(true)}>
            <HardDriveUpload className="h-3.5 w-3.5" />
            {t("database.restore")}
          </Button>
          {dbList.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={updateBlockedReason !== undefined || (stale !== null && staleCount === 0)}
              title={updateBlockedReason}
              onClick={() => setUpdateDialog({ mode: "stale", names: [] })}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {stale === null ? t("database.updateAll") : t("database.updateStaleCount", { count: staleCount })}
            </Button>
          )}
```

(With no state file yet, `--stale` treats every database as "never updated" — hence the "Update all" label for the same mode.)

8. Replace

```tsx
            {selected.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBulkDrop}>
```
with
```tsx
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={updateBlockedReason !== undefined}
                title={updateBlockedReason}
                onClick={() => setUpdateDialog({ mode: "names", names: Array.from(selected) })}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {t("database.updateSelectedCount", { count: selected.size })}
              </Button>
            )}
            {selected.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBulkDrop}>
```

9. Replace `<td className="p-2 font-mono">{db}</td>` with:

```tsx
                      <td className="p-2">
                        <span className="font-mono">{db}</span>
                        {stale?.[db] && (
                          <span
                            title={stale[db]}
                            className="ml-2 rounded-md bg-yellow-500/15 px-1.5 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400"
                          >
                            {t("database.staleBadge")}
                          </span>
                        )}
                      </td>
```

10. Replace `      {dbList.length > 0 && (` (the table block opener) with:

```tsx
      {updateRun && <DbUpdatePanel version={selectedVersion} onOpenLog={setLogPath} />}

      {dbList.length > 0 && (
```

11. Replace `      <OperationProgress` with:

```tsx
      {updateDialog && (
        <DbUpdateDialog
          open
          onClose={() => setUpdateDialog(null)}
          version={selectedVersion}
          mode={updateDialog.mode}
          names={updateDialog.names}
        />
      )}

      {logPath && <UpdateLogDialog key={logPath} path={logPath} onClose={() => setLogPath(null)} />}

      <OperationProgress
```

- [ ] **Step 4: Checks** — `pnpm test && pnpm run typecheck && pnpm run lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/database/DbUpdatePanel.tsx src/components/database/UpdateLogDialog.tsx src/components/database/DatabasePanel.tsx
git commit -m "[ADD] db update: stale markers, update buttons, live progress panel, log viewer"
```

---

### Task 7: Header indicator and dashboard stale count

**Files:**
- Create: `src/components/DbUpdateIndicator.tsx`
- Modify: `src/components/Header.tsx`, `src/App.tsx`, `src/components/dashboard/VersionCard.tsx`, `src/lib/constants.ts:62-66`, `src/locales/en.json`, `src/locales/de.json` (`dashboard` object)

**Interfaces:**
- Consumes: `useDbUpdateStore`, `isActive`, `finishedCount`; `DbListResponse.stale`; event `db-update-exited` `{version}`; `usePolling(fn, intervalMs, enabled)` (runs `fn` immediately when enabled).
- Produces: `<DbUpdateIndicator onOpen={(version) => void} />`; `Header` prop `onOpenDatabase: (version: string) => void`; `POLL_INTERVALS.stale = 300_000`; i18n `dashboard.staleDatabases_one/_other`.

- [ ] **Step 1: Poll interval** — in `src/lib/constants.ts` extend `POLL_INTERVALS`:

```ts
export const POLL_INTERVALS = {
  docker: 5_000,
  venv: 30_000,
  server: 1_000,
  /** Stale-database count: each `db list` with a state file runs `git status` per repo. */
  stale: 300_000,
};
```

- [ ] **Step 2: Dashboard strings** — find the last key of the `dashboard` object: `grep -n '"editConfigFiles"' src/locales/en.json src/locales/de.json`. Append a comma to that line and add after it:

`en.json`:
```json
    "staleDatabases_one": "{{count}} database stale",
    "staleDatabases_other": "{{count}} databases stale"
```

`de.json`:
```json
    "staleDatabases_one": "{{count}} Datenbank veraltet",
    "staleDatabases_other": "{{count}} Datenbanken veraltet"
```

(If `editConfigFiles` is not the last key in `dashboard`, add the two lines before the closing `}` of `dashboard` instead and keep the commas valid.)

- [ ] **Step 3: Indicator** — `src/components/DbUpdateIndicator.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { finishedCount, isActive } from "../lib/dbUpdateReducer";
import { useDbUpdateStore } from "../store/dbUpdateStore";

/** One chip per version with a running `db update`; click jumps to its database view. */
export function DbUpdateIndicator({ onOpen }: { onOpen: (version: string) => void }) {
  const { t } = useTranslation();
  const runs = useDbUpdateStore((s) => s.runs);
  const active = Object.entries(runs)
    .filter(([, run]) => isActive(run))
    .sort(([a], [b]) => a.localeCompare(b));
  if (active.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {active.map(([version, run]) => (
        <button
          key={version}
          onClick={() => onOpen(version)}
          className="flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("database.updateRunningIndicator", { version, done: finishedCount(run), total: run.order.length })}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Header and App**

In `src/components/Header.tsx`: add `import { DbUpdateIndicator } from "./DbUpdateIndicator";`, change the signature to

```tsx
export function Header({
  onSelectSettings,
  onOpenDatabase,
}: {
  onSelectSettings: () => void;
  onOpenDatabase: (version: string) => void;
}) {
```

and replace `        {updateCheck?.update_available && <UpdateBadge />}` with

```tsx
        <DbUpdateIndicator onOpen={onOpenDatabase} />
        {updateCheck?.update_available && <UpdateBadge />}
```

In `src/App.tsx` replace `<Header onSelectSettings={() => setActiveView("settings")} />` with

```tsx
        <Header
          onSelectSettings={() => setActiveView("settings")}
          onOpenDatabase={(version) => handleNavigate("database", version)}
        />
```

- [ ] **Step 5: Version card** — in `src/components/dashboard/VersionCard.tsx`:

1. Replace `import { useState } from "react";` with `import { useCallback, useEffect, useState } from "react";` and add `import { listen } from "@tauri-apps/api/event";` below it.
2. In the `import type { … } from "../../types";` list add `DbListResponse,` (alphabetically first).
3. Directly after `const dockerRunning = dockerStatus?.running ?? false;` add:

```tsx
  const [staleCount, setStaleCount] = useState<number | null>(null);
  const refreshStale = useCallback(() => {
    invokeCmd<DbListResponse>("get_databases", { version })
      .then((resp) => setStaleCount(resp.stale ? resp.databases.filter((d) => resp.stale?.[d]).length : null))
      .catch(() => setStaleCount(null));
  }, [version]);
  // Not on the 30 s venv interval: with a state file every `db list` runs git status per repository.
  usePolling(refreshStale, POLL_INTERVALS.stale, active && dockerRunning);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listen<{ version: string }>("db-update-exited", (e) => {
      if (e.payload.version === version && dockerRunning) refreshStale();
    }).then((u) => {
      if (disposed) u();
      else unlisten = u;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [version, dockerRunning, refreshStale]);
```

4. Replace `          <StatusBadge {...odooBadge} />` with:

```tsx
          <StatusBadge {...odooBadge} />
          {dockerRunning && staleCount !== null && staleCount > 0 && (
            <button onClick={() => onNavigate("database", version)} title={t("dashboard.databases")}>
              <StatusBadge status="warn" label={t("dashboard.staleDatabases", { count: staleCount })} />
            </button>
          )}
```

- [ ] **Step 6: Checks** — `pnpm test && pnpm run typecheck && pnpm run lint` → PASS (locale parity covers the new dashboard keys).

- [ ] **Step 7: Commit**

```bash
git add src/components/DbUpdateIndicator.tsx src/components/Header.tsx src/App.tsx src/components/dashboard/VersionCard.tsx src/lib/constants.ts src/locales/en.json src/locales/de.json
git commit -m "[ADD] db update: header indicator for running updates, stale count on the dashboard"
```

---

### Task 8: Bulk drop reports failures

**Files:**
- Create: `src/components/database/bulkDrop.ts`, `src/components/database/bulkDrop.test.ts`
- Modify: `src/components/database/DatabasePanel.tsx` (`handleBulkDrop`)

**Interfaces:**
- Consumes: `OpResult` type; i18n `database.bulkDropping`, `database.bulkDropDone`, `database.bulkDropFailed` (Task 5).
- Produces: `interface BulkDropOutcome { dropped: string[]; failed: { name: string; error: string }[] }`; `dropMany(names: string[], drop: (name: string) => Promise<OpResult>): Promise<BulkDropOutcome>`.

- [ ] **Step 1: Write the failing test** — `src/components/database/bulkDrop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dropMany } from "./bulkDrop";
import type { OpResult } from "../../types";

describe("dropMany", () => {
  it("reports refused and thrown drops instead of calling everything a success", async () => {
    const drop = async (name: string): Promise<OpResult> => {
      if (name === "busy") return { success: false, error: "database is being accessed by other users" };
      if (name === "boom") throw new Error("odoodev not found");
      return { success: true, error: null };
    };
    const outcome = await dropMany(["a", "busy", "boom", "b"], drop);
    expect(outcome.dropped).toEqual(["a", "b"]);
    expect(outcome.failed).toEqual([
      { name: "busy", error: "database is being accessed by other users" },
      { name: "boom", error: "Error: odoodev not found" },
    ]);
  });

  it("continues after a failure and keeps the order", async () => {
    const seen: string[] = [];
    await dropMany(["x", "y"], async (name) => {
      seen.push(name);
      return { success: name === "y", error: null };
    });
    expect(seen).toEqual(["x", "y"]);
  });

  it("uses a placeholder when the backend gives no reason", async () => {
    const outcome = await dropMany(["x"], async () => ({ success: false, error: null }));
    expect(outcome.failed).toEqual([{ name: "x", error: "unknown error" }]);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm test src/components/database/bulkDrop.test.ts` → FAIL (`Failed to resolve import "./bulkDrop"`).

- [ ] **Step 3: Implement** — `src/components/database/bulkDrop.ts`:

```ts
import type { OpResult } from "../../types";

export interface BulkDropOutcome {
  dropped: string[];
  failed: { name: string; error: string }[];
}

/** Drop databases one after another. A failure never stops the rest and is
 *  always reported — the previous loop only logged it to the console. */
export async function dropMany(
  names: string[],
  drop: (name: string) => Promise<OpResult>,
): Promise<BulkDropOutcome> {
  const outcome: BulkDropOutcome = { dropped: [], failed: [] };
  for (const name of names) {
    try {
      const result = await drop(name);
      if (result.success) outcome.dropped.push(name);
      else outcome.failed.push({ name, error: result.error ?? "unknown error" });
    } catch (e) {
      outcome.failed.push({ name, error: String(e) });
    }
  }
  return outcome;
}
```

Run `pnpm test src/components/database/bulkDrop.test.ts` → PASS.

- [ ] **Step 4: Use it in `DatabasePanel.tsx`** — add `import { dropMany } from "./bulkDrop";` next to the other local imports and replace the whole `handleBulkDrop`:

```tsx
  const handleBulkDrop = async () => {
    const names = Array.from(selected);
    const tid = toastLoading(t("database.bulkDropping", { count: names.length }));
    const outcome = await dropMany(names, (name) =>
      invokeCmd<OpResult>("drop_db", { version: selectedVersion, name, terminateConnections: true }),
    );
    outcome.dropped.forEach((name) => removeDbTags(selectedVersion, name));
    // Keep the failed ones selected so a retry is one click.
    setSelected(new Set(outcome.failed.map((f) => f.name)));
    await fetchDatabases();
    if (outcome.failed.length === 0) {
      toastUpdate(tid, "success", t("database.bulkDropDone", { count: outcome.dropped.length }));
    } else {
      toastUpdate(
        tid,
        "error",
        t("database.bulkDropFailed", { failed: outcome.failed.length, total: names.length }),
        outcome.failed.map((f) => `${f.name}: ${f.error}`).join("\n"),
      );
    }
  };
```

- [ ] **Step 5: Checks** — `pnpm test && pnpm run typecheck && pnpm run lint` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/database/bulkDrop.ts src/components/database/bulkDrop.test.ts src/components/database/DatabasePanel.tsx
git commit -m "[FIX] bulk drop reported success even when databases could not be dropped"
```

---

### Task 9: Documentation, spec amendments, version 1.8.0

**Files:**
- Modify: `docs/superpowers/specs/2026-09-15-db-update-gui-design.md`, `docs/TAURI_API.md`, `docs/CLI_INTEGRATION.md`, `CLAUDE.md`, `RELEASE_NOTES.md`, `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`

**Interfaces:**
- Consumes: the implemented behaviour of Tasks 1–8.
- Produces: docs matching the code; version `1.8.0`.

- [ ] **Step 1: Amend the spec to what was built** — in `docs/superpowers/specs/2026-09-15-db-update-gui-design.md`:

Replace
```markdown
- New managed state `DbUpdateManager` (same shape as `ServerManager`):
  `Arc<Mutex<HashMap<String /*version*/, UpdateHandle { pid: u32, child: Child }>>>`.
```
with
```markdown
- New managed state `DbUpdateManager`: `Arc<Mutex<HashMap<String /*version*/, RunHandle { pid: u32,
  force_kill: UnboundedSender<()> }>>>`. The spawned task owns the `Child` (so no lock is held across
  an await) and kills it when the force channel fires.
```

Replace
```markdown
- stdout reader: each line is deserialized into
  `#[serde(tag = "event", rename_all = "snake_case")] enum DbUpdateEvent` and emitted as
  `db-update:<version>`. A line that is not a known event is emitted on the console channel
  instead (never dropped, never a crash).
- stderr reader: every line emitted as `db-update-log:<version>` (plain string).
- On exit: remove the handle, emit `db-update-exited:<version>` with `{ exitCode }`.
```
with
```markdown
- stdout reader: each line is deserialized into
  `#[serde(tag = "event", rename_all = "snake_case")] enum DbUpdateEvent` and emitted as the
  global event `db-update-event` with `{ version, event }`. A line that is not a known event is
  emitted on the console channel instead (never dropped, never a crash).
- stderr reader: every line emitted as `db-update-log` with `{ version, line }`.
- On exit: remove the handle, emit `db-update-exited` with `{ version, exit_code }` (`null` when
  killed by a signal) — same key as `server-exited`.
- *Amended during planning:* global event names with the version in the payload replace
  `db-update:<version>`, so the frontend needs no per-version listeners (versions load later
  than `App` mounts).
```

Replace
```markdown
`DbListResponse` gains `#[serde(default)] stale: HashMap<String, String>` (database → reason).
Older odoodev versions simply return no map.
```
with
```markdown
`DbListResponse` gains `#[serde(default)] stale: Option<HashMap<String, String>>` (database →
reason), serialized as `null` when the CLI sent none — the GUI distinguishes "no update recorded
yet" (button "Update all") from "all current" (empty map).
```

Replace `Listeners for \`db-update:*\`, \`db-update-log:*\`, \`db-update-exited:*\` are registered` with `Listeners for \`db-update-event\`, \`db-update-log\`, \`db-update-exited\` are registered`.

- [ ] **Step 2: `docs/TAURI_API.md`**
  - Under `### Databases`, after the `rename_db` entry, add:

````markdown
#### `plan_db_update`
Dry run of `db update`: which databases would be updated and why.
```typescript
invoke('plan_db_update', { args: DbUpdateArgs }) → DbUpdatePlan
```
CLI: `odoodev db update <version> (-n <db>… | --stale | --all) -u <modules> [--stop-on-error] [--timeout <s>] --dry-run --output ndjson`
```typescript
interface DbUpdateArgs { version: string; mode: "names" | "stale" | "all"; names: string[]; modules: string; stopOnError: boolean; timeoutSeconds: number | null }
interface DbUpdatePlan { version: string; modules: string; targets: { database: string; reason: string | null }[]; skipped_current: string[]; server_running: boolean }
```
Errors: the CLI's `error` event message; "odoodev >= 0.69.0 is required …" for older CLIs.

#### `start_db_update`
Starts the update in the background (one per version) and returns immediately; progress arrives as events.
```typescript
invoke('start_db_update', { args: DbUpdateArgs }) → void
```
CLI: as `plan_db_update` without `--dry-run`. Errors: invalid args, "An update is already running for v<version>".

#### `cancel_db_update`
```typescript
invoke('cancel_db_update', { version: string, force: boolean }) → void
```
`force: false` sends SIGTERM (odoodev stops odoo-bin, exits 130). `force: true` kills odoodev only — odoo-bin may keep running. On Windows both kill odoodev.

#### `list_db_updates`
```typescript
invoke('list_db_updates') → string[]   // versions with a running update
```

#### `read_update_log`
```typescript
invoke('read_update_log', { path: string }) → string
```
Only `~/odoodev-logs/update_v*.log` (canonicalized); files over 2 MB return their last 2 MB with a note.
````

  - Under `### Progress Streaming`, add:

````markdown
#### `db-update-event`, `db-update-log`, `db-update-exited`
```typescript
listen<{ version: string; event: DbUpdateEvent }>('db-update-event')   // plan | start | issue | result | summary | interrupted | error
listen<{ version: string; line: string }>('db-update-log')             // stderr and non-event stdout lines
listen<{ version: string; exit_code: number | null }>('db-update-exited')
```
Event shapes: see `DbUpdateEvent` in `src/types/index.ts` and `docs/CLI_INTEGRATION.md` (`db update --output ndjson`).
````

  - Correct the existing `backup-progress` and `restore-progress` payload descriptions: the payload is a plain `string` per line, not `{ line: string }`.

- [ ] **Step 3: `docs/CLI_INTEGRATION.md`**
  - In `### 3. \`odoodev db list <VERSION> --json\``, add to the output example `"stale": {"v19_b": "2 repos changed: v19-addons, v19e"}` and the note: *optional; absent until a `db update` state file exists (odoodev ≥ 0.68.0).*
  - After section 11 add:

````markdown
### 12. `odoodev db update <VERSION> --output ndjson`

**Purpose:** Module update (`odoo-bin -u`) over many databases with live per-database progress (odoodev ≥ 0.69.0).

**CLI Command:**
```bash
odoodev db update 19 --stale -u all --output ndjson
odoodev db update 19 -n v19_a -n v19_b -u eq_base --stop-on-error --timeout 1800 --output ndjson
```

**Output Format:** one JSON object per stdout line, flushed immediately; human-readable text on stderr.

| `event` | Fields |
|---|---|
| `plan` | `version`, `modules`, `targets: [{database, reason}]`, `skipped_current`, `server_running` |
| `start` | `database`, `index`, `total`, `log` |
| `issue` | `database`, `level` (`WARNING`/`ERROR`/`CRITICAL`/`RAW`), `text` |
| `result` | `database`, `ok`, `exit_code`, `duration_s`, `warnings`, `errors`, `last_error`, `timed_out`, `log` |
| `summary` | `results`, `skipped_current`, `exit_code` |
| `interrupted` | `database` (exit 130) |
| `error` | `message` (exit 1, before `plan`) |

`--dry-run` emits `plan` only. Requires `-n`, `--stale` or `--all`. Stop with SIGTERM, never SIGKILL — only then does odoodev kill Odoo's process group.

---
````

  - "odoodev Version Compatibility": add the row `| 0.69.0+ | \`db update --output ndjson\` | Database update view enabled |` and change the minimum-version sentence to state that the update view needs 0.69.0 (other features keep their stated minimum).

- [ ] **Step 4: `CLAUDE.md`** — get today's date with `date +%d.%m.%Y`, then:
  - Replace `## Current Project Status (Stand 26. August 2026, v1.6.3)` with `## Current Project Status (Stand <day>. <Monat> <year>, v1.8.0)` (German month name).
  - Replace
    `- \`commands/\`: 14 command modules (versions, server, database, docker, doctor, editor,`
    `  env, init, migrate, playbook, repos, venv, system, self_update)`
    with
    `- \`commands/\`: 15 command modules (versions, server, database, db_update, docker, doctor,`
    `  editor, env, init, migrate, playbook, repos, venv, system, self_update)`
    and add below it:
    `- \`db_update.rs\` + \`db_update_manager.rs\`: \`db update --output ndjson\` (odoodev ≥ 0.69.0) —`
    `  typed events, one run per version, SIGTERM-Abbruch, beim App-Beenden SIGTERM an alle Läufe`
  - Replace
    `- Database: Liste, Tags, Backup (3 Formate), Restore (3-Step Wizard + Dry Run mit vollem`
    `  CLI-Report), Drop/Copy/Rename, Bulk-Drop`
    with
    `- Database: Liste, Tags, Backup (3 Formate), Restore (3-Step Wizard + Dry Run mit vollem`
    `  CLI-Report), Drop/Copy/Rename, Bulk-Drop (meldet Fehlschläge), Veraltet-Markierung,`
    `  Update veralteter/ausgewählter Datenbanken mit Live-Fortschritt, Abbrechen und`
    `  Stoppen-Updaten-Neustarten eines laufenden Servers; Dashboard zeigt veraltete Datenbanken`
  - In the "CLI Integration Surface" table change the NDJSON row to `| NDJSON stream | \`run --output json\`, \`db update --output ndjson\` | One JSON object per line |`.
  - In "Open — Next Steps" item 1 replace `bisher \`restoreArgs.test.ts\` und \`locales.test.ts\`` with `bisher \`restoreArgs\`, \`locales\`, \`version\`, \`dbUpdateReducer\`, \`dbUpdateStore\`, \`bulkDrop\``.

- [ ] **Step 5: `RELEASE_NOTES.md`** — insert above `## Version 1.7.0` (date from `date +%d.%m.%Y`):

```markdown
## Version 1.8.0 (DD.MM.YYYY)

### Added
- **Update databases after a repository sync.** The database list marks databases whose
  repositories changed since their last full module update ("stale", reason in the tooltip).
  "Update stale" and "Update selected" run `odoo-bin -u` over them one after another; a dialog
  shows the plan first (which databases, why, which are skipped as current), the module list
  (default `all`), stop-at-first-failure and a per-database timeout. Requires odoodev ≥ 0.69.0.
- **Live progress without blocking the app.** A panel in the database view shows each
  database's status, duration and warning/error counts; rows expand to Odoo's warnings, errors
  and tracebacks, and "Open log" shows the full log. The header shows running updates from any
  view.
- **Safe cancel.** Cancelling stops the running `odoo-bin` cleanly (the interrupted database is
  not marked current); if odoodev does not respond within 20 s a forced stop is offered.
  Closing the app stops running updates first instead of leaving `odoo-bin` behind.
- **Running server.** If an Odoo server runs on the version, the update can stop it and start it
  again with the same configuration afterwards.
- **Dashboard.** Each version card shows how many databases are stale.

### Fixed
- Dropping several selected databases reported success even when some could not be dropped.
  Failures are now reported by name and stay selected for a retry.
- The playbook view's check for old odoodev versions never took effect (it read a version field
  that was never filled).
```

- [ ] **Step 6: Version 1.8.0** — set `"version": "1.8.0"` in `package.json` and `src-tauri/tauri.conf.json`, `version = "1.8.0"` in `src-tauri/Cargo.toml`, then `cd src-tauri && cargo check` (updates `Cargo.lock`).

- [ ] **Step 7: Full verification**

```bash
pnpm install --frozen-lockfile
pnpm run typecheck && pnpm run lint && pnpm test
cd src-tauri && cargo fmt --check && cargo clippy && cargo test && cd ..
```
Expected: everything passes; clippy reports no warnings in `db_update*.rs` or `commands/db_update.rs`.

- [ ] **Step 8: Commit**

```bash
git add docs CLAUDE.md RELEASE_NOTES.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "[ADD] version 1.8.0: database updates with live progress; docs and spec amendments"
```

---

### Task 10: Manual verification with the maintainer, then release

**Files:** none (fixes found here go back into the task that owns the file)

**Interfaces:**
- Consumes: odoodev 0.69.0 on PyPI (CLI plan Task 5), the finished branch.
- Produces: verified behaviour; after approval tag `v1.8.0` on both remotes and a GitHub release run.

Run this **together with the maintainer, one step at a time**: give one step with the expected result, wait for the report, compare, and only then continue. Every command the maintainer types must be fish syntax. Total: 8 steps, about 30–45 minutes (two small `-u all` runs).

- [ ] **Step 1: CLI version** — maintainer runs `uv tool upgrade odoodev-equitania; odoodev --version`. Expected: `odoodev, version 0.69.0`.
- [ ] **Step 2: Start the app** — `~/.cargo/bin/cargo-tauri dev` in the repo. Expected: header shows odoodev v0.69.0; database view of a version with PostgreSQL running shows "Update stale (N)" or "Update all" enabled.
- [ ] **Step 3: Update two selected small databases** — select two test databases → "Update selected". Expected: dialog lists both with a reason; after "Start update" the panel shows `1/2`, `2/2`, both rows "updated"; a success toast; their stale badges disappear after the list reloads.
- [ ] **Step 4: Cancel mid-run** — start "Update selected" on one database, cancel while its row says "running", confirm. Expected: row and panel "interrupted" within a few seconds; then maintainer runs `pgrep -fl odoo-bin` → no process for that update.
- [ ] **Step 5: Running server** — start the version's server from the Server view, then "Update selected" on one database, choose "Stop the server, update, then restart it". Expected: server stops, update runs, afterwards the "Restarting the Odoo server" toast and the server runs again with the same database.
- [ ] **Step 6: Webview reload** — start an update, press Cmd+R. Expected: the panel reappears with "Details from before the reload are unavailable", progress continues in the header count, and Cancel still stops it.
- [ ] **Step 7: Close the app during an update** — start an update, quit the app. Expected: the app closes within ~10 s; `pgrep -fl odoo-bin` → no update process left.
- [ ] **Step 8: Dashboard** — with a stale database present, open the dashboard. Expected: the version card shows "N databases stale"; clicking it opens the database view of that version.

After all steps pass, **ask for release approval**. With an explicit yes:

```bash
bash <<'SCRIPT'
set -euo pipefail
cd /Users/picard/gitbase/odoodev-gui
HITS=$(git log -p origin/main..HEAD | grep -E '^\+' | grep -v '^+++' \
  | grep -Ei '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}|ownerp\.io|intra\.|/Users/' | grep -v 'noreply@anthropic.com' || true)
[ -z "$HITS" ] && echo "data scan clean" || { echo "$HITS"; exit 1; }
SCRIPT
git switch main && git merge --no-ff feat/db-update -m "[CHG] Merge feat/db-update: database updates in the GUI (v1.8.0)"
git tag -a v1.8.0 -m "Release v1.8.0"
git push origin main && git push upstream main
git push upstream refs/tags/v1.8.0 && git push origin refs/tags/v1.8.0
gh run list --repo equitania/odoodev-gui --workflow release.yml --limit 1
```

Expected: `data scan clean`; both remotes carry `main` and the tag; the release workflow run for `v1.8.0` is queued or running (never push tags with `--tags` — a multi-tag push suppresses the workflow trigger).
