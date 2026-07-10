# Tauri Command API Reference — odoodev-gui

> Complete reference of all Tauri IPC commands (Rust → frontend) and events
> (Rust emits → frontend listens). This is the contract between the Rust backend
> and the React frontend.

---

## Commands (Frontend → Rust via `invoke`)

### System & Self-Update

#### `check_uv`
Check if `uv` is installed and available.

```typescript
invoke('check_uv') → {
  installed: boolean,
  path?: string,      // e.g. "/Users/picard/.local/bin/uv"
  version?: string,   // e.g. "0.11.28"
}
```

#### `install_uv`
Install `uv` (platform-specific download).

```typescript
invoke('install_uv') → {
  success: boolean,
  path?: string,
  version?: string,
  error?: string,
}
```
Emits events: `install-progress` (stdout lines)

#### `check_odoodev`
Check if `odoodev` is installed and get its version.

```typescript
invoke('check_odoodev') → {
  installed: boolean,
  version?: string,   // e.g. "0.49.1"
}
```

#### `install_odoodev`
Install `odoodev` via `uv tool install odoodev-equitania`.

```typescript
invoke('install_odoodev') → {
  success: boolean,
  version?: string,
  error?: string,
}
```
Prerequisite: `uv` must be installed (calls `ensure_uv()` internally).
Emits events: `install-progress` (stdout lines)

#### `upgrade_odoodev`
Upgrade `odoodev` to the latest PyPI version via `uv tool upgrade odoodev-equitania`.

```typescript
invoke('upgrade_odoodev') → {
  success: boolean,
  old_version?: string,
  new_version?: string,
  error?: string,
}
```
Emits events: `install-progress` (stdout lines)

#### `get_pypi_version`
Check latest version on PyPI (HTTP GET).

```typescript
invoke('get_pypi_version') → {
  version?: string,   // e.g. "0.49.1"
  error?: string,     // network error (non-blocking)
}
```

#### `check_odoodev_update`
Combined check: installed version vs PyPI latest.

```typescript
invoke('check_odoodev_update') → {
  installed_version?: string,   // e.g. "0.49.1"
  latest_version?: string,      // e.g. "0.50.0"
  update_available: boolean,    // true if latest > installed
}
```

#### `get_app_version`
Get the GUI's own version (from Cargo.toml / tauri.conf.json).

```typescript
invoke('get_app_version') → {
  version: string,   // e.g. "1.0.0"
}
```

#### `check_app_update`
Check if a GUI update is available (Tauri updater plugin).

```typescript
invoke('check_app_update') → {
  update_available: boolean,
  version?: string,
  notes?: string,
}
```

#### `do_app_update`
Trigger the Tauri updater to download and install a GUI update.

```typescript
invoke('do_app_update') → void
```
This will restart the app after successful update.

#### `get_platform_info`
Get OS and architecture info.

```typescript
invoke('get_platform_info') → {
  os: string,     // "macos" | "linux" | "windows"
  arch: string,    // "aarch64" | "x86_64"
  shell?: string,  // detected shell (fish/zsh/bash)
}
```

---

### Dashboard

#### `get_versions`
Get all Odoo version configurations.

```typescript
invoke('get_versions') → Record<string, VersionInfo>
```
CLI: `odoodev config versions --json`

```typescript
interface VersionInfo {
  python: string;       // "3.12" | "3.13"
  postgres: string;     // "16.11-alpine" | "17.4-alpine"
  ports: {
    db: number;         // 16432, 17432, 18432, 19432
    odoo: number;       // 16069, 17069, 18069, 19069
    gevent: number;     // 16072, 17072, 18072, 19072
    mailpit: number;    // 16025, 17025, 18025, 19025
  };
  base: string;         // "~/gitbase/v16" etc. (tilde NOT expanded)
}
```

#### `get_venv_status`
Get venv status for a specific version.

```typescript
invoke('get_venv_status', { version: "18" }) → VenvStatus
```
CLI: `odoodev venv check 18 --json`

```typescript
interface VenvStatus {
  version: string;
  venv_dir: string;          // absolute path (expanded)
  exists: boolean;
  is_symlink: boolean;
  python_version: string | null;   // "3.13.12"
  python_matches: boolean | null;   // true if venv Python matches config
  requirements_current: boolean | null; // true if hash matches
}
```
Note: CLI exits with code 1 if venv doesn't exist, but JSON is still on stdout.
Rust parses stdout regardless of exit code.

#### `get_active_versions`
Get the list of active versions from global config.

```typescript
invoke('get_active_versions') → string[]
// e.g. ["16", "17", "18", "19"] or ["18", "19"]
```
CLI: `odoodev config show` (parsed) — or read `~/.config/odoodev/config.yaml` directly.

**Implementation note:** There's no direct `--json` for this. Options:
1. Parse `config show` text output (fragile)
2. Read the config YAML file directly in Rust (preferred)
3. Add `config get active_versions --json` to odoodev (future)

#### `get_docker_status`
Check if PostgreSQL container is running for a version.

```typescript
invoke('get_docker_status', { version: "18" }) → DockerStatus
```
**Implementation:** Direct `docker ps` / `container ls` / TCP port probe (NOT CLI text parsing).

```typescript
interface DockerStatus {
  running: boolean;
  container_name?: string;
  runtime: string;    // "docker" | "apple" | "none"
}
```

#### `get_all_dashboard_status`
Bulk fetch all dashboard data in one call (avoids 12+ separate invokes on startup).

```typescript
invoke('get_all_dashboard_status') → {
  versions: Record<string, VersionInfo>,
  active_versions: string[],
  venv_status: Record<string, VenvStatus>,
  docker_status: Record<string, DockerStatus>,
  server_status: Record<string, ServerStatus>,
}
```
Internally calls all individual commands in parallel (tokio::join_all).

---

### Server (Parallel)

#### `start_server`
Start an Odoo server for a version.

```typescript
invoke('start_server', {
  version: "18",
  mode: "dev",                    // "normal" | "dev" | "shell" | "test" | "prepare"
  database?: "v18_exam",          // database name
  update_modules?: "eq_sale,eq_stock",  // -u
  install_modules?: "eq_new",     // -i
  host?: "127.0.0.1",             // --host
  load_language?: "de_DE",        // --load-language
  i18n_overwrite?: boolean,       // --i18n-overwrite
  clean_sessions?: boolean,       // --clean-sessions
  config_path?: string,           // -c (explicit config override)
  allow_default_credentials?: boolean, // --allow-default-credentials
  runtime?: "docker" | "apple",   // --runtime
  extra_args?: string,            // after -- (passthrough to odoo-bin)
}) → {
  pid: number,        // process ID
  port: number,       // Odoo port for this version
}
```

CLI mapping:
```bash
odoodev start 18 --dev -d v18_exam -u eq_sale,eq_stock -i eq_new \
  --host 127.0.0.1 --load-language de_DE --i18n-overwrite --clean-sessions \
  -c /path/to/config.conf --allow-default-credentials --runtime docker \
  -- --workers=4
```

Flag construction rules:
- `mode: "dev"` → `--dev`
- `mode: "shell"` → `--shell`
- `mode: "test"` → `--test`
- `mode: "prepare"` → `--prepare`
- `mode: "normal"` → (no flag)
- `database` → `-d <database>`
- `update_modules` → `-u <modules>`
- `install_modules` → `-i <modules>`
- `load_language` → `--load-language <lang>`
- `i18n_overwrite: true` → `--i18n-overwrite`
- `clean_sessions: true` → `--clean-sessions`
- `config_path` → `-c <path>`
- `allow_default_credentials: true` → `--allow-default-credentials`
- `extra_args` → `-- <args>`
- Always adds `--no-confirm` (GUI is the confirmation)

Emits events:
- `odoodev-log:<version>` — one per stdout line (parsed OdooLogEntry)
- `server-status:<version>` — every 500ms: `{ running, pid, uptime_seconds }`
- `server-exited:<version>` — on child exit: `{ exit_code }`

#### `stop_server`
Stop an Odoo server.

```typescript
invoke('stop_server', {
  version: "18",
  keep_docker?: boolean,   // default: true (GUI keeps Docker running)
  force?: boolean,         // SIGKILL instead of SIGTERM
}) → void
```
CLI: `odoodev stop 18 --keep-docker [--force]`

Default `keep_docker: true` — stopping PostgreSQL is a separate action in the
Docker panel. This matches the "stop Odoo, not PostgreSQL" mental model.

#### `get_server_status`
Get status of a running server for a version.

```typescript
invoke('get_server_status', { version: "18" }) → ServerStatus
```

```typescript
interface ServerStatus {
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
  port?: number;
}
```
Reads from the `ServerManager` HashMap (no subprocess call).

#### `get_all_server_statuses`
Get status of all running servers.

```typescript
invoke('get_all_server_statuses') → Record<string, ServerStatus>
```

---

### Databases

#### `get_databases`
List all databases for a version.

```typescript
invoke('get_databases', { version: "18" }) → DbListResponse
```
CLI: `odoodev db list 18 --json`

```typescript
interface DbListResponse {
  version: string;
  host: string;
  port: number;
  databases: string[];
}
```
Error: If PostgreSQL not accessible, returns `Err("PostgreSQL not accessible on port XXXXX")`.

#### `backup_db`
Create a database backup.

```typescript
invoke('backup_db', {
  version: "18",
  name: "v18_exam",
  type: "zip",             // "sql" | "zip" | "tar.zst"
  output_dir?: "~/Downloads",
  level?: 5,               // tar.zst only, 1-22
}) → BackupResult
```
CLI: `odoodev db backup 18 -n v18_exam -t zip -o ~/Downloads`

```typescript
interface BackupResult {
  success: boolean;
  path?: string;     // e.g. "~/Downloads/v18_exam_250710.zip"
  size?: string;     // e.g. "45.2 MB"
  error?: string;
}
```
Emits events: `backup-progress` (stdout lines during backup)

#### `restore_db`
Restore a database from backup.

```typescript
invoke('restore_db', {
  version: "18",
  name: "v18_restored",
  backup_file: "~/Downloads/backup.zip",
  drop?: boolean,                 // --drop
  deactivate_cron?: boolean,      // --deactivate-cron
  neutralize?: boolean,           // --neutralize
  anonymize?: boolean,            // --anonymize
  wipe?: boolean,                 // --wipe
  purge_master_data?: boolean,    // --purge-master-data
  no_purge_master_data?: boolean, // --no-purge-master-data (override sanitize)
  purge_transactions?: boolean,   // --purge-transactions
  anonymize_users?: boolean,      // --anonymize-users
  user_password?: string,         // --user-password (default: "ownerp")
  uninstall_modules?: string,     // --uninstall-modules "mod1,mod2"
  recompute?: boolean,            // --recompute
  keep_temp?: boolean,            // --keep-temp
  check_space?: boolean,           // --check-space (default: true)
  delete_backup?: boolean,        // --delete-backup
  dry_run?: boolean,               // --dry-run
}) → RestoreResult
```

CLI mapping (example with sanitize):
```bash
odoodev db restore 18 -n v18_restored -z ~/Downloads/backup.zip \
  --drop --deactivate-cron --neutralize --anonymize --wipe --purge-master-data \
  --uninstall-modules mod1,mod2 --recompute -y
```

GUI always passes `-y` (the GUI dialog IS the confirmation).

Flag construction:
- Individual sanitize flags (not `--sanitize`) for fine-grained control
- If user selects "sanitize all" in GUI → set all 5 sub-flags individually
- `no_purge_master_data` → `--no-purge-master-data` (override when sanitize on but purge off)
- Always pass `-y`
- `--keep-backup` by default (never auto-delete original from GUI)

```typescript
interface RestoreResult {
  success: boolean;
  error?: string;
}
```
Emits events: `restore-progress` (stdout lines during restore)

#### `drop_db`
Drop a database.

```typescript
invoke('drop_db', {
  version: "18",
  name: "v18_exam",
  terminate_connections?: boolean,   // --terminate-connections
}) → { success: boolean, error?: string }
```
CLI: `odoodev db drop 18 -n v18_exam -y`
Always passes `-y` (GUI dialog IS the confirmation with type-to-confirm).

#### `copy_db`
Copy a database.

```typescript
invoke('copy_db', {
  version: "18",
  src: "v18_exam",
  dst: "v18_copy",
  terminate_connections?: boolean,
}) → { success: boolean, error?: string }
```
CLI: `odoodev db copy 18 -s v18_exam -d v18_copy -y`

#### `rename_db`
Rename a database.

```typescript
invoke('rename_db', {
  version: "18",
  src: "v18_old",
  dst: "v18_new",
  terminate_connections?: boolean,
}) → { success: boolean, error?: string }
```
CLI: `odoodev db rename 18 -s v18_old -d v18_new -y`

---

### Docker

#### `docker_up`
Start PostgreSQL service for a version.

```typescript
invoke('docker_up', {
  version: "18",
  runtime?: "docker" | "apple",   // overrides config
}) → { success: boolean, error?: string }
```
CLI: `odoodev docker up 18`
Emits events: `docker-up-progress` (stdout lines)

#### `docker_down`
Stop PostgreSQL service for a version.

```typescript
invoke('docker_down', {
  version: "18",
  runtime?: "docker" | "apple",
}) → { success: boolean, error?: string }
```
CLI: `odoodev docker down 18`

#### `docker_status`
Check PostgreSQL service status (direct, not CLI).

```typescript
invoke('docker_status', { version: "18" }) → DockerStatus
```
Implementation: Direct `docker ps` / `container ls` / TCP port probe.

#### `docker_logs`
Get PostgreSQL service logs (Phase 2).

```typescript
invoke('docker_logs', {
  version: "18",
  follow?: boolean,    // -f
  tail?: number,       // -n (default 100)
  runtime?: "docker" | "apple",
}) → { lines: string[] }
```
CLI: `odoodev docker logs 18 -n 100`
If `follow: true`: streams as `docker-logs:<version>` events.

---

## Events (Rust → Frontend via `listen`)

### Log Streaming

#### `odoodev-log:<version>`
Emitted for each stdout line from `odoodev start <version>`.

```typescript
listen(`odoodev-log:${version}`, (entry: OdooLogEntry) => { ... })
```

```typescript
interface OdooLogEntry {
  timestamp: string;    // "2025-07-10 14:23:45,123"
  pid: string;          // "12345"
  level: "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL" | "RAW";
  database: string;    // "v18_exam" (empty for RAW)
  logger: string;      // "odoo.modules.loading" (empty for RAW)
  message: string;     // "Loading module eq_sale"
  raw: string;          // original line
}
```

RAW level: tracebacks, blank lines, startup messages. These don't match the Odoo
log format regex and should be displayed dimmed/italic.

#### `server-status:<version>`
Emitted every 500ms while server is running.

```typescript
listen(`server-status:${version}`, (status: {
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
  port?: number;
}) => { ... })
```

#### `server-exited:<version>`
Emitted once when the server process exits.

```typescript
listen(`server-exited:${version}`, (event: {
  exit_code: number;
}) => { ... })
```

Frontend action: append separator line `--- Server stopped (exit code N) ---`
to the log buffer. Buffer is NOT cleared.

---

### Progress Streaming

#### `backup-progress`
Emitted for each stdout line during `odoodev db backup`.

```typescript
listen('backup-progress', (event: { line: string }) => { ... })
```

#### `restore-progress`
Emitted for each stdout line during `odoodev db restore`.

```typescript
listen('restore-progress', (event: { line: string }) => { ... })
```

#### `install-progress`
Emitted for each stdout line during `uv install` or `odoodev install`.

```typescript
listen('install-progress', (event: { line: string, phase: string }) => { ... })
```
`phase`: `"uv_install"` | `"odoodev_install"` | `"odoodev_upgrade"`

---

### Docker

#### `docker-up-progress`
Emitted for each stdout line during `odoodev docker up`.

```typescript
listen('docker-up-progress', (event: { line: string }) => { ... })
```

#### `docker-logs:<version>` (Phase 2)
Emitted for each log line when following Docker logs.

```typescript
listen(`docker-logs:${version}`, (event: { line: string }) => { ... })
```

---

### Playbook (Phase 2)

#### `playbook-event`
Emitted for each NDJSON line during `odoodev run --output json`.

```typescript
listen('playbook-event', (event: PlaybookEvent) => { ... })
```

```typescript
interface PlaybookEvent {
  event: "playbook_start" | "step_done" | "playbook_done" | "error";
  name?: string;
  command?: string;
  status?: "ok" | "error" | "skipped";
  message?: string;
  exit_code?: number;
  duration_ms?: number;
  details?: any;
  playbook?: string;
  version?: string;
  steps_ok?: number;
  steps_error?: number;
  total_duration_ms?: number;
}
```

---

## TypeScript Type Definitions

All types in `src/types/odoodev.ts`:

```typescript
// Version info (config versions --json)
export interface VersionInfo {
  python: string;
  postgres: string;
  ports: {
    db: number;
    odoo: number;
    gevent: number;
    mailpit: number;
  };
  base: string;
}

// Venv status (venv check --json)
export interface VenvStatus {
  version: string;
  venv_dir: string;
  exists: boolean;
  is_symlink: boolean;
  python_version: string | null;
  python_matches: boolean | null;
  requirements_current: boolean | null;
}

// DB list (db list --json)
export interface DbListResponse {
  version: string;
  host: string;
  port: number;
  databases: string[];
}

// Docker status (Rust-native)
export interface DockerStatus {
  running: boolean;
  container_name?: string;
  runtime: 'docker' | 'apple' | 'none';
}

// Server status
export interface ServerStatus {
  running: boolean;
  pid?: number;
  uptime_seconds?: number;
  port?: number;
}

// Log entry (from log_parser)
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'RAW';

export interface OdooLogEntry {
  timestamp: string;
  pid: string;
  level: LogLevel;
  database: string;
  logger: string;
  message: string;
  raw: string;
}

// Server config (for start_server)
export interface ServerConfig {
  version: string;
  mode: 'normal' | 'dev' | 'shell' | 'test' | 'prepare';
  database?: string;
  update_modules?: string;
  install_modules?: string;
  host?: string;
  load_language?: string;
  i18n_overwrite?: boolean;
  clean_sessions?: boolean;
  config_path?: string;
  allow_default_credentials?: boolean;
  runtime?: 'docker' | 'apple';
  extra_args?: string;
}

// Backup config
export interface BackupConfig {
  version: string;
  name: string;
  type: 'sql' | 'zip' | 'tar.zst';
  output_dir?: string;
  level?: number;
}

// Restore config
export interface RestoreConfig {
  version: string;
  name: string;
  backup_file: string;
  drop?: boolean;
  deactivate_cron?: boolean;
  neutralize?: boolean;
  anonymize?: boolean;
  wipe?: boolean;
  purge_master_data?: boolean;
  no_purge_master_data?: boolean;
  purge_transactions?: boolean;
  anonymize_users?: boolean;
  user_password?: string;
  uninstall_modules?: string;
  recompute?: boolean;
  keep_temp?: boolean;
  check_space?: boolean;
  delete_backup?: boolean;
  dry_run?: boolean;
}

// Backup result
export interface BackupResult {
  success: boolean;
  path?: string;
  size?: string;
  error?: string;
}

// Restore result
export interface RestoreResult {
  success: boolean;
  error?: string;
}

// Playbook event (NDJSON, Phase 2)
export interface PlaybookEvent {
  event: string;
  name?: string;
  command?: string;
  status?: string;
  message?: string;
  exit_code?: number;
  duration_ms?: number;
  details?: any;
  playbook?: string;
  version?: string;
  steps_ok?: number;
  steps_error?: number;
  total_duration_ms?: number;
}

// uv info
export interface UvInfoDto {
  installed: boolean;
  path?: string;
  version?: string;
}

// odoodev info
export interface OdoodevInfoDto {
  installed: boolean;
  version?: string;
}

// Update check
export interface UpdateCheckResult {
  installed_version?: string;
  latest_version?: string;
  update_available: boolean;
}

// Platform info
export interface PlatformInfo {
  os: string;
  arch: string;
}

// Server state (Zustand store)
export interface ServerState {
  status: ServerStatus;
  config: ServerConfig;
  logBuffer: OdooLogEntry[];
  logFilters: Set<LogLevel>;
  searchTerm: string;
  autoScroll: boolean;
}
```

---

## Event Naming Convention

All events follow the pattern:

| Event | Pattern | Example |
|-------|---------|---------|
| Log streaming | `odoodev-log:<version>` | `odoodev-log:18` |
| Server status | `server-status:<version>` | `server-status:18` |
| Server exited | `server-exited:<version>` | `server-exited:18` |
| Docker logs | `docker-logs:<version>` | `docker-logs:18` (Phase 2) |
| Progress (no version) | `<operation>-progress` | `backup-progress`, `restore-progress` |
| Install progress | `install-progress` | (single event, phase field distinguishes) |
| Playbook | `playbook-event` | (single event, per NDJSON line) |

Version-scoped events use the version string as suffix (`:18`, `:19`, etc.).
Non-versioned operations use a single event name.