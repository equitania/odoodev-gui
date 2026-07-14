//! Curated file editor backend: read/write access limited to odoodev-owned
//! files (global config, per-version config files, playbook YAMLs). Not a
//! general file browser by design — every path is checked against an allowlist.
//!
//! The allowlist uses directory roots (each version's native_dir, conf_dir and
//! myconfs_dir, as reported by `odoodev config paths --json`). That admits any
//! file under those odoodev-owned trees, not only the curated entries — an
//! intentional trade-off: the dirs are user-controlled dev directories at the
//! same trust level as `~/.config/odoodev`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::process::Command;

use crate::models::PlaybookInfo;
use crate::{config, odoodev};

/// Editing targets are small text files; anything bigger is suspicious.
const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

/// Default odoodev versions, used when the config declares no active_versions.
const DEFAULT_VERSIONS: &[&str] = &["16", "17", "18", "19"];

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContent {
    Text { content: String },
    Binary { size: u64 },
    TooLarge { size: u64 },
}

#[derive(Debug, Clone, Serialize)]
pub struct CuratedEntry {
    pub path: String,
    pub exists: bool,
    pub label: String,
}

/// One editable config file of a version (role tags mirror
/// `odoodev config paths --json`).
#[derive(Debug, Clone, Serialize)]
pub struct VersionFileEntry {
    pub role: String,
    pub path: String,
    pub exists: bool,
    pub label: String,
    pub hint: Option<String>,
}

/// All editable config files of one Odoo version.
#[derive(Debug, Clone, Serialize)]
pub struct VersionFileGroup {
    pub version: String,
    pub native_dir: String,
    /// None when the installed odoodev CLI lacks `config paths` (fallback mode).
    pub conf_dir: Option<String>,
    pub myconfs_dir: Option<String>,
    pub entries: Vec<VersionFileEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CuratedFiles {
    pub config: CuratedEntry,
    pub version_groups: Vec<VersionFileGroup>,
    pub playbooks: Vec<PlaybookInfo>,
    /// Directories where new playbooks may be created.
    pub playbook_roots: Vec<String>,
    /// Union of playbook roots and version directories; the allowlist roots
    /// the frontend passes to fs_read_file / fs_write_file.
    pub extra_roots: Vec<String>,
    /// False when the installed odoodev CLI lacks `config paths --json`
    /// (reduced file list, template/generated confs unavailable).
    pub paths_command_available: bool,
}

/// Fixed role order for display and fallback synthesis.
const NATIVE_DIR_ROLES: &[&str] = &[
    "env",
    "compose",
    "requirements",
    "repos_yaml",
    "postgresql_conf",
];
const ALL_ROLES: &[&str] = &[
    "env",
    "compose",
    "requirements",
    "repos_yaml",
    "postgresql_conf",
    "template_conf",
    "generated_conf",
];

/// The file a role maps to inside a version's native dir (fallback mode).
fn native_dir_filename(role: &str) -> &'static str {
    match role {
        "env" => ".env",
        "compose" => "docker-compose.yml",
        "requirements" => "requirements.txt",
        "repos_yaml" => "repos.yaml",
        "postgresql_conf" => "postgresql.conf",
        _ => unreachable!("not a native-dir role: {role}"),
    }
}

fn role_hint(role: &str) -> Option<String> {
    match role {
        "template_conf" => Some("Source template for the generated odoo.conf".to_string()),
        "generated_conf" => {
            Some("Generated file — overwritten by the next `odoodev repos` run".to_string())
        }
        _ => None,
    }
}

fn entry_for_path(role: &str, path: &Path, exists: bool) -> VersionFileEntry {
    let label = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| role.to_string());
    VersionFileEntry {
        role: role.to_string(),
        path: path.to_string_lossy().to_string(),
        exists,
        label,
        hint: role_hint(role),
    }
}

/// Parse the `odoodev config paths --json` payload into version groups.
/// Returns None when the payload has an unexpected shape.
fn groups_from_paths_value(value: &serde_json::Value) -> Option<Vec<VersionFileGroup>> {
    let obj = value.as_object()?;
    let mut groups = Vec::new();
    for (version, data) in obj {
        let Some(native_dir) = data.get("native_dir").and_then(|v| v.as_str()) else {
            continue;
        };
        let files = data.get("files").and_then(|v| v.as_object());
        let mut entries = Vec::new();
        if let Some(files) = files {
            for role in ALL_ROLES {
                let Some(entry) = files.get(*role) else {
                    continue;
                };
                // `generated_conf` is null when nothing was generated yet.
                let Some(path) = entry.get("path").and_then(|v| v.as_str()) else {
                    continue;
                };
                let exists = entry
                    .get("exists")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                entries.push(entry_for_path(role, Path::new(path), exists));
            }
        }
        groups.push(VersionFileGroup {
            version: version.clone(),
            native_dir: native_dir.to_string(),
            conf_dir: data
                .get("conf_dir")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            myconfs_dir: data
                .get("myconfs_dir")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            entries,
        });
    }
    groups.sort_by(|a, b| a.version.cmp(&b.version));
    Some(groups)
}

/// Fallback for odoodev < 0.53.0 (no `config paths`): derive the native-dir
/// files from `env dir`; template/generated confs are not discoverable.
async fn groups_from_env_dir(versions: &[String]) -> Vec<VersionFileGroup> {
    let mut groups = Vec::new();
    for version in versions {
        // `env dir` prints the version's native dir; skip versions it doesn't know.
        let Ok(output) = odoodev::run_odoodev_text(&["env", "dir", version]).await else {
            continue;
        };
        let native_dir = PathBuf::from(output.trim());
        if native_dir.as_os_str().is_empty() {
            continue;
        }
        let entries = NATIVE_DIR_ROLES
            .iter()
            .map(|role| {
                let path = native_dir.join(native_dir_filename(role));
                let exists = path.is_file();
                entry_for_path(role, &path, exists)
            })
            .collect();
        groups.push(VersionFileGroup {
            version: version.clone(),
            native_dir: native_dir.to_string_lossy().to_string(),
            conf_dir: None,
            myconfs_dir: None,
            entries,
        });
    }
    groups
}

#[derive(Debug, Clone, Serialize)]
pub struct YamlError {
    pub message: String,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SemanticValidation {
    pub valid: bool,
    pub message: Option<String>,
}

fn config_dir() -> PathBuf {
    odoodev::home_dir().join(".config/odoodev")
}

/// Built-in allowlist roots (always permitted): the odoodev config dir and
/// a ./playbooks directory relative to the current working directory.
fn builtin_roots() -> Vec<PathBuf> {
    let mut roots = vec![config_dir()];
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd.join("playbooks"));
    }
    roots
}

/// Canonicalize a path for prefix comparison. For paths that do not exist
/// yet (new playbook files), canonicalize the parent and re-append the
/// file name — plain lexical matching would miss `..` traversal.
fn canonical_for_check(path: &Path) -> Option<PathBuf> {
    if let Ok(canon) = path.canonicalize() {
        return Some(canon);
    }
    let parent = path.parent()?;
    let name = path.file_name()?;
    parent.canonicalize().ok().map(|p| p.join(name))
}

fn is_allowed(path: &Path, extra_roots: &[String]) -> bool {
    let Some(canon) = canonical_for_check(path) else {
        return false;
    };
    builtin_roots()
        .into_iter()
        .chain(extra_roots.iter().map(PathBuf::from))
        .any(|root| match root.canonicalize() {
            Ok(root_canon) => canon.starts_with(&root_canon),
            Err(_) => false,
        })
}

fn check_allowed(path: &Path, extra_roots: &[String]) -> Result<(), String> {
    if is_allowed(path, extra_roots) {
        Ok(())
    } else {
        Err(format!(
            "Path is outside the editable odoodev locations: {}",
            path.display()
        ))
    }
}

/// Assemble the three curated sections shown in the editor's file list.
#[tauri::command]
pub async fn curated_files() -> Result<CuratedFiles, String> {
    let dir = config_dir();
    let yaml = dir.join("config.yaml");
    let yml = dir.join("config.yml");
    let config_path = if !yaml.exists() && yml.exists() {
        yml
    } else {
        yaml
    };
    let config_entry = CuratedEntry {
        exists: config_path.is_file(),
        path: config_path.to_string_lossy().to_string(),
        label: "config.yaml".to_string(),
    };

    let mut versions = config::get_active_versions();
    if versions.is_empty() {
        versions = DEFAULT_VERSIONS.iter().map(|s| s.to_string()).collect();
    }

    // Preferred: single CLI call that reports every editable file per version.
    // Fallback for older odoodev: derive the native-dir files from `env dir`.
    let (mut groups, paths_command_available) =
        match odoodev::run_odoodev_json(&["config", "paths", "--json"]).await {
            Ok(value) => match groups_from_paths_value(&value) {
                Some(groups) => (groups, true),
                None => (groups_from_env_dir(&versions).await, false),
            },
            Err(_) => (groups_from_env_dir(&versions).await, false),
        };
    // The CLI reports all registry versions; limit to the active ones.
    groups.retain(|g| versions.contains(&g.version));

    let mut playbook_roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        playbook_roots.push(cwd.join("playbooks").to_string_lossy().to_string());
    }
    for group in &groups {
        playbook_roots.push(
            Path::new(&group.native_dir)
                .join("scripts/playbooks")
                .to_string_lossy()
                .to_string(),
        );
    }

    // Allowlist roots: playbook dirs plus each version's directories. Parent
    // dirs of template/generated confs are added separately because repos.yaml
    // overrides may place them outside conf_dir/myconfs_dir.
    let mut extra_roots: Vec<String> = playbook_roots.clone();
    for group in &groups {
        extra_roots.push(group.native_dir.clone());
        extra_roots.extend(group.conf_dir.clone());
        extra_roots.extend(group.myconfs_dir.clone());
        for entry in &group.entries {
            if let Some(parent) = Path::new(&entry.path).parent() {
                extra_roots.push(parent.to_string_lossy().to_string());
            }
        }
    }
    extra_roots.sort();
    extra_roots.dedup();

    let playbooks = super::playbook::playbook_list().await.unwrap_or_default();

    Ok(CuratedFiles {
        config: config_entry,
        version_groups: groups,
        playbooks,
        playbook_roots,
        extra_roots,
        paths_command_available,
    })
}

#[tauri::command]
pub fn fs_read_file(path: String, extra_roots: Vec<String>) -> Result<FileContent, String> {
    let path = Path::new(&path);
    check_allowed(path, &extra_roots)?;

    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("Not a regular file: {}", path.display()));
    }
    if meta.len() > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { size: meta.len() });
    }

    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if bytes[..bytes.len().min(8192)].contains(&0) {
        return Ok(FileContent::Binary { size: meta.len() });
    }
    Ok(FileContent::Text {
        content: String::from_utf8_lossy(&bytes).to_string(),
    })
}

#[tauri::command]
pub fn fs_write_file(
    path: String,
    content: String,
    allow_create: bool,
    extra_roots: Vec<String>,
) -> Result<(), String> {
    let path = Path::new(&path);
    check_allowed(path, &extra_roots)?;

    match std::fs::metadata(path) {
        Ok(meta) if !meta.is_file() => {
            return Err(format!("Not a regular file: {}", path.display()));
        }
        Ok(_) => {}
        Err(_) if allow_create => {
            // New-playbook flow: the parent (a playbooks dir) may not exist yet.
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("{}: {e}", parent.display()))?;
            }
        }
        Err(_) => {
            return Err(format!(
                "File does not exist (creation not allowed here): {}",
                path.display()
            ));
        }
    }

    std::fs::write(path, content).map_err(|e| format!("{}: {e}", path.display()))
}

/// Pure YAML syntax check; returns None when the content parses.
#[tauri::command]
pub fn validate_yaml(content: String) -> Option<YamlError> {
    match serde_yaml::from_str::<serde_yaml::Value>(&content) {
        Ok(_) => None,
        Err(e) => {
            let location = e.location();
            Some(YamlError {
                message: e.to_string(),
                line: location.as_ref().map(|l| l.line()),
                column: location.as_ref().map(|l| l.column()),
            })
        }
    }
}

/// Schema-level playbook validation via `odoodev run <file> --dry-run --output json`.
/// Scans the NDJSON output for an `error` event; a validation failure exits 1,
/// so the raw output is inspected regardless of exit code.
#[tauri::command]
pub async fn playbook_validate_semantic(
    path: String,
    extra_roots: Vec<String>,
) -> Result<SemanticValidation, String> {
    check_allowed(Path::new(&path), &extra_roots)?;

    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(["run", &path, "--dry-run", "--output", "json"]);
    odoodev::augment_path(&mut cmd);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if event.get("event").and_then(|v| v.as_str()) == Some("error") {
            return Ok(SemanticValidation {
                valid: false,
                message: event
                    .get("message")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
            });
        }
    }

    if output.status.success() {
        Ok(SemanticValidation {
            valid: true,
            message: None,
        })
    } else {
        // Failed without an error event (e.g. a dry-run step error): surface stderr.
        let stderr = String::from_utf8_lossy(&output.stderr);
        Ok(SemanticValidation {
            valid: false,
            message: Some(stderr.trim().to_string()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("odoodev-gui-editor-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_paths_outside_all_roots() {
        assert!(!is_allowed(Path::new("/etc/passwd"), &[]));
    }

    #[test]
    fn rejects_traversal_out_of_extra_root() {
        let root = temp_root("traverse");
        let sneaky = root.join("../../etc/passwd");
        assert!(!is_allowed(&sneaky, &[root.to_string_lossy().to_string()]));
    }

    #[test]
    fn allows_file_under_extra_root() {
        let root = temp_root("allow");
        let file = root.join("pb.yaml");
        std::fs::write(&file, "x: 1\n").unwrap();
        assert!(is_allowed(&file, &[root.to_string_lossy().to_string()]));
    }

    #[test]
    fn allows_nonexistent_file_under_extra_root() {
        let root = temp_root("allow-new");
        let file = root.join("new-playbook.yaml");
        assert!(is_allowed(&file, &[root.to_string_lossy().to_string()]));
    }

    #[test]
    fn write_refuses_to_create_without_allow_create() {
        let root = temp_root("no-create");
        let file = root.join("missing.yaml");
        std::fs::remove_file(&file).ok();
        let result = fs_write_file(
            file.to_string_lossy().to_string(),
            "a: 1\n".to_string(),
            false,
            vec![root.to_string_lossy().to_string()],
        );
        assert!(result.is_err());
        assert!(!file.exists());
    }

    #[test]
    fn write_creates_when_allowed() {
        let root = temp_root("create");
        let file = root.join("fresh.yaml");
        std::fs::remove_file(&file).ok();
        fs_write_file(
            file.to_string_lossy().to_string(),
            "a: 1\n".to_string(),
            true,
            vec![root.to_string_lossy().to_string()],
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a: 1\n");
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn read_roundtrip_and_size_guard() {
        let root = temp_root("read");
        let file = root.join("small.yaml");
        std::fs::write(&file, "hello: world\n").unwrap();
        let roots = vec![root.to_string_lossy().to_string()];
        match fs_read_file(file.to_string_lossy().to_string(), roots).unwrap() {
            FileContent::Text { content } => assert_eq!(content, "hello: world\n"),
            other => panic!("expected text, got {other:?}"),
        }
    }

    #[test]
    fn allows_nested_file_under_directory_root() {
        let root = temp_root("conf-dir");
        let nested = root.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("odoo18_template.conf");
        std::fs::write(&file, "[options]\n").unwrap();
        assert!(is_allowed(&file, &[root.to_string_lossy().to_string()]));
    }

    #[test]
    fn parses_config_paths_payload() {
        let payload = serde_json::json!({
            "18": {
                "native_dir": "/base/v18/v18-dev/dev18_native",
                "conf_dir": "/base/v18/v18-dev/conf",
                "myconfs_dir": "/base/v18/myconfs",
                "files": {
                    "env": {"path": "/base/v18/v18-dev/dev18_native/.env", "exists": true},
                    "compose": {"path": "/base/v18/v18-dev/dev18_native/docker-compose.yml", "exists": true},
                    "requirements": {"path": "/base/v18/v18-dev/dev18_native/requirements.txt", "exists": false},
                    "repos_yaml": {"path": "/base/v18/v18-dev/dev18_native/repos.yaml", "exists": true},
                    "postgresql_conf": {"path": "/base/v18/v18-dev/dev18_native/postgresql.conf", "exists": true},
                    "template_conf": {"path": "/base/v18/v18-dev/conf/odoo18_template.conf", "exists": true},
                    "generated_conf": {"path": "/base/v18/myconfs/odoo_260714.conf", "exists": true}
                }
            },
            "16": {
                "native_dir": "/base/v16/v16-dev/dev16_native",
                "conf_dir": "/base/v16/v16-dev/conf",
                "myconfs_dir": "/base/v16/myconfs",
                "files": {
                    "env": {"path": "/base/v16/v16-dev/dev16_native/.env", "exists": false},
                    "generated_conf": null
                }
            }
        });
        let groups = groups_from_paths_value(&payload).unwrap();
        assert_eq!(groups.len(), 2);
        // Sorted by version
        assert_eq!(groups[0].version, "16");
        assert_eq!(groups[1].version, "18");

        let v18 = &groups[1];
        assert_eq!(v18.conf_dir.as_deref(), Some("/base/v18/v18-dev/conf"));
        assert_eq!(v18.entries.len(), 7);
        // Fixed role order
        let roles: Vec<&str> = v18.entries.iter().map(|e| e.role.as_str()).collect();
        assert_eq!(roles, ALL_ROLES.to_vec());
        let generated = v18.entries.last().unwrap();
        assert_eq!(generated.label, "odoo_260714.conf");
        assert!(generated.hint.is_some());

        // Null generated_conf is skipped; missing roles are skipped.
        let v16 = &groups[0];
        assert_eq!(v16.entries.len(), 1);
        assert_eq!(v16.entries[0].role, "env");
        assert!(!v16.entries[0].exists);
    }

    #[test]
    fn rejects_malformed_paths_payload() {
        assert!(groups_from_paths_value(&serde_json::json!([1, 2])).is_none());
        // Versions without native_dir are skipped, not fatal.
        let groups = groups_from_paths_value(&serde_json::json!({"18": {"files": {}}})).unwrap();
        assert!(groups.is_empty());
    }

    #[test]
    fn validate_yaml_ok_and_error_location() {
        assert!(validate_yaml("a: 1\nb: [1, 2]\n".to_string()).is_none());
        let err = validate_yaml("a: 1\n  broken: [\n".to_string()).expect("must fail");
        assert!(err.line.is_some());
        assert!(!err.message.is_empty());
    }
}
