use std::collections::HashMap;

use tauri::{Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::docker_check;
use crate::models::{DockerStatus, OpResult, VersionInfo};
use crate::odoodev;
use crate::server_manager::ServerManager;

#[tauri::command]
pub async fn docker_up(
    version: String,
    #[allow(unused_variables)] runtime: Option<String>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let mut cli = vec!["docker", "up", version.as_str()];
    let mut rt = runtime.clone();
    let _ = &mut rt;
    let refs: Vec<&str> = cli.drain(..).collect();

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
        error: if status.success() {
            None
        } else {
            Some(last)
        },
    })
}

#[tauri::command]
pub async fn docker_down(
    version: String,
    #[allow(unused_variables)] runtime: Option<String>,
) -> Result<OpResult, String> {
    let args = vec!["docker", "down", version.as_str()];
    match odoodev::run_odoodev_text(&args).await {
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