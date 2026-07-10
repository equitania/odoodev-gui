# odoodev-gui

Native desktop GUI for the [odoodev](https://github.com/equitania/odoo-dev) CLI tool.

> **Status:** Planning phase — implementation not yet started.
> See `docs/PLAN.md` for the full implementation plan.

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
- **UI:** Tailwind CSS v4 + shadcn/ui
- **State:** Zustand
- **Distribution:** Native bundles (.dmg / .msi / .AppImage)

## Features (Planned)

### Phase 1 — MVP

- **Dashboard:** Status overview for all 4 Odoo versions (Docker, Venv, Odoo running)
- **Server:** Start/stop Odoo in multiple modes (normal, dev, shell, test, prepare) with live log viewer (syntax highlighting + level filtering)
- **Databases:** List, backup, restore (with sanitize wizard), copy, rename, drop
- **Auto-Install:** Installs `uv` and `odoodev` if missing
- **Auto-Update:** Update notification for `odoodev` (manual click to update)
- **Parallel Servers:** Run multiple Odoo versions simultaneously

### Phase 2 — Extended

- Docker/Container panel (up/down/status/logs, benchmark)
- Venv panel (setup/check/remove)
- Repos panel (clone/update/config-regenerate)
- Playbook runner (NDJSON live progress)
- Init wizard (guided environment setup)
- Migration group management
- Doctor / health check
- Full i18n (DE/EN)

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