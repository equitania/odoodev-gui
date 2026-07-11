use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct OdoodevConfig {
    #[allow(dead_code)]
    pub base_dir: Option<String>,
    pub active_versions: Option<Vec<String>>,
    #[serde(rename = "container_runtime")]
    pub container_runtime: Option<String>,
}

/// Read the global odoodev config at ~/.config/odoodev/config.yaml
pub fn read_config() -> Option<OdoodevConfig> {
    let home = crate::odoodev::home_dir();
    let candidates = [
        home.join(".config/odoodev/config.yaml"),
        home.join(".config/odoodev/config.yml"),
    ];
    for path in &candidates {
        if let Ok(content) = std::fs::read_to_string(path) {
            if let Ok(cfg) = serde_yaml::from_str::<OdoodevConfig>(&content) {
                return Some(cfg);
            }
        }
    }
    None
}

pub fn get_active_versions() -> Vec<String> {
    read_config()
        .and_then(|c| c.active_versions)
        .unwrap_or_default()
}

pub fn get_container_runtime() -> Option<String> {
    read_config().and_then(|c| c.container_runtime)
}
