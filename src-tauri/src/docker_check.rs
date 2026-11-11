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
    resolve_runtime(
        crate::config::get_container_runtime(),
        odoodev::find_binary_opt("docker").is_some(),
        cfg!(target_os = "macos") && odoodev::find_binary_opt("container").is_some(),
    )
}

/// Pure decision behind `detect_runtime`: a non-empty configured value wins
/// (even an unknown one — callers treat unknown runtimes as "none"-like),
/// then docker on PATH, then Apple Container, else "none".
fn resolve_runtime(configured: Option<String>, has_docker: bool, has_apple: bool) -> String {
    if let Some(rt) = configured {
        if !rt.is_empty() {
            return rt;
        }
    }
    if has_docker {
        "docker".to_string()
    } else if has_apple {
        "apple".to_string()
    } else {
        "none".to_string()
    }
}

/// Whether the runtime's backend service is reachable.
/// docker: `docker info` succeeds only when the daemon answers.
/// apple: `container system status` reports the launchd apiserver state.
pub async fn check_daemon_running(runtime: &str) -> Option<bool> {
    match runtime {
        "docker" => {
            let docker_path = odoodev::find_binary_opt("docker")?;
            let mut cmd = Command::new(docker_path);
            cmd.args(["info", "--format", "{{.ServerVersion}}"]);
            odoodev::augment_path(&mut cmd);
            match cmd.output().await {
                Ok(out) => Some(out.status.success()),
                Err(_) => Some(false),
            }
        }
        "apple" => {
            let container_path = odoodev::find_binary_opt("container")?;
            let mut cmd = Command::new(container_path);
            cmd.args(["system", "status"]);
            odoodev::augment_path(&mut cmd);
            match cmd.output().await {
                Ok(out) => {
                    if !out.status.success() {
                        return Some(false);
                    }
                    // FIELD/VALUE table; the "status" row says running/stopped.
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    let running = stdout.lines().any(|l| {
                        let mut cols = l.split_whitespace();
                        cols.next() == Some("status") && cols.next() == Some("running")
                    });
                    Some(running)
                }
                Err(_) => Some(false),
            }
        }
        _ => None,
    }
}

/// Start the runtime's backend service. Returns Ok(message) on success.
/// apple: `container system start` (idempotent launchd agent).
/// docker: Linux `systemctl start docker`; macOS `open -a Docker`
/// (Docker Desktop). Windows has no reliable CLI path — the user must
/// start Docker Desktop manually.
pub async fn start_daemon(runtime: &str) -> Result<String, String> {
    match runtime {
        "apple" => {
            let container_path = odoodev::find_binary_opt("container")
                .ok_or_else(|| "'container' binary not found".to_string())?;
            let mut cmd = Command::new(container_path);
            cmd.args(["system", "start"]);
            odoodev::augment_path(&mut cmd);
            let out = cmd
                .output()
                .await
                .map_err(|e| format!("container system start: {e}"))?;
            if out.status.success() {
                Ok("Apple Container apiserver started".to_string())
            } else {
                Err(format!(
                    "container system start failed: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ))
            }
        }
        "docker" if cfg!(target_os = "linux") => {
            let out = Command::new("systemctl")
                .args(["start", "docker"])
                .output()
                .await
                .map_err(|e| format!("systemctl start docker: {e}"))?;
            if out.status.success() {
                Ok("Docker service started".to_string())
            } else {
                Err(format!(
                    "systemctl start docker failed: {} — try 'sudo systemctl start docker' in a terminal",
                    String::from_utf8_lossy(&out.stderr).trim()
                ))
            }
        }
        "docker" if cfg!(target_os = "macos") => {
            let out = Command::new("open")
                .args(["-a", "Docker"])
                .output()
                .await
                .map_err(|e| format!("open -a Docker: {e}"))?;
            if out.status.success() {
                Ok("Docker Desktop is starting (this can take a while)".to_string())
            } else {
                Err(format!(
                    "Could not launch Docker Desktop: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ))
            }
        }
        "docker" => Err("Please start Docker Desktop manually on this platform".to_string()),
        other => Err(format!("Unknown runtime: {other}")),
    }
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
    docker_container_from_ps(&stdout, db_port)
}

/// Find the container publishing `db_port` in `docker ps --format
/// "{{.Names}}\t{{.Ports}}"` output. Empty string when none matches.
fn docker_container_from_ps(stdout: &str, db_port: u16) -> String {
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
    match apple_container_from_ls(&stdout, db_port) {
        Some(found) => found,
        // Unparseable output or no matching container — fall back to TCP probe
        None => (crate::pypi::check_pg_port(db_port).await, String::new()),
    }
}

/// Find the Apple Container publishing `db_port` (matched on
/// `publishedPorts[].hostPort`) in `container ls --format json` output.
/// Returns (is_running, container_id); `None` for malformed JSON or no match.
fn apple_container_from_ls(stdout: &str, db_port: u16) -> Option<(bool, String)> {
    let items = serde_json::from_str::<Vec<serde_json::Value>>(stdout).ok()?;

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
                return Some((running, id.to_string()));
            }
        }
    }

    None
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
    parse_apple_container_list(&stdout)
}

/// Parse `container ls --format json` output; malformed JSON yields an empty list.
fn parse_apple_container_list(stdout: &str) -> Vec<ContainerInfo> {
    let Ok(items) = serde_json::from_str::<Vec<serde_json::Value>>(stdout) else {
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
    parse_docker_ps_json(&stdout)
}

/// Parse `docker ps --format json` (one JSON object per line); blank and
/// malformed lines are skipped.
fn parse_docker_ps_json(stdout: &str) -> Vec<ContainerInfo> {
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

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed, scrubbed `container ls --format json` (Apple Container 1.x):
    // a running Postgres container publishing 19432, plus a stopped one without
    // any published ports.
    const APPLE_LS: &str = r#"[
      {
        "configuration": {
          "id": "user-dev-db-19-native",
          "image": {"reference": "docker.io/library/postgres:17.4-alpine"},
          "platform": {"architecture": "arm64", "os": "linux"},
          "publishedPorts": [
            {"containerPort": 5432, "count": 1, "hostAddress": "0.0.0.0", "hostPort": 19432, "proto": "tcp"}
          ],
          "resources": {"cpuOverhead": 1, "cpus": 4, "memoryInBytes": 1073741824}
        },
        "id": "user-dev-db-19-native",
        "status": {
          "networks": [{"ipv4Address": "192.0.2.2/24", "network": "default"}],
          "startedDate": "2026-01-01T08:00:00Z",
          "state": "running"
        }
      },
      {
        "configuration": {
          "id": "demo-helper",
          "image": {"reference": "docker.io/library/alpine:3"},
          "platform": {"architecture": "arm64", "os": "linux"},
          "publishedPorts": [],
          "resources": {"cpus": 1, "memoryInBytes": 536870912}
        },
        "status": {"networks": [], "state": "stopped"}
      }
    ]"#;

    #[test]
    fn resolve_runtime_prefers_config() {
        assert_eq!(resolve_runtime(Some("apple".into()), true, false), "apple");
        assert_eq!(
            resolve_runtime(Some("docker".into()), false, true),
            "docker"
        );
    }

    #[test]
    fn resolve_runtime_passes_unknown_value_through() {
        assert_eq!(resolve_runtime(Some("podman".into()), true, true), "podman");
    }

    #[test]
    fn resolve_runtime_ignores_empty_config_and_falls_back_to_path() {
        assert_eq!(resolve_runtime(Some(String::new()), true, true), "docker");
        assert_eq!(resolve_runtime(None, false, true), "apple");
        assert_eq!(resolve_runtime(None, false, false), "none");
    }

    #[test]
    fn apple_match_by_host_port_running() {
        let found = apple_container_from_ls(APPLE_LS, 19432).unwrap();
        assert_eq!(found, (true, "user-dev-db-19-native".to_string()));
    }

    #[test]
    fn apple_match_reports_stopped_state() {
        let json = APPLE_LS.replace("\"running\"", "\"stopped\"");
        assert_eq!(
            apple_container_from_ls(&json, 19432),
            Some((false, "user-dev-db-19-native".to_string()))
        );
    }

    #[test]
    fn apple_no_match_returns_none() {
        assert_eq!(apple_container_from_ls(APPLE_LS, 18432), None);
        // container port must not match, only the host port
        assert_eq!(apple_container_from_ls(APPLE_LS, 5432), None);
    }

    #[test]
    fn apple_empty_list_and_malformed_input_return_none() {
        assert_eq!(apple_container_from_ls("[]", 19432), None);
        assert_eq!(apple_container_from_ls("", 19432), None);
        assert_eq!(apple_container_from_ls("not json", 19432), None);
        assert_eq!(apple_container_from_ls(r#"{"a":1}"#, 19432), None);
    }

    #[test]
    fn apple_tolerates_missing_fields() {
        let json = r#"[{"configuration": {"publishedPorts": [{"hostPort": 19432}]}}]"#;
        assert_eq!(
            apple_container_from_ls(json, 19432),
            Some((false, String::new()))
        );
    }

    #[test]
    fn apple_list_parses_details() {
        let list = parse_apple_container_list(APPLE_LS);
        assert_eq!(list.len(), 2);
        let c = &list[0];
        assert_eq!(c.id, "user-dev-db-19-native");
        assert_eq!(c.image, "docker.io/library/postgres:17.4-alpine");
        assert_eq!(c.os, "linux");
        assert_eq!(c.arch, "arm64");
        assert_eq!(c.state, "running");
        assert_eq!(c.ip, "192.0.2.2");
        assert_eq!(c.cpus, 4);
        assert_eq!(c.memory_mb, 1024);
        assert_eq!(c.started, "2026-01-01T08:00:00Z");
        assert_eq!(c.host_port, 19432);
    }

    #[test]
    fn apple_list_container_without_ports_or_network_has_defaults() {
        let list = parse_apple_container_list(APPLE_LS);
        let c = &list[1];
        assert_eq!(c.id, "demo-helper");
        assert_eq!(c.state, "stopped");
        assert_eq!(c.host_port, 0);
        assert_eq!(c.ip, "");
        assert_eq!(c.started, "");
        assert_eq!(c.memory_mb, 512);
    }

    #[test]
    fn apple_list_empty_and_malformed_yield_empty() {
        assert!(parse_apple_container_list("[]").is_empty());
        assert!(parse_apple_container_list("").is_empty());
        assert!(parse_apple_container_list("{broken").is_empty());
    }

    #[test]
    fn apple_list_unknown_fields_are_ignored() {
        let list = parse_apple_container_list(r#"[{"somethingNew": 1}]"#);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "");
        assert_eq!(list[0].host_port, 0);
    }

    #[test]
    fn docker_ps_text_matches_port_mapping() {
        let out = "user-dev-db-18-native\t0.0.0.0:18432->5432/tcp, :::18432->5432/tcp\n\
                   demo-web\t0.0.0.0:8080->80/tcp\n";
        assert_eq!(
            docker_container_from_ps(out, 18432),
            "user-dev-db-18-native"
        );
        assert_eq!(docker_container_from_ps(out, 8080), "demo-web");
    }

    #[test]
    fn docker_ps_text_no_match_or_empty() {
        let out = "demo-web\t0.0.0.0:8080->80/tcp\n";
        assert_eq!(docker_container_from_ps(out, 18432), "");
        assert_eq!(docker_container_from_ps("", 18432), "");
        // unpublished port (no "->") must not match
        assert_eq!(docker_container_from_ps("x\t5432/tcp\n", 5432), "");
    }

    #[test]
    fn docker_ps_json_parses_lines_and_skips_garbage() {
        let out = concat!(
            r#"{"ID":"abc123","Names":"user-dev-db-18-native","Image":"postgres:16.11-alpine","State":"running","Ports":"0.0.0.0:18432->5432/tcp, :::18432->5432/tcp","RunningFor":"2 hours ago"}"#,
            "\n\n",
            "this is not json\n",
            r#"{"ID":"def456","Image":"alpine:3","State":"exited","Ports":""}"#,
            "\n",
        );
        let list = parse_docker_ps_json(out);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "user-dev-db-18-native");
        assert_eq!(list[0].image, "postgres:16.11-alpine");
        assert_eq!(list[0].state, "running");
        assert_eq!(list[0].host_port, 18432);
        assert_eq!(list[0].started, "2 hours ago");
        assert_eq!(list[0].os, "linux");
        // no Names: falls back to ID; no ports: host_port 0
        assert_eq!(list[1].id, "def456");
        assert_eq!(list[1].host_port, 0);
    }

    #[test]
    fn docker_ps_json_empty_output() {
        assert!(parse_docker_ps_json("").is_empty());
        assert!(parse_docker_ps_json("\n\n").is_empty());
    }

    #[test]
    fn docker_memory_usage_units() {
        let mib = parse_docker_container(serde_json::json!({"MemUsage": "512MiB / 1GiB"}));
        assert_eq!(mib.memory_mb, 512);
        let gib = parse_docker_container(serde_json::json!({"MemUsage": "2GiB / 4GiB"}));
        assert_eq!(gib.memory_mb, 2048);
        let missing = parse_docker_container(serde_json::json!({}));
        assert_eq!(missing.memory_mb, 0);
    }

    #[test]
    fn docker_host_port_extraction() {
        assert_eq!(extract_docker_host_port("0.0.0.0:18432->5432/tcp"), 18432);
        assert_eq!(extract_docker_host_port("5432/tcp"), 0);
        assert_eq!(extract_docker_host_port(""), 0);
        assert_eq!(
            extract_docker_host_port("5432/tcp, 0.0.0.0:19432->5432/tcp"),
            19432
        );
    }
}
