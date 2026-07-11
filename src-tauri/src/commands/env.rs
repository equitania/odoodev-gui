use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::{EnvCheckResult, OpResult};
use crate::odoodev;

#[tauri::command]
pub async fn env_check(version: String) -> Result<EnvCheckResult, String> {
    let output = odoodev::run_odoodev_text(&["env", "check", &version]).await;
    match output {
        Ok(text) => {
            let complete = text.contains("[OK]") && !text.contains("[ERROR]");
            Ok(EnvCheckResult {
                exists: complete,
                complete,
                message: text.trim().to_string(),
            })
        }
        Err(e) => Ok(EnvCheckResult {
            exists: false,
            complete: false,
            message: e,
        }),
    }
}

#[tauri::command]
pub async fn env_dir(version: String) -> Result<String, String> {
    odoodev::run_odoodev_text(&["env", "dir", &version]).await
}

#[tauri::command]
pub async fn env_show(version: String) -> Result<String, String> {
    odoodev::run_odoodev_text(&["env", "show", &version]).await
}

#[tauri::command]
pub async fn env_setup(version: String, window: tauri::Window) -> Result<OpResult, String> {
    let args = [
        "env".to_string(),
        "setup".to_string(),
        "--non-interactive".to_string(),
        version.clone(),
    ];
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let event_name = format!("env-setup-progress:{version}");
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
        error: if status.success() { None } else { Some(last) },
    })
}
