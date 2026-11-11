use std::path::PathBuf;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};

pub const EXTRA_PATHS_UNIX: &[&str] = &[
    ".local/bin",
    ".cargo/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    // Homebrew's libpq is keg-only: psql/pg_dump live here and are NOT
    // symlinked into /opt/homebrew/bin. Without these, odoodev subprocesses
    // spawned from the packaged app find no pg client tools.
    "/opt/homebrew/opt/libpq/bin",
    "/usr/local/opt/libpq/bin",
];

pub const EXTRA_PATHS_WIN: &[&str] = &[".local\\bin", ".cargo\\bin"];

pub fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Prepare a CLI subprocess. Despite the historical name this sets up the whole
/// child environment, not just PATH — every call site that spawns a CLI goes
/// through it, so this is the one place that keeps their behaviour uniform.
///
/// * `COLUMNS` / `NO_COLOR`: without a TTY, Rich falls back to an 80-column
///   width and soft-wraps long messages (a filestore path lands on its own
///   line), which breaks every parser that keys on a `[LEVEL]` line prefix.
/// * `stdin` = null: a packaged desktop app has no terminal. Inheriting stdin
///   would let an unexpected CLI prompt block forever with no visible reason;
///   a null stdin turns that into an immediate, reportable failure instead.
pub fn augment_path(cmd: &mut Command) {
    cmd.env("COLUMNS", "200");
    cmd.env("NO_COLOR", "1");
    cmd.stdin(std::process::Stdio::null());

    let home = home_dir();
    let extra: Vec<PathBuf> = if cfg!(target_os = "windows") {
        EXTRA_PATHS_WIN.iter().map(|p| home.join(p)).collect()
    } else {
        EXTRA_PATHS_UNIX
            .iter()
            .map(|p| {
                if p.starts_with('/') {
                    PathBuf::from(p)
                } else {
                    home.join(p)
                }
            })
            .collect()
    };

    let current = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let extra_str = extra
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(sep);
    cmd.env("PATH", format!("{extra_str}{sep}{current}"));
}

/// Locate a binary via PATH plus the well-known install dirs from
/// EXTRA_PATHS. Packaged desktop apps start with a minimal PATH
/// (macOS: /usr/bin:/bin:...), so PATH lookup alone misses binaries in
/// /usr/local/bin (docker, container) or ~/.local/bin (odoodev, uv).
pub fn find_binary_opt(name: &str) -> Option<PathBuf> {
    if let Ok(p) = which::which(name) {
        return Some(p);
    }
    let home = home_dir();
    let dirs: &[&str] = if cfg!(target_os = "windows") {
        EXTRA_PATHS_WIN
    } else {
        EXTRA_PATHS_UNIX
    };
    for dir in dirs {
        let base = if dir.starts_with('/') {
            PathBuf::from(dir)
        } else {
            home.join(dir)
        };
        let candidate = base.join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

pub fn find_binary(name: &str) -> PathBuf {
    find_binary_opt(name).unwrap_or_else(|| PathBuf::from(name))
}

pub fn find_odoodev() -> PathBuf {
    find_binary("odoodev")
}

/// Reject a user-supplied value that could be misparsed as a flag by the
/// downstream odoodev (Click) parser. Args are always passed as an argv vector,
/// so this is not a shell-injection guard — it is defense-in-depth against
/// argument injection. Every legitimate value here (versions, DB names, module
/// lists, file paths) never starts with '-', so a leading '-' is rejected early
/// with a clear message instead of producing a confusing downstream CLI error.
///
/// This is the check for free-form values (paths, module lists, host names,
/// image tags). Versions and names have the stricter `validate_version` /
/// `validate_name`.
pub fn reject_flag_like(field: &str, value: &str) -> Result<(), String> {
    if value.starts_with('-') {
        Err(format!("Invalid {field}: value must not start with '-'"))
    } else {
        Ok(())
    }
}

/// Validate an Odoo version identifier: exactly two ASCII digits, as in the
/// registry reported by `odoodev config versions --json` ("16" .. "20").
pub fn validate_version(field: &str, value: &str) -> Result<(), String> {
    if value.len() == 2 && value.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(format!(
            "Invalid {field}: expected a two-digit Odoo version, e.g. \"18\""
        ))
    }
}

/// Validate a database, migration-group or playbook-step name that is passed
/// as a CLI value. Deliberately lenient (existing databases may carry names
/// the CLI would no longer accept for new ones): non-blank, at most 255
/// characters, no leading '-' and no control characters.
pub fn validate_name(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("Invalid {field}: value must not be empty"));
    }
    if value.chars().count() > 255 {
        return Err(format!("Invalid {field}: value is too long"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!(
            "Invalid {field}: value must not contain control characters"
        ));
    }
    reject_flag_like(field, value)
}

/// Strip the line ending (`\n` or `\r\n`) from one raw output line and decode
/// it lossily.
pub fn decode_line(buf: &[u8]) -> String {
    let line = buf.strip_suffix(b"\n").unwrap_or(buf);
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    String::from_utf8_lossy(line).into_owned()
}

/// The next line of a child pipe, or `None` at EOF (or on a read error).
///
/// Unlike `AsyncBufReadExt::lines()`, invalid UTF-8 does not end the loop:
/// `lines()` errors on the first bad byte, the caller stops reading, the pipe
/// is no longer drained and the child can block on a full buffer. `buf` is a
/// caller-owned scratch buffer that is reused between calls.
pub async fn next_lossy_line<R>(reader: &mut R, buf: &mut Vec<u8>) -> Option<String>
where
    R: AsyncBufRead + Unpin,
{
    buf.clear();
    match reader.read_until(b'\n', buf).await {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(decode_line(buf)),
    }
}

pub fn build_odoodev_command(args: &[&str]) -> Command {
    let mut cmd = Command::new(find_odoodev());
    cmd.args(args);
    augment_path(&mut cmd);
    cmd
}

pub async fn run_odoodev_json(args: &[&str]) -> Result<serde_json::Value, String> {
    let output = build_odoodev_command(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Try parse stdout as JSON regardless of exit code (venv check exits 1 but emits JSON)
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) {
        return Ok(v);
    }
    if output.status.success() {
        Err(format!("Failed to parse JSON. Output: {stdout}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "odoodev failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ))
    }
}

pub async fn run_odoodev_text(args: &[&str]) -> Result<String, String> {
    let output = build_odoodev_command(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Some CLI abort reasons are printed via print_info (stdout), not
        // stderr — fall back so the user sees WHY the command failed.
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        Err(format!(
            "odoodev failed (exit {}): {detail}",
            output.status.code().unwrap_or(-1),
        ))
    }
}

/// Lenient variant that returns stdout AND stderr combined. The CLI's
/// print_error writes to stderr — parsers that must see `[ERROR]` lines
/// (e.g. doctor's hard-check failures) need both streams.
pub async fn run_odoodev_text_lenient_combined(args: &[&str]) -> Result<String, String> {
    let output = build_odoodev_command(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = if stderr.trim().is_empty() {
        stdout.to_string()
    } else {
        format!("{stdout}\n{stderr}")
    };
    if combined.trim().is_empty() && !output.status.success() {
        return Err(format!(
            "odoodev failed (exit {}) with no output",
            output.status.code().unwrap_or(-1),
        ));
    }
    Ok(combined)
}

pub async fn run_odoodev_streaming(
    args: &[&str],
    window: &tauri::Window,
    event_name: &str,
) -> Result<i32, String> {
    let mut child = build_odoodev_command(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn odoodev: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let win_err = window.clone();
    let event_err = event_name.to_string();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        while let Some(line) = next_lossy_line(&mut reader, &mut buf).await {
            let _ = win_err.emit(&event_err, &line);
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    while let Some(line) = next_lossy_line(&mut reader, &mut buf).await {
        let _ = window.emit(event_name, &line);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for odoodev: {e}"))?;
    Ok(status.code().unwrap_or(-1))
}

pub async fn run_odoodev_spawn(args: &[&str]) -> Result<Child, String> {
    let mut cmd = build_odoodev_command(args);
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(false);
    cmd.spawn()
        .map_err(|e| format!("Failed to spawn odoodev: {e}"))
}

pub async fn get_odoodev_version() -> Option<String> {
    let mut cmd = Command::new(find_odoodev());
    cmd.arg("--version");
    augment_path(&mut cmd);
    let output = cmd.output().await.ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    if let Some(v) = stdout.split("version ").nth(1) {
        return Some(v.trim().to_string());
    }
    // Fallback: any version-like token
    for tok in stdout.split_whitespace() {
        if tok
            .chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        {
            return Some(tok.trim().to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        decode_line, find_binary_opt, next_lossy_line, reject_flag_like, validate_name,
        validate_version,
    };

    #[test]
    fn find_binary_opt_none_for_unknown() {
        assert!(find_binary_opt("definitely-not-a-real-binary-xyz").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn find_binary_opt_finds_sh() {
        assert!(find_binary_opt("sh").is_some());
    }

    #[test]
    fn accepts_normal_values() {
        assert!(reject_flag_like("version", "19").is_ok());
        assert!(reject_flag_like("name", "v19_exam").is_ok());
        assert!(reject_flag_like("backup_file", "/home/user/dump.zip").is_ok());
        assert!(reject_flag_like("modules", "sale,stock").is_ok());
    }

    #[test]
    fn rejects_flag_like_values() {
        assert!(reject_flag_like("name", "--drop").is_err());
        assert!(reject_flag_like("version", "-d").is_err());
    }

    #[test]
    fn validate_version_accepts_registry_versions_only() {
        for v in ["16", "17", "18", "19", "20"] {
            assert!(validate_version("version", v).is_ok(), "{v}");
        }
        for v in [
            "", "1", "180", "-1", "--", "v18", "1a", " 18", "18 ", "１８", "all",
        ] {
            assert!(validate_version("version", v).is_err(), "{v:?}");
        }
    }

    #[test]
    fn validate_name_accepts_real_names() {
        for n in [
            "v19_exam",
            "my-db.old",
            "db with space",
            "18-to-19",
            "db.backup",
            "Müller_2026",
            "a",
        ] {
            assert!(validate_name("name", n).is_ok(), "{n:?}");
        }
    }

    #[test]
    fn validate_name_rejects_unsafe_names() {
        for n in ["", "   ", "-d", "--force", "a\nb", "a\0b", "tab\there"] {
            assert!(validate_name("name", n).is_err(), "{n:?}");
        }
        assert!(validate_name("name", &"x".repeat(256)).is_err());
        assert!(validate_name("name", &"x".repeat(255)).is_ok());
    }

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
}
