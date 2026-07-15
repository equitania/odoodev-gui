use serde::Deserialize;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::{BackupResult, DbListResponse, OpResult, RestoreResult};
use crate::odoodev;

#[tauri::command]
pub async fn get_databases(version: String) -> Result<DbListResponse, String> {
    let val = odoodev::run_odoodev_json(&["db", "list", &version, "--json"]).await?;
    let resp: DbListResponse =
        serde_json::from_value(val).map_err(|e| format!("Failed to parse db list: {e}"))?;
    Ok(resp)
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackupArgs {
    pub version: String,
    pub name: String,
    #[serde(rename = "type")]
    pub backup_type: String, // "sql" | "zip" | "tar.zst"
    pub output_dir: Option<String>,
    pub level: Option<u8>,
}

#[tauri::command]
pub async fn backup_db(args: BackupArgs, window: tauri::Window) -> Result<BackupResult, String> {
    odoodev::reject_flag_like("version", &args.version)?;
    odoodev::reject_flag_like("name", &args.name)?;
    if let Some(dir) = &args.output_dir {
        if !dir.is_empty() {
            odoodev::reject_flag_like("output_dir", dir)?;
        }
    }
    let mut cli: Vec<String> = vec![
        "db".into(),
        "backup".into(),
        args.version.clone(),
        "-n".into(),
        args.name.clone(),
        "-t".into(),
        args.backup_type.clone(),
    ];
    if let Some(dir) = &args.output_dir {
        if !dir.is_empty() {
            cli.push("-o".into());
            cli.push(dir.clone());
        }
    }
    if let Some(lvl) = args.level {
        cli.push("-l".into());
        cli.push(lvl.to_string());
    }
    let refs: Vec<&str> = cli.iter().map(|s| s.as_str()).collect();

    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn backup: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let win_err = window.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit("backup-progress", &line);
        }
    });

    let mut last_line = String::new();
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = window.emit("backup-progress", &line);
        last_line = line;
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;

    if status.success() {
        let (path, size) = parse_backup_summary(&last_line);
        Ok(BackupResult {
            success: true,
            path,
            size,
            error: None,
        })
    } else {
        Ok(BackupResult {
            success: false,
            path: None,
            size: None,
            error: Some(last_line),
        })
    }
}

fn parse_backup_summary(line: &str) -> (Option<String>, Option<String>) {
    // "[OK] Backup saved: ~/Downloads/v18_exam_250710.zip (45.2 MB)"
    if let Some(idx) = line.find("Backup saved:") {
        let rest = &line[idx..];
        if let Some(colon) = rest.find(':') {
            let after = rest[colon + 1..].trim();
            if let Some(paren) = after.rfind('(') {
                let path = after[..paren].trim().to_string();
                let size = after[paren..]
                    .trim_matches(|c| c == '(' || c == ')')
                    .to_string();
                return (Some(path), Some(size));
            }
            return (Some(after.to_string()), None);
        }
    }
    (None, None)
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct RestoreArgs {
    pub version: String,
    pub name: String,
    pub backup_file: String,
    pub drop: Option<bool>,
    pub deactivate_cron: Option<bool>,
    pub neutralize: Option<bool>,
    pub anonymize: Option<bool>,
    pub wipe: Option<bool>,
    pub purge_master_data: Option<bool>,
    pub no_purge_master_data: Option<bool>,
    pub purge_transactions: Option<bool>,
    pub anonymize_users: Option<bool>,
    pub user_password: Option<String>,
    pub uninstall_modules: Option<String>,
    pub recompute: Option<bool>,
    pub keep_temp: Option<bool>,
    pub check_space: Option<bool>,
    pub delete_backup: Option<bool>,
    pub dry_run: Option<bool>,
}

#[tauri::command]
pub async fn restore_db(args: RestoreArgs, window: tauri::Window) -> Result<RestoreResult, String> {
    odoodev::reject_flag_like("version", &args.version)?;
    odoodev::reject_flag_like("name", &args.name)?;
    odoodev::reject_flag_like("backup_file", &args.backup_file)?;
    if let Some(m) = &args.uninstall_modules {
        if !m.is_empty() {
            odoodev::reject_flag_like("uninstall_modules", m)?;
        }
    }
    let mut cli: Vec<String> = vec![
        "db".into(),
        "restore".into(),
        args.version.clone(),
        "-n".into(),
        args.name.clone(),
        "-z".into(),
        args.backup_file.clone(),
    ];
    // The CLI's --drop/--no-drop pair defaults to --drop (overwrite!), so an
    // unchecked GUI checkbox must be forwarded explicitly as --no-drop.
    match args.drop {
        Some(true) => cli.push("--drop".into()),
        Some(false) => cli.push("--no-drop".into()),
        None => {}
    }
    if args.deactivate_cron.unwrap_or(false) {
        cli.push("--deactivate-cron".into());
    }
    if args.neutralize.unwrap_or(false) {
        cli.push("--neutralize".into());
    }
    if args.anonymize.unwrap_or(false) {
        cli.push("--anonymize".into());
    }
    if args.wipe.unwrap_or(false) {
        cli.push("--wipe".into());
    }
    if args.purge_master_data.unwrap_or(false) {
        cli.push("--purge-master-data".into());
    }
    if args.no_purge_master_data.unwrap_or(false) {
        cli.push("--no-purge-master-data".into());
    }
    if args.purge_transactions.unwrap_or(false) {
        cli.push("--purge-transactions".into());
    }
    if args.anonymize_users.unwrap_or(false) {
        cli.push("--anonymize-users".into());
    }
    if let Some(pw) = &args.user_password {
        if !pw.is_empty() {
            cli.push("--user-password".into());
            cli.push(pw.clone());
        }
    }
    if let Some(m) = &args.uninstall_modules {
        if !m.is_empty() {
            cli.push("--uninstall-modules".into());
            cli.push(m.clone());
        }
    }
    if args.recompute.unwrap_or(false) {
        cli.push("--recompute".into());
    }
    if args.keep_temp.unwrap_or(false) {
        cli.push("--keep-temp".into());
    }
    if let Some(cs) = args.check_space {
        if cs {
            cli.push("--check-space".into());
        } else {
            cli.push("--no-check-space".into());
        }
    }
    if args.delete_backup.unwrap_or(false) {
        cli.push("--delete-backup".into());
    } else {
        cli.push("--keep-backup".into());
    }
    if args.dry_run.unwrap_or(false) {
        cli.push("--dry-run".into());
    }
    cli.push("-y".into());

    let refs: Vec<&str> = cli.iter().map(|s| s.as_str()).collect();
    let mut cmd = Command::new(odoodev::find_odoodev());
    cmd.args(&refs);
    odoodev::augment_path(&mut cmd);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn restore: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let win_err = window.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = win_err.emit("restore-progress", &line);
        }
    });

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();
    let mut last_line = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        let _ = window.emit("restore-progress", &line);
        last_line = line;
    }
    let status = child.wait().await.map_err(|e| format!("wait: {e}"))?;

    if status.success() {
        Ok(RestoreResult {
            success: true,
            error: None,
        })
    } else {
        Ok(RestoreResult {
            success: false,
            error: Some(last_line),
        })
    }
}

#[tauri::command]
pub async fn drop_db(
    version: String,
    name: String,
    terminate_connections: Option<bool>,
) -> Result<OpResult, String> {
    for (f, v) in [("version", &version), ("name", &name)] {
        if let Err(e) = odoodev::reject_flag_like(f, v) {
            return Ok(OpResult {
                success: false,
                error: Some(e),
            });
        }
    }
    let mut args = vec!["db", "drop", &version, "-n", &name, "-y"];
    if terminate_connections.unwrap_or(false) {
        args.push("--terminate-connections");
    }
    match odoodev::run_odoodev_text(&args).await {
        Ok(_) => Ok(OpResult {
            success: true,
            error: None,
        }),
        Err(e) => Ok(OpResult {
            success: false,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn copy_db(
    version: String,
    src: String,
    dst: String,
    terminate_connections: Option<bool>,
) -> Result<OpResult, String> {
    for (f, v) in [("version", &version), ("src", &src), ("dst", &dst)] {
        if let Err(e) = odoodev::reject_flag_like(f, v) {
            return Ok(OpResult {
                success: false,
                error: Some(e),
            });
        }
    }
    // `db copy` duplicates the database AND its filestore (CLI-side).
    let mut args = vec!["db", "copy", &version, "-s", &src, "-d", &dst, "-y"];
    if terminate_connections.unwrap_or(false) {
        args.push("--terminate-connections");
    }
    match odoodev::run_odoodev_text(&args).await {
        Ok(_) => Ok(OpResult {
            success: true,
            error: None,
        }),
        Err(e) => Ok(OpResult {
            success: false,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn rename_db(
    version: String,
    src: String,
    dst: String,
    terminate_connections: Option<bool>,
) -> Result<OpResult, String> {
    for (f, v) in [("version", &version), ("src", &src), ("dst", &dst)] {
        if let Err(e) = odoodev::reject_flag_like(f, v) {
            return Ok(OpResult {
                success: false,
                error: Some(e),
            });
        }
    }
    // `db rename` also moves the filestore (CLI-side).
    let mut args = vec!["db", "rename", &version, "-s", &src, "-d", &dst, "-y"];
    if terminate_connections.unwrap_or(false) {
        args.push("--terminate-connections");
    }
    match odoodev::run_odoodev_text(&args).await {
        Ok(_) => Ok(OpResult {
            success: true,
            error: None,
        }),
        Err(e) => Ok(OpResult {
            success: false,
            error: Some(e),
        }),
    }
}
