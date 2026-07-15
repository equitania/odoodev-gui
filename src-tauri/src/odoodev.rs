use std::path::PathBuf;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
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

pub fn augment_path(cmd: &mut Command) {
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
pub fn reject_flag_like(field: &str, value: &str) -> Result<(), String> {
    if value.starts_with('-') {
        Err(format!("Invalid {field}: value must not start with '-'"))
    } else {
        Ok(())
    }
}

#[allow(dead_code)]
pub fn find_uv() -> PathBuf {
    find_binary("uv")
}

fn build_odoodev_command(args: &[&str]) -> Command {
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

/// Like run_odoodev_text, but tolerates non-zero exit codes: some odoodev
/// commands (e.g. `doctor`) legitimately exit 1 while still printing their
/// full report to stdout. Errors only when the process can't be spawned or
/// produced no stdout at all.
pub async fn run_odoodev_text_lenient(args: &[&str]) -> Result<String, String> {
    let output = build_odoodev_command(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if !stdout.trim().is_empty() {
        return Ok(stdout);
    }
    if output.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!(
            "odoodev failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
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
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit(&event_err, &line);
        }
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
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

#[cfg(test)]
mod tests {
    use super::{find_binary_opt, reject_flag_like};

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
