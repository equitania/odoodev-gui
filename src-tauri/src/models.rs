use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// === config versions --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VersionInfo {
    pub python: String,
    pub postgres: String,
    pub ports: Ports,
    pub base: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Ports {
    pub db: u16,
    pub odoo: u16,
    pub gevent: u16,
    pub mailpit: u16,
}

pub type VersionsResponse = HashMap<String, VersionInfo>;

// === venv check --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VenvStatus {
    pub version: String,
    pub venv_dir: String,
    pub exists: bool,
    pub is_symlink: bool,
    pub python_version: Option<String>,
    pub python_matches: Option<bool>,
    pub requirements_current: Option<bool>,
}

// === db list --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DbListResponse {
    pub version: String,
    pub host: String,
    pub port: u16,
    pub databases: Vec<String>,
}

// === run --output json (NDJSON, per-line) ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaybookEvent {
    pub event: String,
    pub name: Option<String>,
    pub command: Option<String>,
    pub status: Option<String>,
    pub message: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<u64>,
    pub details: Option<serde_json::Value>,
    pub playbook: Option<String>,
    pub version: Option<String>,
    pub steps_ok: Option<u32>,
    pub steps_error: Option<u32>,
}

// === Docker status (Rust-native check) ===
#[derive(Debug, Clone, Serialize)]
pub struct DockerStatus {
    pub running: bool,
    pub container_name: String,
    pub runtime: String, // "docker", "apple", "none"
}

// === Container info (from runtime CLI) ===
#[derive(Debug, Clone, Serialize)]
pub struct ContainerInfo {
    pub id: String,
    pub image: String,
    pub os: String,
    pub arch: String,
    pub state: String,
    pub ip: String,
    pub cpus: u64,
    pub memory_mb: u64,
    pub started: String,
    pub host_port: u16,
}

// === Runtime info ===
#[derive(Debug, Clone, Serialize)]
pub struct RuntimeInfo {
    pub runtime: String,
    pub configured: Option<String>,
    pub available: Vec<String>,
}

// === Server status ===
#[derive(Debug, Clone, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub uptime_seconds: Option<u64>,
    pub port: Option<u16>,
}

// === PyPI version ===
#[derive(Debug, Deserialize)]
pub struct PypiResponse {
    pub info: PypiInfo,
}
#[derive(Debug, Deserialize)]
pub struct PypiInfo {
    pub version: String,
}

// === uv info ===
#[derive(Debug, Clone, Serialize)]
pub struct UvInfoDto {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

// === odoodev info ===
#[derive(Debug, Clone, Serialize)]
pub struct OdoodevInfoDto {
    pub installed: bool,
    pub version: Option<String>,
}

// === Update check ===
#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
}

// === Platform info ===
#[derive(Debug, Clone, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
}

// === Backup / Restore results ===
#[derive(Debug, Clone, Serialize)]
pub struct BackupResult {
    pub success: bool,
    pub path: Option<String>,
    pub size: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RestoreResult {
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpResult {
    pub success: bool,
    pub error: Option<String>,
}
