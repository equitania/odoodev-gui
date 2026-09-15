use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};

use crate::db_update::{
    build_db_update_args, parse_event, read_log_tail, update_log_dir, validate_update_log_path,
    DbUpdateArgs, DbUpdateEvent, DbUpdatePlan, LOG_VIEW_LIMIT,
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

/// Decode one output line lossily — `lines()` would stop on the first invalid
/// UTF-8 byte and leave the pipe undrained, which can block the child.
fn decode_line(buf: &[u8]) -> String {
    let line = buf.strip_suffix(b"\n").unwrap_or(buf);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    String::from_utf8_lossy(line).into_owned()
}

/// The next line of a child pipe, or `None` at EOF (or on a read error).
async fn next_lossy_line<R>(reader: &mut R, buf: &mut Vec<u8>) -> Option<String>
where
    R: AsyncBufRead + Unpin,
{
    buf.clear();
    match reader.read_until(b'\n', buf).await {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(decode_line(buf)),
    }
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
    let pid = child
        .id()
        .ok_or_else(|| "Failed to get the odoodev PID".to_string())?;

    let (force_tx, mut force_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    if let Err(e) = manager.insert(version.clone(), pid, force_tx) {
        let _ = child.start_kill();
        return Err(e);
    }

    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    let (app_out, version_out) = (app.clone(), version.clone());
    let stdout_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        while let Some(line) = next_lossy_line(&mut reader, &mut buf).await {
            if let Some(event) = parse_event(&line) {
                let _ = app_out.emit(
                    "db-update-event",
                    EventPayload {
                        version: version_out.clone(),
                        event,
                    },
                );
            } else if !line.trim().is_empty() {
                let _ = app_out.emit(
                    "db-update-log",
                    LogPayload {
                        version: version_out.clone(),
                        line,
                    },
                );
            }
        }
    });

    let (app_err, version_err) = (app.clone(), version.clone());
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        while let Some(line) = next_lossy_line(&mut reader, &mut buf).await {
            if !line.trim().is_empty() {
                let _ = app_err.emit(
                    "db-update-log",
                    LogPayload {
                        version: version_err.clone(),
                        line,
                    },
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
pub fn cancel_db_update(
    version: String,
    force: bool,
    manager: State<'_, DbUpdateManager>,
) -> Result<(), String> {
    manager.cancel(&version, force)
}

#[tauri::command]
pub fn list_db_updates(manager: State<'_, DbUpdateManager>) -> Vec<String> {
    manager.versions()
}

/// Async so the file work runs off the main thread; only the tail is read.
#[tauri::command]
pub async fn read_update_log(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let canon = validate_update_log_path(std::path::Path::new(&path), &update_log_dir())?;
        read_log_tail(&canon, LOG_VIEW_LIMIT)
    })
    .await
    .map_err(|e| format!("Could not read the log: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::{decode_line, next_lossy_line, plan_from_output};
    use crate::models::DbListResponse;

    #[test]
    fn decode_line_trims_line_endings_and_replaces_invalid_utf8() {
        assert_eq!(decode_line(b"abc\n"), "abc");
        assert_eq!(decode_line(b"abc\r\n"), "abc");
        assert_eq!(decode_line(b"no newline"), "no newline");
        assert_eq!(decode_line(b"bad \xff byte\n"), "bad \u{FFFD} byte");
    }

    #[tokio::test]
    async fn reading_continues_past_an_invalid_utf8_line() {
        let data: &[u8] = b"first\nbad \xff\r\nlast";
        let mut reader = tokio::io::BufReader::new(data);
        let mut buf = Vec::new();
        let mut lines = Vec::new();
        while let Some(line) = next_lossy_line(&mut reader, &mut buf).await {
            lines.push(line);
        }
        assert_eq!(lines, vec!["first", "bad \u{FFFD}", "last"]);
    }

    #[test]
    fn plan_is_taken_from_the_plan_event() {
        let stdout = r#"{"event":"plan","version":"19","modules":"all","targets":[],"skipped_current":["v19_a"],"server_running":false}"#;
        let plan = plan_from_output(stdout, "").unwrap();
        assert_eq!(plan.skipped_current, vec!["v19_a"]);
    }

    #[test]
    fn the_cli_error_event_wins() {
        let stdout =
            r#"{"event":"error","message":"PostgreSQL on 127.0.0.1:19432 is not reachable"}"#;
        assert_eq!(
            plan_from_output(
                stdout,
                "[ERROR] PostgreSQL on 127.0.0.1:19432 is not reachable"
            )
            .unwrap_err(),
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
        let without: DbListResponse = serde_json::from_str(
            r#"{"version":"19","host":"localhost","port":19432,"databases":["a"]}"#,
        )
        .unwrap();
        assert!(without.stale.is_none());
        let with: DbListResponse = serde_json::from_str(
            r#"{"version":"19","host":"localhost","port":19432,"databases":["a"],"stale":{"a":"never updated"}}"#,
        )
        .unwrap();
        assert_eq!(with.stale.unwrap()["a"], "never updated");
    }
}
