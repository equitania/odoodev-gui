use serde::Deserialize;
use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::log_parser;
use crate::models::{OpResult, ServerStatus};
use crate::odoodev;
use crate::server_manager::ServerManager;

#[derive(Debug, Clone, Deserialize)]
pub struct StartServerArgs {
    pub version: String,
    pub mode: Option<String>, // "normal" | "dev" | "shell" | "test" | "prepare"
    pub database: Option<String>,
    pub update_modules: Option<String>,
    pub install_modules: Option<String>,
    pub host: Option<String>,
    pub load_language: Option<String>,
    pub i18n_overwrite: Option<bool>,
    pub clean_sessions: Option<bool>,
    pub config_path: Option<String>,
    pub allow_default_credentials: Option<bool>,
    pub runtime: Option<String>,
    pub extra_args: Option<String>,
}

#[derive(serde::Serialize)]
pub struct StartResult {
    pub pid: u32,
    pub port: u16,
}

fn build_start_args(a: &StartServerArgs) -> Vec<String> {
    let mut args = vec!["start".to_string(), a.version.clone()];
    match a.mode.as_deref() {
        Some("dev") => args.push("--dev".to_string()),
        Some("shell") => args.push("--shell".to_string()),
        Some("test") => args.push("--test".to_string()),
        Some("prepare") => args.push("--prepare".to_string()),
        _ => {}
    }
    if let Some(db) = &a.database {
        if !db.is_empty() {
            args.push("-d".to_string());
            args.push(db.clone());
        }
    }
    if let Some(u) = &a.update_modules {
        if !u.is_empty() {
            args.push("-u".to_string());
            args.push(u.clone());
        }
    }
    if let Some(i) = &a.install_modules {
        if !i.is_empty() {
            args.push("-i".to_string());
            args.push(i.clone());
        }
    }
    if let Some(h) = &a.host {
        if !h.is_empty() {
            args.push("--host".to_string());
            args.push(h.clone());
        }
    }
    if let Some(l) = &a.load_language {
        if !l.is_empty() {
            args.push("--load-language".to_string());
            args.push(l.clone());
        }
    }
    if a.i18n_overwrite.unwrap_or(false) {
        args.push("--i18n-overwrite".to_string());
    }
    if a.clean_sessions.unwrap_or(false) {
        args.push("--clean-sessions".to_string());
    }
    if let Some(c) = &a.config_path {
        if !c.is_empty() {
            args.push("-c".to_string());
            args.push(c.clone());
        }
    }
    if a.allow_default_credentials.unwrap_or(false) {
        args.push("--allow-default-credentials".to_string());
    }
    if let Some(r) = &a.runtime {
        if !r.is_empty() {
            args.push("--runtime".to_string());
            args.push(r.clone());
        }
    }
    args.push("--no-confirm".to_string());
    if let Some(extra) = &a.extra_args {
        if !extra.is_empty() {
            args.push("--".to_string());
            for t in extra.split_whitespace() {
                args.push(t.to_string());
            }
        }
    }
    args
}

fn port_for_version(version: &str) -> u16 {
    match version {
        "16" => 16069,
        "17" => 17069,
        "18" => 18069,
        "19" => 19069,
        _ => 0,
    }
}

#[tauri::command]
pub async fn start_server(
    args: StartServerArgs,
    window: tauri::Window,
    manager: State<'_, ServerManager>,
) -> Result<StartResult, String> {
    if manager.is_running(&args.version) {
        return Err(format!("Server {} is already running", args.version));
    }

    odoodev::reject_flag_like("version", &args.version)?;
    for (field, val) in [
        ("database", &args.database),
        ("update_modules", &args.update_modules),
        ("install_modules", &args.install_modules),
        ("host", &args.host),
        ("load_language", &args.load_language),
        ("config_path", &args.config_path),
        ("runtime", &args.runtime),
    ] {
        if let Some(v) = val {
            odoodev::reject_flag_like(field, v)?;
        }
    }

    let port = port_for_version(&args.version);
    let cli_args = build_start_args(&args);
    let arg_refs: Vec<&str> = cli_args.iter().map(|s| s.as_str()).collect();

    let mut child = odoodev::run_odoodev_spawn(&arg_refs).await?;
    let pid = child
        .id()
        .ok_or_else(|| "Failed to get child PID".to_string())?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let version = args.version.clone();
    let win_out = window.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let entry = log_parser::parse_line(&line);
            let _ = win_out.emit(&format!("odoodev-log:{version}"), &entry);
        }
    });

    let version_err = args.version.clone();
    let win_err = window.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let entry = log_parser::parse_line(&line);
            let _ = win_err.emit(&format!("odoodev-log:{version_err}"), &entry);
        }
    });

    manager.insert(args.version.clone(), child, pid, port);

    // Poller for status + exit
    let version_poll = args.version.clone();
    let win_poll = window.clone();
    let mgr: ServerManager = manager.inner().clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if !mgr.is_running(&version_poll) {
                break;
            }
            let _ = win_poll.emit(
                &format!("server-status:{version_poll}"),
                ServerStatus {
                    running: true,
                    pid: mgr.get_pid(&version_poll),
                    uptime_seconds: mgr.get_uptime(&version_poll),
                    port: mgr.get_port(&version_poll),
                },
            );
        }
    });

    Ok(StartResult { pid, port })
}

#[tauri::command]
pub async fn stop_server(
    version: String,
    keep_docker: Option<bool>,
    force: Option<bool>,
    window: tauri::Window,
    manager: State<'_, ServerManager>,
) -> Result<OpResult, String> {
    let mut args = vec!["stop".to_string(), version.clone()];
    if keep_docker.unwrap_or(true) {
        args.push("--keep-docker".to_string());
    }
    if force.unwrap_or(false) {
        args.push("--force".to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // Run stop as subprocess (odoodev handles the kill)
    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&arg_refs);
    odoodev::augment_path(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute stop: {e}"))?;

    manager.remove(&version);
    let _ = window.emit(
        &format!("server-exited:{version}"),
        serde_json::json!({ "exit_code": output.status.code().unwrap_or(-1) }),
    );

    if output.status.success() {
        Ok(OpResult {
            success: true,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok(OpResult {
            success: false,
            error: Some(stderr),
        })
    }
}

#[tauri::command]
pub fn get_server_status_cmd(version: String, manager: State<'_, ServerManager>) -> ServerStatus {
    let running = manager.is_running(&version);
    ServerStatus {
        running,
        pid: manager.get_pid(&version),
        uptime_seconds: manager.get_uptime(&version),
        port: manager.get_port(&version),
    }
}
