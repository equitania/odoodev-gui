use std::collections::HashMap;

use tauri::State;

use crate::config;
use crate::docker_check;
use crate::installer;
use crate::log_parser;
use crate::models::{
    DockerStatus, OdoodevInfoDto, ServerStatus, UvInfoDto, VenvStatus, VersionInfo,
    VersionsResponse,
};
use crate::odoodev;
use crate::pypi;
use crate::server_manager::ServerManager;

#[tauri::command]
pub async fn get_versions() -> Result<VersionsResponse, String> {
    let v: VersionsResponse =
        serde_json::from_value(odoodev::run_odoodev_json(&["config", "versions", "--json"]).await?)
            .map_err(|e| format!("Failed to parse versions: {e}"))?;
    Ok(v)
}

#[tauri::command]
pub async fn get_venv_status(version: String) -> Result<VenvStatus, String> {
    let val = odoodev::run_odoodev_json(&["venv", "check", &version, "--json"]).await?;
    let status: VenvStatus =
        serde_json::from_value(val).map_err(|e| format!("Failed to parse venv status: {e}"))?;
    Ok(status)
}

#[tauri::command]
pub fn get_active_versions() -> Vec<String> {
    config::get_active_versions()
}

#[tauri::command]
pub async fn get_docker_status(
    version: String,
    versions: HashMap<String, VersionInfo>,
) -> Result<DockerStatus, String> {
    let info = versions
        .get(&version)
        .ok_or_else(|| format!("Unknown version: {version}"))?;
    Ok(docker_check::check_docker_status(&version, info.ports.db).await)
}

#[tauri::command]
pub fn get_server_status(version: String, manager: State<'_, ServerManager>) -> ServerStatus {
    let running = manager.is_running(&version);
    ServerStatus {
        running,
        pid: manager.get_pid(&version),
        uptime_seconds: manager.get_uptime(&version),
        port: manager.get_port(&version),
    }
}

#[tauri::command]
pub fn get_all_server_statuses(manager: State<'_, ServerManager>) -> HashMap<String, ServerStatus> {
    manager
        .versions()
        .into_iter()
        .map(|v| {
            (
                v.clone(),
                ServerStatus {
                    running: true,
                    pid: manager.get_pid(&v),
                    uptime_seconds: manager.get_uptime(&v),
                    port: manager.get_port(&v),
                },
            )
        })
        .collect()
}

#[derive(serde::Serialize)]
pub struct DashboardStatus {
    pub versions: VersionsResponse,
    pub active_versions: Vec<String>,
    pub venv_status: HashMap<String, VenvStatus>,
    pub docker_status: HashMap<String, DockerStatus>,
    pub server_status: HashMap<String, ServerStatus>,
}

#[tauri::command]
pub async fn get_all_dashboard_status(
    manager: State<'_, ServerManager>,
) -> Result<DashboardStatus, String> {
    let versions: VersionsResponse =
        serde_json::from_value(odoodev::run_odoodev_json(&["config", "versions", "--json"]).await?)
            .map_err(|e| format!("Failed to parse versions: {e}"))?;

    let active_versions = config::get_active_versions();
    let keys: Vec<String> = versions.keys().cloned().collect();

    let mut venv_status: HashMap<String, VenvStatus> = HashMap::new();
    let mut docker_status: HashMap<String, DockerStatus> = HashMap::new();

    for k in &keys {
        if let Ok(val) = odoodev::run_odoodev_json(&["venv", "check", k, "--json"]).await {
            if let Ok(s) = serde_json::from_value::<VenvStatus>(val) {
                venv_status.insert(k.clone(), s);
            }
        }
    }
    for k in &keys {
        if let Some(info) = versions.get(k) {
            docker_status.insert(
                k.clone(),
                docker_check::check_docker_status(k, info.ports.db).await,
            );
        }
    }

    let server_status: HashMap<String, ServerStatus> = manager
        .versions()
        .into_iter()
        .map(|v| {
            (
                v.clone(),
                ServerStatus {
                    running: true,
                    pid: manager.get_pid(&v),
                    uptime_seconds: manager.get_uptime(&v),
                    port: manager.get_port(&v),
                },
            )
        })
        .collect();

    Ok(DashboardStatus {
        versions,
        active_versions,
        venv_status,
        docker_status,
        server_status,
    })
}

#[tauri::command]
pub fn get_odoo_log_entry(line: String) -> log_parser::OdooLogEntry {
    log_parser::parse_line(&line)
}

#[tauri::command]
pub async fn check_uv() -> UvInfoDto {
    pypi::check_uv_status().await
}

#[tauri::command]
pub async fn install_uv() -> Result<UvInfoDto, String> {
    installer::install_uv().await?;
    Ok(pypi::check_uv_status().await)
}

#[tauri::command]
pub async fn check_odoodev() -> OdoodevInfoDto {
    match pypi::check_odoodev_update_via_version().await {
        Some(v) => OdoodevInfoDto {
            installed: true,
            version: Some(v),
        },
        None => OdoodevInfoDto {
            installed: false,
            version: None,
        },
    }
}

#[tauri::command]
pub async fn install_odoodev() -> Result<OdoodevInfoDto, String> {
    let v = installer::install_odoodev().await?;
    Ok(OdoodevInfoDto {
        installed: true,
        version: Some(v),
    })
}

#[tauri::command]
pub async fn get_runtime() -> String {
    docker_check::detect_runtime().await
}

#[tauri::command]
pub async fn get_runtime_config() -> Option<String> {
    config::get_container_runtime()
}
