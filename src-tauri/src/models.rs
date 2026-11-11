use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// === config versions --json ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VersionInfo {
    pub python: String,
    pub postgres: String,
    pub ports: Ports,
    /// Runtime ports resolved from the version's .env (CLI >= 0.58.0).
    /// Multi-user hosts give every user an own port prefix — container
    /// matching and URLs must use these, not the registry defaults.
    #[serde(default)]
    pub effective_ports: Option<Ports>,
    pub base: String,
}

impl VersionInfo {
    pub fn db_port(&self) -> u16 {
        self.effective_ports
            .as_ref()
            .map(|p| p.db)
            .unwrap_or(self.ports.db)
    }
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
    /// Database → reason it needs `db update` (odoodev >= 0.68.0). Absent until a
    /// `db update` state file exists; serialized as null so the GUI can tell
    /// "nothing recorded yet" from "all current".
    #[serde(default)]
    pub stale: Option<HashMap<String, String>>,
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
    /// Position of the step in `step_start` / `step_progress` (odoodev >= 0.74.0).
    pub index: Option<u32>,
    pub total: Option<u32>,
    pub steps_ok: Option<u32>,
    pub steps_error: Option<u32>,
    pub total_duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PlaybookInfo {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    pub version: Option<String>,
    pub steps: Option<Vec<String>>,
    pub vars: Option<serde_json::Value>,
}

// === run --steps --output json (odoodev >= 0.51) ===
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StepCapability {
    pub command: String,
    pub mode: String, // "dev" | "server"
}

// === playbook_inspect: lenient YAML summary of a playbook file ===
#[derive(Debug, Clone, Serialize, Default)]
pub struct PlaybookDetails {
    pub description: String,
    pub version: String,
    pub on_error: String,
    pub step_names: Vec<String>,
    pub step_commands: Vec<String>,
    pub targets: Vec<String>,
    pub env_file: Option<String>,
    pub has_rpc: bool,
    pub vars: Vec<String>,
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
    /// Whether the runtime's backend service answers (Docker daemon /
    /// Apple Container apiserver). None when no runtime is available.
    pub daemon_running: Option<bool>,
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
    /// Every stdout/stderr line in emission order. A `--dry-run` reports its
    /// whole verdict here (backup file, target-DB collision, filestore path,
    /// free space, planned post-restore steps) — the dialog shows it verbatim
    /// instead of collapsing it into a generic "passed" string.
    pub output: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpResult {
    pub success: bool,
    pub error: Option<String>,
}

/// Result line of `odoodev export modules --json`. `path` is `None` for an
/// empty module list (`count` 0, nothing written); `updated`/`cleaned` are
/// `None` when the respective flag was not given.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExportModulesResult {
    pub version: String,
    pub database: String,
    pub scope: String,
    pub path: Option<String>,
    pub count: u32,
    pub updated: Option<i64>,
    pub cleaned: Option<i64>,
}

#[cfg(test)]
mod export_modules_result_tests {
    use super::ExportModulesResult;

    #[test]
    fn parses_a_full_result() {
        let line = r#"{"version":"18","database":"v18_exam","scope":"all","path":"/x/modules_v18_exam_all_20261111_101500.csv","count":2,"updated":3,"cleaned":5}"#;
        let r: ExportModulesResult = serde_json::from_str(line).unwrap();
        assert_eq!(r.version, "18");
        assert_eq!(r.database, "v18_exam");
        assert_eq!(r.count, 2);
        assert_eq!(r.updated, Some(3));
        assert_eq!(r.cleaned, Some(5));
        assert!(r.path.unwrap().ends_with("101500.csv"));
    }

    #[test]
    fn parses_the_empty_result() {
        let line = r#"{"version":"18","database":"d","scope":"installed","path":null,"count":0,"updated":null,"cleaned":null}"#;
        let r: ExportModulesResult = serde_json::from_str(line).unwrap();
        assert_eq!(r.count, 0);
        assert!(r.path.is_none() && r.updated.is_none() && r.cleaned.is_none());
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct EnvCheckResult {
    pub exists: bool,
    pub complete: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MigrationGroup {
    pub name: String,
    pub from_version: String,
    pub to_version: String,
    pub postgres: String,
    pub shared_port: u16,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct MigrationStatus {
    pub active: bool,
    pub no_active: bool,
    pub group_name: Option<String>,
    pub source: Option<String>,
    pub target: Option<String>,
    pub shared_port: Option<u16>,
    pub filestore: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorCheck {
    pub name: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorResult {
    pub version: Option<String>,
    pub checks: Vec<DoctorCheck>,
    pub overall: String,
    pub all_ok: bool,
    pub raw_output: String,
}

#[cfg(test)]
mod cli_json_tests {
    use super::*;

    // Scrubbed `odoodev config versions --json`.
    const VERSIONS: &str = r#"{
      "18": {"python": "3.13", "postgres": "16.11-alpine",
             "ports": {"db": 18432, "odoo": 18069, "gevent": 18072, "mailpit": 18025},
             "effective_ports": {"db": 28432, "odoo": 28069, "gevent": 28072, "mailpit": 28025},
             "base": "~/gitbase/v18"},
      "19": {"python": "3.13", "postgres": "17.4-alpine",
             "ports": {"db": 19432, "odoo": 19069, "gevent": 19072, "mailpit": 19025},
             "base": "~/gitbase/v19", "future_field": true}
    }"#;

    #[test]
    fn versions_parse_and_effective_ports_win() {
        let v: VersionsResponse = serde_json::from_str(VERSIONS).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v["18"].python, "3.13");
        assert_eq!(v["18"].db_port(), 28432);
    }

    #[test]
    fn versions_without_effective_ports_use_registry_ports_and_ignore_unknown_fields() {
        let v: VersionsResponse = serde_json::from_str(VERSIONS).unwrap();
        assert!(v["19"].effective_ports.is_none());
        assert_eq!(v["19"].db_port(), 19432);
    }

    #[test]
    fn versions_empty_object_and_malformed_input() {
        assert!(serde_json::from_str::<VersionsResponse>("{}")
            .unwrap()
            .is_empty());
        assert!(serde_json::from_str::<VersionsResponse>("[]").is_err());
        assert!(serde_json::from_str::<VersionsResponse>(r#"{"18": {"python": "3.13"}}"#).is_err());
        assert!(serde_json::from_str::<VersionsResponse>("").is_err());
    }

    #[test]
    fn venv_status_full_and_minimal() {
        // `python_pin*` keys are not modelled and must be ignored.
        let full = r#"{"version": "18", "venv_dir": "/home/user/v18/.venv", "exists": true,
            "is_symlink": false, "python_version": "3.13.1", "python_matches": true,
            "python_pin": "3.13.1", "python_pin_source": "file", "requirements_current": true}"#;
        let s: VenvStatus = serde_json::from_str(full).unwrap();
        assert!(s.exists && !s.is_symlink);
        assert_eq!(s.python_version.as_deref(), Some("3.13.1"));
        assert_eq!(s.requirements_current, Some(true));

        let minimal = r#"{"version": "17", "venv_dir": "/home/user/v17/.venv",
            "exists": false, "is_symlink": false}"#;
        let s: VenvStatus = serde_json::from_str(minimal).unwrap();
        assert!(!s.exists);
        assert!(s.python_version.is_none() && s.python_matches.is_none());
    }

    #[test]
    fn venv_status_missing_required_field_is_error() {
        assert!(serde_json::from_str::<VenvStatus>(r#"{"version": "18"}"#).is_err());
    }

    #[test]
    fn db_list_with_and_without_stale() {
        let with = r#"{"version": "18", "host": "localhost", "port": 18432,
            "databases": ["demo_db", "demo_db_copy"], "stale": {"demo_db": "new migration"}}"#;
        let r: DbListResponse = serde_json::from_str(with).unwrap();
        assert_eq!(r.databases, vec!["demo_db", "demo_db_copy"]);
        assert_eq!(r.stale.unwrap()["demo_db"], "new migration");

        // Older CLI: key absent. Newer CLI before first update: explicit null.
        let absent = r#"{"version": "18", "host": "localhost", "port": 18432, "databases": []}"#;
        let r: DbListResponse = serde_json::from_str(absent).unwrap();
        assert!(r.databases.is_empty() && r.stale.is_none());
        let null = r#"{"version": "18", "host": "localhost", "port": 18432, "databases": [], "stale": null}"#;
        assert!(serde_json::from_str::<DbListResponse>(null)
            .unwrap()
            .stale
            .is_none());
    }

    #[test]
    fn db_list_rejects_plain_text_error_output() {
        // When PostgreSQL is down the CLI prints log lines instead of JSON.
        let text = "[ERROR] PostgreSQL not accessible on localhost:18432";
        assert!(serde_json::from_str::<DbListResponse>(text).is_err());
    }

    #[test]
    fn playbook_event_minimal_and_progress() {
        let start: PlaybookEvent = serde_json::from_str(r#"{"event": "step_start"}"#).unwrap();
        assert_eq!(start.event, "step_start");
        assert!(start.index.is_none() && start.name.is_none());

        let progress: PlaybookEvent = serde_json::from_str(
            r#"{"event": "step_progress", "name": "restore", "index": 2, "total": 5, "unknown": 1}"#,
        )
        .unwrap();
        assert_eq!((progress.index, progress.total), (Some(2), Some(5)));
        assert!(serde_json::from_str::<PlaybookEvent>(r#"{"name": "x"}"#).is_err());
    }
}
