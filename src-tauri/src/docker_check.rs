use tokio::process::Command;

use crate::models::DockerStatus;
use crate::odoodev;

/// Check PostgreSQL container status for a version.
/// Primary check: TCP probe on DB port (runtime-agnostic).
/// Display: container name from `docker ps` if docker is present.
pub async fn check_docker_status(version: &str, db_port: u16) -> DockerStatus {
    let running = crate::pypi::check_pg_port(db_port).await;
    let mut container_name = String::new();
    let runtime = detect_runtime().await;

    if runtime == "docker" {
        if let Ok(docker_path) = which::which("docker") {
            let mut cmd = Command::new(docker_path);
            cmd.args(["ps", "--format", "{{.Names}}\t{{.Ports}}"]);
            odoodev::augment_path(&mut cmd);
            if let Ok(out) = cmd.output().await {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let needle = format!(":{db_port}->");
                for line in stdout.lines() {
                    if line.contains(&needle) {
                        if let Some(name) = line.split('\t').next() {
                            container_name = name.to_string();
                            break;
                        }
                    }
                }
            }
        }
    }

    DockerStatus {
        running,
        container_name,
        runtime,
    }
}

/// Detect the available container runtime.
pub async fn detect_runtime() -> String {
    if which::which("docker").is_ok() {
        return "docker".to_string();
    }
    if cfg!(target_os = "macos") && which::which("container").is_ok() {
        return "apple".to_string();
    }
    "none".to_string()
}