# Implementation Plan — odoodev-gui

> Vollständiger Umsetzungsplan für die Tauri + React Desktop-GUI für `odoodev`.
> Alle Phasen, Tasks, Aufwandsschätzungen und Abhängigkeiten.

---

## Overview

| Metric | Value |
|--------|-------|
| Tech-Stack | Rust + Tauri v2 + React 19 + TypeScript |
| Target Platforms | macOS, Linux, Windows |
| Delivery | Native bundle (.dmg / .msi / .AppImage) |
| MVP Estimate | ~11.5 Tage |
| Total Estimate (Phase 1+2) | ~28 Tage |

---

## Phase 0 — Setup & CI (Tag 1)

### 0.1 Tauri v2 Projekt initialisieren

- [ ] `cargo create` + Tauri v2 template (React + Vite)
- [ ] `tauri.conf.json` konfigurieren:
  - Identifier: `de.equitania.odoodev-gui`
  - Window: 1200x800, min 900x600, title "odoodev — Odoo Development Manager"
  - Updater plugin: pubkey, endpoints (GitHub releases)
  - Bundle targets: `.dmg` + `.app` (macOS), `.msi` + NSIS `.exe` (Windows), `.AppImage` + `.deb` (Linux)
- [ ] App-Icon generieren (odoodev-Logo → `icon.icns` / `icon.ico` / `icon.png`)
- [ ] Tauri v2 capabilities (`capabilities/default.json`): shell + updater permissions

### 0.2 Frontend-Stack aufsetzen

- [ ] Vite + React 19 + TypeScript
- [ ] Tailwind CSS v4 + `@tailwindcss/vite`
- [ ] shadcn/ui (`components.json`, `src/components/ui/`)
- [ ] Zustand state management
- [ ] lucide-react icons
- [ ] @tanstack/react-virtual (für Log-Viewer)
- [ ] react-router-dom v7

### 0.3 Rust-Dependencies

- [ ] `Cargo.toml` mit allen dependencies (siehe `docs/ARCHITECTURE.md` § Cargo.toml)
- [ ] `tokio` mit `full` features (async subprocess + streaming)
- [ ] `reqwest` für PyPI HTTP check
- [ ] `which` für PATH-Lookup
- [ ] `regex` für Log-Parser

### 0.4 CI/CD

- [ ] `.github/workflows/ci.yml`: lint + typecheck + build (macOS/Linux/Windows matrix)
- [ ] `.github/workflows/release.yml`: git tag → build → GitHub Release mit 3 Binaries
- [ ] `.gitignore` (Rust + Node + Tauri + OS-spezifisch)

### 0.5 Projekt-Meta

- [ ] `README.md` Skeleton
- [ ] `CLAUDE.md` (fertig)
- [ ] `LICENSE` (AGPL-3.0, gleiche Lizenz wie odoodev)
- [ ] Initialer Commit + Push

---

## Phase 1 — MVP (~11 Tage)

### 1.1 Rust-Backend: Subprocess-Wrapper & JSON-Models (Tag 2-3)

#### `models.rs` — Serde-Structs für alle CLI-JSON-Responses

- [ ] `VersionInfo` (config versions --json): python, postgres, ports {db, odoo, gevent, mailpit}, base
- [ ] `VenvStatus` (venv check --json): version, venv_dir, exists, is_symlink, python_version, python_matches, requirements_current
- [ ] `DbListResponse` (db list --json): version, host, port, databases: Vec<String>
- [ ] `PlaybookEvent` (run --output json, NDJSON): event, name, status, message, exit_code, duration_ms, details (Phase 2)
- [ ] `PypiResponse` (HTTP): info.version

#### `odoodev.rs` — Subprocess-Wrapper

- [ ] `run_odoodev_json(args) -> Result<Value, String>` — executes odoodev, parses stdout as JSON
- [ ] `run_odoodev_text(args) -> Result<String, String>` — executes, returns stdout as text
- [ ] `run_odoodev_streaming(args, window, event_name) -> Result<i32, String>` — spawns child, reads stdout/stderr line-by-line, emits each line as Tauri event
- [ ] PATH-Ergänzung: `~/.local/bin`, `~/.cargo/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `%USERPROFILE%\.local\bin`
- [ ] `find_odoodev() -> Option<PathBuf>` — which("odoodev") + fallback paths
- [ ] `get_odoodev_version() -> Option<String>` — `odoodev --version` → regex parse

#### `log_parser.rs` — Port von `odoodev/tui/log_parser.py`

- [ ] `LogLevel` enum: Debug, Info, Warning, Error, Critical, Raw
- [ ] `OdooLogEntry` struct: timestamp, pid, level, database, logger, message, raw
- [ ] `parse_line(line) -> OdooLogEntry` — Regex aus Python-Original:
  ```
  ^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+)\s+(\d+)\s+(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s+(\S+)\s+(\S+?):\s*(.*)
  ```
- [ ] `LEVEL_ORDER` map für Severity-Vergleich
- [ ] Fallback: nicht-matchende Zeilen → `LogLevel::Raw`
- [ ] Unit tests: bekannte Odoo-Log-Zeilen, Traceback-Zeilen, Leerzeilen

#### `server_manager.rs` — Parallele Server-Verwaltung

- [ ] `OdooProcess` struct: child: Option<Child>, pid: u32, started_at: DateTime
- [ ] `ServerManager` struct: `Mutex<HashMap<String, OdooProcess>>` (key = version string)
- [ ] `start_server(version, args)`:
  1. Prüfe: läuft bereits ein Server für diese Version? → Fehler oder Warnung
  2. Baue CLI-Args aus GUI-Parametern (mode, database, update, install, advanced)
  3. Spawn `odoodev start <ver> [flags]` als child process mit piped stdout/stderr
  4. Speichere child + pid in HashMap
  5. Spawn tokio task: lese stdout zeilenweise → parse_line() → emit("odoodev-log:<version>", entry)
  6. Spawn tokio task: lese stderr zeilenweise → emit als Raw entries
  7. Spawn tokio task: poll child status alle 500ms → emit("server-status:<version>", {running, pid, uptime})
  8. Bei child exit: emit("server-exited:<version>", {exit_code})
- [ ] `stop_server(version, keep_docker, force)`:
  1. Lookup process in HashMap
  2. `odoodev stop <ver> --keep-docker [--force]` als subprocess
  3. Entferne aus HashMap
  4. Emit("server-status:<version>", {running: false})
- [ ] `get_server_status(version) -> ServerStatus` — lese aus HashMap (running, pid, uptime)
- [ ] `get_all_server_statuses() -> HashMap<String, ServerStatus>`
- [ ] Bei Stop: Log-Buffer wird NICHT geleert (Frontend verwaltet Buffer)

#### `installer.rs` — uv + odoodev Installation

- [ ] `ensure_uv() -> Result<UvInfo>`:
  1. `which::which("uv")` → gefunden? → return
  2. Check common paths: `~/.local/bin/uv`, `~/.cargo/bin/uv`, `/opt/homebrew/bin/uv`, `%USERPROFILE%\.local\bin\uv.exe`
  3. Nicht gefunden → `install_uv()`
- [ ] `install_uv()`:
  - macOS/Linux: `sh -c "curl -LsSf https://astral.sh/uv/install.sh | sh"`
  - Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`
  - Fallback: GitHub releases binary download (`astral-sh/uv`)
  - Nach Installation: PATH ergänzen + re-check
- [ ] `check_odoodev() -> Option<String>`:
  - `uv tool list` → parse output → find "odoodev-equitania" → extract version
  - Alternative: `odoodev --version` → regex
- [ ] `install_odoodev()`: `uv tool install odoodev-equitania`
- [ ] `upgrade_odoodev()`: `uv tool upgrade odoodev-equitania`

#### `pypi.rs` — PyPI Version Check

- [ ] `get_pypi_version() -> Option<String>`:
  - `reqwest::get("https://pypi.org/pypi/odoodev-equitania/json")` → parse JSON → `info.version`

#### `docker_check.rs` — Direkte Docker-Status-Prüfung

- [ ] `check_docker_status(version, expected_container_name) -> DockerStatus`:
  1. Check: `which("docker")` → wenn nicht da → DockerStatus::NotInstalled
  2. `docker ps --format "{{.Names}}"` → parse output → contains expected name?
  3. Apple Container: `which("container")` → `container ls` → parse
  4. Return: `DockerStatus { running: bool, container_name: String, runtime: "docker"|"apple"|"none" }`
- [ ] Container-Namen-Ermittlung: aus `config versions --json` + Version → `picard-dev-db-XX-native` Pattern
  - Besser: `odoodev docker status <ver>` ausführen und Output parsen (info-Zeile mit container name)
  - Oder: `.env`-Datei im native_dir lesen (POSTGRES_CONTAINER Variable)

#### Tauri-Commands registrieren (`main.rs`)

- [ ] `tauri::Builder::default()`
  - `.manage(ServerManager::new())`
  - `.plugin(tauri_plugin_shell::init())`
  - `.plugin(tauri_plugin_updater::Builder::new().build())`
  - `.invoke_handler(tauri::generate_handler![...])` — alle Commands aus `commands/`

### 1.2 uv-Installer & Auto-Update (Tag 3-4)

- [ ] First-run detection: `check_uv()` + `check_odoodev()` beim App-Start
- [ ] Wenn odoodev fehlt: Tauri Event "odoodev-not-installed" → Frontend zeigt Dialog
- [ ] Dialog: "odoodev is not installed. Install now?" → [Yes] [No]
- [ ] Bei Yes: `install_uv()` (falls nötig) → `install_odoodev()` → Progress-Dialog
- [ ] Nach Installation: Dashboard reload
- [ ] Update-Check: `get_pypi_version()` vs `check_odoodev()` → Version comparison
- [ ] Wenn Update verfügbar: Update-Badge im Header (blauer Punkt + "Update available v0.X.X → v0.Y.Y")
- [ ] Bei Klick "Update": `upgrade_odoodev()` → Progress → Version refresh
- [ ] Tauri Updater (GUI self-update): `check_app_update()` → Tauri-Updater-Dialog

### 1.3 Frontend: App-Shell & Navigation (Tag 4-5)

#### `App.tsx` — Layout

- [ ] Sidebar (left, fixed width): Icons + Labels
  - Dashboard (LayoutGrid icon)
  - Server (Rocket icon)
  - Databases (Database icon)
  - Settings (Settings icon)
  - Phase 2: Docker, Venv, Repos, Playbooks, Init, Migrate, Doctor
- [ ] Header (top bar): Logo + "odoodev" + version string + Update-Badge + Settings-Icon
- [ ] Main content area: active view (via react-router)
- [ ] Responsive: min-width 900px (Desktop-only, keine Mobile-Anpassung nötig)

#### `store/appStore.ts` — Zustand Global State

```typescript
interface AppState {
  // Meta
  odoodevVersion: string | null;
  pypiVersion: string | null;
  uvVersion: string | null;
  updateAvailable: boolean;
  firstRunChecked: boolean;
  odoodevInstalled: boolean;

  // Dashboard
  versions: Record<string, VersionInfo>;
  activeVersions: string[];
  venvStatus: Record<string, VenvStatus | null>;
  dockerStatus: Record<string, DockerStatus>;
  dashboardLoading: boolean;

  // Server (parallel)
  servers: Record<string, ServerState>;
  // ServerState = { status, pid, uptime, logBuffer, config }

  // Actions
  fetchVersions: () => Promise<void>;
  fetchVenvStatus: (version: string) => Promise<void>;
  fetchDockerStatus: (version: string) => Promise<void>;
  fetchAllDashboard: () => Promise<void>;
  checkOdoodevUpdate: () => Promise<void>;
  installOdoodev: () => Promise<void>;
  updateOdoodev: () => Promise<void>;
  startServer: (config: ServerConfig) => Promise<void>;
  stopServer: (version: string, force?: boolean) => Promise<void>;
  appendLog: (version: string, entry: OdooLogEntry) => void;
  clearLog: (version: string) => void;
}
```

#### `hooks/useOdoodev.ts` — Typed Tauri Invoke Wrappers

- [ ] Wrapper für jeden Tauri-Command mit TypeScript-Typen
- [ ] Error-Handling: Tauri errors → user-friendly messages

#### `hooks/usePolling.ts`

- [ ] Generic polling hook: `usePolling(fn, intervalMs, enabled)`
- [ ] Dashboard: 5s für Docker-Status, 30s für Venv-Status
- [ ] Server: 1s für Server-Status (wenn running)

### 1.4 Frontend: Dashboard-View (Tag 5-6)

#### `components/dashboard/Dashboard.tsx`

- [ ] Fetch `get_versions()` → 4 Version-Cards rendern
- [ ] Fetch `get_active_versions()` → opacity-Logik
- [ ] Pro Version: `get_venv_status(ver)` + `get_docker_status(ver)` polling
- [ ] Pro Version: `get_server_status(ver)` → Odoo-Running-Indicator
- [ ] Layout: 2x2 Grid (responsive: 1x4 bei schmalem Fenster)
- [ ] Loading-Skeleton während initial fetch

#### `components/dashboard/VersionCard.tsx`

- [ ] Version-Label (v16/v17/v18/v19) mit Farbcodierung:
  - v16: blau, v17: grün, v18: lila, v19: orange
- [ ] Status-Badges (Reihe von Pills):
  - Docker: ● grün (Running) / ○ grau (Stopped) / ✗ rot (Not installed) / — grau (no compose)
  - Venv: ✓ grün (current) / ⚠ gelb (stale) / ✗ rot (missing) / — grau (no requirements)
  - Python: "3.12" / "3.13" + match-Indikator (✓/✗)
  - Odoo: ● grün (Running, port XXXX) / ○ grau (Stopped)
- [ ] Ports-Übersicht: DB: 16432 | Odoo: 16069 | Mailpit: 16025
- [ ] Base-Dir Pfad (klein, dimmed)
- [ ] Quick-Actions:
  - "Start Server" → navigiert zu Server-View, pre-selects version
  - "Databases" → navigiert zu Database-View, pre-selects version
  - "Docker Up" / "Docker Down" → inline action
- [ ] Inactive state (nicht in active_versions):
  - Opacity 50%
  - "Not in active versions" subtitle
  - Start-Button disabled + tooltip
  - Docker Up/Down disabled

#### `components/dashboard/StatusBadge.tsx`

- [ ] Generic reusable badge: props { status: "ok"|"warn"|"error"|"neutral"|"running"|"stopped"|"disabled", label, icon }
- [ ] Farben: ok=green, warn=yellow, error=red, neutral=gray, running=green+pulse, stopped=gray, disabled=gray+50%opacity

### 1.5 Frontend: Server-View (Tag 6-8)

#### `components/server/ServerPanel.tsx`

- [ ] Tab-Bar: pro laufende/gestartete Version ein Tab
- [ ] Tab-Badge: ● grün (running) / ○ grau (stopped) / ● rot (crashed)
- [ ] "+ New" Tab → Start-Formular
- [ ] Pro Tab: eigene Log-Buffer (persistiert über Stop/Start)
- [ ] Bei Tab-Switch: Log-Buffer bleibt erhalten (nur Anzeige wechselt)

#### `components/server/ServerConfig.tsx`

- [ ] Version-Selektor (Dropdown v16-v19)
- [ ] Modus-Auswahl (Segmented Control):
  - Normal → `odoodev start <ver>`
  - Dev → `odoodev start <ver> --dev`
  - Shell → `odoodev start <ver> --shell`
  - Test → `odoodev start <ver> --test`
  - Prepare → `odoodev start <ver> --prepare`
- [ ] Database-Dropdown (via `get_databases(ver)`):
  - Refresh-Button
  - Empty: "No databases — start PostgreSQL first" + Button "Docker Up"
  - Error: "PostgreSQL not accessible" + Button "Start Docker"
- [ ] Module-Update-Feld (`-u`): Text-Input, comma-separated, placeholder "eq_sale,eq_stock"
- [ ] Module-Install-Feld (`-i`): Text-Input, comma-separated
- [ ] Advanced (collapsible section):
  - Host override (`--host`, default 127.0.0.1)
  - Load language (`--load-language de_DE`) + `--i18n-overwrite` checkbox
  - Clean sessions (`--clean-sessions` checkbox)
  - Custom config (`-c` file picker via Tauri dialog)
  - Allow default credentials (checkbox + orange warning)
  - Extra args (`--` passthrough text input)
- [ ] Start-Button (groß, primary) → disabled wenn Server schon läuft
- [ ] Wenn running: Start-Button wird zu "Restart" + "Stop" + "Force Stop"

#### `components/server/LogViewer.tsx` — Hauptkomponente

- [ ] **Filter-Bar** (top):
  - Level-Toggles: [All] [DEBUG] [INFO] [WARN] [ERROR] [CRIT] — Multi-Select
  - "All" = alle aktivieren; einzelne Levels toggle
  - RAW-Lines: erben Level der vorherigen Zeile (gleiche Logik wie TUI)
  - Search-Input (🔍) mit debounce
  - Action-Buttons: [Clear] [Save] [Copy Visible] [Copy Errors]
- [ ] **Log-List** (main area):
  - `@tanstack/react-virtual` für Virtualisierung (10k+ Zeilen flüssig)
  - Pro Zeile: `<LogLine>` mit Syntax-Highlighting
  - Auto-Scroll nach unten (wenn enabled + user nicht manuell gescrollt)
  - Scroll-Toggle Button (Auto-Scroll on/off)
  - Bei neuen Zeilen + Auto-Scroll off: "N new lines" badge → click → jump to bottom
- [ ] **Status-Bar** (bottom):
  - ● Running / ○ Stopped | v18 | PID 12345 | port 18069 | uptime 00:02:34
  - Zeilen-Anzeige: "12,345 lines | 23 errors | 5 warnings"
- [ ] **Trennlinie bei Stop:**
  - Wenn server-exited event: append `--- Server stopped (exit code N) ---` als Separator
  - Log-Buffer wird NICHT geleert
  - Bei Restart: neue Zeilen appended nach Trennlinie

#### `components/server/LogLine.tsx`

- [ ] Rendering mit Syntax-Highlighting:
  - Timestamp: `text-gray-500` (dim)
  - PID: `text-blue-400` (dim)
  - Level: farbig
    - DEBUG: `text-gray-500`
    - INFO: `text-foreground` (default)
    - WARNING: `text-yellow-500`
    - ERROR: `text-red-500`
    - CRITICAL: `text-red-500 font-bold`
    - RAW: `text-gray-600 italic` (tracebacks, startup messages)
  - Database: `text-cyan-400`
  - Logger: `text-blue-400` (dim)
  - Message: default text
  - SQL-Keywords in Message: `SELECT/INSERT/UPDATE/DELETE/WHERE/FROM/JOIN` in alternating colors
  - Traceback-Lines (RAW): monospace, `text-gray-600`, indentiert
- [ ] Filter: wenn Level nicht aktiv → `hidden` (nicht rendern)
- [ ] Search: wenn search-term → match → highlight background
- [ ] Click auf Zeile → expand (full-width, kein Truncation)

#### `hooks/useLogStream.ts`

- [ ] `listen("odoodev-log:<version>")` → append entry to buffer (Zustand store)
- [ ] `listen("server-status:<version>")` → update server state
- [ ] `listen("server-exited:<version>")` → append separator line, update status
- [ ] Buffer cap: 50.000 Zeilen (älteste werden entfernt, aber mit indicator "… N older lines truncated")
- [ ] Cleanup listener on tab close / unmount

#### `hooks/useServerStatus.ts`

- [ ] Pollt `get_server_status(ver)` alle 1s wenn running
- [ ] Update store: running, pid, uptime

### 1.6 Frontend: Database-View (Tag 8-9)

#### `components/database/DatabasePanel.tsx`

- [ ] Version-Selektor (Dropdown v16-v19)
- [ ] Fetch `get_databases(ver)` → DB-Tabelle
- [ ] Tabelle:
  - Spalte: Database Name (monospace font)
  - Spalte: Actions: [Backup] [Restore] [Drop] [Copy] [Rename] (icon buttons)
  - Refresh-Button (re-fetch)
  - Sort by name (click header)
- [ ] Empty State: "No databases found" + "Start PostgreSQL" button → `docker_up(ver)`
- [ ] Error State: "PostgreSQL not accessible on port XXXXX" + "Start Docker" button
- [ ] Loading State: skeleton rows
- [ ] Bulk-Select: checkboxes pro Zeile + "Drop Selected" (mit type-to-confirm)

#### `components/database/BackupDialog.tsx`

- [ ] Modal Dialog
- [ ] Database name (read-only, from selected row)
- [ ] Format radio: SQL / ZIP / tar.zst
- [ ] Level slider (1-22) — nur sichtbar wenn tar.zst, default 5
- [ ] Output directory picker (Tauri dialog API) — default `~/Downloads`
- [ ] [Cancel] [Backup] buttons
- [ ] Bei Backup: `backup_db({version, name, type, output_dir, level})`
- [ ] Progress: `listen("backup-progress")` → live stdout in modal
- [ ] Bei Erfolg: "Backup saved: ~/Downloads/v18_exam_250710.zip (45.2 MB)" + [Open Folder] button

#### `components/database/RestoreDialog.tsx`

- [ ] Modal Dialog, 3-Step Wizard
- [ ] **Step 1/3 — Source:**
  - Backup file picker (Tauri dialog, filter: .zip .7z .tar .tar.zst .gz .sql)
  - Auto-detect format from extension
- [ ] **Step 2/3 — Target:**
  - New DB name (text input, validation: letters/digits/underscore, not starting with digit)
  - Checkbox: "Drop existing database first" (default off)
- [ ] **Step 3/3 — Post-Processing:**
  - Sanitize section (boxed):
    - Checkbox "—sanitize (enable all below)" → toggles 5 sub-options
    - Sub: ☐ Deactivate cron + mail (--deactivate-cron)
    - Sub: ☐ Neutralize (--neutralize)
    - Sub: ☐ Anonymize (--anonymize)
    - Sub: ☐ Wipe content (--wipe)
    - Sub: ☐ Purge master data (--purge-master-data)
      - ⚠ Warning text when checked: "WARNING: This DELETEs customers/vendors, CRM/HR data, messages, attachments. Keeps products, pricelists, users, companies, config."
      - Sub-override: "Escape with --no-purge-master-data" (nur sichtbar wenn sanitize an + purge-master-data an)
  - Independent options (outside sanitize):
    - ☐ Anonymize users (--anonymize-users, not in --sanitize)
      - Dev password input (default "ownerp") — nur sichtbar wenn anonymize-users checked
    - ☐ Purge transactions (--purge-transactions, not in --sanitize)
  - Modules to uninstall: text input (comma-separated, optional)
  - ☐ Recompute stored fields (--recompute)
  - ☐ Skip confirmation (-y) — default on für GUI (GUI ist die Bestätigung)
- [ ] CLI-Mapping Logik (Frontend → CLI args):
  - `--sanitize` flag wenn sanitize checkbox an (und keine sub-overrides)
  - Stattdessen: wenn sanitize an, setze alle 5 sub-flags einzeln (bessere Kontrolle)
  - `--no-purge-master-data` wenn sanitize an aber purge-master-data sub-off
  - `--anonymize-users` separat
  - `--purge-transactions` separat
  - `--uninstall-modules` wenn modules eingegeben
  - `--recompute` wenn checked
  - `-y` immer (GUI ist die Bestätigung)
  - `--drop` wenn "drop existing" checked
- [ ] [Cancel] [Dry Run] [Restore] buttons
- [ ] Dry Run: `restore_db({...dry_run: true})` → zeigt Plan in readonly text area
- [ ] Restore: `restore_db({...dry_run: false})` → `listen("restore-progress")` → live stdout
- [ ] Bei Erfolg: "Database 'v18_restored' restored successfully" + [Go to Server] button

#### `components/database/DropConfirmDialog.tsx`

- [ ] Dialog: "Drop database 'v18_exam'?"
- [ ] Warning: "This action cannot be undone. All data will be permanently lost."
- [ ] Type-to-confirm: "Type the database name to confirm" → input must match
- [ ] [Cancel] [Drop] (disabled until name matches)
- [ ] Bei Drop: `drop_db({version, name, yes: true})`

#### `components/database/OperationProgress.tsx`

- [ ] Modal: live stdout streaming für backup/restore/drop/copy/rename
- [ ] Spinner + "Running..." label
- [ ] Scrollable text area (monospace)
- [ ] Bei Erfolg: grüne checkmark + summary
- [ ] Bei Fehler: rotes X + error message
- [ ] [Close] button (enabled after completion)

### 1.7 Frontend: Settings-View (Tag 9)

#### `components/settings/SettingsPanel.tsx`

- [ ] Section: "odoodev"
  - Installed version: "v0.49.1"
  - Latest version: "v0.50.0"
  - [Update odoodev] button (nur wenn update available)
  - [Reinstall odoodev] button (secondary)
  - Progress indicator während update
- [ ] Section: "uv"
  - Version: "uv 0.11.28"
  - Path: `/Users/picard/.local/bin/uv`
  - [Reinstall uv] button (secondary)
- [ ] Section: "GUI"
  - Version: "1.0.0"
  - [Check for Updates] button (Tauri updater)
- [ ] Section: "Language"
  - Radio: Deutsch / English (für zukünftige i18n — Phase 1 hardcodiert EN)
- [ ] Section: "About"
  - "odoodev-gui — Odoo Development Manager"
  - "Copyright 2026 Equitania Software GmbH"
  - "License: AGPL-3.0"
  - GitHub Link (opens in browser)

### 1.8 Frontend: Install Dialog & Update Badge (Tag 9-10)

#### `components/InstallDialog.tsx`

- [ ] First-run detection: App-Start → `check_uv()` + `check_odoodev()`
- [ ] Wenn odoodev nicht installiert:
  - Modal: "odoodev is not installed"
  - Text: "odoodev is the CLI tool that this GUI controls. It will be installed via uv (Python package manager)."
  - [Install now] [Skip] buttons
- [ ] Wenn uv nicht installiert:
  - Modal: "uv is not installed"
  - Text: "uv is the Python package manager needed to install and update odoodev."
  - [Install uv now] [Skip] buttons
- [ ] Bei Install: Progress-Dialog mit stdout streaming
- [ ] Nach Erfolg: Dashboard reload

#### `components/UpdateBadge.tsx`

- [ ] Im Header (rechts): Badge + "Update available" text
- [ ] Tooltip: "Current: v0.49.1 | Latest: v0.50.0"
- [ ] Click → Dropdown:
  - "Update odoodev to v0.50.0" → `upgrade_odoodev()`
  - "Release notes" → opens browser (CHANGELOG URL)
- [ ] Nach Update: Badge verschwindet, neue version im Header

### 1.9 Cross-Platform Testing & Polish (Tag 10-11)

- [ ] macOS: Test auf Apple silicon + Intel
- [ ] Linux: Test in Ubuntu VM (webkit2gtk)
- [ ] Windows: Test in Windows 11 VM (WebView2)
- [ ] PATH-Edge Cases:
  - uv in `~/.local/bin` aber nicht in GUI-PATH → Rust ergänzt
  - odoodev via `uv tool` installiert → PATH zum tool bin
  - Docker Desktop (macOS/Windows) vs Docker Engine (Linux)
- [ ] Error Handling:
  - odoodev subprocess crash → error dialog
  - Docker not running → friendly message + action button
  - No databases → empty state
  - Network error (PyPI check) → silent fail (non-blocking)
- [ ] Loading States: skeleton components für alle Views
- [ ] Empty States: illustrative messages + action buttons
- [ ] Window: min-size enforcement, resizable, maximize
- [ ] Final commit + git tag `v1.0.0` → Release build

---

## Phase 2 — Extended Features (~16 Tage)

### 2.1 Docker/Container Panel (Tag 12-13)

- [ ] Docker status pro version (via `docker_check.rs`)
- [ ] Docker Up/Down buttons pro version
- [ ] Runtime selector (Docker / Apple Container — Apple nur macOS 26)
- [ ] Docker logs viewer (streaming via `odoodev docker logs -f`)
- [ ] Benchmark view (`odoodev bench --output json` — falls --json verfügbar, sonst text parsing)

### 2.2 Venv Panel (Tag 13-14)

- [ ] Venv status per version (`venv check --json`)
- [ ] Venv setup (`venv setup <ver> --force`)
- [ ] Venv remove (`venv remove <ver> -y`)
- [ ] Requirements freshness indicator
- [ ] Python version mismatch warning

### 2.3 Repos Panel (Tag 14-15)

- [ ] Repos status (clone/update)
- [ ] `repos <ver>` execute
- [ ] `pull <ver>` execute
- [ ] Config-only regeneration (`repos <ver> --config-only`)
- [ ] Progress streaming

### 2.4 Env Panel (Tag 15-16)

- [ ] `.env` status (`env check <ver>`)
- [ ] `.env` setup (`env setup <ver> --non-interactive`)
- [ ] `.env` show (`env show <ver>`)
- [ ] `.env` dir path

### 2.5 Playbook Runner (Tag 16-18)

- [ ] Playbook list (`run --list`)
- [ ] Playbook file picker
- [ ] Inline step builder (checkbox list of valid commands)
- [ ] `--var KEY=VALUE` inputs
- [ ] `--dry-run` button
- [ ] Execute with NDJSON live stream (`run --output json`)
- [ ] Per-step status display (OK/ERROR/SKIP badges)
- [ ] Summary at end

### 2.6 Init Wizard (Tag 18-19)

- [ ] Guided wizard for `odoodev init <ver>`
- [ ] Step 1: Choose version
- [ ] Step 2: Options (--skip-repos, --skip-docker, --non-interactive)
- [ ] Step 3: Execute with progress
- [ ] `odoodev setup` wizard (interactive mode)

### 2.7 Migrate Panel (Tag 19-20)

- [ ] Migration group list (`migrate list`)
- [ ] Create group (`migrate create --from --to --name --pg-version`)
- [ ] Activate/deactivate (`migrate activate/deactivate`)
- [ ] Status display (`migrate status`)
- [ ] Remove group (`migrate remove`)

### 2.8 Doctor / Health Check (Tag 20-21)

- [ ] `odoodev doctor <ver>` execute
- [ ] Parse Rich table output → render as GUI table
- [ ] Status badges (✓/✗/⚠) per check
- [ ] Action buttons for failed checks (e.g. "Start Docker" if PostgreSQL failed)

### 2.9 Full i18n DE/EN (Tag 21-23)

- [ ] i18n setup (`react-i18next` or `i18next`)
- [ ] Translation files: `src/locales/en.json`, `src/locales/de.json`
- [ ] All UI strings translated
- [ ] Language switch in Settings (persisted)
- [ ] Default: system language detection

---

## Phase 3 — Polish & Release (post-Phase 2)

- [ ] App Store / Distribution strategy
- [ ] Code signing (macOS notarization, Windows code signing)
- [ ] Auto-update channel setup (stable + nightly)
- [ ] Documentation: user manual (bilingual)
- [ ] Screenshots for GitHub Release
- [ ] Website announcement (it-guy.ai blog post)

---

## Dependency Graph

```
Phase 0 (Setup)
  ├── 0.1 Tauri init ──┐
  ├── 0.2 Frontend setup ┤
  ├── 0.3 Rust deps ─────┤
  ├── 0.4 CI/CD ─────────┤
  └── 0.5 Meta ──────────┘
                         ▼
Phase 1 (MVP)
  1.1 Rust Backend ────────┐
  1.2 uv/Update ───────────┤
  1.3 App-Shell ───────────┤
  1.4 Dashboard ───────────┤ (depends on 1.1 for data)
  1.5 Server View ─────────┤ (depends on 1.1 for streaming)
  1.6 Database View ───────┤ (depends on 1.1 for JSON)
  1.7 Settings ────────────┤ (depends on 1.2 for update)
  1.8 Install/Update UI ───┤ (depends on 1.2)
  1.9 Testing & Polish ────┘ (depends on all above)
                           ▼
                    v1.0.0 Release
                           │
Phase 2 (Extended) ◀────────┘
  2.1 Docker ─── 2.2 Venv ─── 2.3 Repos ─── 2.4 Env
  2.5 Playbooks ─── 2.6 Init ─── 2.7 Migrate ─── 2.8 Doctor
  2.9 i18n (independent)
                           ▼
                    v2.0.0 Release
```

---

## Time Estimate Summary

| Phase | Content | Days |
|-------|---------|------|
| 0 | Setup + CI | 1 |
| 1.1 | Rust Backend (subprocess, JSON, log_parser, server_manager) | 2 |
| 1.2 | uv-Installer + Auto-Update | 1.5 |
| 1.3 | App-Shell + Navigation + State | 1 |
| 1.4 | Dashboard View | 1.5 |
| 1.5 | Server View + Log-Viewer | 2 |
| 1.6 | Database View + Dialogs | 2 |
| 1.7 | Settings View | 0.5 |
| 1.8 | Install Dialog + Update Badge | 0.5 |
| 1.9 | Cross-Platform Testing + Polish | 1.5 |
| **MVP Total** | | **~11.5** |
| 2.1 | Docker Panel | 2 |
| 2.2 | Venv Panel | 1.5 |
| 2.3 | Repos Panel | 1.5 |
| 2.4 | Env Panel | 1 |
| 2.5 | Playbook Runner | 2 |
| 2.6 | Init Wizard | 2 |
| 2.7 | Migrate Panel | 1.5 |
| 2.8 | Doctor / Health Check | 1 |
| 2.9 | Full i18n DE/EN | 2 |
| **Phase 2 Total** | | **~14.5** |
| **Grand Total** | | **~26** |