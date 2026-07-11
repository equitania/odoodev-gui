use crate::models::{MigrationGroup, MigrationStatus, OpResult};
use crate::odoodev;

fn parse_table_row(line: &str) -> Option<Vec<String>> {
    let trimmed = line.trim();
    if !trimmed.starts_with('│') {
        return None;
    }
    let parts: Vec<&str> = trimmed.split('│').collect();
    if parts.len() < 3 {
        return None;
    }
    let cells: Vec<String> = parts
        .iter()
        .skip(1)
        .take(parts.len() - 2)
        .map(|s| s.trim().to_string())
        .collect();
    if cells.is_empty() {
        return None;
    }
    Some(cells)
}

#[tauri::command]
pub async fn migrate_list() -> Result<Vec<MigrationGroup>, String> {
    let text = odoodev::run_odoodev_text(&["migrate", "list"]).await?;
    let mut groups = Vec::new();

    for line in text.lines() {
        if let Some(cells) = parse_table_row(line) {
            if cells.len() >= 6 && cells[0] != "Name" {
                groups.push(MigrationGroup {
                    name: cells[0].clone(),
                    from_version: cells[1].trim_start_matches('v').to_string(),
                    to_version: cells[2].trim_start_matches('v').to_string(),
                    postgres: cells[3].clone(),
                    shared_port: cells[4].parse().unwrap_or(0),
                    status: cells[5].clone(),
                });
            }
        }
    }

    Ok(groups)
}

#[tauri::command]
pub async fn migrate_status() -> Result<MigrationStatus, String> {
    let text = odoodev::run_odoodev_text(&["migrate", "status"]).await?;
    let active = text.contains("[ACTIVE]");
    let no_active = text.contains("No migration group is currently active");

    let mut group_name = None;
    let mut source = None;
    let mut target = None;
    let mut shared_port: Option<u16> = None;
    let mut filestore = None;

    for line in text.lines() {
        let l = line.trim();
        if l.contains("Available groups:") {
            let rest = l.split("Available groups:").nth(1).unwrap_or("").trim();
            if !rest.is_empty() {
                group_name = Some(rest.to_string());
            }
        }
        if l.starts_with("│") && l.contains("Source") {
            if let Some(val) = l.split("│").nth(2) {
                source = Some(val.trim().to_string());
            }
        }
        if l.starts_with("│") && l.contains("Target") {
            if let Some(val) = l.split("│").nth(2) {
                target = Some(val.trim().to_string());
            }
        }
        if l.starts_with("│") && l.contains("Shared DB Port") {
            if let Some(val) = l.split("│").nth(2) {
                shared_port = val.trim().parse::<u16>().ok();
            }
        }
        if l.starts_with("│") && l.contains("Shared Filestore") {
            if let Some(val) = l.split("│").nth(2) {
                let parts: Vec<&str> = val.split('(').collect();
                filestore = Some(parts[0].trim().to_string());
            }
        }
    }

    if active {
        for line in text.lines() {
            let l = line.trim();
            if l.contains("Migration:") && l.contains("[ACTIVE]") {
                let between = l.split("Migration:").nth(1).unwrap_or("");
                let name = between.split("[ACTIVE]").next().unwrap_or("").trim();
                if !name.is_empty() {
                    group_name = Some(name.to_string());
                }
            }
        }
    }

    Ok(MigrationStatus {
        active,
        no_active,
        group_name,
        source,
        target,
        shared_port,
        filestore,
    })
}

#[tauri::command]
pub async fn migrate_create(
    from: String,
    to: String,
    name: Option<String>,
    pg_version: Option<String>,
) -> Result<OpResult, String> {
    let mut args = vec!["migrate".to_string(), "create".to_string()];
    args.push("--from".to_string());
    args.push(from);
    args.push("--to".to_string());
    args.push(to);
    if let Some(n) = name {
        args.push("--name".to_string());
        args.push(n);
    }
    if let Some(pg) = pg_version {
        args.push("--pg-version".to_string());
        args.push(pg);
    }
    match odoodev::run_odoodev_text(&args.iter().map(|s| s.as_str()).collect::<Vec<_>>()).await {
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
pub async fn migrate_activate(name: String) -> Result<OpResult, String> {
    match odoodev::run_odoodev_text(&["migrate", "activate", &name]).await {
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
pub async fn migrate_deactivate() -> Result<OpResult, String> {
    match odoodev::run_odoodev_text(&["migrate", "deactivate"]).await {
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
pub async fn migrate_remove(name: String) -> Result<OpResult, String> {
    match odoodev::run_odoodev_text(&["migrate", "remove", &name, "-y"]).await {
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
