use tauri::Emitter;

use crate::installer;
use crate::models::{OdoodevInfoDto, UpdateCheckResult, UvInfoDto};
use crate::pypi;

#[tauri::command]
pub async fn get_pypi_version() -> Result<Option<String>, String> {
    Ok(pypi::get_pypi_version().await)
}

#[tauri::command]
pub async fn check_odoodev_update() -> UpdateCheckResult {
    pypi::check_odoodev_update().await
}

#[tauri::command]
pub async fn upgrade_odoodev(window: tauri::Window) -> Result<OdoodevInfoDto, String> {
    let new_version = installer::upgrade_odoodev().await?;
    let _ = window.emit("install-progress", "upgrade complete");
    Ok(OdoodevInfoDto {
        installed: true,
        version: Some(new_version),
    })
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub async fn check_uv_status_cmd() -> UvInfoDto {
    pypi::check_uv_status().await
}
