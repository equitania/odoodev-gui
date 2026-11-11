use std::path::{Path, PathBuf};

use tauri::Emitter;
use tokio::io::BufReader;
use tokio::process::Command;

use crate::models::{OpResult, PlaybookDetails, PlaybookEvent, PlaybookInfo, StepCapability};
use crate::odoodev;

/// Last known-good dev-mode step list, used when the installed odoodev
/// predates `run --steps` (< 0.51) and can't report its own capabilities.
pub const FALLBACK_DEV_STEPS: &[&str] = &[
    "db.backup",
    "db.drop",
    "db.list",
    "db.purge",
    "db.restore",
    "docker.down",
    "docker.status",
    "docker.up",
    "env.check",
    "pull",
    "repos",
    "start",
    "stop",
    "venv.check",
    "venv.setup",
];

#[tauri::command]
pub async fn playbook_list() -> Result<Vec<PlaybookInfo>, String> {
    let val = odoodev::run_odoodev_json(&["run", "--list", "--output", "json"]).await?;
    let list: Vec<PlaybookInfo> =
        serde_json::from_value(val).map_err(|e| format!("Failed to parse playbook list: {e}"))?;
    Ok(list)
}

#[tauri::command]
pub async fn playbook_valid_steps() -> Result<Vec<StepCapability>, String> {
    match odoodev::run_odoodev_json(&["run", "--steps", "--output", "json"]).await {
        Ok(val) => serde_json::from_value(val)
            .map_err(|e| format!("Failed to parse step capabilities: {e}")),
        // odoodev < 0.51 rejects --steps (usage error on stderr, empty stdout).
        Err(_) => Ok(FALLBACK_DEV_STEPS
            .iter()
            .map(|s| StepCapability {
                command: s.to_string(),
                mode: "dev".to_string(),
            })
            .collect()),
    }
}

fn has_yaml_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("yml") || e.eq_ignore_ascii_case("yaml"))
}

/// Cheap, sound check for a playbook the UI wants to read or run: not
/// flag-like, a .yml/.yaml name, and an existing regular file. Deliberately
/// not the editor allowlist: `odoodev run --list` also reports the playbooks
/// bundled inside the odoodev package, which live outside every editor root.
fn check_playbook_file(path: &str) -> Result<(), String> {
    odoodev::reject_flag_like("path", path)?;
    let p = Path::new(path);
    if !has_yaml_extension(p) {
        return Err(format!("Not a playbook file (.yml/.yaml expected): {path}"));
    }
    match std::fs::metadata(p) {
        Ok(meta) if meta.is_file() => Ok(()),
        Ok(_) => Err(format!("Not a regular file: {path}")),
        Err(e) => Err(format!("{path}: {e}")),
    }
}

/// What a checked path is for. Both kinds share one check (containment in the
/// playbook directories, `~`, symlinks, `..`); they differ in the allowed file
/// name and in the error prefix, so the UI can name the right field.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Target {
    /// The playbook YAML (`-o`).
    Playbook,
    /// The secrets file the CLI writes for `env_file.path`.
    EnvFile,
}

impl Target {
    /// `playbook_output:<code>` / `playbook_env_file:<code>` — the frontend maps
    /// the code to a translated message; the text after it is an English fallback.
    fn prefix(self) -> &'static str {
        match self {
            Target::Playbook => "playbook_output",
            Target::EnvFile => "playbook_env_file",
        }
    }

    fn field(self) -> &'static str {
        match self {
            Target::Playbook => "output_path",
            Target::EnvFile => "env_file.path",
        }
    }

    /// Playbooks are `.yml`/`.yaml`. The wizard and the CLI name secrets files
    /// `<slug>.env` (CLI defaults `./playbooks/<slug>.env` and
    /// `~/.config/odoodev/<slug>.env`), so a file name ending in `.env` is the
    /// shape accepted — this also rules out names like `authorized_keys`.
    fn name_ok(self, path: &Path) -> bool {
        match self {
            Target::Playbook => has_yaml_extension(path),
            Target::EnvFile => path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.len() > 4 && n.ends_with(".env")),
        }
    }
}

fn target_err(kind: Target, code: &str, detail: impl std::fmt::Display) -> String {
    format!("{}:{code}: {detail}", kind.prefix())
}

fn output_err(code: &str, detail: impl std::fmt::Display) -> String {
    target_err(Target::Playbook, code, detail)
}

/// Expand a leading `~` like the CLI's `os.path.expanduser` and make the path
/// absolute against `cwd` (the CLI inherits the GUI's working directory), so
/// the check and the CLI act on the same file. `~user` is refused: the CLI
/// would expand it to another account's home, which we cannot mirror.
fn expand_target_path(kind: Target, raw: &str, home: &Path, cwd: &Path) -> Result<PathBuf, String> {
    let expanded = if raw == "~" {
        home.to_path_buf()
    } else if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        home.join(rest)
    } else if raw.starts_with('~') {
        return Err(target_err(
            kind,
            "bad_tilde",
            format!("only '~' and '~/...' are supported: {raw}"),
        ));
    } else {
        PathBuf::from(raw)
    };
    Ok(if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    })
}

/// Check a path the CLI is going to write and return the absolute,
/// `~`-expanded path to hand to it.
///
/// Rules: not flag-like, a file name of the kind's shape, located inside one of
/// the playbook directories `roots` (symlinks resolved, also for directories
/// that do not exist yet — see `editor::resolve_lenient`), and, if it exists
/// already, a regular file. Overwriting stays gated by `force`, which the CLI
/// enforces. The parent directory may be missing: the CLI runs `mkdir -p`, and
/// the wizard's default directory may not exist on a fresh install.
fn check_write_target(
    kind: Target,
    raw: &str,
    roots: &[PathBuf],
    home: &Path,
    cwd: &Path,
) -> Result<PathBuf, String> {
    odoodev::reject_flag_like(kind.field(), raw).map_err(|e| target_err(kind, "flag_like", e))?;
    if raw.trim().is_empty() {
        return Err(target_err(kind, "empty", "no path given"));
    }
    let path = expand_target_path(kind, raw, home, cwd)?;
    if !kind.name_ok(&path) {
        return Err(target_err(
            kind,
            "bad_extension",
            format!("unsupported file name: {raw}"),
        ));
    }
    let real = super::editor::resolve_lenient(&path).map_err(|e| {
        let code = if e.contains("'..'") {
            "parent_escape"
        } else {
            "unresolvable"
        };
        target_err(kind, code, e)
    })?;
    let allowed = roots.iter().filter_map(|r| {
        let abs = if r.is_absolute() {
            r.clone()
        } else {
            cwd.join(r)
        };
        super::editor::resolve_lenient(&abs).ok()
    });
    if !allowed.into_iter().any(|root| real.starts_with(&root)) {
        return Err(target_err(
            kind,
            "outside_roots",
            format!("{} is outside the playbook directories", real.display()),
        ));
    }
    if let Ok(meta) = std::fs::metadata(&path) {
        if !meta.is_file() {
            return Err(target_err(
                kind,
                "not_a_file",
                format!("not a regular file: {raw}"),
            ));
        }
    }
    Ok(path)
}

/// The playbook output path (see `check_write_target`).
fn check_playbook_output(
    raw: &str,
    roots: &[PathBuf],
    home: &Path,
    cwd: &Path,
) -> Result<PathBuf, String> {
    check_write_target(Target::Playbook, raw, roots, home, cwd)
}

/// Check the secrets-file path inside the wizard's answers and rewrite it to
/// the expanded absolute form.
///
/// CLI behaviour this mirrors (`write_env_file`, `_write_outputs`): the file is
/// written only when `env_file.generate` is true and `env_file.path` is
/// non-empty; the path goes through `os.path.expanduser` only, so a relative
/// path is relative to the process working directory (not the playbook's
/// directory) — the same rule the output path follows. An existing file is
/// refused without `--force`. Answers without an env file, or with
/// `generate: false` (the path is then only recorded in the playbook, nothing
/// is written), pass untouched.
///
/// Errors never contain answer values other than the path itself, so secrets
/// cannot leak through a message.
fn check_env_file_answers(
    answers: &mut serde_json::Value,
    roots: &[PathBuf],
    home: &Path,
    cwd: &Path,
) -> Result<(), String> {
    let kind = Target::EnvFile;
    let Some(top) = answers.as_object_mut() else {
        return Err(target_err(
            kind,
            "malformed",
            "answers must be a JSON object",
        ));
    };
    let Some(env) = top.get_mut("env_file") else {
        return Ok(());
    };
    if env.is_null() {
        return Ok(());
    }
    let Some(env) = env.as_object_mut() else {
        return Err(target_err(kind, "malformed", "env_file must be an object"));
    };
    // The CLI treats any truthy `generate` as "write"; accept only a real boolean
    // true here and refuse other shapes rather than guess what Python would do.
    let generate = match env.get("generate") {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(_) => {
            return Err(target_err(
                kind,
                "malformed",
                "env_file.generate must be a boolean",
            ))
        }
    };
    if !generate {
        return Ok(());
    }
    let raw = match env.get("path") {
        None | Some(serde_json::Value::Null) => return Ok(()), // CLI rejects it; nothing is written
        Some(serde_json::Value::String(s)) if s.trim().is_empty() => return Ok(()),
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(_) => {
            return Err(target_err(
                kind,
                "malformed",
                "env_file.path must be a string",
            ))
        }
    };
    let checked = check_write_target(kind, &raw, roots, home, cwd)?;
    env.insert(
        "path".to_string(),
        serde_json::Value::String(checked.to_string_lossy().to_string()),
    );
    Ok(())
}

/// Where the secrets `.env` file may go, for the wizard: the allowed
/// directories in display order (playbook directories first, odoodev's config
/// directory last) and the config directory itself, which is the CLI's default
/// for server playbooks.
#[derive(serde::Serialize)]
pub struct EnvFileDirs {
    pub dirs: Vec<String>,
    pub config_dir: String,
}

#[tauri::command]
pub async fn playbook_env_dirs(
    roots: tauri::State<'_, super::editor::EditorRoots>,
) -> Result<EnvFileDirs, String> {
    let dirs = super::editor::env_file_dirs(&roots.playbook_dirs().await);
    Ok(EnvFileDirs {
        dirs: dirs
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
        config_dir: super::editor::config_dir().to_string_lossy().to_string(),
    })
}

/// Dry-run of the checks `playbook_create` applies, for the wizard to show a
/// clear message before submitting. Read-only; returns the absolute path that
/// would be written.
#[tauri::command]
pub async fn playbook_check_output(
    output_path: String,
    kind: Option<String>,
    roots: tauri::State<'_, super::editor::EditorRoots>,
) -> Result<String, String> {
    let kind = match kind.as_deref() {
        None | Some("output") => Target::Playbook,
        Some("env_file") => Target::EnvFile,
        Some(other) => return Err(format!("Invalid kind: {other}")),
    };
    let mut dirs = roots.playbook_dirs().await;
    if kind == Target::EnvFile {
        dirs = super::editor::env_file_dirs(&dirs);
    }
    let cwd = std::env::current_dir().map_err(|e| target_err(kind, "unresolvable", e))?;
    check_write_target(kind, &output_path, &dirs, &odoodev::home_dir(), &cwd)
        .map(|p| p.to_string_lossy().to_string())
}

fn yaml_str(map: &serde_yaml::Mapping, key: &str) -> String {
    map.get(serde_yaml::Value::from(key))
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn yaml_keys(map: &serde_yaml::Mapping, key: &str) -> Vec<String> {
    map.get(serde_yaml::Value::from(key))
        .and_then(|v| v.as_mapping())
        .map(|m| {
            m.keys()
                .filter_map(|k| k.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Lenient read-only summary of a playbook file for the details card.
/// Tolerates unknown fields and future step commands by design.
#[tauri::command]
pub fn playbook_inspect(path: String) -> Result<PlaybookDetails, String> {
    check_playbook_file(&path)?;
    let content = std::fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))?;
    let raw: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| format!("YAML parse error: {e}"))?;
    let map = raw
        .as_mapping()
        .ok_or_else(|| "playbook root must be a mapping".to_string())?;

    let mut step_names = Vec::new();
    let mut step_commands = Vec::new();
    if let Some(steps) = map
        .get(serde_yaml::Value::from("steps"))
        .and_then(|v| v.as_sequence())
    {
        for step in steps {
            let Some(step_map) = step.as_mapping() else {
                continue;
            };
            let command = yaml_str(step_map, "command");
            let name = yaml_str(step_map, "name");
            step_names.push(if name.is_empty() {
                command.clone()
            } else {
                name
            });
            step_commands.push(command);
        }
    }

    let env_file = {
        let value = yaml_str(map, "env_file");
        (!value.is_empty()).then_some(value)
    };

    Ok(PlaybookDetails {
        description: yaml_str(map, "description"),
        version: yaml_str(map, "version"),
        on_error: yaml_str(map, "on_error"),
        step_names,
        step_commands,
        targets: yaml_keys(map, "targets"),
        env_file,
        has_rpc: map
            .get(serde_yaml::Value::from("rpc"))
            .and_then(|v| v.as_mapping())
            .is_some_and(|m| !m.is_empty()),
        vars: yaml_keys(map, "vars"),
    })
}

/// Wizard field schema from the CLI — the GUI form-rendering contract.
/// Deliberately passed through untyped: the schema is versioned and evolves
/// on the CLI side; the GUI must render whatever the installed CLI reports.
#[tauri::command]
pub async fn playbook_schema() -> Result<serde_json::Value, String> {
    odoodev::run_odoodev_json(&["playbook", "schema", "--json"]).await
}

#[tauri::command]
pub async fn playbook_validate(path: String) -> Result<serde_json::Value, String> {
    check_playbook_file(&path)?;
    odoodev::run_odoodev_json(&["playbook", "validate", &path, "--json"]).await
}

/// RAII guard for the temporary answers JSON file. Answers may contain
/// inline secrets, so the file is 0600 on Unix and removed on every exit
/// path (error, panic unwind, success).
struct TempAnswersFile(std::path::PathBuf);

impl TempAnswersFile {
    fn create(answers: &serde_json::Value) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!(
            "odoodev-gui-playbook-answers-{}-{}.json",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0),
        ));
        let body = serde_json::to_string(answers).map_err(|e| format!("serialize answers: {e}"))?;
        // Created atomically with mode 0600 and `create_new` (O_EXCL), so the
        // secrets are never readable by others, not even briefly, and a
        // pre-planted file or symlink at the predictable name is refused.
        // Windows: the file inherits the per-user temp-dir ACL; there is no
        // direct 0600 equivalent, so removal-after-use is the protection.
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&path)
            .map_err(|e| format!("create answers file: {e}"))?;
        // From here on the guard owns the file and removes it on every exit.
        let guard = Self(path);
        std::io::Write::write_all(&mut file, body.as_bytes())
            .map_err(|e| format!("write answers file: {e}"))?;
        Ok(guard)
    }
}

impl Drop for TempAnswersFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Generate a playbook YAML (plus optional secrets env_file) from wizard
/// answers via `playbook create --non-interactive`. The CLI has no JSON
/// output for this command, so success is exit 0; the resulting path is the
/// explicit `-o` value rather than anything scraped from stdout.
#[tauri::command]
pub async fn playbook_create(
    mut answers: serde_json::Value,
    output_path: String,
    force: bool,
    roots: tauri::State<'_, super::editor::EditorRoots>,
) -> Result<String, String> {
    let dirs = roots.playbook_dirs().await;
    let cwd = std::env::current_dir().map_err(|e| output_err("unresolvable", e))?;
    // The CLI gets the checked, expanded absolute path, so both sides write the same file.
    let output_path = check_playbook_output(&output_path, &dirs, &odoodev::home_dir(), &cwd)?
        .to_string_lossy()
        .to_string();
    // Same for the secrets file named in the answers (rewritten to its absolute form).
    let env_dirs = super::editor::env_file_dirs(&dirs);
    check_env_file_answers(&mut answers, &env_dirs, &odoodev::home_dir(), &cwd)?;
    let tmp = TempAnswersFile::create(&answers)?;
    let tmp_path = tmp.0.to_string_lossy().to_string();

    let mut args = vec![
        "playbook",
        "create",
        "--answers",
        &tmp_path,
        "--non-interactive",
        "-o",
        &output_path,
    ];
    if force {
        args.push("--force");
    }

    odoodev::run_odoodev_text(&args).await?;
    Ok(output_path)
}

#[tauri::command]
pub async fn playbook_run(
    playbook: Option<String>,
    steps: Vec<String>,
    version: Option<String>,
    vars: Vec<String>,
    dry_run: bool,
    no_preflight: Option<bool>,
    window: tauri::Window,
) -> Result<OpResult, String> {
    if let Some(pb) = &playbook {
        // The UI always sends a path; the CLI also resolves bare names.
        if pb.contains('/') || pb.contains('\\') || has_yaml_extension(Path::new(pb)) {
            check_playbook_file(pb)?;
        } else {
            odoodev::validate_name("playbook", pb)?;
        }
    }
    for s in &steps {
        odoodev::validate_name("step", s)?;
    }
    if let Some(v) = &version {
        odoodev::validate_version("version", v)?;
    }
    for v in &vars {
        odoodev::reject_flag_like("var", v)?;
    }

    let mut args = vec!["run".to_string()];

    if let Some(ref pb) = playbook {
        args.push(pb.clone());
    } else {
        for s in &steps {
            args.push("--step".to_string());
            args.push(s.clone());
        }
    }

    if let Some(ref v) = version {
        args.push("-V".to_string());
        args.push(v.clone());
    }

    for v in &vars {
        args.push("-D".to_string());
        args.push(v.clone());
    }

    if dry_run {
        args.push("--dry-run".to_string());
    }

    if no_preflight.unwrap_or(false) {
        args.push("--no-preflight".to_string());
    }

    args.push("--output".to_string());
    args.push("json".to_string());

    let event_name = "playbook-event".to_string();

    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("spawn: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let win_err = window.clone();
    let err_event = event_name.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut buf = Vec::new();
        while let Some(line) = odoodev::next_lossy_line(&mut reader, &mut buf).await {
            let _ = win_err.emit(&err_event, &line);
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    let mut last_error: Option<String> = None;
    let mut final_status = "ok".to_string();

    while let Some(line) = odoodev::next_lossy_line(&mut reader, &mut buf).await {
        if let Ok(event) = serde_json::from_str::<PlaybookEvent>(&line) {
            if event.event == "error" {
                last_error = event.message.clone();
                final_status = "error".to_string();
            }
            let _ = window.emit(&event_name, &event);
        }
    }

    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;

    Ok(OpResult {
        success: status.success() && final_status == "ok",
        error: last_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_capability_parses_cli_json() {
        let json = r#"[{"command": "docker.up", "mode": "dev"}, {"command": "server.backup", "mode": "server"}]"#;
        let steps: Vec<StepCapability> = serde_json::from_str(json).unwrap();
        assert_eq!(steps.len(), 2);
        assert_eq!(steps[1].command, "server.backup");
        assert_eq!(steps[1].mode, "server");
    }

    #[test]
    fn inspect_server_mode_playbook() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-inspect");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("server.yaml");
        std::fs::write(
            &path,
            r#"
version: "18"
on_error: stop
description: "Mirror live to test"
env_file: /root/.config/odoodev/mirror.env
targets:
  live:
    db_container: live-db
    db_name: production
  test:
    db_container: test-db
    db_name: production
rpc:
  host: "{{ env.ODOO_URL }}"
vars:
  customer: acme
steps:
  - name: "Create backup"
    command: server.backup
  - command: container.stop
"#,
        )
        .unwrap();

        let details = playbook_inspect(path.to_string_lossy().to_string()).unwrap();
        assert_eq!(details.version, "18");
        assert_eq!(details.description, "Mirror live to test");
        assert_eq!(details.targets, vec!["live", "test"]);
        assert_eq!(
            details.env_file.as_deref(),
            Some("/root/.config/odoodev/mirror.env")
        );
        assert!(details.has_rpc);
        assert_eq!(details.vars, vec!["customer"]);
        assert_eq!(details.step_names, vec!["Create backup", "container.stop"]);
        assert_eq!(
            details.step_commands,
            vec!["server.backup", "container.stop"]
        );

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn inspect_minimal_playbook_defaults() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-inspect");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("minimal.yaml");
        std::fs::write(&path, "version: \"18\"\nsteps:\n  - command: pull\n").unwrap();

        let details = playbook_inspect(path.to_string_lossy().to_string()).unwrap();
        assert!(details.targets.is_empty());
        assert!(details.env_file.is_none());
        assert!(!details.has_rpc);
        assert!(details.vars.is_empty());

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn temp_answers_file_is_private_and_removed() {
        let answers = serde_json::json!({"playbook_type": "dev", "name": "t"});
        let path;
        {
            let tmp = TempAnswersFile::create(&answers).unwrap();
            path = tmp.0.clone();
            assert!(path.exists());
            let content = std::fs::read_to_string(&path).unwrap();
            assert!(content.contains("\"playbook_type\":\"dev\""));
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = std::fs::metadata(&path).unwrap().permissions().mode();
                assert_eq!(mode & 0o777, 0o600);
            }
        }
        assert!(!path.exists(), "answers file must be removed on drop");
    }

    #[test]
    fn temp_answers_file_is_never_overwritten() {
        // create_new: a second create at the same name must fail, not truncate.
        let answers = serde_json::json!({"a": 1});
        let tmp = TempAnswersFile::create(&answers).unwrap();
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        assert!(options.open(&tmp.0).is_err());
    }

    #[test]
    fn playbook_file_check_requires_existing_yaml_file() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-checks");
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("ok.yml");
        std::fs::write(&ok, "a: 1\n").unwrap();
        let txt = dir.join("secrets.txt");
        std::fs::write(&txt, "x").unwrap();
        assert!(check_playbook_file(&ok.to_string_lossy()).is_ok());
        assert!(check_playbook_file(&txt.to_string_lossy()).is_err());
        assert!(check_playbook_file(&dir.join("missing.yaml").to_string_lossy()).is_err());
        assert!(check_playbook_file(&dir.to_string_lossy()).is_err());
        assert!(check_playbook_file("--version.yaml").is_err());
        assert!(playbook_inspect(txt.to_string_lossy().to_string()).is_err());
    }

    /// Fresh scratch dir with a `home` and a `cwd` inside; removed first so reruns are clean.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("odoodev-gui-output-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn check(raw: &str, roots: &[PathBuf], home: &Path, cwd: &Path) -> Result<PathBuf, String> {
        check_playbook_output(raw, roots, home, cwd)
    }

    fn code(r: Result<PathBuf, String>) -> String {
        let e = r.unwrap_err();
        e.strip_prefix("playbook_output:")
            .and_then(|x| x.split(':').next())
            .unwrap_or(&e)
            .to_string()
    }

    #[test]
    fn output_inside_existing_root_and_missing_subdir_is_allowed() {
        let base = scratch("inside");
        let root = base.join("playbooks");
        std::fs::create_dir_all(&root).unwrap();
        let roots = vec![root.clone()];
        let ok = check(
            &root.join("new.yaml").to_string_lossy(),
            &roots,
            &base,
            &base,
        )
        .unwrap();
        assert_eq!(ok, root.join("new.yaml"));
        assert!(check(
            &root.join("new.YML").to_string_lossy(),
            &roots,
            &base,
            &base
        )
        .is_ok());
        // Missing subfolders stay free within the root.
        let deep = root.join("customer/a/new.yaml");
        assert_eq!(
            check(&deep.to_string_lossy(), &roots, &base, &base).unwrap(),
            deep
        );
    }

    #[test]
    fn output_name_and_shape_rules_still_apply() {
        let base = scratch("shape");
        let root = base.join("playbooks");
        std::fs::create_dir_all(&root).unwrap();
        let roots = vec![root.clone()];
        assert_eq!(
            code(check(
                &root.join("x.sh").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "bad_extension"
        );
        assert_eq!(code(check("-o.yaml", &roots, &base, &base)), "flag_like");
        assert_eq!(code(check("  ", &roots, &base, &base)), "empty");
        // An existing directory (even named *.yaml) is not a regular file.
        let dir_named = root.join("dir.yaml");
        std::fs::create_dir_all(&dir_named).unwrap();
        assert_eq!(
            code(check(&dir_named.to_string_lossy(), &roots, &base, &base)),
            "not_a_file"
        );
    }

    #[test]
    fn output_outside_every_root_is_rejected() {
        let base = scratch("outside");
        let root = base.join("playbooks");
        std::fs::create_dir_all(&root).unwrap();
        let other = base.join("other");
        std::fs::create_dir_all(&other).unwrap();
        let roots = vec![root];
        assert_eq!(
            code(check(
                &other.join("x.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        // A sibling whose name merely starts with the root's name is outside too.
        let sibling = base.join("playbooks-evil");
        std::fs::create_dir_all(&sibling).unwrap();
        assert_eq!(
            code(check(
                &sibling.join("x.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        assert_eq!(
            code(check("/etc/x.yaml", &roots, &base, &base)),
            "outside_roots"
        );
        // No roots known at all: nothing is allowed.
        assert_eq!(
            code(check(
                &base.join("x.yaml").to_string_lossy(),
                &[],
                &base,
                &base
            )),
            "outside_roots"
        );
    }

    #[test]
    fn dotdot_escape_through_a_missing_directory_is_rejected() {
        let base = scratch("dotdot");
        let root = base.join("playbooks");
        std::fs::create_dir_all(&root).unwrap();
        let roots = vec![root.clone()];
        let sneaky = format!("{}/missing/../../escape.yaml", root.display());
        assert_eq!(code(check(&sneaky, &roots, &base, &base)), "parent_escape");
        // Even a harmless-looking `..` after a missing directory is refused.
        let harmless = format!("{}/missing/../ok.yaml", root.display());
        assert_eq!(
            code(check(&harmless, &roots, &base, &base)),
            "parent_escape"
        );
        // `..` inside the existing part resolves physically and is judged by its result.
        let up = format!("{}/../outside.yaml", root.display());
        assert_eq!(code(check(&up, &roots, &base, &base)), "outside_roots");
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_directory_pointing_out_of_the_root_is_rejected() {
        let base = scratch("symlink");
        let root = base.join("playbooks");
        let outside = base.join("elsewhere");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let roots = vec![root.clone()];
        // existing target dir behind the link, and a not-yet-existing subdir behind it
        assert_eq!(
            code(check(
                &root.join("link/x.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        assert_eq!(
            code(check(
                &root.join("link/new/x.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        // a symlinked file pointing out is judged by its target
        std::fs::write(outside.join("real.yaml"), "x: 1\n").unwrap();
        std::os::unix::fs::symlink(outside.join("real.yaml"), root.join("file.yaml")).unwrap();
        assert_eq!(
            code(check(
                &root.join("file.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        // a dangling symlink must not be written through
        std::os::unix::fs::symlink(outside.join("nothing.yaml"), root.join("dangling.yaml"))
            .unwrap();
        assert_eq!(
            code(check(
                &root.join("dangling.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "unresolvable"
        );
        // a symlink that stays inside the root is fine
        std::fs::create_dir_all(root.join("real_dir")).unwrap();
        std::os::unix::fs::symlink(root.join("real_dir"), root.join("alias")).unwrap();
        assert!(check(
            &root.join("alias/x.yaml").to_string_lossy(),
            &roots,
            &base,
            &base
        )
        .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn root_behind_a_symlinked_ancestor_still_matches() {
        let base = scratch("rootlink");
        let real = base.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, base.join("proj")).unwrap();
        // The root is configured through the link and does not exist yet.
        let roots = vec![base.join("proj/playbooks")];
        let target = base.join("proj/playbooks/n.yaml");
        assert_eq!(
            check(&target.to_string_lossy(), &roots, &base, &base).unwrap(),
            target
        );
        // The same location reached through its real path is the same place.
        assert!(check(
            &real.join("playbooks/n.yaml").to_string_lossy(),
            &roots,
            &base,
            &base
        )
        .is_ok());
    }

    #[test]
    fn root_that_does_not_exist_yet_is_usable() {
        let base = scratch("missingroot");
        let roots = vec![base.join("fresh/scripts/playbooks")];
        let target = base.join("fresh/scripts/playbooks/n.yaml");
        assert_eq!(
            check(&target.to_string_lossy(), &roots, &base, &base).unwrap(),
            target
        );
        assert_eq!(
            code(check(
                &base.join("fresh/scripts/n.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        assert_eq!(
            code(check(
                &base.join("fresh/n.yaml").to_string_lossy(),
                &roots,
                &base,
                &base
            )),
            "outside_roots"
        );
    }

    #[test]
    fn tilde_is_expanded_and_relative_paths_use_the_cwd() {
        let base = scratch("tilde");
        let home = base.join("home");
        let cwd = base.join("work");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(&cwd).unwrap();
        let roots = vec![home.join("pb"), cwd.join("playbooks")];
        assert_eq!(
            check("~/pb/a.yaml", &roots, &home, &cwd).unwrap(),
            home.join("pb/a.yaml")
        );
        assert_eq!(
            check("playbooks/b.yaml", &roots, &home, &cwd).unwrap(),
            cwd.join("playbooks/b.yaml")
        );
        assert_eq!(
            check("./playbooks/c.yaml", &roots, &home, &cwd).unwrap(),
            cwd.join("./playbooks/c.yaml")
        );
        // `~` alone is the home dir itself, `~user` cannot be mirrored
        assert_eq!(code(check("~", &roots, &home, &cwd)), "bad_extension");
        assert_eq!(
            code(check("~other/pb/a.yaml", &roots, &home, &cwd)),
            "bad_tilde"
        );
        assert_eq!(
            code(check("~/other/a.yaml", &roots, &home, &cwd)),
            "outside_roots"
        );
        // The path handed to the CLI is absolute and has no tilde left.
        let handed = check("~/pb/a.yaml", &roots, &home, &cwd).unwrap();
        assert!(handed.is_absolute() && !handed.to_string_lossy().contains('~'));
    }

    const SECRET: &str = "s3cr3t-marker-value";

    fn env_answers(path: &str, generate: bool) -> serde_json::Value {
        serde_json::json!({
            "name": "demo",
            "env_file": { "generate": generate, "path": path, "secrets": { "API_KEY": SECRET } }
        })
    }

    fn env_code(r: Result<(), String>) -> String {
        let e = r.unwrap_err();
        assert!(!e.contains(SECRET), "secret leaked into error: {e}");
        e.strip_prefix("playbook_env_file:")
            .and_then(|x| x.split(':').next())
            .unwrap_or(&e)
            .to_string()
    }

    #[test]
    fn env_file_inside_a_root_is_checked_and_rewritten_to_absolute() {
        let base = scratch("env-inside");
        let root = base.join("playbooks");
        let roots = vec![root.clone()];
        // missing directory is fine, the CLI creates it
        let mut a = env_answers(&root.join("sub/demo.env").to_string_lossy(), true);
        check_env_file_answers(&mut a, &roots, &base, &base).unwrap();
        assert_eq!(
            a["env_file"]["path"],
            root.join("sub/demo.env").to_string_lossy().as_ref()
        );
        // relative path and `~` become absolute, secrets stay untouched
        let mut rel = env_answers("playbooks/demo.env", true);
        check_env_file_answers(&mut rel, &roots, &base, &base).unwrap();
        assert_eq!(
            rel["env_file"]["path"],
            root.join("demo.env").to_string_lossy().as_ref()
        );
        assert_eq!(rel["env_file"]["secrets"]["API_KEY"], SECRET);
        let mut tilde = env_answers("~/playbooks/demo.env", true);
        check_env_file_answers(&mut tilde, &roots, &base, &base).unwrap();
        assert_eq!(
            tilde["env_file"]["path"],
            root.join("demo.env").to_string_lossy().as_ref()
        );
    }

    #[test]
    fn env_file_outside_or_escaping_is_rejected() {
        let base = scratch("env-outside");
        let root = base.join("playbooks");
        std::fs::create_dir_all(&root).unwrap();
        let roots = vec![root.clone()];
        let mut out = env_answers(&base.join("elsewhere/demo.env").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut out, &roots, &base, &base)),
            "outside_roots"
        );
        let mut dd = env_answers(&format!("{}/missing/../../x.env", root.display()), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut dd, &roots, &base, &base)),
            "parent_escape"
        );
        let mut name = env_answers(&root.join("authorized_keys").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut name, &roots, &base, &base)),
            "bad_extension"
        );
        let mut yaml = env_answers(&root.join("demo.yaml").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut yaml, &roots, &base, &base)),
            "bad_extension"
        );
        let mut dash = env_answers("-x.env", true);
        assert_eq!(
            env_code(check_env_file_answers(&mut dash, &roots, &base, &base)),
            "flag_like"
        );
        let mut dir = env_answers(
            &root
                .to_string_lossy()
                .replace("playbooks", "playbooks/d.env"),
            true,
        );
        std::fs::create_dir_all(root.join("d.env")).unwrap();
        assert_eq!(
            env_code(check_env_file_answers(&mut dir, &roots, &base, &base)),
            "not_a_file"
        );
    }

    #[cfg(unix)]
    #[test]
    fn env_file_symlink_escape_and_dangling_link_are_rejected() {
        let base = scratch("env-symlink");
        let root = base.join("playbooks");
        let outside = base.join("elsewhere");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        std::os::unix::fs::symlink(outside.join("nothing.env"), root.join("dangling.env")).unwrap();
        let roots = vec![root.clone()];
        let mut a = env_answers(&root.join("link/new/demo.env").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut a, &roots, &base, &base)),
            "outside_roots"
        );
        let mut b = env_answers(&root.join("dangling.env").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut b, &roots, &base, &base)),
            "unresolvable"
        );
    }

    #[test]
    fn env_file_dirs_append_the_config_dir_once() {
        let pb = vec![PathBuf::from("/work/v18/scripts/playbooks")];
        let dirs = super::super::editor::env_file_dirs(&pb);
        assert_eq!(dirs[0], pb[0]);
        assert_eq!(dirs.last().unwrap(), &super::super::editor::config_dir());
        assert_eq!(super::super::editor::env_file_dirs(&dirs), dirs);
    }

    #[test]
    fn env_file_in_the_config_dir_is_allowed_but_the_playbook_is_not() {
        let base = scratch("env-config");
        let pb = base.join("playbooks");
        let cfg = base.join("home/.config/odoodev"); // does not exist yet
        let env_roots = vec![pb.clone(), cfg.clone()];
        let pb_roots = vec![pb.clone()];
        // missing config dir, plain file and subdirectory
        for rel in ["server.env", "secrets/server.env"] {
            let mut a = env_answers(&cfg.join(rel).to_string_lossy(), true);
            check_env_file_answers(&mut a, &env_roots, &base, &base).unwrap();
            assert_eq!(
                a["env_file"]["path"],
                cfg.join(rel).to_string_lossy().as_ref()
            );
        }
        // existing dir and `~` form (home = base/home)
        std::fs::create_dir_all(&cfg).unwrap();
        let mut tilde = env_answers("~/.config/odoodev/x.env", true);
        check_env_file_answers(&mut tilde, &env_roots, &base.join("home"), &base).unwrap();
        assert_eq!(
            tilde["env_file"]["path"],
            cfg.join("x.env").to_string_lossy().as_ref()
        );
        // name rule still applies there
        let mut cfgyaml = env_answers(&cfg.join("config.yaml").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(
                &mut cfgyaml,
                &env_roots,
                &base,
                &base
            )),
            "bad_extension"
        );
        // the playbook output path must not use the config dir
        assert_eq!(
            code(check(
                &cfg.join("p.yaml").to_string_lossy(),
                &pb_roots,
                &base,
                &base
            )),
            "outside_roots"
        );
        // and the env file is rejected there when the config dir is not offered
        let mut no_cfg = env_answers(&cfg.join("x.env").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut no_cfg, &pb_roots, &base, &base)),
            "outside_roots"
        );
    }

    #[cfg(unix)]
    #[test]
    fn env_file_symlink_out_of_the_config_dir_is_rejected() {
        let base = scratch("env-config-link");
        let cfg = base.join("home/.config/odoodev");
        let outside = base.join("elsewhere");
        std::fs::create_dir_all(&cfg).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, cfg.join("link")).unwrap();
        std::os::unix::fs::symlink(outside.join("n.env"), cfg.join("dangling.env")).unwrap();
        let roots = vec![cfg.clone()];
        let mut a = env_answers(&cfg.join("link/new/s.env").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut a, &roots, &base, &base)),
            "outside_roots"
        );
        let mut b = env_answers(&cfg.join("dangling.env").to_string_lossy(), true);
        assert_eq!(
            env_code(check_env_file_answers(&mut b, &roots, &base, &base)),
            "unresolvable"
        );
    }

    #[test]
    fn answers_without_a_file_to_write_pass_untouched() {
        let base = scratch("env-none");
        let roots = vec![base.join("playbooks")];
        for answers in [
            serde_json::json!({ "name": "demo" }),
            serde_json::json!({ "name": "demo", "env_file": null }),
            // generate=false: the CLI only records the path in the playbook
            env_answers("/etc/outside.env", false),
            // generate=true without a path: the CLI rejects it, nothing is written
            serde_json::json!({ "env_file": { "generate": true, "secrets": { "K": SECRET } } }),
            serde_json::json!({ "env_file": { "generate": true, "path": "  " } }),
        ] {
            let mut a = answers.clone();
            check_env_file_answers(&mut a, &roots, &base, &base).unwrap();
            assert_eq!(a, answers);
        }
    }

    #[test]
    fn malformed_answers_give_a_clear_error_without_panicking_or_leaking() {
        let base = scratch("env-malformed");
        let roots = vec![base.join("playbooks")];
        for answers in [
            serde_json::json!("just a string"),
            serde_json::json!([1, 2]),
            serde_json::json!({ "env_file": "path.env" }),
            serde_json::json!({ "env_file": { "generate": "yes", "path": "a.env", "secrets": { "K": SECRET } } }),
            serde_json::json!({ "env_file": { "generate": true, "path": 7, "secrets": { "K": SECRET } } }),
        ] {
            let mut a = answers.clone();
            assert_eq!(
                env_code(check_env_file_answers(&mut a, &roots, &base, &base)),
                "malformed"
            );
        }
    }

    #[test]
    fn inspect_rejects_invalid_yaml() {
        let dir = std::env::temp_dir().join("odoodev-gui-test-inspect");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("broken.yaml");
        std::fs::write(&path, "steps:\n  - command: [unclosed\n").unwrap();

        assert!(playbook_inspect(path.to_string_lossy().to_string()).is_err());
        std::fs::remove_file(&path).ok();
    }
}
