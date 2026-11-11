use std::path::PathBuf;
use tokio::process::Command;

use crate::odoodev;

pub struct UvInfo {
    pub path: PathBuf,
    pub version: String,
}

/// Read-only lookup of `uv` (PATH, then the well-known install dirs from
/// `odoodev::EXTRA_PATHS_*`). Never installs anything — safe for status probes.
pub async fn find_uv() -> Option<UvInfo> {
    let path = odoodev::find_binary_opt("uv").or_else(|| odoodev::find_binary_opt("uv.exe"))?;
    let version = get_uv_version(&path).await;
    Some(UvInfo { path, version })
}

/// Like [`find_uv`], but installs uv when it is missing. Only call this from
/// commands the user triggered explicitly (the install dialog), never from a probe.
pub async fn ensure_uv() -> Result<UvInfo, String> {
    if let Some(info) = find_uv().await {
        return Ok(info);
    }
    install_uv().await?;
    find_uv()
        .await
        .ok_or_else(|| "uv still not found after install".to_string())
}

/// Static, non-interpolated unix install command. Trust assumption: the
/// official astral.sh installer fetched over HTTPS (TLS 1.2+, https-only,
/// redirects included); no version pinning or checksum verification.
/// The script is downloaded first so a curl failure cannot be masked by the
/// pipe (plain `sh` has no `pipefail`).
const UV_INSTALL_UNIX: &str = "set -e; s=$(curl --proto '=https' --tlsv1.2 -LsSf https://astral.sh/uv/install.sh); printf '%s\\n' \"$s\" | sh";

/// Windows variant (official PowerShell installer, same trust assumption).
const UV_INSTALL_WINDOWS: &str = "irm https://astral.sh/uv/install.ps1 | iex";

pub async fn install_uv() -> Result<(), String> {
    let output = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(["-NoProfile", "-Command", UV_INSTALL_WINDOWS])
            .output()
            .await
    } else {
        Command::new("sh")
            .args(["-c", UV_INSTALL_UNIX])
            .output()
            .await
    }
    .map_err(|e| format!("Failed to install uv: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "uv installer failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

pub async fn get_uv_version(path: &PathBuf) -> String {
    let mut cmd = Command::new(path);
    cmd.arg("--version");
    odoodev::augment_path(&mut cmd);
    let output = cmd.output().await;
    match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => String::new(),
    }
}

pub async fn install_odoodev() -> Result<String, String> {
    let uv = ensure_uv().await?;
    let mut cmd = Command::new(uv.path);
    cmd.args(["tool", "install", "odoodev-equitania"]);
    odoodev::augment_path(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to install odoodev: {e}"))?;
    if output.status.success() {
        odoodev::get_odoodev_version()
            .await
            .ok_or_else(|| "Installed but version check failed".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

pub async fn upgrade_odoodev() -> Result<String, String> {
    let uv = find_uv()
        .await
        .ok_or_else(|| "uv is not installed".to_string())?;
    let mut cmd = Command::new(uv.path);
    cmd.args(["tool", "upgrade", "odoodev-equitania"]);
    odoodev::augment_path(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to upgrade odoodev: {e}"))?;
    if output.status.success() {
        Ok(odoodev::get_odoodev_version().await.unwrap_or_default())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unix_install_command_is_https_only_and_static() {
        assert!(UV_INSTALL_UNIX.contains("--proto '=https'"));
        assert!(UV_INSTALL_UNIX.contains("--tlsv1.2"));
        assert!(UV_INSTALL_UNIX.contains("https://astral.sh/uv/install.sh"));
        assert!(UV_INSTALL_UNIX.starts_with("set -e;"));
    }

    #[test]
    fn windows_install_command_uses_https() {
        assert!(UV_INSTALL_WINDOWS.contains("https://astral.sh/uv/install.ps1"));
    }

    #[test]
    fn uv_search_dirs_cover_common_locations() {
        #[cfg(not(target_os = "windows"))]
        for d in [
            ".local/bin",
            ".cargo/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ] {
            assert!(odoodev::EXTRA_PATHS_UNIX.contains(&d), "{d}");
        }
        #[cfg(target_os = "windows")]
        for d in [".local\\bin", ".cargo\\bin"] {
            assert!(odoodev::EXTRA_PATHS_WIN.contains(&d), "{d}");
        }
    }
}
