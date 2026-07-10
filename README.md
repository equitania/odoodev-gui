# odoodev-gui

Native desktop GUI for the [odoodev](https://github.com/equitania/odoo-dev) CLI tool.

> **Status:** Phase 1 MVP implementiert — Dashboard, Server, Databases, Settings funktionsfähig.
> Apple Container Integration aktiv. Phase 2 (Docker Panel, Venv, Repos, Playbooks, i18n) offen.

## What is this?

A native desktop application (macOS / Linux / Windows) that provides a graphical
interface for `odoodev` — the unified CLI tool for native Odoo development environment
management (Odoo v16–v19).

The GUI is a **pure presentation layer**: it shells out to `odoodev` as a subprocess
and parses its JSON / stdout output. No Python logic is duplicated. The GUI also
manages `uv` (installs if missing) and `odoodev` (installs / upgrades via `uv tool`).

## Tech Stack

- **Backend:** Rust + Tauri v2
- **Frontend:** React 19 + TypeScript + Vite
- **UI:** Tailwind CSS v4 + shadcn/ui primitives
- **State:** Zustand (+ toast notification system)
- **Icons:** lucide-react
- **Virtual scrolling:** @tanstack/react-virtual (Log viewer with 10k+ lines)
- **Distribution:** Native bundles (.dmg / .msi / .AppImage)

## Features (Implemented)

### Phase 1 — MVP ✅

- **Dashboard:** 4 Version-Cards (v16–v19) mit Status-Badges (Docker/Container, Venv, Python, Odoo),
  Polling, Docker Up/Down inline, Quick-Actions (Start Server, Databases)
- **Server:** Alle 4 Versionen als Tabs, ServerConfig (5 Modi: Normal/Dev/Shell/Test/Prepare,
  Database-Dropdown, Module-Update/Install, Advanced: Host, Language, Clean-Sessions, Config,
  Default-Credentials, Extra-Args), LogViewer mit Virtual Scrolling, Level-Filter (DEBUG/INFO/
  WARNING/ERROR/CRITICAL), Search, Auto-Scroll, Copy, Syntax-Highlighting, Stop/Start-Buffer-Persistenz
- **Databases:** DB-Liste, Backup (SQL/ZIP/tar.zst mit Level), Restore (3-Step Wizard mit Dry Run,
  Sanitize, Anonymize, Purge, Recompute), Drop (type-to-confirm), Copy, Rename, Bulk-Drop,
  Operation-Progress mit live stdout
- **Settings:** odoodev Version + Update, uv Version + Reinstall, GUI Version, About
- **Auto-Install:** InstallDialog bei fehlendem uv/odoodev
- **Auto-Update:** UpdateBadge im Header bei neuer odoodev-Version (PyPI check)
- **Toast-Notifications:** Success/Error/Loading mit Auto-dismiss
- **Apple Container:** Runtime-Erkennung aus odoodev Config (`container_runtime: apple`),
  `container ls --format json` für Container-Status, `--runtime apple` wird an odoodev durchgereicht,
  Docker wird nie angerührt wenn Config apple sagt

### Phase 2 — Offen

- Docker/Container Panel (up/down/status/logs, benchmark)
- Venv Panel (setup/check/remove)
- Repos Panel (clone/update/config-regenerate)
- Playbook Runner (NDJSON live progress)
- Init Wizard (guided environment setup)
- Migration Group Management
- Doctor / Health Check
- Full i18n (DE/EN)

## Getting Started

```bash
pnpm install              # install frontend deps
~/.cargo/bin/cargo-tauri dev   # launch dev mode (hot-reload frontend + Rust rebuild)
~/.cargo/bin/cargo-tauri build  # production build
```

**Prerequisites:** Rust 1.75+, Node.js 20+, pnpm, Tauri CLI v2 (`cargo install tauri-cli --version "^2"`),
`odoodev` installed (`uv tool install odoodev-equitania`)

## Documentation

| Document | Content |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Project guidance for Claude Code |
| [docs/PLAN.md](docs/PLAN.md) | Full implementation plan with all phases and time estimates |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, data flow, file structure, code examples |
| [docs/CLI_INTEGRATION.md](docs/CLI_INTEGRATION.md) | CLI integration matrix, JSON formats, parsing strategies |
| [docs/TAURI_API.md](docs/TAURI_API.md) | Tauri IPC command API reference (all invoke/listen signatures) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log with all user-confirmed design choices |

## Related

- **odoodev CLI:** [odoo-dev repository](https://github.com/equitania/odoo-dev) (PyPI: `odoodev-equitania`)
- **Agent Capability Card:** `usage/AGENT.md` in the odoodev repo

## License

AGPL-3.0-or-later (same as odoodev)

## Copyright

Copyright 2025 Equitania Software GmbH