use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::OpResult;
use crate::odoodev;

fn spawn_streaming(args: Vec<String>) -> Result<tokio::process::Child, String> {
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    cmd.spawn().map_err(|e| format!("spawn: {e}"))
}

async fn run_streaming(
    args: Vec<String>,
    window: &tauri::Window,
    event_name: &str,
) -> Result<OpResult, String> {
    let mut child = spawn_streaming(args)?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let win_err = window.clone();
    let err_event = event_name.to_string();
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
        let _ = window.emit(event_name, &line);
        last = line;
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;
    Ok(OpResult {
        success: status.success(),
        error: if status.success() { None } else { Some(last) },
    })
}

#[tauri::command]
pub async fn init_version(
    version: String,
    skip_repos: bool,
    skip_docker: bool,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let mut args = vec!["init".to_string()];
    args.push("--non-interactive".to_string());
    if skip_repos {
        args.push("--skip-repos".to_string());
    }
    if skip_docker {
        args.push("--skip-docker".to_string());
    }
    args.push(version.clone());
    let event = format!("init-progress:{version}");
    run_streaming(args, &window, &event).await
}

#[tauri::command]
pub async fn setup_config(reset: bool, window: tauri::Window) -> Result<OpResult, String> {
    let mut args = vec!["setup".to_string(), "--non-interactive".to_string()];
    if reset {
        args.push("--reset".to_string());
    }
    let event = "setup-progress".to_string();
    run_streaming(args, &window, &event).await
}
