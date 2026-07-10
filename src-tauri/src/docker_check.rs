use tokio::process::Command;

use crate::models::DockerStatus;
use crate::odoodev;

/// Check PostgreSQL container status for a version.
/// Primary check: TCP probe on DB port (runtime-agnostic).
/// Display: container name + state from runtime CLI.
pub async fn check_docker_status(_version: &str, db_port: u16) -> DockerStatus {
    let runtime = detect_runtime().await;

    match runtime.as_str() {
        "docker" => {
            let running = crate::pypi::check_pg_port(db_port).await;
            let container_name = docker_container_for_port(db_port).await;
            DockerStatus { running, container_name, runtime }
        }
        "apple" => {
            let (running, container_name) = apple_container_status(db_port).await;
            DockerStatus { running, container_name, runtime }
        }
        _ => {
            let running = crate::pypi::check_pg_port(db_port).await;
            DockerStatus { running, container_name: String::new(), runtime }
        }
    }
}

/// Detect the available container runtime.
/// Priority: odoodev config > PATH detection (docker → apple → none).
pub async fn detect_runtime() -> String {
    if let Some(rt) = crate::config::get_container_runtime() {
        if !rt.is_empty() {
            return rt;
        }
    }
    if which::which("docker").is_ok() {
        return "docker".to_string();
    }
    if cfg!(target_os = "macos") && which::which("container").is_ok() {
        return "apple".to_string();
    }
    "none".to_string()
}

/// Query `docker ps --format` for a container publishing the given DB port.
async fn docker_container_for_port(db_port: u16) -> String {
    let Ok(docker_path) = which::which("docker") else {
        return String::new();
    };
    let mut cmd = Command::new(docker_path);
    cmd.args(["ps", "--format", "{{.Names}}\t{{.Ports}}"]);
    odoodev::augment_path(&mut cmd);
    let Ok(out) = cmd.output().await else {
        return String::new();
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let needle = format!(":{db_port}->");
    for line in stdout.lines() {
        if line.contains(&needle) {
            if let Some(name) = line.split('\t').next() {
                return name.trim().to_string();
            }
        }
    }
    String::new()
}

/// Query `container ls --format json` (Apple Container) for a container
/// publishing the given DB port. Returns (is_running, container_name).
/// Falls back to TCP probe if the API server is down or JSON parsing fails.
async fn apple_container_status(db_port: u16) -> (bool, String) {
    let Ok(container_path) = which::which("container") else {
        return (crate::pypi::check_pg_port(db_port).await, String::new());
    };

    let mut cmd = Command::new(container_path);
    cmd.args(["ls", "--format", "json"]);
    odoodev::augment_path(&mut cmd);
    let Ok(out) = cmd.output().await else {
        return (crate::pypi::check_pg_port(db_port).await, String::new());
    };

    if !out.status.success() {
        // API server might be down — fall back to TCP probe
        return (crate::pypi::check_pg_port(db_port).await, String::new());
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) else {
        return (crate::pypi::check_pg_port(db_port).await, String::new());
    };

    for item in &items {
        let id = item
            .pointer("/configuration/id")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let empty = Vec::new();
        let ports = item
            .pointer("/configuration/publishedPorts")
            .and_then(|v| v.as_array())
            .unwrap_or(&empty);

        let state = item
            .pointer("/status/state")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        for port in ports {
            let host_port = port.get("hostPort").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
            if host_port == db_port {
                let running = state == "running";
                return (running, id.to_string());
            }
        }
    }

    // No matching container found — fall back to TCP probe for running check
    (crate::pypi::check_pg_port(db_port).await, String::new())
}