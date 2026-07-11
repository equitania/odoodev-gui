use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::OpResult;
use crate::odoodev;

#[tauri::command]
pub async fn venv_setup(
    version: String,
    force: bool,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let mut args = vec!["venv".to_string(), "setup".to_string()];
    if force {
        args.push("--force".to_string());
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
    let event_name = format!("venv-setup-progress:{version}");
    let win_err = window.clone();
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
        error: if status.success() {
            None
        } else {
            Some(last)
        },
    })
}

#[tauri::command]
pub async fn venv_remove(version: String) -> Result<OpResult, String> {
    match odoodev::run_odoodev_text(&["venv", "remove", &version, "-y"]).await {
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