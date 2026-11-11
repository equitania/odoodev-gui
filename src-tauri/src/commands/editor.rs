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
use std::sync::Mutex;

use serde::Serialize;
use tauri::State;
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

/// odoodev's configuration directory. The CLI uses `Path.home() / ".config" /
/// "odoodev"` on every platform (`get_config_dir` in `core/global_config.py`),
/// which is exactly this; `config.rs` reads `config.yaml` from the same place.
pub(crate) fn config_dir() -> PathBuf {
    odoodev::home_dir().join(".config/odoodev")
}

/// Where the wizard's secrets `.env` file may be written: the playbook
/// directories plus odoodev's config dir (the CLI's own default for server
/// playbooks is `~/.config/odoodev/<slug>.env`). Single place for that rule.
pub(crate) fn env_file_dirs(playbook_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut dirs = playbook_dirs.to_vec();
    let cfg = config_dir();
    if !dirs.contains(&cfg) {
        dirs.push(cfg);
    }
    dirs
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

/// Server-side allowlist roots (playbook dirs plus each version's
/// directories), computed in Rust by `curated_files` and held in Tauri managed
/// state. The webview never supplies roots — it can only ask for paths, which
/// are then checked against this list.
///
/// `playbook` is the subset where *new playbooks* may be written (`./playbooks`
/// and each version's `<native_dir>/scripts/playbooks`) — narrower than the
/// editor roots, which also cover the config directories.
#[derive(Default)]
pub struct EditorRoots {
    all: Mutex<Vec<PathBuf>>,
    playbook: Mutex<Vec<PathBuf>>,
}

impl EditorRoots {
    pub fn new() -> Self {
        Self::default()
    }

    fn set(&self, roots: Vec<PathBuf>) {
        *self.all.lock().unwrap_or_else(|e| e.into_inner()) = roots;
    }

    fn set_playbook(&self, roots: Vec<PathBuf>) {
        *self.playbook.lock().unwrap_or_else(|e| e.into_inner()) = roots;
    }

    fn snapshot(&self) -> Vec<PathBuf> {
        self.all.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn playbook_snapshot(&self) -> Vec<PathBuf> {
        self.playbook
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Store both lists from one `build_curated` run, so they never disagree.
    fn set_from(&self, files: &CuratedFiles, roots: Vec<PathBuf>) {
        self.set(roots);
        self.set_playbook(files.playbook_roots.iter().map(PathBuf::from).collect());
    }

    /// Current roots; computed on demand when `curated_files` has not run yet.
    async fn get_or_compute(&self) -> Vec<PathBuf> {
        let current = self.snapshot();
        if !current.is_empty() {
            return current;
        }
        let (files, roots) = build_curated().await;
        self.set_from(&files, roots.clone());
        roots
    }

    /// Directories where a new playbook may be written; computed on demand
    /// from the same run as the editor roots.
    pub async fn playbook_dirs(&self) -> Vec<PathBuf> {
        let current = self.playbook_snapshot();
        if !current.is_empty() {
            return current;
        }
        let (files, roots) = build_curated().await;
        self.set_from(&files, roots);
        self.playbook_snapshot()
    }
}

/// Resolve an absolute `path` to its real location when the tail may not exist
/// yet (a new playbook in a directory that is still to be created).
///
/// The longest existing prefix is canonicalized (symlinks and `..` inside it
/// resolve physically), the remaining components are appended. A `..` in the
/// non-existing remainder is rejected: it cannot be resolved without the
/// directory, and the CLI's `mkdir -p` would follow it. A dangling symlink is
/// an error, not "missing" — writing through it would create its target.
pub(crate) fn resolve_lenient(path: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    if !path.is_absolute() {
        return Err(format!("not an absolute path: {}", path.display()));
    }
    let comps: Vec<Component> = path.components().collect();
    for n in (1..=comps.len()).rev() {
        let prefix: PathBuf = comps[..n].iter().collect();
        match std::fs::symlink_metadata(&prefix) {
            Ok(_) => {
                let mut base = prefix
                    .canonicalize()
                    .map_err(|e| format!("{}: {e}", prefix.display()))?;
                for c in &comps[n..] {
                    match c {
                        Component::Normal(name) => base.push(name),
                        Component::CurDir => {}
                        _ => {
                            return Err(format!(
                                "'..' in a directory that does not exist yet: {}",
                                path.display()
                            ))
                        }
                    }
                }
                return Ok(base);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("{}: {e}", prefix.display())),
        }
    }
    Err(format!("cannot resolve {}", path.display()))
}

fn is_allowed(path: &Path, extra_roots: &[PathBuf]) -> bool {
    let Some(canon) = canonical_for_check(path) else {
        return false;
    };
    builtin_roots()
        .into_iter()
        .chain(extra_roots.iter().cloned())
        .any(|root| match root.canonicalize() {
            Ok(root_canon) => canon.starts_with(&root_canon),
            Err(_) => false,
        })
}

fn check_allowed(path: &Path, extra_roots: &[PathBuf]) -> Result<(), String> {
    if is_allowed(path, extra_roots) {
        Ok(())
    } else {
        Err(format!(
            "Path is outside the editable odoodev locations: {}",
            path.display()
        ))
    }
}

/// True for a path directly below a filesystem root (`/playbooks`, `C:\\playbooks`).
fn is_root_level(path: &Path) -> bool {
    path.parent().is_some_and(|p| p.parent().is_none())
}

/// The single place that decides which playbook directories exist and which of
/// them may receive new files. Returns `(all, writable)`, both in priority order:
/// each version's `<native_dir>/scripts/playbooks` first, `<cwd>/playbooks` last.
///
/// The working directory is only the project in a dev checkout; an installed
/// app launched from Finder or a desktop launcher gets whatever the launcher
/// sets (on macOS typically `/`), which turns `./playbooks` into `/playbooks`.
/// Such a root-level directory stays in `all` (reading, listing, editing keep
/// working) but is never a `writable` target nor an offered default.
pub(crate) fn playbook_dirs_for(
    native_dirs: &[String],
    cwd: Option<&Path>,
) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let mut all: Vec<PathBuf> = native_dirs
        .iter()
        .map(|d| Path::new(d).join("scripts/playbooks"))
        .collect();
    if let Some(cwd) = cwd {
        all.push(cwd.join("playbooks"));
    }
    let mut seen = Vec::new();
    all.retain(|p| {
        let dup = seen.contains(p);
        seen.push(p.clone());
        !dup
    });
    let writable = all.iter().filter(|p| !is_root_level(p)).cloned().collect();
    (all, writable)
}

/// Assemble the three curated sections shown in the editor's file list and
/// refresh the server-side allowlist.
#[tauri::command]
pub async fn curated_files(roots: State<'_, EditorRoots>) -> Result<CuratedFiles, String> {
    let (files, allow_roots) = build_curated().await;
    roots.set_from(&files, allow_roots);
    Ok(files)
}

/// Compute the curated file list together with the allowlist roots.
async fn build_curated() -> (CuratedFiles, Vec<PathBuf>) {
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

    let native_dirs: Vec<String> = groups.iter().map(|g| g.native_dir.clone()).collect();
    let cwd = std::env::current_dir().ok();
    let (all_playbook_dirs, writable_dirs) = playbook_dirs_for(&native_dirs, cwd.as_deref());
    let playbook_roots: Vec<String> = writable_dirs
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    // Allowlist roots: playbook dirs plus each version's directories. Parent
    // dirs of template/generated confs are added separately because repos.yaml
    // overrides may place them outside conf_dir/myconfs_dir.
    // (Editing may still reach `./playbooks` when it is the project's, even if
    // it is not offered as a place for new playbooks.)
    let mut extra_roots: Vec<String> = all_playbook_dirs
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();
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
    let extra_roots: Vec<PathBuf> = extra_roots.into_iter().map(PathBuf::from).collect();

    let playbooks = super::playbook::playbook_list().await.unwrap_or_default();

    (
        CuratedFiles {
            config: config_entry,
            version_groups: groups,
            playbooks,
            playbook_roots,
            paths_command_available,
        },
        extra_roots,
    )
}

#[tauri::command]
pub async fn fs_read_file(
    path: String,
    roots: State<'_, EditorRoots>,
) -> Result<FileContent, String> {
    let allow_roots = roots.get_or_compute().await;
    read_file_checked(&path, &allow_roots)
}

fn read_file_checked(path: &str, extra_roots: &[PathBuf]) -> Result<FileContent, String> {
    let path = Path::new(path);
    check_allowed(path, extra_roots)?;

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
pub async fn fs_write_file(
    path: String,
    content: String,
    allow_create: bool,
    roots: State<'_, EditorRoots>,
) -> Result<(), String> {
    let allow_roots = roots.get_or_compute().await;
    write_file_checked(&path, &content, allow_create, &allow_roots)
}

fn write_file_checked(
    path: &str,
    content: &str,
    allow_create: bool,
    extra_roots: &[PathBuf],
) -> Result<(), String> {
    let path = Path::new(path);
    check_allowed(path, extra_roots)?;

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
    roots: State<'_, EditorRoots>,
) -> Result<SemanticValidation, String> {
    let allow_roots = roots.get_or_compute().await;
    check_allowed(Path::new(&path), &allow_roots)?;

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

    fn roots_of(root: &Path) -> Vec<PathBuf> {
        vec![root.to_path_buf()]
    }

    #[test]
    fn playbook_dirs_put_versions_first_and_cwd_last() {
        let natives = vec!["/work/v18".to_string(), "/work/v19".to_string()];
        let (all, writable) = playbook_dirs_for(&natives, Some(Path::new("/home/dev/project")));
        let expect: Vec<PathBuf> = vec![
            "/work/v18/scripts/playbooks".into(),
            "/work/v19/scripts/playbooks".into(),
            "/home/dev/project/playbooks".into(),
        ];
        assert_eq!(all, expect);
        assert_eq!(writable, expect);
    }

    #[test]
    fn root_level_cwd_playbooks_is_never_writable() {
        let natives = vec!["/work/v18".to_string()];
        let (all, writable) = playbook_dirs_for(&natives, Some(Path::new("/")));
        assert_eq!(all.last().unwrap(), Path::new("/playbooks"));
        assert_eq!(writable, vec![PathBuf::from("/work/v18/scripts/playbooks")]);
        // no cwd at all, no versions: nothing to offer
        assert!(playbook_dirs_for(&[], None).1.is_empty());
    }

    #[test]
    fn rejects_paths_outside_all_roots() {
        assert!(!is_allowed(Path::new("/etc/passwd"), &[]));
    }

    #[test]
    fn rejects_traversal_out_of_extra_root() {
        let root = temp_root("traverse");
        let sneaky = root.join("../../etc/passwd");
        assert!(!is_allowed(&sneaky, &roots_of(&root)));
    }

    #[test]
    fn rejects_path_outside_server_side_roots() {
        let root = temp_root("outside-root");
        let other = temp_root("outside-other");
        let file = other.join("secret.yaml");
        std::fs::write(&file, "x: 1\n").unwrap();
        let roots = roots_of(&root);
        assert!(!is_allowed(&file, &roots));
        assert!(read_file_checked(&file.to_string_lossy(), &roots).is_err());
        assert!(write_file_checked(&file.to_string_lossy(), "y: 2\n", true, &roots).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "x: 1\n");
    }

    #[test]
    fn rejects_root_slash_only_when_not_server_side() {
        // A caller-supplied "/" no longer exists as an input; with no
        // server-side roots, an arbitrary path is refused.
        assert!(read_file_checked("/etc/hosts", &[]).is_err());
        assert!(write_file_checked("/tmp/odoodev-gui-nope.yaml", "a: 1\n", true, &[]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escaping_the_root() {
        let root = temp_root("symlink-root");
        let outside = temp_root("symlink-target");
        let secret = outside.join("secret.txt");
        std::fs::write(&secret, "top secret\n").unwrap();
        let link = root.join("link.txt");
        std::fs::remove_file(&link).ok();
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let roots = roots_of(&root);
        assert!(!is_allowed(&link, &roots));
        assert!(read_file_checked(&link.to_string_lossy(), &roots).is_err());
        assert!(write_file_checked(&link.to_string_lossy(), "x", false, &roots).is_err());
        assert_eq!(std::fs::read_to_string(&secret).unwrap(), "top secret\n");

        // A symlinked directory pointing out is refused for new files too.
        let dir_link = root.join("dirlink");
        std::fs::remove_file(&dir_link).ok();
        std::os::unix::fs::symlink(&outside, &dir_link).unwrap();
        let new_file = dir_link.join("new.yaml");
        assert!(!is_allowed(&new_file, &roots));
        assert!(write_file_checked(&new_file.to_string_lossy(), "a: 1\n", true, &roots).is_err());
        assert!(!outside.join("new.yaml").exists());
    }

    #[test]
    fn allows_file_under_extra_root() {
        let root = temp_root("allow");
        let file = root.join("pb.yaml");
        std::fs::write(&file, "x: 1\n").unwrap();
        assert!(is_allowed(&file, &roots_of(&root)));
    }

    #[test]
    fn allows_nonexistent_file_under_extra_root() {
        let root = temp_root("allow-new");
        let file = root.join("new-playbook.yaml");
        assert!(is_allowed(&file, &roots_of(&root)));
    }

    #[test]
    fn write_refuses_to_create_without_allow_create() {
        let root = temp_root("no-create");
        let file = root.join("missing.yaml");
        std::fs::remove_file(&file).ok();
        let result = write_file_checked(&file.to_string_lossy(), "a: 1\n", false, &roots_of(&root));
        assert!(result.is_err());
        assert!(!file.exists());
    }

    #[test]
    fn write_creates_when_allowed() {
        let root = temp_root("create");
        let file = root.join("fresh.yaml");
        std::fs::remove_file(&file).ok();
        write_file_checked(&file.to_string_lossy(), "a: 1\n", true, &roots_of(&root)).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a: 1\n");
        std::fs::remove_file(&file).ok();
    }

    #[test]
    fn read_roundtrip_and_size_guard() {
        let root = temp_root("read");
        let file = root.join("small.yaml");
        std::fs::write(&file, "hello: world\n").unwrap();
        match read_file_checked(&file.to_string_lossy(), &roots_of(&root)).unwrap() {
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
        assert!(is_allowed(&file, &roots_of(&root)));
    }

    #[test]
    fn roots_state_roundtrip() {
        let state = EditorRoots::new();
        assert!(state.snapshot().is_empty());
        state.set(vec![PathBuf::from("/a")]);
        assert_eq!(state.snapshot(), vec![PathBuf::from("/a")]);
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
