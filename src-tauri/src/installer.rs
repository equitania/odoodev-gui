use std::path::PathBuf;
use tokio::process::Command;

use crate::odoodev;

pub struct UvInfo {
    pub path: PathBuf,
    pub version: String,
}

pub async fn ensure_uv() -> Result<UvInfo, String> {
    // 1. Check PATH
    if let Ok(path) = which::which("uv") {
        let version = get_uv_version(&path).await;
        return Ok(UvInfo { path, version });
    }
    // 2. Check common locations
    let home = odoodev::home_dir();
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            home.join(r".local\bin\uv.exe"),
            home.join(r".cargo\bin\uv.exe"),
        ]
    } else {
        vec![
            home.join(".local/bin/uv"),
            home.join(".cargo/bin/uv"),
            PathBuf::from("/opt/homebrew/bin/uv"),
            PathBuf::from("/usr/local/bin/uv"),
        ]
    };
    for c in &candidates {
        if c.exists() {
            let version = get_uv_version(c).await;
            return Ok(UvInfo {
                path: c.clone(),
                version,
            });
        }
    }
    // 3. Install uv
    install_uv().await?;
    // 4. Re-check
    let path = which::which("uv")
        .or_else(|_| {
            candidates
                .iter()
                .find(|c| c.exists())
                .cloned()
                .ok_or("uv not found")
        })
        .map_err(|_| "uv still not found after install".to_string())?;
    let version = get_uv_version(&path).await;
    Ok(UvInfo { path, version })
}

pub async fn install_uv() -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args(["-c", "irm https://astral.sh/uv/install.ps1 | iex"])
            .output()
            .await
            .map_err(|e| format!("Failed to install uv: {e}"))?;
    } else {
        Command::new("sh")
            .args(["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"])
            .output()
            .await
            .map_err(|e| format!("Failed to install uv: {e}"))?;
    }
    Ok(())
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
    let uv = ensure_uv().await?;
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
