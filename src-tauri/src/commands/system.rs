use crate::models::PlatformInfo;

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    let os = if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else {
        std::env::consts::OS.to_string()
    };
    let arch = std::env::consts::ARCH.to_string();
    PlatformInfo { os, arch }
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    tauri_plugin_opener::open_url(url, None::<&str>)
        .map_err(|e| format!("Failed to open: {e}"))
}