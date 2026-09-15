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
    let canon = path
        .canonicalize()
        .map_err(|e| format!("Log file not found: {e}"))?;
    let dir = log_dir
        .canonicalize()
        .map_err(|e| format!("Log directory not found: {e}"))?;
    let name = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if canon.parent() != Some(dir.as_path())
        || !name.starts_with("update_v")
        || !name.ends_with(".log")
    {
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
                "db",
                "update",
                "19",
                "-n",
                "v19_a",
                "-n",
                "v19_b",
                "-u",
                "eq_base,eq_sale",
                "--stop-on-error",
                "--timeout",
                "1800",
                "--dry-run",
                "--output",
                "ndjson",
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
            parse_event(
                r#"{"event":"start","database":"v19_a","index":1,"total":2,"log":"/l.log"}"#
            ),
            Some(DbUpdateEvent::Start {
                index: 1,
                total: 2,
                ..
            })
        ));
        assert!(matches!(
            parse_event(r#"{"event":"issue","database":"v19_a","level":"RAW","text":"Traceback"}"#),
            Some(DbUpdateEvent::Issue { .. })
        ));
        assert!(
            matches!(parse_event(RESULT_LINE), Some(DbUpdateEvent::DbResult(r)) if r.warnings == 1)
        );
        assert!(matches!(
            parse_event(&format!(
                r#"{{"event":"summary","results":[{{{}],"skipped_current":[],"exit_code":0}}"#,
                &RESULT_LINE[18..]
            )),
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
        let issue =
            parse_event(r#"{"event":"issue","database":"v19_a","level":"WARNING","text":"x"}"#)
                .unwrap();
        let value = serde_json::to_value(&issue).unwrap();
        assert_eq!(value["event"], "issue");
        assert_eq!(value["level"], "WARNING");
        let result = serde_json::to_value(parse_event(RESULT_LINE).unwrap()).unwrap();
        assert_eq!(result["event"], "result");
        assert_eq!(result["duration_s"], 12.5);
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("odoodev-gui-test-{tag}-{}", std::process::id()));
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
        let traversal = dir
            .join("..")
            .join(outside_dir.file_name().unwrap())
            .join("update_v19_b.log");
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
