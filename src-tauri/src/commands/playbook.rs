use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::{OpResult, PlaybookDetails, PlaybookEvent, PlaybookInfo, StepCapability};
use crate::odoodev;

/// Last known-good dev-mode step list, used when the installed odoodev
/// predates `run --steps` (< 0.51) and can't report its own capabilities.
pub const FALLBACK_DEV_STEPS: &[&str] = &[
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
pub async fn playbook_valid_steps() -> Result<Vec<StepCapability>, String> {
    match odoodev::run_odoodev_json(&["run", "--steps", "--output", "json"]).await {
        Ok(val) => serde_json::from_value(val)
            .map_err(|e| format!("Failed to parse step capabilities: {e}")),
        // odoodev < 0.51 rejects --steps (usage error on stderr, empty stdout).
        Err(_) => Ok(FALLBACK_DEV_STEPS
            .iter()
            .map(|s| StepCapability {
                command: s.to_string(),
                mode: "dev".to_string(),
            })
            .collect()),
    }
}

fn yaml_str(map: &serde_yaml::Mapping, key: &str) -> String {
    map.get(serde_yaml::Value::from(key))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn yaml_keys(map: &serde_yaml::Mapping, key: &str) -> Vec<String> {
    map.get(serde_yaml::Value::from(key))
        .and_then(|v| v.as_mapping())
        .map(|m| {
            m.keys()
                .filter_map(|k| k.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Lenient read-only summary of a playbook file for the details card.
/// Tolerates unknown fields and future step commands by design.
#[tauri::command]
pub fn playbook_inspect(path: String) -> Result<PlaybookDetails, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let raw: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| format!("YAML parse error: {e}"))?;
    let map = raw
        .as_mapping()
        .ok_or_else(|| "playbook root must be a mapping".to_string())?;

    let mut step_names = Vec::new();
    let mut step_commands = Vec::new();
    if let Some(steps) = map
        .get(serde_yaml::Value::from("steps"))
        .and_then(|v| v.as_sequence())
    {
        for step in steps {
            let Some(step_map) = step.as_mapping() else {
                continue;
            };
            let command = yaml_str(step_map, "command");
            let name = yaml_str(step_map, "name");
            step_names.push(if name.is_empty() {
                command.clone()
            } else {
                name
            });
            step_commands.push(command);
        }
    }

    let env_file = {
        let value = yaml_str(map, "env_file");
        (!value.is_empty()).then_some(value)
    };

    Ok(PlaybookDetails {
        description: yaml_str(map, "description"),
        version: yaml_str(map, "version"),
        on_error: yaml_str(map, "on_error"),
        step_names,
        step_commands,
        targets: yaml_keys(map, "targets"),
        env_file,
        has_rpc: map
            .get(serde_yaml::Value::from("rpc"))
            .and_then(|v| v.as_mapping())
            .is_some_and(|m| !m.is_empty()),
        vars: yaml_keys(map, "vars"),
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_capability_parses_cli_json() {
        let json = r#"[{"command": "docker.up", "mode": "dev"}, {"command": "server.backup", "mode": "server"}]"#;
        let steps: Vec<StepCapability> = serde_json::from_str(json).unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[1].command, "server.backup");
        assert_eq!(steps[1].mode, "server");
    }

    #[test]
    fn inspect_server_mode_playbook() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-inspect");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("server.yaml");
        std::fs::write(
            &path,
            r#"
version: "18"
on_error: stop
description: "Mirror live to test"
env_file: /root/.config/odoodev/mirror.env
targets:
  live:
    db_container: live-db
    db_name: production
  test:
    db_container: test-db
    db_name: production
rpc:
  host: "{{ env.ODOO_URL }}"
vars:
  customer: acme
steps:
  - name: "Create backup"
    command: server.backup
  - command: container.stop
"#,
        )
        .unwrap();

        let details = playbook_inspect(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(details.version, "18");
        assert_eq!(details.description, "Mirror live to test");
        assert_eq!(details.targets, vec!["live", "test"]);
        assert_eq!(
            details.env_file.as_deref(),
            Some("/root/.config/odoodev/mirror.env")
        );
        assert!(details.has_rpc);
        assert_eq!(details.vars, vec!["customer"]);
        assert_eq!(details.step_names, vec!["Create backup", "container.stop"]);
        assert_eq!(
            details.step_commands,
            vec!["server.backup", "container.stop"]
        );

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn inspect_minimal_playbook_defaults() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-inspect");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("minimal.yaml");
        std::fs::write(&path, "version: \"18\"\nsteps:\n  - command: pull\n").unwrap();

        let details = playbook_inspect(path.to_string_lossy().to_string()).unwrap();
        assert!(details.targets.is_empty());
        assert!(details.env_file.is_none());
        assert!(!details.has_rpc);
        assert!(details.vars.is_empty());

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn inspect_rejects_invalid_yaml() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-inspect");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("broken.yaml");
        std::fs::write(&path, "steps:\n  - command: [unclosed\n").unwrap();

        assert!(playbook_inspect(path.to_string_lossy().to_string()).is_err());
        std::fs::remove_file(&path).ok();
    }
}
