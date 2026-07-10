use tokio::net::TcpStream;

use crate::installer::ensure_uv;
use crate::models::{PypiResponse, UpdateCheckResult, UvInfoDto};

pub async fn get_pypi_version() -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://pypi.org/pypi/odoodev-equitania/json")
        .send()
        .await
        .ok()?;
    let json: PypiResponse = resp.json().await.ok()?;
    Some(json.info.version)
}

pub async fn check_odoodev_update() -> UpdateCheckResult {
    let installed = crate::odoodev::get_odoodev_version().await;
    let latest = get_pypi_version().await;
    let update_available = match (&installed, &latest) {
        (Some(i), Some(l)) => l.trim() != i.trim() && !l.is_empty(),
        _ => false,
    };
    UpdateCheckResult {
        installed_version: installed,
        latest_version: latest,
        update_available,
    }
}

pub async fn check_uv_status() -> UvInfoDto {
    match ensure_uv().await {
        Ok(info) => UvInfoDto {
            installed: true,
            path: Some(info.path.to_string_lossy().to_string()),
            version: Some(info.version),
        },
        Err(_) => UvInfoDto {
            installed: false,
            path: None,
            version: None,
        },
    }
}

pub async fn check_pg_port(port: u16) -> bool {
    TcpStream::connect(format!("localhost:{port}"))
        .await
        .is_ok()
}

/// Returns the installed odoodev version, if any.
pub async fn check_odoodev_update_via_version() -> Option<String> {
    crate::odoodev::get_odoodev_version().await
}