use crate::models::{DoctorCheck, DoctorResult};
use crate::odoodev;

fn parse_detail_line(line: &str) -> Option<DoctorCheck> {
    let trimmed = line.trim();
    if trimmed.starts_with("[OK]") {
        let message = trimmed[4..].trim().to_string();
        Some(DoctorCheck {
            name: extract_check_name(&message),
            status: "ok".to_string(),
            message,
        })
    } else if trimmed.starts_with("[FAIL]") || trimmed.starts_with("[ERROR]") {
        let message = trimmed
            .trim_start_matches("[FAIL]")
            .trim_start_matches("[ERROR]")
            .trim()
            .to_string();
        Some(DoctorCheck {
            name: extract_check_name(&message),
            status: "fail".to_string(),
            message,
        })
    } else if trimmed.starts_with("[WARN]") {
        let message = trimmed[6..].trim().to_string();
        Some(DoctorCheck {
            name: extract_check_name(&message),
            status: "warn".to_string(),
            message,
        })
    } else {
        None
    }
}

fn extract_check_name(message: &str) -> String {
    let lower = message.to_lowercase();
    if lower.contains("uv") {
        "uv".to_string()
    } else if lower.contains("apple container") {
        "apple_container".to_string()
    } else if lower.contains("docker") {
        "docker".to_string()
    } else if lower.contains("wkhtmltopdf") {
        "wkhtmltopdf".to_string()
    } else if lower.contains("postgresql tools") || lower.contains("pg_tools") {
        "pg_tools".to_string()
    } else if lower.contains("postgresql accessible") || lower.contains("postgres") {
        "postgres".to_string()
    } else if lower.contains("node.js") || lower.contains("node") {
        if lower.contains("packages") {
            "node_packages".to_string()
        } else {
            "node".to_string()
        }
    } else if lower.contains("system libraries") || lower.contains("system_libs") {
        "system_libs".to_string()
    } else if lower.contains("7-zip") || lower.contains("7zip") {
        "7zip".to_string()
    } else if lower.contains("zstd") {
        "zstd".to_string()
    } else if lower.contains("python packages") || lower.contains("python_packages") {
        "python_packages".to_string()
    } else if lower.contains("pypi") {
        "pypi".to_string()
    } else {
        message.split_whitespace().next().unwrap_or("unknown").to_string()
    }
}

#[tauri::command]
pub async fn doctor_run(version: Option<String>) -> Result<DoctorResult, String> {
    let args: Vec<&str> = match &version {
        Some(v) => vec!["doctor", v],
        None => vec!["doctor"],
    };

    let text = odoodev::run_odoodev_text(&args).await?;
    let mut checks = Vec::new();
    let mut raw_output = String::new();

    for line in text.lines() {
        raw_output.push_str(line);
        raw_output.push('\n');
        if let Some(check) = parse_detail_line(line) {
            checks.push(check);
        }
    }

    let all_ok = checks.iter().all(|c| c.status == "ok");
    let has_fail = checks.iter().any(|c| c.status == "fail");
    let has_warn = checks.iter().any(|c| c.status == "warn");

    let overall = if has_fail {
        "fail"
    } else if has_warn {
        "warn"
    } else {
        "ok"
    };

    Ok(DoctorResult {
        version: version.clone(),
        checks,
        overall: overall.to_string(),
        all_ok,
        raw_output,
    })
}

#[tauri::command]
pub async fn doctor_all_versions() -> Result<Vec<DoctorResult>, String> {
    let versions_val = odoodev::run_odoodev_json(&["config", "versions", "--json"]).await?;
    let versions: std::collections::HashMap<String, serde_json::Value> =
        serde_json::from_value(versions_val)
            .map_err(|e| format!("Failed to parse versions: {e}"))?;

    let mut results = Vec::new();
    for ver in versions.keys() {
        match doctor_run(Some(ver.clone())).await {
            Ok(r) => results.push(r),
            Err(e) => {
                results.push(DoctorResult {
                    version: Some(ver.clone()),
                    checks: vec![],
                    overall: "fail".to_string(),
                    all_ok: false,
                    raw_output: e,
                });
            }
        }
    }
    Ok(results)
}

#[tauri::command]
pub async fn doctor_general() -> Result<DoctorResult, String> {
    doctor_run(None).await
}