//! Curated file editor backend: read/write access limited to odoodev-owned
//! files (global config, per-version .env, playbook YAMLs). Not a general
//! file browser by design — every path is checked against an allowlist.

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

#[derive(Debug, Clone, Serialize)]
pub struct CuratedFiles {
    pub config: CuratedEntry,
    pub env_files: Vec<CuratedEntry>,
    pub playbooks: Vec<PlaybookInfo>,
    /// Directories where new playbooks may be created; also serve as
    /// extra allowlist roots for fs_read_file / fs_write_file.
    pub playbook_roots: Vec<String>,
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

    let mut env_files = Vec::new();
    let mut playbook_roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        playbook_roots.push(cwd.join("playbooks").to_string_lossy().to_string());
    }
    for version in &versions {
        // `env dir` prints the version's native dir; skip versions it doesn't know.
        let Ok(output) = odoodev::run_odoodev_text(&["env", "dir", version]).await else {
            continue;
        };
        let native_dir = PathBuf::from(output.trim());
        if native_dir.as_os_str().is_empty() {
            continue;
        }
        let env_path = native_dir.join(".env");
        env_files.push(CuratedEntry {
            exists: env_path.is_file(),
            path: env_path.to_string_lossy().to_string(),
            label: format!("v{version} .env"),
        });
        playbook_roots.push(
            native_dir
                .join("scripts/playbooks")
                .to_string_lossy()
                .to_string(),
        );
    }

    let playbooks = super::playbook::playbook_list().await.unwrap_or_default();

    Ok(CuratedFiles {
        config: config_entry,
        env_files,
        playbooks,
        playbook_roots,
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
    fn validate_yaml_ok_and_error_location() {
        assert!(validate_yaml("a: 1\nb: [1, 2]\n".to_string()).is_none());
        let err = validate_yaml("a: 1\n  broken: [\n".to_string()).expect("must fail");
        assert!(err.line.is_some());
        assert!(!err.message.is_empty());
    }
}
