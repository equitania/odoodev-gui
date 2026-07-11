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

pub fn find_binary(name: &str) -> PathBuf {
    if let Ok(p) = which::which(name) {
        return p;
    }
    let home = home_dir();
    let candidates = [
        home.join(format!(".local/bin/{name}")),
        home.join(format!(".cargo/bin/{name}")),
    ];
    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }
    PathBuf::from(name)
}

pub fn find_odoodev() -> PathBuf {
    find_binary("odoodev")
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
        Err(format!(
            "odoodev failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ))
    }
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
