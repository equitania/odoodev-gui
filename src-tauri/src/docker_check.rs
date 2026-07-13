use tokio::process::Command;

use crate::models::{ContainerInfo, DockerStatus};
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
            DockerStatus {
                running,
                container_name,
                runtime,
            }
        }
        "apple" => {
            let (running, container_name) = apple_container_status(db_port).await;
            DockerStatus {
                running,
                container_name,
                runtime,
            }
        }
        _ => {
            let running = crate::pypi::check_pg_port(db_port).await;
            DockerStatus {
                running,
                container_name: String::new(),
                runtime,
            }
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
    if odoodev::find_binary_opt("docker").is_some() {
        return "docker".to_string();
    }
    if cfg!(target_os = "macos") && odoodev::find_binary_opt("container").is_some() {
        return "apple".to_string();
    }
    "none".to_string()
}

/// Query `docker ps --format` for a container publishing the given DB port.
async fn docker_container_for_port(db_port: u16) -> String {
    let Some(docker_path) = odoodev::find_binary_opt("docker") else {
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
    let Some(container_path) = odoodev::find_binary_opt("container") else {
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

/// List all Apple Containers via `container ls --format json`.
pub async fn list_apple_containers() -> Vec<ContainerInfo> {
    let Some(container_path) = odoodev::find_binary_opt("container") else {
        return Vec::new();
    };
    let mut cmd = Command::new(container_path);
    cmd.args(["ls", "--format", "json"]);
    odoodev::augment_path(&mut cmd);
    let Ok(out) = cmd.output().await else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(&stdout) else {
        return Vec::new();
    };
    items.iter().map(parse_apple_container).collect()
}

fn parse_apple_container(item: &serde_json::Value) -> ContainerInfo {
    let id = item
        .pointer("/configuration/id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let image = item
        .pointer("/configuration/image/reference")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let os = item
        .pointer("/configuration/platform/os")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let arch = item
        .pointer("/configuration/platform/architecture")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let state = item
        .pointer("/status/state")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let ip = item
        .pointer("/status/networks/0/ipv4Address")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let cpus = item
        .pointer("/configuration/resources/cpus")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let memory_mb = item
        .pointer("/configuration/resources/memoryInBytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        / 1_048_576;
    let started = item
        .pointer("/status/startedDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let host_port = item
        .pointer("/configuration/publishedPorts/0/hostPort")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u16;
    ContainerInfo {
        id,
        image,
        os,
        arch,
        state,
        ip,
        cpus,
        memory_mb,
        started,
        host_port,
    }
}

/// List all Docker containers via `docker ps --format json`.
pub async fn list_docker_containers() -> Vec<ContainerInfo> {
    let Some(docker_path) = odoodev::find_binary_opt("docker") else {
        return Vec::new();
    };
    let mut cmd = Command::new(docker_path);
    cmd.args(["ps", "--format", "json"]);
    odoodev::augment_path(&mut cmd);
    let Ok(out) = cmd.output().await else {
        return Vec::new();
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .map(parse_docker_container)
        .collect()
}

fn parse_docker_container(item: serde_json::Value) -> ContainerInfo {
    let id = item
        .get("Names")
        .and_then(|v| v.as_str())
        .or_else(|| item.get("ID").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let image = item
        .get("Image")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let state = item
        .get("State")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let cpus = item.get("CPUs").and_then(|v| v.as_u64()).unwrap_or(0);
    let memory_mb = item
        .get("MemUsage")
        .and_then(|v| v.as_str())
        .and_then(|s| {
            let parts: Vec<&str> = s.split('/').collect();
            if parts.is_empty() {
                return None;
            }
            let n = parts[0]
                .trim()
                .trim_end_matches("MiB")
                .trim_end_matches("GiB")
                .trim()
                .parse::<u64>()
                .unwrap_or(0);
            if parts[0].contains("GiB") {
                Some(n * 1024)
            } else {
                Some(n)
            }
        })
        .unwrap_or(0);
    let ports_str = item.get("Ports").and_then(|v| v.as_str()).unwrap_or("");
    let host_port = extract_docker_host_port(ports_str);
    let started = item
        .get("RunningFor")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    ContainerInfo {
        id,
        image,
        os: "linux".to_string(),
        arch: std::env::consts::ARCH.to_string(),
        state,
        ip: String::new(),
        cpus,
        memory_mb,
        started,
        host_port,
    }
}

fn extract_docker_host_port(ports: &str) -> u16 {
    for part in ports.split(',') {
        let part = part.trim();
        if let Some(start) = part.find(':') {
            let rest = &part[start + 1..];
            if let Some(end) = rest.find('-') {
                if let Ok(p) = rest[..end].parse::<u16>() {
                    return p;
                }
            } else if let Ok(p) = rest.trim().parse::<u16>() {
                return p;
            }
        }
    }
    0
}

/// List containers for the active runtime.
pub async fn list_containers() -> Vec<ContainerInfo> {
    let runtime = detect_runtime().await;
    match runtime.as_str() {
        "apple" => list_apple_containers().await,
        "docker" => list_docker_containers().await,
        _ => Vec::new(),
    }
}
