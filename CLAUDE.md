# CLAUDE.md

This file provides guidance to Claude Code when working on the odoodev-gui project.

## What is odoodev-gui?

A native desktop GUI (macOS / Linux / Windows) for the `odoodev` Python CLI tool.
The GUI is a **pure presentation layer** — it shells out to `odoodev` as a subprocess
and parses its JSON / NDJSON / stdout output. No Python logic is duplicated.

The GUI also manages `uv` (install if missing) and `odoodev` (install / upgrade via `uv tool`).

## Tech Stack

- **Backend:** Rust + Tauri v2
- **Frontend:** React 19 + TypeScript + Vite
- **UI:** Tailwind CSS v4 + shadcn/ui
- **State:** Zustand
- **Icons:** lucide-react
- **Virtual scrolling:** @tanstack/react-virtual (Log viewer with 10k+ lines)

## Project Structure

```
odoodev-gui/
├── src-tauri/           # Rust backend (Tauri v2)
│   ├── src/
│   │   ├── main.rs      # Tauri entry, plugin + state registration
│   │   ├── odoodev.rs   # Subprocess wrapper: run_odoodev_json/text/streaming
│   │   ├── server_manager.rs  # HashMap<version, OdooProcess> for parallel servers
│   │   ├── log_parser.rs      # Port of odoodev's tui/log_parser.py
│   │   ├── installer.rs       # uv install + odoodev install/upgrade
│   │   ├── pypi.rs            # PyPI version check via reqwest
│   │   ├── docker_check.rs    # Direct docker ps / container ls (no CLI text parsing)
│   │   ├── models.rs          # Serde structs for CLI JSON responses
│   │   └── commands/         # #[tauri::command] thin wrappers
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                 # React frontend
│   ├── App.tsx          # Layout shell: Sidebar + Header + active view
│   ├── components/
│   │   ├── ui/          # shadcn/ui primitives
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── dashboard/   # Dashboard view (4 version cards)
│   │   ├── server/     # Server view (multi-tab, log viewer)
│   │   ├── database/   # Database view (list, backup, restore)
│   │   └── settings/   # Settings view
│   ├── hooks/          # useOdoodev, usePolling, useLogStream, useServerStatus
│   ├── store/          # Zustand global state
│   ├── types/          # TypeScript types mirroring Rust models
│   └── lib/            # tauri.ts, constants.ts
├── docs/               # Design documents (this file's companions)
├── package.json
└── .github/workflows/  # CI + Release builds (3-OS matrix)
```

## Core Architecture

```
React Frontend ←─IPC (invoke/listen)─→ Rust Backend (Tauri)
                                           │
                                           ▼ subprocess
                                     odoodev CLI
                                     uv tool
```

The Rust backend:
1. Executes `odoodev` commands as subprocesses
2. Parses JSON output (serde) for structured data
3. Streams stdout line-by-line for `odoodev start` (log streaming)
4. Parses Odoo log lines with a ported regex from `odoodev/tui/log_parser.py`
5. Emits structured Tauri events to the frontend
6. Manages multiple parallel server processes via `HashMap<String, OdooProcess>`

## Key Design Decisions

See `docs/DECISIONS.md` for the full decision log. Highlights:

- **CLI-Wrapper, not reimplementation:** All logic stays in `odoodev`. The GUI only calls and presents.
- **Parallel servers:** Multiple Odoo versions can run simultaneously (multi-tab UI).
- **uv auto-install:** If `uv` is missing, the GUI installs it (platform-specific).
- **odoodev auto-install:** First-run dialog "odoodev not installed. Install now?"
- **odoodev update:** Notification badge only; update on explicit user click.
- **Log buffer persists across stop/start:** Separator line inserted, not cleared.
- **Dashboard:** All 4 versions always shown; inactive ones greyed out.
- **TUI stays:** The existing Textual TUI (`odoodev start --tui`) coexists with the GUI.

## CLI Integration Surface

The GUI communicates with `odoodev` via these channels:

| Method | Commands | Format |
|--------|----------|--------|
| JSON (serde) | `config versions --json`, `venv check --json`, `db list --json` | Single-line JSON |
| NDJSON stream | `run --output json` | One JSON object per line (Phase 2) |
| stdout streaming | `start`, `db backup`, `db restore` | Line-by-line text |
| Exit code | `stop`, `db drop`, `db copy`, `db rename` | 0 = success |
| Direct (Rust) | Docker status check | `docker ps` / `container ls` (bypasses CLI) |
| HTTP | PyPI version check | `pypi.org/pypi/odoodev-equitania/json` |

See `docs/CLI_INTEGRATION.md` for the complete matrix.

## Common Commands (once setup is complete)

```bash
# Development
pnpm install              # install frontend deps
pnpm tauri dev            # launch dev mode (hot-reload frontend + Rust rebuild)
pnpm tauri build          # production build (creates .app/.exe/.AppImage)

# Lint & Typecheck
pnpm run lint             # eslint
pnpm run typecheck        # tsc --noEmit
cargo clippy              # Rust lint
cargo fmt --check         # Rust format check

# Tests
cargo test                # Rust unit tests
pnpm test                 # Frontend tests (vitest, once added)
```

## Build Prerequisites

- **Rust** 1.75+ (rustc/cargo)
- **Node.js** 20+
- **pnpm** (package manager)
- **Tauri v2 CLI:** `cargo install tauri-cli --version "^2"`
- **Platform-specific:**
  - macOS: Xcode Command Line Tools
  - Linux: `webkit2gtk-4.1`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
  - Windows: WebView2 (preinstalled on Win10/11), MSVC Build Tools

## Security

- No secrets in frontend; DB passwords stay in `.env` (managed by odoodev)
- Tauri permissions: only `shell` (subprocess) and `updater` enabled
- `--allow-default-credentials` shows a warning in the GUI
- odoodev is never auto-updated without explicit user click

## Documentation

- `docs/PLAN.md` — Full implementation plan with all phases and time estimates
- `docs/ARCHITECTURE.md` — Architecture, data flow, file structure details
- `docs/CLI_INTEGRATION.md` — CLI integration matrix, JSON formats, parsing strategies
- `docs/TAURI_API.md` — Tauri command API reference (all invoke/listen signatures)
- `docs/DECISIONS.md` — Decision log with all user-confirmed choices

## Related Repository

- **odoodev CLI:** `/Users/picard/gitbase/PyPi-Projects/odoo-dev` (Python, PyPI package `odoodev-equitania`)
- **Agent Capability Card:** `usage/AGENT.md` in the odoodev repo — documents every CLI command and flag