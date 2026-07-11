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
    // Only allow web schemes. Calling the opener library directly bypasses the
    // plugin's built-in scheme allowlist, so an unvalidated URL could open
    // file:// paths or arbitrary OS URI handlers. Enforce the allowlist here.
    let allowed = url.starts_with("https://") || url.starts_with("http://");
    if !allowed {
        return Err(format!("Refused to open URL with disallowed scheme: {url}"));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| format!("Failed to open: {e}"))
}
