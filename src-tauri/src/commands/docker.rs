use std::collections::HashMap;

use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::docker_check;
use crate::models::{ContainerInfo, DockerStatus, OpResult, RuntimeInfo, VersionInfo};
use crate::odoodev;
use crate::server_manager::ServerManager;

/// Resolve the runtime to use: explicit override > odoodev config > auto-detect.
async fn resolve_runtime(explicit: Option<String>) -> String {
    if let Some(rt) = explicit {
        if !rt.is_empty() {
            return rt;
        }
    }
    if let Some(rt) = crate::config::get_container_runtime() {
        if !rt.is_empty() {
            return rt;
        }
    }
    docker_check::detect_runtime().await
}

#[tauri::command]
pub async fn docker_up(
    version: String,
    runtime: Option<String>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let rt = resolve_runtime(runtime).await;
    let mut cli = vec!["docker".to_string(), "up".to_string()];
    if !rt.is_empty() {
        cli.push("--runtime".to_string());
        cli.push(rt);
    }
    cli.push(version);
    let refs: Vec<&str> = cli.iter().map(|s| s.as_str()).collect();

    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let win_err = window.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit("docker-up-progress", &line);
        }
    });
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut last = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = window.emit("docker-up-progress", &line);
        last = line;
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;
    Ok(OpResult {
        success: status.success(),
        error: if status.success() { None } else { Some(last) },
    })
}

#[tauri::command]
pub async fn docker_down(version: String, runtime: Option<String>) -> Result<OpResult, String> {
    let rt = resolve_runtime(runtime).await;
    let mut args = vec!["docker".to_string(), "down".to_string()];
    if !rt.is_empty() {
        args.push("--runtime".to_string());
        args.push(rt);
    }
    args.push(version);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match odoodev::run_odoodev_text(&refs).await {
        Ok(_) => Ok(OpResult {
            success: true,
            error: None,
        }),
        Err(e) => Ok(OpResult {
            success: false,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn docker_status(
    version: String,
    versions: HashMap<String, VersionInfo>,
    #[allow(unused_variables)] manager: State<'_, ServerManager>,
) -> Result<DockerStatus, String> {
    let info = versions
        .get(&version)
        .ok_or_else(|| format!("Unknown version: {version}"))?;
    Ok(docker_check::check_docker_status(&version, info.ports.db).await)
}

#[tauri::command]
pub async fn list_containers() -> Result<Vec<ContainerInfo>, String> {
    Ok(docker_check::list_containers().await)
}

#[tauri::command]
pub async fn get_runtime_info() -> Result<RuntimeInfo, String> {
    let configured = crate::config::get_container_runtime();
    let runtime = docker_check::detect_runtime().await;
    let mut available = Vec::new();
    if which::which("docker").is_ok() {
        available.push("docker".to_string());
    }
    if cfg!(target_os = "macos") && which::which("container").is_ok() {
        available.push("apple".to_string());
    }
    Ok(RuntimeInfo {
        runtime,
        configured,
        available,
    })
}

#[tauri::command]
pub async fn docker_logs(
    version: String,
    runtime: Option<String>,
    tail: Option<u32>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let rt = resolve_runtime(runtime).await;
    let mut args = vec!["docker".to_string(), "logs".to_string()];
    if !rt.is_empty() {
        args.push("--runtime".to_string());
        args.push(rt);
    }
    if let Some(n) = tail {
        args.push("-n".to_string());
        args.push(n.to_string());
    }
    args.push(version.clone());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let win_err = window.clone();
    let event_name = format!("docker-logs:{version}");
    let err_event = event_name.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit(&err_event, &line);
        }
    });
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut last = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = window.emit(&event_name, &line);
        last = line;
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;
    Ok(OpResult {
        success: status.success(),
        error: if status.success() { None } else { Some(last) },
    })
}

#[tauri::command]
pub async fn docker_bench(
    version: String,
    runtime: Option<String>,
    duration: Option<u32>,
    scale: Option<u32>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let mut args = vec!["bench".to_string(), version.clone()];
    if let Some(rt) = runtime {
        if !rt.is_empty() {
            args.push("--runtime".to_string());
            args.push(rt);
        }
    }
    if let Some(d) = duration {
        args.push("--duration".to_string());
        args.push(d.to_string());
    }
    if let Some(s) = scale {
        args.push("--scale".to_string());
        args.push(s.to_string());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let event_name = format!("docker-bench:{version}");
    let exit_code = odoodev::run_odoodev_streaming(&refs, &window, &event_name).await?;
    Ok(OpResult {
        success: exit_code == 0,
        error: if exit_code == 0 {
            None
        } else {
            Some(format!("bench exited with code {exit_code}"))
        },
    })
}
