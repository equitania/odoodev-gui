# Architecture — odoodev-gui

> System architecture, data flow, file structure, and technology decisions.

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Tauri v2 Window (Rust)                        │
│                                                                  │
│  ┌─────────────────┐    IPC (invoke/listen)   ┌────────────────┐  │
│  │  Rust Backend   │ ←──────────────────────→ │  React 19      │  │
│  │                  │                          │  Frontend      │  │
│  │  ┌────────────┐ │  invoke('start_server')  │  ┌──────────┐  │  │
│  │  │ odoodev.rs │ │  listen('odoodev-log:v') │  │ Sidebar  │  │  │
│  │  │ + uv       │ │  listen('server-status') │  │ + Views  │  │  │
│  │  │ + pypi     │ │                          │  └──────────┘  │  │
│  │  └────────────┘ │                          └────────────────┘  │
│  │  ┌────────────┐ │                                               │
│  │  │  HashMap   │ │  key: version ("16".."19")                   │
│  │  │  String,   │ │  val: OdooProcess { child, pid, started_at } │
│  │  │  OdooProc  │ │                                               │
│  │  └────────────┘ │                                               │
│  │  ┌────────────┐ │                                               │
│  │  │log_parser  │ │  port of odoodev/tui/log_parser.py           │
│  │  └────────────┘ │                                               │
│  └─────────────────┘                                               │
│         │ subprocess                                                │
│         ▼                                                           │
│  ┌─────────────────────────────────────────────────────┐           │
│  │  odoodev start 18 --dev -d v18_exam                 │           │
│  │  odoodev db list 18 --json                          │           │
│  │  odoodev config versions --json                     │           │
│  │  odoodev venv check 18 --json                       │           │
│  │  odoodev db backup 18 -n v18_exam -t zip            │           │
│  │  odoodev db restore 18 -n new -z backup.zip ...     │           │
│  │  odoodev docker up 18                                │           │
│  │  odoodev stop 18 --keep-docker                      │           │
│  │  uv tool install odoodev-equitania                   │           │
│  │  uv tool upgrade odoodev-equitania                  │           │
│  └─────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
```

---

## Data Flow

### 1. Dashboard Data Flow

```
App Start
  │
  ├── Rust: check_uv() → ensure_uv() → uv found/installed
  ├── Rust: check_odoodev() → install prompt if missing
  ├── Rust: get_pypi_version() → compare with installed
  │
  ├── Rust: get_versions() ────────────────┐
  │   odoodev config versions --json        │
  │   → serde → HashMap<String, VersionInfo>│
  │                                         │
  ├── Rust: get_venv_status("18") ─────────┤
  │   odoodev venv check 18 --json          │
  │   → serde → VenvStatus                  │
  │   (per version, parallel)              │
  │                                         │
  ├── Rust: check_docker_status("18") ─────┤
  │   docker ps --format "{{.Names}}"       │
  │   → compare with expected container    │
  │   (per version, parallel)              │
  │                                         │
  └── Frontend: render 4 VersionCards ◄────┘
      Polling: docker 5s, venv 30s
```

### 2. Server Start + Log Streaming Data Flow

```
User clicks "Start"
  │
  Frontend: invoke('start_server', { version: '18', mode: 'dev', database: 'v18_exam' })
  │
  Rust:
  │   1. Build args: ["start", "18", "--dev", "-d", "v18_exam"]
  │   2. Spawn: tokio::process::Command::new("odoodev").args(args)
  │   3. Store child+pid in HashMap["18"]
  │   4. Spawn tokio task: read stdout line-by-line
  │      → parse_line(line) → OdooLogEntry
  │      → window.emit("odoodev-log:18", entry)
  │   5. Spawn tokio task: read stderr line-by-line
  │      → emit as Raw OdooLogEntry
  │   6. Spawn tokio task: poll child status every 500ms
  │      → window.emit("server-status:18", { running, pid, uptime })
  │   7. On child exit:
  │      → window.emit("server-exited:18", { exit_code })
  │      → remove from HashMap
  │
  Frontend: listen("odoodev-log:18")
  │   → appendLog("18", entry) → Zustand store
  │   → LogViewer re-renders (virtual list)
  │
  Frontend: listen("server-status:18")
  │   → update store: servers["18"].status = { running, pid, uptime }
  │   → StatusBar re-renders
  │
  Frontend: listen("server-exited:18")
      → appendLog("18", separator: "--- Server stopped (exit code N) ---")
      → update store: servers["18"].status = { running: false }
      → Log-Buffer bleibt erhalten
```

### 3. Database Backup Data Flow

```
User clicks [Backup] → BackupDialog
  │
  Frontend: invoke('backup_db', { version: '18', name: 'v18_exam', type: 'zip', output_dir: '~/Downloads' })
  │
  Rust:
  │   1. Build args: ["db", "backup", "18", "-n", "v18_exam", "-t", "zip", "-o", "~/Downloads"]
  │   2. Spawn odoodev subprocess
  │   3. Stream stdout/stderr line-by-line
  │      → window.emit("backup-progress", { line })
  │   4. On exit: return { success, path, size }
  │
  Frontend: listen("backup-progress")
  │   → OperationProgress modal: append lines
  │
  Rust: return result
  │
  Frontend: show "Backup saved: ~/Downloads/v18_exam_250710.zip (45.2 MB)"
```

### 4. uv Install + odoodev Install Data Flow

```
App Start
  │
  Rust: check_uv()
  │   → which("uv") → not found
  │   → check common paths → not found
  │   → emit("uv-not-installed")
  │
  Frontend: InstallDialog "uv is not installed"
  │   User clicks [Install uv now]
  │   → invoke('install_uv')
  │
  Rust: install_uv()
  │   → macOS/Linux: sh -c "curl -LsSf https://astral.sh/uv/install.sh | sh"
  │   → Windows: powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
  │   → stream stdout → emit("install-progress")
  │   → re-check: which("uv") → found
  │   → return { success, path }
  │
  Rust: check_odoodev()
  │   → uv tool list → no odoodev-equitania
  │   → emit("odoodev-not-installed")
  │
  Frontend: InstallDialog "odoodev is not installed"
  │   User clicks [Install now]
  │   → invoke('install_odoodev')
  │
  Rust: install_odoodev()
  │   → uv tool install odoodev-equitania
  │   → stream stdout → emit("install-progress")
  │   → re-check: odoodev --version → v0.49.1
  │   → return { success, version }
  │
  Frontend: Dashboard reload
```

---

## Rust Backend Modules

### `odoodev.rs` — Subprocess Wrapper

```rust
use std::process::Stdio;
use tokio::process::{Command, Child};
use tokio::io::{AsyncBufReadExt, BufReader};
use tauri::Window;

/// Execute odoodev with args, return stdout parsed as JSON
pub async fn run_odoodev_json(args: &[&str]) -> Result<serde_json::Value, String> {
    let output = build_odoodev_command(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse JSON: {e}\nOutput: {stdout}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("odoodev failed: {}", stderr.trim()))
    }
}

/// Execute odoodev with args, return stdout as text
pub async fn run_odoodev_text(args: &[&str]) -> Result<String, String> {
    let output = build_odoodev_command(args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Execute odoodev with streaming stdout/stderr, emit lines as Tauri events
pub async fn run_odoodev_streaming(
    args: &[&str],
    window: &Window,
    event_name: &str,
) -> Result<i32, String> {
    let mut child = build_odoodev_command(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn odoodev: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    // Spawn stderr reader (emit as Raw log entries)
    let win_err = window.clone();
    let event_err = event_name.to_string();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit(&event_err, &line);
        }
    });

    // Read stdout line-by-line
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = window.emit(event_name, &line);
    }

    let status = child.wait().await
        .map_err(|e| format!("Failed to wait for odoodev: {e}"))?;
    Ok(status.code().unwrap_or(-1))
}

/// Build the odoodev Command with PATH augmentation
fn build_odoodev_command(args: &[&str]) -> Command {
    let odoodev_path = find_odoodev();
    let mut cmd = Command::new(odoodev_path);
    cmd.args(args);
    // Augment PATH for environments where GUI doesn't inherit shell PATH
    augment_path(&mut cmd);
    cmd
}

/// Find odoodev binary in PATH or common locations
fn find_odoodev() -> PathBuf {
    if let Ok(p) = which::which("odoodev") {
        return p;
    }
    // Fallback: uv tool bin directory
    let home = dirs::home_dir().unwrap();
    let candidates = [
        home.join(".local/bin/odoodev"),
        home.join(".cargo/bin/odoodev"),
    ];
    for c in &candidates {
        if c.exists() {
            return c.clone();
        }
    }
    PathBuf::from("odoodev") // last resort: rely on PATH
}

/// Add common bin directories to PATH (GUI apps may not inherit shell PATH)
fn augment_path(cmd: &mut Command) {
    let home = dirs::home_dir().unwrap();
    let extra_paths = if cfg!(target_os = "windows") {
        vec![
            home.join(".local/bin"),
            home.join(".cargo/bin"),
        ]
    } else {
        vec![
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]
    };

    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra_joined = extra_paths.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(":");
    cmd.env("PATH", format!("{extra_joined}:{current_path}"));
}
```

### `server_manager.rs` — Parallel Server Management

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::process::Child;
use chrono::{DateTime, Utc};

pub struct OdooProcess {
    pub child: Option<Child>,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
}

pub struct ServerManager {
    processes: Mutex<HashMap<String, OdooProcess>>,
}

impl ServerManager {
    pub fn new() -> Self {
        Self { processes: Mutex::new(HashMap::new()) }
    }

    pub fn is_running(&self, version: &str) -> bool {
        self.processes.lock().unwrap().contains_key(version)
    }

    pub fn get_pid(&self, version: &str) -> Option<u32> {
        self.processes.lock().unwrap().get(version).map(|p| p.pid)
    }

    pub fn get_uptime(&self, version: &str) -> Option<u64> {
        self.processes.lock().unwrap().get(version).map(|p| {
            (Utc::now() - p.started_at).num_seconds() as u64
        })
    }

    pub fn insert(&self, version: String, child: Child, pid: u32) {
        self.processes.lock().unwrap().insert(version, OdooProcess {
            child: Some(child),
            pid,
            started_at: Utc::now(),
        });
    }

    pub fn remove(&self, version: &str) {
        self.processes.lock().unwrap().remove(version);
    }
}
```

### `log_parser.rs` — Odoo Log Parser (Port from Python)

```rust
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Debug,
    Info,
    Warning,
    Error,
    Critical,
    Raw,
}

#[derive(Debug, Clone, Serialize)]
pub struct OdooLogEntry {
    pub timestamp: String,
    pub pid: String,
    pub level: LogLevel,
    pub database: String,
    pub logger: String,
    pub message: String,
    pub raw: String,
}

lazy_static::lazy_static! {
    static ref LOG_PATTERN: Regex = Regex::new(
        r"^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+)\s+(\d+)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+)\s+(\S+?):\s*(.*)"
    ).unwrap();
}

pub fn parse_line(line: &str) -> OdooLogEntry {
    let stripped = line.trim_end_matches(['\n', '\r']);
    if let Some(caps) = LOG_PATTERN.captures(stripped) {
        let level = match &caps[3] {
            "DEBUG" => LogLevel::Debug,
            "INFO" => LogLevel::Info,
            "WARNING" => LogLevel::Warning,
            "ERROR" => LogLevel::Error,
            "CRITICAL" => LogLevel::Critical,
            _ => LogLevel::Raw,
        };
        OdooLogEntry {
            timestamp: caps[1].to_string(),
            pid: caps[2].to_string(),
            level,
            database: caps[4].to_string(),
            logger: caps[5].to_string(),
            message: caps[6].to_string(),
            raw: stripped.to_string(),
        }
    } else {
        OdooLogEntry {
            timestamp: String::new(),
            pid: String::new(),
            level: LogLevel::Raw,
            database: String::new(),
            logger: String::new(),
            message: stripped.to_string(),
            raw: stripped.to_string(),
        }
    }
}
```

### `installer.rs` — uv + odoodev Installer

```rust
use std::path::PathBuf;
use tokio::process::Command;

pub struct UvInfo {
    pub path: PathBuf,
    pub version: String,
}

pub async fn ensure_uv() -> Result<UvInfo, String> {
    // 1. Check PATH
    if let Ok(path) = which::which("uv") {
        let version = get_uv_version(&path).await;
        return Ok(UvInfo { path, version });
    }
    // 2. Check common locations
    let home = dirs::home_dir().unwrap();
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            home.join(r".local\bin\uv.exe"),
            home.join(r".cargo\bin\uv.exe"),
        ]
    } else {
        vec![
            home.join(".local/bin/uv"),
            home.join(".cargo/bin/uv"),
            PathBuf::from("/opt/homebrew/bin/uv"),
            PathBuf::from("/usr/local/bin/uv"),
        ]
    };
    for c in &candidates {
        if c.exists() {
            let version = get_uv_version(c).await;
            return Ok(UvInfo { path: c.clone(), version });
        }
    }
    // 3. Install uv
    install_uv().await?;
    // 4. Re-check
    let path = which::which("uv").map_err(|_| "uv still not found after install".to_string())?;
    let version = get_uv_version(&path).await;
    Ok(UvInfo { path, version })
}

async fn install_uv() -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(["-c", "irm https://astral.sh/uv/install.ps1 | iex"])
            .output().await
            .map_err(|e| format!("Failed to install uv: {e}"))?;
    } else {
        Command::new("sh")
            .args(["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"])
            .output().await
            .map_err(|e| format!("Failed to install uv: {e}"))?;
    }
    Ok(())
}

pub async fn check_odoodev() -> Option<String> {
    // Try: odoodev --version
    if let Ok(output) = Command::new("odoodev").arg("--version").output().await {
        let stdout = String::from_utf8_lossy(&output.stdout);
        // Parse: "odoodev, version 0.49.1"
        if let Some(v) = stdout.split("version ").nth(1) {
            return Some(v.trim().to_string());
        }
    }
    None
}

pub async fn install_odoodev() -> Result<String, String> {
    let uv = ensure_uv().await?;
    let output = Command::new(uv.path)
        .args(["tool", "install", "odoodev-equitania"])
        .output().await
        .map_err(|e| format!("Failed to install odoodev: {e}"))?;
    if output.status.success() {
        check_odoodev().await.ok_or("Installed but version check failed".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

pub async fn upgrade_odoodev() -> Result<String, String> {
    let uv = ensure_uv().await?;
    let old_version = check_odoodev().await.unwrap_or_default();
    let output = Command::new(uv.path)
        .args(["tool", "upgrade", "odoodev-equitania"])
        .output().await
        .map_err(|e| format!("Failed to upgrade odoodev: {e}"))?;
    if output.status.success() {
        let new_version = check_odoodev().await.unwrap_or_default();
        Ok(new_version)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

---

## Rust Models (`models.rs`)

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// === config versions --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VersionInfo {
    pub python: String,
    pub postgres: String,
    pub ports: Ports,
    pub base: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Ports {
    pub db: u16,
    pub odoo: u16,
    pub gevent: u16,
    pub mailpit: u16,
}

// Top-level: { "16": VersionInfo, "17": VersionInfo, ... }
pub type VersionsResponse = HashMap<String, VersionInfo>;

// === venv check --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VenvStatus {
    pub version: String,
    pub venv_dir: String,
    pub exists: bool,
    pub is_symlink: bool,
    pub python_version: Option<String>,
    pub python_matches: Option<bool>,
    pub requirements_current: Option<bool>,
}

// === db list --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DbListResponse {
    pub version: String,
    pub host: String,
    pub port: u16,
    pub databases: Vec<String>,
}

// === run --output json (NDJSON, per-line) ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaybookEvent {
    pub event: String,  // "playbook_start", "step_done", "playbook_done", "error"
    pub name: Option<String>,
    pub command: Option<String>,
    pub status: Option<String>,  // "ok", "error", "skipped"
    pub message: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub details: Option<serde_json::Value>,
    pub playbook: Option<String>,
    pub version: Option<String>,
    pub steps_ok: Option<u32>,
    pub steps_error: Option<u32>,
}

// === Docker status (Rust-native check, not CLI) ===
#[derive(Debug, Clone, Serialize)]
pub struct DockerStatus {
    pub running: bool,
    pub container_name: String,
    pub runtime: String,  // "docker", "apple", "none"
}

// === Server status ===
#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime_seconds: Option<u64>,
    pub port: Option<u16>,
}

// === PyPI version ===
#[derive(Debug, Deserialize)]
pub struct PypiResponse {
    pub info: PypiInfo,
}
#[derive(Debug, Deserialize)]
pub struct PypiInfo {
    pub version: String,
}

// === uv info ===
#[derive(Debug, Clone, Serialize)]
pub struct UvInfoDto {
    pub path: String,
    pub version: String,
}

// === Platform info ===
#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
}
```

---

## Frontend State Architecture (Zustand)

```
┌─────────────────────────────────────────────────────────────┐
│                      Zustand Store                           │
│                                                              │
│  ┌─── Meta ───────────────────────────────────────────────┐ │
│  │ odoodevVersion: string | null                           │ │
│  │ pypiVersion: string | null                              │ │
│  │ uvInfo: { path, version } | null                         │ │
│  │ updateAvailable: boolean                                 │ │
│  │ odoodevInstalled: boolean                                 │ │
│  │ firstRunChecked: boolean                                 │ │
│  │ appVersion: string                                       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─── Dashboard ───────────────────────────────────────────┐ │
│  │ versions: Record<string, VersionInfo>                   │ │
│  │ activeVersions: string[]                                │ │
│  │ venvStatus: Record<string, VenvStatus | null>          │ │
│  │ dockerStatus: Record<string, DockerStatus>              │ │
│  │ dashboardLoading: boolean                               │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─── Servers (parallel) ─────────────────────────────────┐ │
│  │ servers: Record<string, ServerState>                    │ │
│  │                                                         │ │
│  │ ServerState = {                                         │ │
│  │   status: ServerStatus,                                  │ │
│  │   config: ServerConfig (last used config),              │ │
│  │   logBuffer: OdooLogEntry[], (persisted across stop)     │ │
│  │   logFilters: Set<LogLevel>,                             │ │
│  │   searchTerm: string,                                    │ │
│  │   autoScroll: boolean,                                   │ │
│  │ }                                                       │ │
│  │                                                         │ │
│  │ Buffer cap: 50,000 entries                              │ │
│  │ On cap: shift oldest, show "… N lines truncated"         │ │
│  │ On stop: append separator entry, keep buffer            │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌─── Actions ────────────────────────────────────────────┐ │
│  │ fetchVersions()                                         │ │
│  │ fetchVenvStatus(version)                                 │ │
│  │ fetchDockerStatus(version)                               │ │
│  │ fetchAllDashboard()                                      │ │
│  │ checkOdoodevUpdate()                                     │ │
│  │ installOdoodev()                                         │ │
│  │ updateOdoodev()                                          │ │
│  │ startServer(config)                                      │ │
│  │ stopServer(version, force?)                              │ │
│  │ appendLog(version, entry)                                │ │
│  │ clearLog(version)                                        │ │
│  │ appendSeparator(version, text)                           │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## File Structure (Complete)

```
odoodev-gui/
├── src-tauri/
│   ├── Cargo.toml                          # Rust dependencies
│   ├── tauri.conf.json                     # Tauri v2 config (window, updater, bundle)
│   ├── build.rs                           # Tauri build script
│   ├── icons/
│   │   ├── icon.icns                       # macOS app icon
│   │   ├── icon.ico                        # Windows app icon
│   │   ├── icon.png                        # Linux app icon
│   │   └── Square*.png                     # Various sizes (Tauri requirement)
│   ├── capabilities/
│   │   └── default.json                    # Tauri v2 permissions (shell, updater)
│   └── src/
│       ├── main.rs                        # Tauri entry: Builder, state, plugin, commands
│       ├── lib.rs                         # Re-exports for tests
│       ├── odoodev.rs                      # Subprocess wrapper (json/text/streaming)
│       ├── server_manager.rs              # HashMap<version, OdooProcess>
│       ├── log_parser.rs                  # Port of odoodev/tui/log_parser.py
│       ├── installer.rs                   # uv + odoodev install/upgrade
│       ├── pypi.rs                        # PyPI version check via reqwest
│       ├── docker_check.rs               # Direct docker ps / container ls
│       ├── models.rs                      # Serde structs for all JSON responses
│       └── commands/
│           ├── mod.rs                     # Module declarations
│           ├── versions.rs                # get_versions, get_venv_status, get_active_versions
│           ├── server.rs                  # start_server, stop_server, get_server_status
│           ├── database.rs               # get_databases, backup_db, restore_db, drop_db
│           ├── docker.rs                  # docker_up, docker_down, docker_status
│           ├── self_update.rs            # check_odoodev_update, update_odoodev, check_app_update
│           └── system.rs                 # get_platform_info, open_external
├── src/                                    # React frontend
│   ├── main.tsx                           # React entry, Tauri event listeners
│   ├── App.tsx                            # Layout shell: Sidebar + Header + Router
│   ├── styles/
│   │   └── globals.css                    # Tailwind v4 + shadcn theme
│   ├── components/
│   │   ├── ui/                            # shadcn/ui primitives
│   │   │   ├── button.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── checkbox.tsx
│   │   │   ├── radio-group.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── tooltip.tsx
│   │   │   └── ...
│   │   ├── Sidebar.tsx                    # Navigation
│   │   ├── Header.tsx                     # Logo + version + update badge
│   │   ├── UpdateBadge.tsx               # odoodev update notification
│   │   ├── InstallDialog.tsx             # First-run install prompt
│   │   ├── dashboard/
│   │   │   ├── Dashboard.tsx             # 4 version cards + polling
│   │   │   ├── VersionCard.tsx           # Single card: badges + actions
│   │   │   ├── StatusBadge.tsx           # Generic status pill
│   │   │   └── DockerBadge.tsx           # Docker-specific badge
│   │   ├── server/
│   │   │   ├── ServerPanel.tsx           # Tab container
│   │   │   ├── ServerTab.tsx             # Single tab: config + log viewer
│   │   │   ├── ServerConfig.tsx          # Start form (mode, db, modules, advanced)
│   │   │   ├── LogViewer.tsx             # Virtual list + filter + search + status bar
│   │   │   ├── LogLine.tsx               # Single log line with syntax highlighting
│   │   │   └── LogFilterBar.tsx          # Level toggles + search + actions
│   │   ├── database/
│   │   │   ├── DatabasePanel.tsx         # Version selector + db table + actions
│   │   │   ├── BackupDialog.tsx          # Modal: format, output, level
│   │   │   ├── RestoreDialog.tsx         # Modal: 3-step wizard
│   │   │   ├── DropConfirmDialog.tsx    # Type-to-confirm
│   │   │   └── OperationProgress.tsx    # Live stdout streaming modal
│   │   └── settings/
│   │       └── SettingsPanel.tsx         # Versions, language, about
│   ├── hooks/
│   │   ├── useOdoodev.ts                 # Typed Tauri invoke wrappers
│   │   ├── usePolling.ts                 # Generic interval polling
│   │   ├── useLogStream.ts              # listen('odoodev-log') → buffer
│   │   └── useServerStatus.ts           # listen('server-status') → state
│   ├── store/
│   │   └── appStore.ts                  # Zustand global state
│   ├── types/
│   │   └── odoodev.ts                    # TypeScript types mirroring Rust models
│   └── lib/
│       ├── tauri.ts                     # Invoke wrappers with error handling
│       └── constants.ts                 # Version labels, colors, etc.
├── docs/                                 # Design documents
│   ├── PLAN.md
│   ├── ARCHITECTURE.md
│   ├── CLI_INTEGRATION.md
│   ├── TAURI_API.md
│   └── DECISIONS.md
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json                       # shadcn/ui config
├── .github/
│   └── workflows/
│       ├── ci.yml                        # Lint + typecheck + build (3-OS)
│       └── release.yml                   # Tag → build → GitHub Release
├── .gitignore
├── CLAUDE.md
├── README.md
└── LICENSE                              # AGPL-3.0
```

---

## Cargo.toml (Dependencies)

```toml
[package]
name = "odoodev-gui"
version = "1.0.0"
edition = "2021"
rust-version = "1.75"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["updater"] }
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json"] }
anyhow = "1"
thiserror = "2"
which = "7"
dirs = "6"
chrono = { version = "0.4", features = ["serde"] }
regex = "1"
lazy_static = "1"
log = "0.4"
env_logger = "0.11"

[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
```

---

## package.json (Dependencies)

```json
{
  "name": "odoodev-gui",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "lint": "eslint src --ext ts,tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "@tauri-apps/plugin-updater": "^2.0.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.500.0",
    "@tanstack/react-virtual": "^3.0.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^3.0.0",
    "class-variance-authority": "^0.7.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.7.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/vite": "^4.0.0",
    "shadcn": "^2.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0"
  }
}
```

---

## Cross-Platform Considerations

### PATH Handling

GUI applications often don't inherit the user's shell PATH. The Rust backend augments
PATH before every subprocess call:

| Platform | Extra PATH entries |
|----------|-------------------|
| macOS | `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, `/usr/local/bin` |
| Linux | `~/.local/bin`, `~/.cargo/bin`, `/usr/local/bin` |
| Windows | `%USERPROFILE%\.local\bin`, `%USERPROFILE%\.cargo\bin` |

### uv Installation

| Platform | Command |
|----------|---------|
| macOS/Linux | `sh -c "curl -LsSf https://astral.sh/uv/install.sh \| sh"` |
| Windows | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| Fallback | Direct binary download from `github.com/astral-sh/uv/releases` |

### Docker Detection

Instead of parsing `odoodev docker status` text output, the Rust backend checks directly:

1. `which("docker")` → not found → DockerStatus::NotInstalled
2. `docker ps --format "{{.Names}}\t{{.Status}}"` → parse output → find expected container
3. Apple Container: `which("container")` → `container ls` → parse
4. Container name from `versions.yaml` pattern: `picard-dev-db-XX-native`

### Webview Dependencies

| Platform | Webview | Requirement |
|----------|---------|-------------|
| macOS | WKWebView | System-native (no extra install) |
| Linux | WebKitGTK | `webkit2gtk-4.1` system package |
| Windows | WebView2 | Preinstalled on Win10/11, or download link |

### Bundle Formats

| Platform | Format | Tool |
|----------|--------|------|
| macOS | `.dmg` + `.app` | Tauri bundler |
| Windows | `.msi` + `.exe` (NSIS) | Tauri bundler |
| Linux | `.AppImage` + `.deb` | Tauri bundler |