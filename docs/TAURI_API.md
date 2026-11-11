# Tauri Command API Reference — odoodev-gui

> Complete reference of all Tauri IPC commands (Rust → frontend) and events
> (Rust emits → frontend listens). This is the contract between the Rust backend
> and the React frontend.

---

## Commands (Frontend → Rust via `invoke`)

### System & Self-Update

#### `check_uv`
Check if `uv` is installed and available. Read-only: never installs.

```typescript
invoke('check_uv') → {
  installed: boolean,
  path?: string,      // e.g. "/Users/<user>/.local/bin/uv"
  version?: string,   // e.g. "0.11.28"
}
```

#### `install_uv`
Install `uv` (platform-specific download from astral.sh). Only on explicit user action; errors carry the installer stderr.

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
Installs `uv` first if missing (`ensure_uv()`), so call only after user confirmation.
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

All fields are passed inside a single `args` object (Tauri deserializes it into
`RestoreArgs`), not as top-level parameters:

```typescript
invoke('restore_db', { args: {
  version: "18",
  name: "v18_restored",
  backup_file: "~/Downloads/backup.zip",
  drop?: boolean,                 // --drop / --no-drop  (ALWAYS sent, see below)
  deactivate_cron?: boolean,      // --deactivate-cron
  neutralize?: boolean,           // --neutralize
  anonymize?: boolean,            // --anonymize
  wipe?: boolean,                 // --wipe (deletes chatter + attachments + filestore files)
  purge_master_data?: boolean,    // --purge-master-data
  purge_transactions?: boolean,   // --purge-transactions
  anonymize_users?: boolean,      // --anonymize-users
  user_password?: string,         // --user-password (default: "ownerp")
  uninstall_modules?: string,     // --uninstall-modules "mod1,mod2"
  recompute?: boolean,            // --recompute / --no-recompute (ALWAYS sent, see below)
  keep_temp?: boolean,            // --keep-temp
  check_space?: boolean,          // --check-space / --no-check-space (CLI default: on)
  without_pgvector?: boolean,     // --without-pgvector (odoodev >= 0.71.0)
  allow_psql_meta?: boolean,      // --allow-psql-meta (odoodev >= 0.77.0), trusted backups only; sent only when true
  delete_backup?: boolean,        // --delete-backup (else --keep-backup)
  dry_run?: boolean,              // --dry-run
}}) → RestoreResult
```

CLI mapping (example with every sanitize step):
```bash
odoodev db restore 18 -n v18_restored -z ~/Downloads/backup.zip \
  --drop --deactivate-cron --neutralize --anonymize --wipe --purge-master-data \
  --uninstall-modules mod1,mod2 --recompute --keep-backup -y
```

Flag construction:
- **`--sanitize` is never sent.** It would pull in `--purge-master-data`, which
  deletes customers, vendors and CRM/HR data. The dialog's "sanitize" switch is a
  toggle-all over the five children, each sent individually.
- **Two flag pairs are always explicit**, because omitting them is a decision
  rather than a neutral act:
  - `--drop/--no-drop` — the CLI defaults to *drop*, so an omitted flag would
    silently overwrite the target database.
  - `--recompute/--no-recompute` — the CLI defaults it to the value of
    `--anonymize`, so an omitted flag would recompute whenever anonymize runs.
    Only meaningful together with anonymize; omitted entirely when anonymize is
    off, where the CLI skips the step regardless.
- The remaining options are opt-in (CLI default off), so the positive flag alone
  is enough.
- Always `-y` (the GUI dialog IS the confirmation) — this also suppresses the
  CLI's interactive "modules to uninstall" prompt, which would otherwise appear
  whenever a sanitize step is enabled and `--uninstall-modules` was omitted.
- Always `--keep-backup` unless `delete_backup` is set — never auto-delete the
  user's original.

```typescript
interface RestoreResult {
  success: boolean;
  error?: string;
  output: string[];   // every stdout/stderr line, in emission order
}
```

`output` carries the run's full report. It matters most for `dry_run`, whose
entire value is its verdict: backup file and size, whether the target DB would be
dropped or created, the filestore destination, free disk space, and the list of
post-restore steps that would run. The dialog renders it verbatim.

`error` is chosen by `pick_failure_reason()`, not taken from the last line: the
CLI prints progress to stdout and errors to stderr and ends a failed run with a
generic `[ERROR] … — nothing was changed`, so the first *specific* `[ERROR]` line
is the one that actually explains the failure.

Emits events: `restore-progress` (stdout **and** stderr lines during the run)

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

#### `export_modules`
Export the module list of a database as CSV (odoodev ≥ 0.59.0; `viaShell` needs ≥ 0.76.0, `viaRpc` ≥ 0.77.0).

```typescript
invoke('export_modules', {
  version: "18",
  database: "v18_exam",
  scope: "all",            // "all" | "no-enterprise" | "installed" (validated in Rust)
  updateList: false,       // --update-list
  cleanup: false,          // --cleanup (runs before --update-list)
  viaShell: true,          // --via-shell, no Odoo login; the frontend never sends true below 0.76.0
  viaRpc: false,           // --via-rpc (XML-RPC with a login); NEW, odoodev >= 0.77.0 only. Both true -> error
}) → ExportModulesResult
```
CLI: `odoodev export modules 18 -d v18_exam --scope all --via-shell --json`

The CLI default flipped in 0.77.0, so the unticked "Without Odoo login" box sends
`viaRpc: true` on 0.77.0+ and nothing on older or unknown versions (see
`CLI_INTEGRATION.md`, section 11b). `viaShell` and `viaRpc` are never both true.

```typescript
interface ExportModulesResult {
  version: string;
  database: string;
  scope: "all" | "no-enterprise" | "installed";
  path: string | null;     // null when count is 0 (nothing written)
  count: number;
  updated: number | null;  // null when updateList was false
  cleaned: number | null;  // null when cleanup was false
}
```
No `--output` is sent: the CLI writes `~/Downloads/modules_<db>_<scope>_<timestamp>.csv`. Resolves with `count: 0` for an empty module list (not an error). Rejects with the CLI's failure reason (first `[ERROR]` line of stderr). Validation: `version` two digits, `database` via `validate_name`, `scope` one of the three values. Frontend mapping: `src/components/database/exportArgs.ts`.

#### `plan_db_update`
Dry run of `db update`: which databases would be updated and why.
```typescript
invoke('plan_db_update', { args: DbUpdateArgs }) → DbUpdatePlan
```
CLI: `odoodev db update <version> (-n <db>… | --stale | --all) -u <modules> [--stop-on-error] [--timeout <s>] --dry-run --output ndjson`
```typescript
interface DbUpdateArgs { version: string; mode: "names" | "stale" | "all"; names: string[]; modules: string; stopOnError: boolean; timeoutSeconds: number | null }
interface DbUpdatePlan { version: string; modules: string; targets: { database: string; reason: string | null }[]; skipped_current: string[]; server_running: boolean }
```
Errors: the CLI's `error` event message; "odoodev >= 0.69.0 is required …" for older CLIs.

#### `start_db_update`
Starts the update in the background (one per version) and returns immediately; progress arrives as events.
```typescript
invoke('start_db_update', { args: DbUpdateArgs }) → void
```
CLI: as `plan_db_update` without `--dry-run`. Errors: invalid args, "An update is already running for v<version>".

#### `cancel_db_update`
```typescript
invoke('cancel_db_update', { version: string, force: boolean }) → void
```
`force: false` sends SIGTERM (odoodev stops odoo-bin, exits 130). `force: true` kills odoodev only — odoo-bin may keep running. On Windows both kill odoodev. The manager sends SIGTERM at most once per run; repeated graceful cancels are no-ops.

#### `list_db_updates`
```typescript
invoke('list_db_updates') → string[]   // versions with a running update
```

#### `read_update_log`
```typescript
invoke('read_update_log', { path: string }) → string
```
Only `~/odoodev-logs/update_v*.log` (canonicalized); files over 2 MB return their last 2 MB with a note. Async: reads only the tail, off the main thread.

---

### Docker

#### `docker_up`
Start PostgreSQL service for a version.

```typescript
invoke('docker_up', {
  version: "18",
  runtime?: "docker" | "apple",   // overrides config
  allowDefaultCredentials?: boolean, // --allow-default-credentials (odoodev >= 0.77.0; sent only when true)
}) → { success: boolean, error?: string }
```
CLI: `odoodev docker up --runtime apple 18 [--allow-default-credentials]`
Emits events: `docker-up-progress` (stdout and stderr lines)

Changed: `allowDefaultCredentials` is new. On failure `error` is now the first
`[ERROR]` line of the run (for the placeholder-password refusal: "Aborted.
Configure a real password and try again."), not the last stdout line. A refusal
resolves with `success: false`, it does not reject.

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

### Editor & Playbooks (path handling)

The editor's path allowlist lives in Rust. `curated_files` computes the roots
(`~/.config/odoodev`, each active version's playbook dir, `./playbooks`,
`native_dir`, `conf_dir`, `myconfs_dir` and the parent dirs of the listed
files), stores them in managed state (`EditorRoots`) and returns the file
list. The webview never supplies roots.

#### `curated_files`
```typescript
invoke('curated_files') → CuratedFiles
// CuratedFiles = { config, version_groups, playbooks, playbook_roots, paths_command_available }
```
Refreshes the server-side allowlist as a side effect. The former
`extra_roots` field was removed from the result.

#### `fs_read_file`
```typescript
invoke('fs_read_file', { path: string }) → FileContent
```
Changed: the `extraRoots` argument was removed. Rejects any path outside the
server-side roots (canonicalised: symlinks and `..` cannot escape). If
`curated_files` has not run yet, the roots are computed on demand.

#### `fs_write_file`
```typescript
invoke('fs_write_file', { path: string, content: string, allowCreate: boolean }) → void
```
Changed: the `extraRoots` argument was removed; same allowlist as `fs_read_file`.

#### `playbook_validate_semantic`
```typescript
invoke('playbook_validate_semantic', { path: string }) → SemanticValidation
```
Changed: the `extraRoots` argument was removed; same allowlist as `fs_read_file`.

#### `playbook_inspect`, `playbook_validate`, `playbook_run`, `playbook_create`
Signatures unchanged, new checks. `playbook_inspect` / `playbook_validate` /
`playbook_run` (path form) require an existing regular `.yml`/`.yaml` file
(not the editor allowlist: `odoodev run --list` also reports playbooks bundled
inside the odoodev package). `playbook_run` also validates `steps` (name rules),
`version` (two digits) and rejects flag-like `vars`.

`playbook_create` writes only into the **playbook directories**: each version's
`<native_dir>/scripts/playbooks` (first, in registry order) and the project's
`./playbooks` (last). These are the `playbook_roots` of `curated_files`, which is
narrower than the editor allowlist (that also covers the config directories). A
`./playbooks` that resolves directly below a filesystem root (`/playbooks`, which
is what an installed app started from Finder gets when its working directory is
`/`) is dropped from `playbook_roots` and from the write targets in one place
(`playbook_dirs_for` in `editor.rs`); the editor can still read and edit it.

Two paths are checked with the same rules (`check_write_target`):
- `outputPath`: a `.yml`/`.yaml` file name.
- `env_file.path` inside `answers`, when `env_file.generate` is true and a path
  is given (that is exactly when the CLI writes the secrets file): a file name
  ending in `.env`, inside the playbook directories **or odoodev's config
  directory** (`~/.config/odoodev`, subfolders allowed; the same directory as the
  editor's built-in root, `config_dir()` in `editor.rs`). The playbook path may
  not use the config directory. The path is rewritten in the answers to its absolute form
  before they go to the CLI. Answers without an env file, or with
  `generate: false`, are not touched.

Rules: a leading `~` is expanded and a relative path is made absolute against the
app's working directory (the CLI resolves both against its own working directory,
not the playbook's); the expanded absolute path is what the CLI receives, and
`playbook_create` returns the playbook's. Missing parent directories are fine
(the CLI creates them), but `..` in a directory that does not exist yet is
refused, symlinks are resolved (a link pointing out of the directories, or a
dangling one, is refused) and an existing target must be a regular file. `force`
is passed to the CLI as before. Rejections are strings
`playbook_output:<code>: <English detail>` (playbook path) or
`playbook_env_file:<code>: <English detail>` (secrets file) with `<code>` one of
`flag_like`, `empty`, `bad_tilde`, `bad_extension`, `parent_escape`,
`unresolvable`, `outside_roots`, `not_a_file`, and for the env file also
`malformed` (answers or `env_file` of the wrong shape). The wizard translates
them. Error texts contain no answer values apart from the path itself.

#### `playbook_check_output` (new)
Read-only dry run of the path check, used by the wizard to show the reason
before submitting.

```typescript
invoke('playbook_check_output', {
  outputPath: string,
  kind?: "output" | "env_file",   // default "output"; "env_file" = secrets file (.env name)
}) → string  // absolute path that would be written
```
Rejects with the same `playbook_output:` / `playbook_env_file:` strings as
`playbook_create`.

#### `playbook_env_dirs` (new)
Read-only list of where the secrets `.env` file may be written, for the wizard.

```typescript
invoke('playbook_env_dirs') → { dirs: string[], config_dir: string }
// dirs: playbook directories first, odoodev's config directory last
// config_dir: the CLI's default location for a server playbook's secrets file
```
The wizard suggests `<config_dir>/<slug>.env` for a server playbook and
`<playbook dir>/<slug>.env` for a dev playbook, as the CLI's interview does.

### Argument validation (all commands that forward strings to the CLI)

`version`, `from`, `to`: exactly two ASCII digits. Database, migration and
step names: non-blank, at most 255 characters, no control characters, no
leading `-`. Free-form values (paths, module lists, host, image tags,
runtime): no leading `-`. `backup_db`: `type` must be `sql`, `zip` or
`tar.zst`, `level` 1-22. Violations return an error (or `OpResult` with
`success: false` for the database drop/copy/rename commands).

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
listen('backup-progress', (line: string) => { ... })
```
Payload is a plain `string` per line, not `{ line: string }`.

#### `restore-progress`
Emitted for each stdout line during `odoodev db restore`.

```typescript
listen('restore-progress', (line: string) => { ... })
```
Payload is a plain `string` per line, not `{ line: string }`.

#### `db-update-event`, `db-update-log`, `db-update-exited`
```typescript
listen<{ version: string; event: DbUpdateEvent }>('db-update-event')   // plan | start | issue | result | summary | interrupted | error
listen<{ version: string; line: string }>('db-update-log')             // stderr and non-event stdout lines
listen<{ version: string; exit_code: number | null }>('db-update-exited')
```
Event shapes: see `DbUpdateEvent` in `src/types/index.ts` and `docs/CLI_INTEGRATION.md` (`db update --output ndjson`).

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