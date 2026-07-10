use tokio::process::Command;

use crate::models::DockerStatus;
use crate::odoodev;

/// Check PostgreSQL container status for a version.
/// Primary check: TCP probe on DB port (runtime-agnostic).
/// Display: container name from `docker ps` or `container ls` depending on runtime.
pub async fn check_docker_status(_version: &str, db_port: u16) -> DockerStatus {
    let running = crate::pypi::check_pg_port(db_port).await;
    let runtime = detect_runtime().await;
    let mut container_name = String::new();

    match runtime.as_str() {
        "docker" => {
            container_name = docker_container_for_port(db_port).await;
        }
        "apple" => {
            container_name = apple_container_for_port(db_port).await;
        }
        _ => {}
    }

    DockerStatus {
        running,
        container_name,
        runtime,
    }
}

/// Detect the available container runtime.
/// Checks odoodev config first, then falls back to PATH detection.
pub async fn detect_runtime() -> String {
    let cfg = crate::config::read_config();
    if let Some(rt) = cfg.as_ref().and_then(|c| c.container_runtime.as_deref()) {
        if !rt.is_empty() {
            return rt.to_string();
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

/// Query `docker ps` for a container publishing the given DB port.
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

/// Query `container ls` (Apple Container) for a container name.
/// Apple Container `container ls` prints a table with columns:
/// ID  IMAGE  OS  ARCH  STATE  IP  CPUS  MEMORY  STARTED
/// We match by the expected container name pattern: picard-dev-db-XX-native.
async fn apple_container_for_port(db_port: u16) -> String {
    let Ok(container_path) = which::which("container") else {
        return String::new();
    };
    let mut cmd = Command::new(container_path);
    cmd.args(["ls"]);
    odoodev::augment_path(&mut cmd);
    let Ok(out) = cmd.output().await else {
        return String::new();
    };
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Apple Container `container ls` output is a table with the container ID
    // in the first column. We can't directly map port→container from this output,
    // but we know the naming convention from odoodev: picard-dev-db-XX-native.
    // Map DB port to version and construct the expected container name.
    let version = port_to_version(db_port);
    let expected = format!("picard-dev-db-{}-native", version);

    for line in stdout.lines() {
        if line.trim().is_empty() || line.starts_with("ID") {
            continue;
        }
        // The ID column may contain the container name
        if line.contains(&expected) {
            if let Some(id) = line.split_whitespace().next() {
                return id.trim().to_string();
            }
        }
    }
    String::new()
}

/// Map a DB port number to an Odoo version string.
fn port_to_version(db_port: u16) -> &'static str {
    match db_port {
        16432 => "16",
        17432 => "17",
        18432 => "18",
        19432 => "19",
        _ => "",
    }
}