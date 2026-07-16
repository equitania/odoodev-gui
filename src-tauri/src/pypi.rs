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

/// True only if `latest` is strictly newer than `installed` (numeric
/// dot-segment comparison, missing segments count as 0). Unparseable
/// versions never trigger an update — a dev build newer than PyPI must
/// not be offered a downgrade.
fn is_newer_version(latest: &str, installed: &str) -> bool {
    fn segments(v: &str) -> Option<Vec<u64>> {
        v.trim().split('.').map(|s| s.parse::<u64>().ok()).collect()
    }
    match (segments(latest), segments(installed)) {
        (Some(l), Some(i)) => {
            let len = l.len().max(i.len());
            for idx in 0..len {
                let a = l.get(idx).copied().unwrap_or(0);
                let b = i.get(idx).copied().unwrap_or(0);
                if a != b {
                    return a > b;
                }
            }
            false
        }
        _ => false,
    }
}

pub async fn check_odoodev_update() -> UpdateCheckResult {
    let installed = crate::odoodev::get_odoodev_version().await;
    let latest = get_pypi_version().await;
    let update_available = match (&installed, &latest) {
        (Some(i), Some(l)) => is_newer_version(l, i),
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

#[cfg(test)]
mod tests {
    use super::is_newer_version;

    #[test]
    fn newer_patch_and_minor_trigger_update() {
        assert!(is_newer_version("0.58.0", "0.57.0"));
        assert!(is_newer_version("1.5.1", "1.5.0"));
        assert!(is_newer_version("1.5.1", "1.5"));
    }

    #[test]
    fn equal_versions_do_not_trigger() {
        assert!(!is_newer_version("0.57.0", "0.57.0"));
        assert!(!is_newer_version("1.5", "1.5.0"));
    }

    #[test]
    fn older_pypi_version_is_never_offered_as_update() {
        assert!(!is_newer_version("0.57.0", "0.58.0"));
        assert!(!is_newer_version("1.4.9", "1.5.0"));
    }

    #[test]
    fn malformed_versions_never_trigger() {
        assert!(!is_newer_version("0.58.0", "0.58.0.dev1"));
        assert!(!is_newer_version("abc", "0.57.0"));
        assert!(!is_newer_version("", "0.57.0"));
    }
}
