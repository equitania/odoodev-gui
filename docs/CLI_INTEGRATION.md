# CLI Integration Matrix — odoodev-gui ↔ odoodev

> Complete reference of how the GUI communicates with the `odoodev` CLI.
> Every integration point, its JSON format, parsing strategy, and edge cases.

---

## Integration Channels

| Channel | Description | Used For |
|---------|-------------|----------|
| **JSON (serde)** | Execute CLI, parse stdout as single JSON object | Structured data queries |
| **NDJSON stream** | Execute CLI, parse stdout line-by-line as JSON objects | Playbook execution |
| **stdout streaming** | Execute CLI, forward stdout lines as Tauri events | Server logs, backup/restore progress |
| **Exit code** | Execute CLI, check return code only | Destructive operations |
| **Direct (Rust)** | Bypass CLI, query system directly | Docker status check |
| **HTTP** | reqwest to PyPI API | Version comparison |

---

## JSON Integration Points

### 1. `odoodev config versions --json`

**Purpose:** Get all Odoo version configurations for the dashboard.

**CLI Command:**
```bash
odoodev config versions --json
```

**Output Format (verified):**
```json
{
  "16": {
    "python": "3.12",
    "postgres": "16.11-alpine",
    "ports": {
      "db": 16432,
      "odoo": 16069,
      "gevent": 16072,
      "mailpit": 16025
    },
    "base": "~/gitbase/v16"
  },
  "17": {
    "python": "3.12",
    "postgres": "16.11-alpine",
    "ports": {
      "db": 17432,
      "odoo": 17069,
      "gevent": 17072,
      "mailpit": 17025
    },
    "base": "~/gitbase/v17"
  },
  "18": {
    "python": "3.13",
    "postgres": "16.11-alpine",
    "ports": {
      "db": 18432,
      "odoo": 18069,
      "gevent": 18072,
      "mailpit": 18025
    },
    "base": "~/gitbase/v18"
  },
  "19": {
    "python": "3.13",
    "postgres": "17.4-alpine",
    "ports": {
      "db": 19432,
      "odoo": 19069,
      "gevent": 19072,
      "mailpit": 19025
    },
    "base": "~/gitbase/v19"
  }
}
```

**Rust Model:**
```rust
type VersionsResponse = HashMap<String, VersionInfo>;

#[derive(Deserialize)]
struct VersionInfo {
    python: String,
    postgres: String,
    ports: Ports,
    base: String,
}

#[derive(Deserialize)]
struct Ports {
    db: u16,
    odoo: u16,
    gevent: u16,
    mailpit: u16,
}
```

**Notes:**
- `base` contains `~` (tilde), NOT expanded. Rust must expand with `dirs::home_dir()`.
- The `ports.smtp` field is NOT included in the JSON output (only db, odoo, gevent, mailpit).
- This is a single-line JSON output (no pretty printing).

**Error handling:**
- If odoodev is not installed → subprocess fails → `Err("Failed to execute odoodev: ...")`
- If versions.yaml is missing → odoodev exits non-zero with stderr error

---

### 1b. `odoodev config paths [VERSION] --json` (CLI ≥ 0.53.0)

**Purpose:** Per-version inventory of every editable config file for the
Monaco editor (`curated_files`) and the jump-to-editor buttons.

**CLI Command:**
```bash
odoodev config paths --json          # all versions
odoodev config paths 18 --json       # single version
```

**Output Format (verified):**
```json
{
  "18": {
    "native_dir": "/Users/x/gitbase/v18/v18-dev/dev18_native",
    "conf_dir": "/Users/x/gitbase/v18/v18-dev/conf",
    "myconfs_dir": "/Users/x/gitbase/v18/myconfs",
    "files": {
      "env":             {"path": ".../dev18_native/.env", "exists": true},
      "compose":         {"path": ".../dev18_native/docker-compose.yml", "exists": true},
      "requirements":    {"path": ".../dev18_native/requirements.txt", "exists": true},
      "repos_yaml":      {"path": ".../dev18_native/repos.yaml", "exists": true},
      "postgresql_conf": {"path": ".../dev18_native/postgresql.conf", "exists": true},
      "template_conf":   {"path": ".../conf/odoo18_template.conf", "exists": true},
      "generated_conf":  {"path": ".../myconfs/odoo_260714.conf", "exists": true}
    }
  }
}
```

`generated_conf` is `null` when no `odoo_YYMMDD.conf` was generated yet.
`repos.yaml` `paths.template` / `paths.config_dir` overrides are already
resolved by the CLI.

**Fallback (older CLIs):** when the command fails (unknown subcommand),
`curated_files()` falls back to `odoodev env dir <version>` per version and
derives only the native-dir files (no template/generated conf). The response
carries `paths_command_available: false` so the frontend shows an
"update odoodev" hint.

---

### 2. `odoodev venv check <VERSION> --json`

**Purpose:** Check venv status and requirements freshness for a specific version.

**CLI Command:**
```bash
odoodev venv check 18 --json
```

**Output Format (verified):**
```json
{
  "version": "18",
  "venv_dir": "/Users/picard/gitbase/v18/v18-dev/dev18_native/.venv",
  "exists": true,
  "is_symlink": false,
  "python_version": "3.13.12",
  "python_matches": true,
  "requirements_current": true
}
```

**Error case (venv missing):**
```json
{
  "version": "16",
  "venv_dir": "/Users/picard/gitbase/v16/v16-dev/dev16_native/.venv",
  "exists": false,
  "is_symlink": false,
  "python_version": null,
  "python_matches": null,
  "requirements_current": null
}
```

**Rust Model:**
```rust
#[derive(Deserialize)]
struct VenvStatus {
    version: String,
    venv_dir: String,
    exists: bool,
    is_symlink: bool,
    python_version: Option<String>,
    python_matches: Option<bool>,
    requirements_current: Option<bool>,
}
```

**Notes:**
- Exits with code 1 if `exists == false` (even with `--json`). The JSON is still on stdout, but the non-zero exit code must be handled: **parse stdout regardless of exit code**.
- `requirements_current` is `null` if no requirements.txt or no stored hash.
- `venv_dir` is already expanded (absolute path, no `~`).

**Implementation:**
```rust
async fn get_venv_status(version: &str) -> Result<VenvStatus, String> {
    let output = Command::new("odoodev")
        .args(["venv", "check", version, "--json"])
        .output().await
        .map_err(|e| format!("Failed to execute: {e}"))?;
    // Parse stdout as JSON regardless of exit code
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim())
        .map_err(|e| format!("Failed to parse venv status JSON: {e}"))
}
```

---

### 3. `odoodev db list <VERSION> --json`

**Purpose:** List all databases for a version.

**CLI Command:**
```bash
odoodev db list 18 --json
```

**Output Format (verified):**
```json
{
  "version": "18",
  "host": "localhost",
  "port": 18432,
  "databases": ["v18_exam", "v18_test", "v18_demo"]
}
```

**Error case (PostgreSQL not accessible):**
```
[ERROR] PostgreSQL not accessible on localhost:18432
[INFO] Start Docker services: odoodev docker up 18
```
Exit code: non-zero. stdout is empty. **No JSON output on error.**

**Rust Model:**
```rust
#[derive(Deserialize)]
struct DbListResponse {
    version: String,
    host: String,
    port: u16,
    databases: Vec<String>,
}
```

**Implementation:**
```rust
async fn get_databases(version: &str) -> Result<DbListResponse, String> {
    let output = Command::new("odoodev")
        .args(["db", "list", version, "--json"])
        .output().await
        .map_err(|e| format!("Failed to execute: {e}"))?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        serde_json::from_str(stdout.trim())
            .map_err(|e| format!("Failed to parse db list JSON: {e}"))
    } else {
        // PostgreSQL not accessible — return empty list with error info
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("PostgreSQL not accessible: {}", stderr.trim()))
    }
}
```

**Notes:**
- System databases (postgres, template0, template1) are already excluded by odoodev.
- The `databases` array is a list of names, not objects. No size/metadata.

---

### 4. `odoodev run <playbook> --output json`

**Purpose:** Execute playbooks with machine-readable NDJSON output (Phase 2).

**CLI Command:**
```bash
odoodev run playbook.yaml --output json
# or inline steps:
odoodev run --step docker.up --step pull -V 18 --output json
```

**Output Format (NDJSON, one JSON object per line):**
```json
{"event":"playbook_start","playbook":"<inline>","version":"18","dry_run":false}
{"event":"step_done","name":"docker.up","command":"docker.up","status":"ok","message":"","exit_code":0,"duration_ms":1234}
{"event":"step_done","name":"pull","command":"pull","status":"ok","message":"Updated 5 repos","exit_code":0,"duration_ms":5678}
{"event":"playbook_done","playbook":"<inline>","version":"18","status":"ok","steps_ok":2,"steps_error":0,"total_duration_ms":6912}
```

**Error case:**
```json
{"event":"error","message":"Playbook validation error: unknown command 'foo'"}
```

**Rust Model:**
```rust
#[derive(Deserialize)]
struct PlaybookEvent {
    event: String,  // "playbook_start", "step_done", "playbook_done", "error"
    name: Option<String>,
    command: Option<String>,
    status: Option<String>,  // "ok", "error", "skipped"
    message: Option<String>,
    exit_code: Option<i32>,
    duration_ms: Option<u64>,
    details: Option<serde_json::Value>,
    playbook: Option<String>,
    version: Option<String>,
    steps_ok: Option<u32>,
    steps_error: Option<u32>,
    total_duration_ms: Option<u64>,
}
```

**Implementation:** Line-by-line streaming, parse each line as JSON:
```rust
async fn run_playbook_streaming(
    playbook: &str,
    version: Option<&str>,
    window: &Window,
) -> Result<(), String> {
    let mut child = Command::new("odoodev")
        .args(["run", playbook, "--output", "json"])
        .stdout(Stdio::piped())
        .spawn().map_err(|e| format!("Failed to spawn: {e}"))?;
    let reader = BufReader::new(child.stdout.take().unwrap());
    let mut lines = reader.lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Ok(event) = serde_json::from_str::<PlaybookEvent>(&line) {
            window.emit("playbook-event", &event)?;
        }
    }
    Ok(())
}
```

---

## stdout Streaming (Text, not JSON)

### 5. `odoodev start <VERSION> [flags]`

**Purpose:** Start Odoo server, stream logs to GUI.

**CLI Command:**
```bash
odoodev start 18 --dev -d v18_exam
odoodev start 18 --shell
odoodev start 18 --test -- -d test_db -i my_module
odoodev start 18 --dev --tui --no-confirm -d v18_exam
```

**Full flag list:**
```
--dev                        Dev mode (--dev=all)
--shell                      Interactive shell
--test                       Run tests (--test-enable --stop-after-init)
--prepare                    Open shell with venv (don't start Odoo)
--no-confirm                 Skip confirmation
--tui                        Start with Textual TUI (NOT used by GUI)
--load-language TEXT         Load language (de_DE, fr_FR, all)
--i18n-overwrite             Overwrite existing translations
--clean-sessions             Clear sessions
-d, --database TEXT          Database name
-u, --update TEXT            Modules to update (comma-separated or 'all')
-i, --init TEXT              Modules to install (comma-separated)
--host TEXT                  Bind interface (default 127.0.0.1)
--runtime docker|apple       Container runtime override
-c, --config PATH            Explicit config file override (v0.46.1)
--allow-default-credentials  Disable safety check (disposable DBs only)
[EXTRA_ARGS]                 After -- : passed to odoo-bin
```

**Output:** stdout line-by-line, Odoo log format:
```
2025-07-10 14:23:45,123 12345 INFO  v18_exam odoo.modules.loading: Loading module eq_sale
2025-07-10 14:23:46,456 12345 INFO  v18_exam odoo.modules.loading: 42 modules loaded
2025-07-10 14:23:47,789 12345 WARNING v18_exam odoo.addons.base: Deprecated method
Traceback (most recent call last):
  File "...", line 42, in ...
    ...
2025-07-10 14:23:48,012 12345 ERROR v18_exam odoo.sql_db: Connection failed
```

**Parsing:** Each line is parsed by `log_parser.rs` (port of `odoodev/tui/log_parser.py`):

Regex:
```
^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+)\s+(\d+)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+)\s+(\S+?):\s*(.*)
```

Groups:
1. timestamp: `2025-07-10 14:23:45,123`
2. pid: `12345`
3. level: `INFO` | `WARNING` | `ERROR` | `DEBUG` | `CRITICAL`
4. database: `v18_exam`
5. logger: `odoo.modules.loading`
6. message: `Loading module eq_sale`

Non-matching lines (tracebacks, blank lines, startup messages) → `level: "RAW"`, `message: raw_line`.

**Event emission:**
```rust
// Rust → Frontend
window.emit("odoodev-log:18", &OdooLogEntry {
    timestamp, pid, level, database, logger, message, raw
});
```

**GUI must NOT pass `--tui` flag** (the Textual TUI would take over stdout).

---

### 6. `odoodev stop <VERSION> [--keep-docker] [--force]`

**Purpose:** Stop Odoo server.

**CLI Command:**
```bash
odoodev stop 18 --keep-docker    # Stop Odoo, keep PostgreSQL
odoodev stop 18                   # Stop Odoo + Docker
odoodev stop 18 --force          # Force kill (SIGKILL)
```

**Output:** Text messages (Rich format):
```
[INFO] Stopping Odoo process PID 12345 on port 18069...
[OK] Odoo process 12345 stopped
[INFO] Keeping Docker services running (--keep-docker)
```

**Parsing:** Only check exit code. 0 = success, non-zero = failure.

**Implementation:**
```rust
async fn stop_server(version: &str, keep_docker: bool, force: bool) -> Result<(), String> {
    let mut args = vec!["stop", version];
    if keep_docker { args.push("--keep-docker"); }
    if force { args.push("--force"); }
    let output = Command::new("odoodev").args(&args).output().await
        .map_err(|e| format!("Failed to execute: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
```

**Note:** The GUI should always pass `--keep-docker` (stopping Docker is a separate
action in the Docker panel). This matches the "stop Odoo, not PostgreSQL" mental model.

---

### 7. `odoodev db backup <VERSION> -n <NAME> -t <TYPE> [-o <DIR>] [-l <LEVEL>]`

**Purpose:** Create a database backup.

**CLI Command:**
```bash
odoodev db backup 18 -n v18_exam -t zip -o ~/Downloads
odoodev db backup 18 -n v18_exam -t tar.zst -l 19 -o ~/Downloads
odoodev db backup 18 -n v18_exam -t sql
```

**Output:** Text progress messages (Rich format):
```
[INFO] Creating ZIP backup of 'v18_exam'...
[OK] Backup saved: ~/Downloads/v18_exam_250710.zip (45.2 MB)
```

**Parsing:** Stream stdout lines as events. Parse final line for path + size:
- Success pattern: `Backup saved: <path> (<size>)`
- Exit code: 0 = success

**Implementation:**
```rust
async fn backup_db(version: &str, name: &str, backup_type: &str, output_dir: Option<&str>, level: Option<u8>) -> Result<BackupResult, String> {
    let mut args = vec!["db", "backup", version, "-n", name, "-t", backup_type];
    if let Some(dir) = output_dir { args.extend(["-o", dir]); }
    if let Some(lvl) = level { args.extend(["-l", &lvl.to_string()]); }

    // Stream stdout to "backup-progress" event
    let exit_code = run_odoodev_streaming(&args, window, "backup-progress").await?;

    if exit_code == 0 {
        // Parse last emitted line for path + size
        Ok(BackupResult { success: true, path, size })
    } else {
        Err("Backup failed".to_string())
    }
}
```

---

### 8. `odoodev db restore <VERSION> -n <NAME> -z <FILE> [flags]`

**Purpose:** Restore a database from backup with optional post-processing.

**CLI Command (full flag list):**
```bash
odoodev db restore 18 -n v18_restored -z ~/Downloads/backup.zip \
  --drop \
  --sanitize \
  --anonymize-users --user-password ownerp \
  --uninstall-modules mod1,mod2 \
  --recompute \
  -y
```

**All restore flags (from verified --help output):**
```
-n, --name TEXT                 New database name
-z, --backup-file PATH          Backup file path
--drop / --no-drop              Drop existing first
--sanitize                      Enable all post-restore (deactivate-cron + neutralize + anonymize + wipe + purge-master-data)
--deactivate-cron / --no-deactivate-cron
--neutralize / --no-neutralize
--anonymize / --no-anonymize
--wipe / --no-wipe
--purge-transactions / --no-purge-transactions
--purge-master-data / --no-purge-master-data
--recompute / --no-recompute
--anonymize-users / --no-anonymize-users
--user-password TEXT            Dev password (default: ownerp)
--uninstall-modules TEXT        Comma-separated module names
-y, --yes                       Skip confirmation
--keep-temp                     Keep temp files
--check-space / --no-check-space  Check disk space (default on)
--delete-backup                 Delete original after success
--keep-backup                   Never delete original
```

**Flag mapping from GUI Restore Dialog:**

| GUI Checkbox/Field | CLI Flag | Default | Notes |
|--------------------|----------|---------|-------|
| "Drop existing first" | `--drop` | off | |
| "—sanitize (all)" | individual flags instead | — | GUI uses individual flags for better control |
| "Deactivate cron" | `--deactivate-cron` | off | |
| "Neutralize" | `--neutralize` | off | |
| "Anonymize" | `--anonymize` | off | |
| "Wipe content" | `--wipe` | off | |
| "Purge master data" | `--purge-master-data` | off | ⚠ Shows warning text |
| "No purge master data" | `--no-purge-master-data` | — | Override when sanitize is on but this sub is off |
| "Anonymize users" | `--anonymize-users` | off | Separate from --sanitize |
| Dev password | `--user-password TEXT` | "ownerp" | Only with --anonymize-users |
| "Purge transactions" | `--purge-transactions` | off | Separate from --sanitize |
| Modules to uninstall | `--uninstall-modules TEXT` | — | |
| "Recompute" | `--recompute` | off | Auto-on with --anonymize |
| Skip confirmation | `-y` | always on | GUI IS the confirmation |

**Important:** The GUI should pass **individual flags** instead of `--sanitize` for
fine-grained control. Example:

```bash
# Instead of:
odoodev db restore 18 -n new -z backup.zip --sanitize -y

# Use:
odoodev db restore 18 -n new -z backup.zip \
  --deactivate-cron --neutralize --anonymize --wipe --purge-master-data -y

# If user wants sanitize but NOT purge-master-data: simply omit the flag.
# The GUI never sends --sanitize, so every post-restore step defaults to off
# and --no-* escapes are unnecessary.
odoodev db restore 18 -n new -z backup.zip \
  --deactivate-cron --neutralize --anonymize --wipe -y
```

**Dry run (requires odoodev >= 0.61.0):**
```bash
odoodev db restore 18 -n new -z backup.zip --dry-run -y
```
→ Validates backup file, target-DB collision, and disk space, then lists the
planned post-restore steps. Nothing is dropped, created, extracted, or restored.
Exit 0 = restore would proceed, exit 1 = it would fail (last line names the
reason). On older CLIs the flag does not exist — Click then fails with
`Error: No such option '--dry-run'` on stderr (surfaced via the stderr
fallback in `restore_db`).

**Output:** Text progress messages (Rich format), streamed line-by-line:
```
[INFO] Restoring database 'v18_restored' from backup.zip...
[INFO] Extracting ZIP archive...
[INFO] Creating database...
[INFO] Moving filestore...
[INFO] Running neutralize...
[OK] Database 'v18_restored' restored successfully
```

**Parsing:** Stream stdout lines as `restore-progress` events. Check exit code.

---

### 9. `odoodev db drop <VERSION> -n <NAME> -y`

**Purpose:** Drop a database.

**CLI Command:**
```bash
odoodev db drop 18 -n v18_exam -y
odoodev db drop 18 -m                          # Multi-select TUI (NOT for GUI)
odoodev db drop 18 --all --filter test_ -y     # Bulk drop (future)
```

**Output:** Text, exit code only matters.

---

### 10. `odoodev db copy <VERSION> -s <SRC> -d <DST> -y`

**Purpose:** Copy a database including filestore.

**CLI Command:**
```bash
odoodev db copy 18 -s v18_exam -d v18_copy -y --terminate-connections
```

---

### 11. `odoodev db rename <VERSION> -s <SRC> -d <DST> -y`

**Purpose:** Rename a database including filestore directory.

**CLI Command:**
```bash
odoodev db rename 18 -s v18_old -d v18_new -y
```

---

## Direct (Rust-Native, Bypassing CLI)

### 12. Docker Status Check

**Purpose:** Check if PostgreSQL container is running for a version.

**Problem:** `odoodev docker status <ver>` outputs text, not JSON. The output format is
Rich-formatted text that's fragile to parse. Instead, the Rust backend checks directly.

**Rust Implementation:**
```rust
async fn check_docker_status(version: &str, version_info: &VersionInfo) -> DockerStatus {
    // 1. Try Docker
    if let Ok(docker_path) = which::which("docker") {
        let output = Command::new(docker_path)
            .args(["ps", "--format", "{{.Names}}\t{{.Status}}"])
            .output().await;
        if let Ok(out) = output {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Expected container name pattern: picard-dev-db-XX-native
            // But the actual name depends on the .env file — better to check
            // if ANY container publishes the expected DB port
            let expected_port = version_info.ports.db;
            // Check port mapping: docker ps --format "{{.Ports}}" → find expected port
            if stdout.contains(&format!(":{expected_port}->")) {
                return DockerStatus { running: true, container_name: ..., runtime: "docker" };
            }
        }
        // Docker exists but container not running
        return DockerStatus { running: false, container_name: ..., runtime: "docker" };
    }

    // 2. Try Apple Container (macOS only)
    if cfg!(target_os = "macos") {
        if let Ok(container_path) = which::which("container") {
            // container ls → parse for expected container
            let output = Command::new(container_path)
                .args(["ls"])
                .output().await;
            // ... parse output
        }
    }

    // 3. Neither installed
    DockerStatus { running: false, container_name: String::new(), runtime: "none" }
}
```

**Better approach:** Check if the DB port is actually listening (TCP probe), which
works regardless of runtime:

```rust
async fn check_pg_port(port: u16) -> bool {
    use tokio::net::TcpStream;
    TcpStream::connect(format!("localhost:{port}")).await.is_ok()
}
```

This is simpler, more reliable, and runtime-agnostic. Use this as primary check,
fall back to container name detection for display.

---

### 13. Odoo Server Running Check

**Purpose:** Check if an Odoo server is running on a version's port.

**Problem:** `odoodev stop` uses `lsof -ti :<port>` internally. The GUI can do the same.

**Rust Implementation:**
```rust
async fn check_odoo_running(odoo_port: u16) -> Option<u32> {
    // Check if anything is listening on the Odoo port
    use tokio::net::TcpStream;
    if TcpStream::connect(format!("localhost:{odoo_port}")).await.is_ok() {
        // Try to get PID via lsof (for display)
        let output = Command::new("lsof")
            .args(["-ti", &format!(":{odoo_port}")])
            .output().await;
        if let Ok(out) = output {
            let pid_str = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if let Ok(pid) = pid_str.parse::<u32>() {
                return Some(pid);
            }
        }
        return Some(0); // Running but PID unknown
    }
    None
}
```

---

## HTTP Integration

### 14. PyPI Version Check

**Purpose:** Check latest odoodev version on PyPI for update notification.

**Endpoint:**
```
GET https://pypi.org/pypi/odoodev-equitania/json
```

**Response (verified):**
```json
{
  "info": {
    "version": "0.49.1",
    ...
  },
  ...
}
```

**Implementation:**
```rust
async fn get_pypi_version() -> Option<String> {
    let client = reqwest::Client::new();
    let resp = client.get("https://pypi.org/pypi/odoodev-equitania/json")
        .send().await.ok()?;
    let json: PypiResponse = resp.json().await.ok()?;
    Some(json.info.version)
}
```

**Notes:**
- Non-blocking: if the request fails (network error), silently return `None`.
- Don't block app startup on this check.
- Only check once at startup, and on manual "Check for updates" button.

---

## CLI Commands WITHOUT JSON Output (Text Parsing Required)

These commands have no `--json` flag. The GUI uses text parsing or exit-code-only strategies.

| Command | Strategy | Notes |
|---------|----------|-------|
| `odoodev start <ver>` | stdout streaming + log_parser | Main use case, well-supported |
| `odoodev stop <ver>` | exit code only | Simple |
| `odoodev db backup` | stdout streaming + final line parse | Path/size from last line |
| `odoodev db restore` | stdout streaming + exit code | Progress text |
| `odoodev db drop` | exit code only | Simple |
| `odoodev db copy` | exit code only | Simple |
| `odoodev db rename` | exit code only | Simple |
| `odoodev docker up` | stdout streaming + exit code | Progress text |
| `odoodev docker down` | exit code only | Simple |
| `odoodev docker status` | **bypassed — Rust direct check** | More reliable than text parsing |
| `odoodev docker logs` | stdout streaming (Phase 2) | Optional `-f` follow |
| `odoodev doctor <ver>` | text table parsing (Phase 2) | ⚠ Fragile, may break on format changes |
| `odoodev init <ver>` | stdout streaming (Phase 2) | Interactive prompts → use `--non-interactive` |
| `odoodev repos <ver>` | stdout streaming (Phase 2) | Progress text |
| `odoodev pull <ver>` | stdout streaming (Phase 2) | Progress text |
| `odoodev venv setup <ver>` | stdout streaming (Phase 2) | Progress text |
| `odoodev venv remove <ver>` | exit code only | Simple |

**Future improvement:** Request `--json` flags on `docker status`, `doctor`, and
`db backup`/`db restore` from the odoodev project. These would simplify the GUI
integration significantly.

---

## odoodev Version Compatibility

The GUI must handle different odoodev versions gracefully:

| Version | Features | GUI Behavior |
|---------|----------|--------------|
| < 0.43.0 | No `--json` on some commands | Show "Please update odoodev" dialog |
| 0.43.0-0.48.0 | JSON on core commands, `--sanitize` excludes purge-master-data | Restore dialog adapts |
| 0.48.0+ | `--sanitize` includes `--purge-master-data` | Restore dialog shows warning |
| 0.49.0+ | Current version | Full feature support |
| Future | May add `--json` to more commands | GUI prefers JSON when available |

**Minimum required version:** 0.49.0 (current). The GUI checks version at startup
and prompts to update if older.

---

## PATH Augmentation Details

GUI applications (especially on macOS) may not inherit the user's shell PATH. The
Rust backend augments PATH before every subprocess call:

```rust
fn augment_path(cmd: &mut Command) {
    let home = dirs::home_dir().unwrap();
    let extra: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            home.join(r".local\bin"),
            home.join(r".cargo\bin"),
        ]
    } else {
        vec![
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            PathBuf::from("/opt/homebrew/bin"),  // macOS Apple Silicon
            PathBuf::from("/usr/local/bin"),     // macOS Intel + Linux
        ]
    };
    let current = std::env::var("PATH").unwrap_or_default();
    let extra_str = extra.iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join(if cfg!(target_os = "windows") { ";" } else { ":" });
    cmd.env("PATH", format!("{extra_str}:{current}"));
}
```

This is critical: without it, `odoodev` (installed via `uv tool`) may not be found
because `~/.local/bin` is typically added by shell config, not inherited by GUI apps.