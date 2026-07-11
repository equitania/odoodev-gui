use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::{OpResult, PlaybookEvent, PlaybookInfo};
use crate::odoodev;

pub const VALID_STEPS: &[&str] = &[
    "db.backup",
    "db.drop",
    "db.list",
    "db.purge",
    "db.restore",
    "docker.down",
    "docker.status",
    "docker.up",
    "env.check",
    "pull",
    "repos",
    "start",
    "stop",
    "venv.check",
    "venv.setup",
];

#[tauri::command]
pub async fn playbook_list() -> Result<Vec<PlaybookInfo>, String> {
    let val = odoodev::run_odoodev_json(&["run", "--list", "--output", "json"]).await?;
    let list: Vec<PlaybookInfo> =
        serde_json::from_value(val).map_err(|e| format!("Failed to parse playbook list: {e}"))?;
    Ok(list)
}

#[tauri::command]
pub fn playbook_valid_steps() -> Vec<String> {
    VALID_STEPS.iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
pub async fn playbook_run(
    playbook: Option<String>,
    steps: Vec<String>,
    version: Option<String>,
    vars: Vec<String>,
    dry_run: bool,
    window: tauri::Window,
) -> Result<OpResult, String> {
    let mut args = vec!["run".to_string()];

    if let Some(ref pb) = playbook {
        args.push(pb.clone());
    } else {
        for s in &steps {
            args.push("--step".to_string());
            args.push(s.clone());
        }
    }

    if let Some(ref v) = version {
        args.push("-V".to_string());
        args.push(v.clone());
    }

    for v in &vars {
        args.push("-D".to_string());
        args.push(v.clone());
    }

    if dry_run {
        args.push("--dry-run".to_string());
    }

    args.push("--output".to_string());
    args.push("json".to_string());

    let event_name = "playbook-event".to_string();

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
    let mut last_error: Option<String> = None;
    let mut final_status = "ok".to_string();

    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(event) = serde_json::from_str::<PlaybookEvent>(&line) {
            if event.event == "error" {
                last_error = event.message.clone();
                final_status = "error".to_string();
            }
            let _ = window.emit(&event_name, &event);
        }
    }

    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;

    Ok(OpResult {
        success: status.success() && final_status == "ok",
        error: last_error,
    })
}
