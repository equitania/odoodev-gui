use crate::models::ExportModulesResult;
use crate::odoodev;

/// Scopes accepted by `odoodev export modules --scope`.
const SCOPES: [&str; 3] = ["all", "no-enterprise", "installed"];

/// Build the argument list for `odoodev export modules`.
///
/// `-d` and `--json` are always sent: the GUI runs the CLI with stdin closed,
/// so without `-d` the CLI exits 2, and `--json` implies `--yes` and gives
/// exactly one result line on stdout. `--output` is deliberately never passed
/// (the CLI writes to `~/Downloads` and reports the path), and no credentials
/// ever appear on the command line.
///
/// `--via-shell` (0.76.0+) and `--via-rpc` (0.77.0+) exclude each other in the
/// CLI (usage error), so both set is rejected by the caller before this runs.
fn build_export_args(
    version: &str,
    database: &str,
    scope: &str,
    update_list: bool,
    cleanup: bool,
    via_shell: bool,
    via_rpc: bool,
) -> Vec<String> {
    let mut args: Vec<String> = ["export", "modules", version, "-d", database]
        .iter()
        .map(|s| s.to_string())
        .collect();
    args.push("--scope".to_string());
    args.push(scope.to_string());
    if update_list {
        args.push("--update-list".to_string());
    }
    if cleanup {
        args.push("--cleanup".to_string());
    }
    if via_shell {
        args.push("--via-shell".to_string());
    }
    if via_rpc {
        args.push("--via-rpc".to_string());
    }
    args.push("--json".to_string());
    args
}

/// Pick the line that explains a failed export.
///
/// The CLI prints `[ERROR] Module export failed: …` to stderr, followed by
/// `[INFO]` hint lines ("Is Odoo running?", "No usable Odoo login? Without
/// --via-rpc/--user/--host the export needs none (odoo-bin shell)" since 0.77.0). Taking
/// the last line would show only a hint, so prefer the first `[ERROR]` line
/// (prefix stripped) and fall back to the last non-empty line.
fn pick_export_error(stderr: &str, stdout: &str, code: i32) -> String {
    for text in [stderr, stdout] {
        if let Some(line) = text.lines().find(|l| l.contains("[ERROR]")) {
            let msg = line.trim().replacen("[ERROR]", "", 1);
            let msg = msg.trim();
            if !msg.is_empty() {
                return msg.to_string();
            }
        }
    }
    for text in [stderr, stdout] {
        if let Some(line) = text.lines().rev().find(|l| !l.trim().is_empty()) {
            return line.trim().to_string();
        }
    }
    format!("odoodev export modules failed (exit {code}) without any output")
}

/// Export the module list of a database as CSV (`odoodev export modules`).
///
/// Errors carry the CLI's own failure reason. `via_shell` needs odoodev
/// >= 0.76.0 and `via_rpc` >= 0.77.0 — the frontend gates both by version.
/// The two exclude each other.
#[tauri::command]
pub async fn export_modules(
    version: String,
    database: String,
    scope: String,
    update_list: bool,
    cleanup: bool,
    via_shell: bool,
    via_rpc: bool,
) -> Result<ExportModulesResult, String> {
    odoodev::validate_version("version", &version)?;
    odoodev::validate_name("database", &database)?;
    if !SCOPES.contains(&scope.as_str()) {
        return Err(format!(
            "Invalid scope: expected one of {}",
            SCOPES.join(", ")
        ));
    }
    if via_shell && via_rpc {
        return Err("via_shell and via_rpc exclude each other".to_string());
    }
    let args = build_export_args(
        &version,
        &database,
        &scope,
        update_list,
        cleanup,
        via_shell,
        via_rpc,
    );
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = odoodev::build_odoodev_command(&refs)
        .output()
        .await
        .map_err(|e| format!("Failed to execute odoodev: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        return Err(pick_export_error(
            &stderr,
            &stdout,
            output.status.code().unwrap_or(-1),
        ));
    }
    // With --json stdout is one JSON line; tolerate stray lines before it.
    let line = stdout
        .lines()
        .rev()
        .find(|l| l.trim_start().starts_with('{'))
        .unwrap_or("");
    serde_json::from_str::<ExportModulesResult>(line.trim()).map_err(|e| {
        format!(
            "Failed to parse export result: {e}. Output: {}",
            stdout.trim()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::{build_export_args, pick_export_error};

    fn args(scope: &str, update: bool, cleanup: bool, shell: bool) -> Vec<String> {
        build_export_args("18", "v18_exam", scope, update, cleanup, shell, false)
    }

    fn args_rpc(rpc: bool, shell: bool) -> Vec<String> {
        build_export_args("18", "v18_exam", "all", false, false, shell, rpc)
    }

    #[test]
    fn always_sends_database_and_json_and_never_output() {
        for scope in ["all", "no-enterprise", "installed"] {
            for bits in 0..8u8 {
                let a = args(scope, bits & 1 != 0, bits & 2 != 0, bits & 4 != 0);
                assert_eq!(&a[..5], ["export", "modules", "18", "-d", "v18_exam"]);
                assert!(a.contains(&"--json".to_string()));
                assert!(!a.contains(&"--output".to_string()));
                let i = a.iter().position(|x| x == "--scope").unwrap();
                assert_eq!(a[i + 1], scope);
            }
        }
    }

    #[test]
    fn each_boolean_maps_to_its_flag() {
        let off = args("all", false, false, false);
        for flag in ["--update-list", "--cleanup", "--via-shell", "--via-rpc"] {
            assert!(!off.contains(&flag.to_string()), "{flag} must be absent");
        }
        assert!(args("all", true, false, false).contains(&"--update-list".to_string()));
        assert!(!args("all", true, false, false).contains(&"--cleanup".to_string()));
        assert!(args("all", false, true, false).contains(&"--cleanup".to_string()));
        assert!(!args("all", false, true, false).contains(&"--via-shell".to_string()));
        assert!(args("all", false, false, true).contains(&"--via-shell".to_string()));
        assert!(!args("all", false, false, true).contains(&"--update-list".to_string()));
    }

    #[test]
    fn transport_flags_map_independently() {
        let none = args_rpc(false, false);
        assert!(!none.contains(&"--via-shell".to_string()));
        assert!(!none.contains(&"--via-rpc".to_string()));
        let shell = args_rpc(false, true);
        assert!(shell.contains(&"--via-shell".to_string()));
        assert!(!shell.contains(&"--via-rpc".to_string()));
        let rpc = args_rpc(true, false);
        assert!(rpc.contains(&"--via-rpc".to_string()));
        assert!(!rpc.contains(&"--via-shell".to_string()));
        // --json stays last
        assert_eq!(rpc.last().unwrap(), "--json");
    }

    #[test]
    fn error_prefers_the_real_reason_with_the_0_77_hint_wording() {
        let stderr = "[ERROR] Module export failed: Connection refused\n\
                      [INFO] Is Odoo v18 running? Start it with: odoodev start 18\n\
                      [INFO] No usable Odoo login? Without --via-rpc/--user/--host the export needs none (odoo-bin shell)\n";
        assert_eq!(
            pick_export_error(stderr, "", 1),
            "Module export failed: Connection refused"
        );
    }

    #[test]
    fn error_prefers_the_real_reason_over_trailing_hints() {
        let stderr = "[ERROR] Module export failed: Connection refused\n\
                      [INFO] Is Odoo v18 running? Start it with: odoodev start 18\n\
                      [INFO] No usable Odoo login? Retry with --via-shell\n";
        assert_eq!(
            pick_export_error(stderr, "", 1),
            "Module export failed: Connection refused"
        );
    }

    #[test]
    fn error_falls_back_to_last_line_then_exit_code() {
        assert_eq!(pick_export_error("boom\n\n", "", 2), "boom");
        assert_eq!(
            pick_export_error("", "[ERROR] from stdout", 1),
            "from stdout"
        );
        assert!(pick_export_error("", "", 7).contains("exit 7"));
    }
}
