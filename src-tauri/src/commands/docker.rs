use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::{Emitter, State};
use tokio::io::BufReader;
use tokio::process::Command;

use crate::docker_check;
use crate::models::{ContainerInfo, DockerStatus, OpResult, RuntimeInfo, VersionInfo};
use crate::odoodev;
use crate::server_manager::ServerManager;

/// Guard the two frontend strings every docker command forwards to the CLI.
fn validate_version_and_runtime(version: &str, runtime: Option<&str>) -> Result<(), String> {
    odoodev::validate_version("version", version)?;
    if let Some(rt) = runtime {
        odoodev::reject_flag_like("runtime", rt)?;
    }
    Ok(())
}

/// Resolve the runtime to use: explicit override > odoodev config > auto-detect.
async fn resolve_runtime(explicit: Option<String>) -> String {
    if let Some(rt) = explicit {
        if !rt.is_empty() {
            return rt;
        }
    }
    if let Some(rt) = crate::config::get_container_runtime() {
        if !rt.is_empty() {
            return rt;
        }
    }
    docker_check::detect_runtime().await
}

/// Build the argument list for `odoodev docker up`.
///
/// `--allow-default-credentials` (odoodev >= 0.77.0, where `docker up` runs the
/// same placeholder-password check as `odoodev start`) is pushed only when
/// asked for; an older CLI would reject it, so the frontend gates it by version.
/// Options come before the version argument.
fn build_docker_up_args(
    version: &str,
    runtime: &str,
    allow_default_credentials: bool,
) -> Vec<String> {
    let mut cli = vec!["docker".to_string(), "up".to_string()];
    if !runtime.is_empty() {
        cli.push("--runtime".to_string());
        cli.push(runtime.to_string());
    }
    if allow_default_credentials {
        cli.push("--allow-default-credentials".to_string());
    }
    cli.push(version.to_string());
    cli
}

/// Pick the line that explains a failed `docker up`.
///
/// The CLI prints its failures with `print_error` to stderr (`[ERROR] …`),
/// while the progress and the placeholder-password explanation go to stdout.
/// The last line of stdout is therefore never the reason: for the refusal it
/// would be the second half of the remedy hint, for a failed container start
/// just `Starting PostgreSQL …`. Prefer the first `[ERROR]` line (tag
/// stripped), else the last non-empty line.
fn pick_docker_up_error(output: &[String]) -> String {
    if let Some(line) = output.iter().find(|l| l.contains("[ERROR]")) {
        let msg = line.trim().replacen("[ERROR]", "", 1);
        let msg = msg.trim();
        if !msg.is_empty() {
            return msg.to_string();
        }
    }
    output
        .iter()
        .rev()
        .find(|l| !l.trim().is_empty())
        .map(|l| l.trim().to_string())
        .unwrap_or_else(|| "odoodev docker up failed without any output".to_string())
}

#[tauri::command]
pub async fn docker_up(
    version: String,
    runtime: Option<String>,
    allow_default_credentials: Option<bool>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    validate_version_and_runtime(&version, runtime.as_deref())?;
    let rt = resolve_runtime(runtime).await;
    let cli = build_docker_up_args(&version, &rt, allow_default_credentials.unwrap_or(false));
    let refs: Vec<&str> = cli.iter().map(|s| s.as_str()).collect();

    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let collected: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let win_err = window.clone();
    let err_lines = Arc::clone(&collected);
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        while let Some(line) = odoodev::next_lossy_line(&mut reader, &mut buf).await {
            let _ = win_err.emit("docker-up-progress", &line);
            if !line.trim().is_empty() {
                err_lines.lock().unwrap().push(line);
            }
        }
    });
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    while let Some(line) = odoodev::next_lossy_line(&mut reader, &mut buf).await {
        let _ = window.emit("docker-up-progress", &line);
        if !line.trim().is_empty() {
            collected.lock().unwrap().push(line);
        }
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;
    let _ = stderr_task.await;
    let output = collected.lock().unwrap().clone();
    Ok(OpResult {
        success: status.success(),
        error: if status.success() {
            None
        } else {
            Some(pick_docker_up_error(&output))
        },
    })
}

#[tauri::command]
pub async fn docker_down(version: String, runtime: Option<String>) -> Result<OpResult, String> {
    validate_version_and_runtime(&version, runtime.as_deref())?;
    let rt = resolve_runtime(runtime).await;
    let mut args = vec!["docker".to_string(), "down".to_string()];
    if !rt.is_empty() {
        args.push("--runtime".to_string());
        args.push(rt);
    }
    args.push(version);
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    match odoodev::run_odoodev_text(&refs).await {
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

#[tauri::command]
pub async fn docker_status(
    version: String,
    versions: HashMap<String, VersionInfo>,
    _manager: State<'_, ServerManager>,
) -> Result<DockerStatus, String> {
    let info = versions
        .get(&version)
        .ok_or_else(|| format!("Unknown version: {version}"))?;
    Ok(docker_check::check_docker_status(&version, info.db_port()).await)
}

#[tauri::command]
pub async fn list_containers() -> Result<Vec<ContainerInfo>, String> {
    Ok(docker_check::list_containers().await)
}

#[tauri::command]
pub async fn get_runtime_info() -> Result<RuntimeInfo, String> {
    let configured = crate::config::get_container_runtime();
    let runtime = docker_check::detect_runtime().await;
    let mut available = Vec::new();
    if which::which("docker").is_ok() {
        available.push("docker".to_string());
    }
    if cfg!(target_os = "macos") && which::which("container").is_ok() {
        available.push("apple".to_string());
    }
    let daemon_running = docker_check::check_daemon_running(&runtime).await;
    Ok(RuntimeInfo {
        runtime,
        configured,
        available,
        daemon_running,
    })
}

/// Start the container runtime's backend service (Apple Container apiserver
/// via `container system start`, Docker via systemctl / Docker Desktop).
/// Polls briefly so the caller usually sees the daemon already up.
#[tauri::command]
pub async fn runtime_system_start(runtime: String) -> Result<OpResult, String> {
    let message = docker_check::start_daemon(&runtime).await;
    match message {
        Ok(_) => {
            // Give the service a moment; Apple's apiserver answers in ~1-2s.
            // Docker Desktop can take much longer — the UI polling catches up.
            for _ in 0..10 {
                if docker_check::check_daemon_running(&runtime).await == Some(true) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            Ok(OpResult {
                success: true,
                error: None,
            })
        }
        Err(e) => Ok(OpResult {
            success: false,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn docker_logs(
    version: String,
    runtime: Option<String>,
    tail: Option<u32>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    validate_version_and_runtime(&version, runtime.as_deref())?;
    let rt = resolve_runtime(runtime).await;
    let mut args = vec!["docker".to_string(), "logs".to_string()];
    if !rt.is_empty() {
        args.push("--runtime".to_string());
        args.push(rt);
    }
    if let Some(n) = tail {
        args.push("-n".to_string());
        args.push(n.to_string());
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
    let win_err = window.clone();
    let event_name = format!("docker-logs:{version}");
    let err_event = event_name.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        while let Some(line) = odoodev::next_lossy_line(&mut reader, &mut buf).await {
            let _ = win_err.emit(&err_event, &line);
        }
    });
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    let mut last = String::new();
    while let Some(line) = odoodev::next_lossy_line(&mut reader, &mut buf).await {
        let _ = window.emit(&event_name, &line);
        last = line;
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;
    Ok(OpResult {
        success: status.success(),
        error: if status.success() { None } else { Some(last) },
    })
}

#[tauri::command]
pub async fn docker_bench(
    version: String,
    runtime: Option<String>,
    duration: Option<u32>,
    scale: Option<u32>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    validate_version_and_runtime(&version, runtime.as_deref())?;
    let mut args = vec!["bench".to_string(), version.clone()];
    if let Some(rt) = runtime {
        if !rt.is_empty() {
            args.push("--runtime".to_string());
            args.push(rt);
        }
    }
    if let Some(d) = duration {
        args.push("--duration".to_string());
        args.push(d.to_string());
    }
    if let Some(s) = scale {
        args.push("--scale".to_string());
        args.push(s.to_string());
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let event_name = format!("docker-bench:{version}");
    let exit_code = odoodev::run_odoodev_streaming(&refs, &window, &event_name).await?;
    Ok(OpResult {
        success: exit_code == 0,
        error: if exit_code == 0 {
            None
        } else {
            Some(format!("bench exited with code {exit_code}"))
        },
    })
}

#[cfg(test)]
mod tests {
    use super::{build_docker_up_args, pick_docker_up_error};

    #[test]
    fn up_args_put_options_before_the_version() {
        assert_eq!(
            build_docker_up_args("18", "apple", false),
            ["docker", "up", "--runtime", "apple", "18"]
        );
        assert_eq!(
            build_docker_up_args("18", "docker", true),
            [
                "docker",
                "up",
                "--runtime",
                "docker",
                "--allow-default-credentials",
                "18"
            ]
        );
    }

    #[test]
    fn up_args_omit_empty_runtime_and_default_credentials_flag() {
        let a = build_docker_up_args("19", "", false);
        assert_eq!(a, ["docker", "up", "19"]);
        assert!(!a.contains(&"--allow-default-credentials".to_string()));
    }

    #[test]
    fn refusal_reason_is_the_error_line_not_the_last_hint_line() {
        // Real 0.77.0 non-interactive refusal: hints on stdout, [ERROR] on stderr.
        let out = vec![
            "[INFO] Starting PostgreSQL for v18 via Apple Container...".to_string(),
            "[WARN] Insecure default credentials".to_string(),
            "[INFO] Run 'odoodev setup' to configure a real password".to_string(),
            "[ERROR] Aborted. Configure a real password and try again.".to_string(),
        ];
        assert_eq!(
            pick_docker_up_error(&out),
            "Aborted. Configure a real password and try again."
        );
    }

    #[test]
    fn failure_without_error_tag_falls_back_to_last_line() {
        let out = vec!["[INFO] a".to_string(), "boom".to_string()];
        assert_eq!(pick_docker_up_error(&out), "boom");
        assert!(pick_docker_up_error(&[]).contains("without any output"));
    }
}
