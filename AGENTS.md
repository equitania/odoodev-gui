# AGENTS.md

Compact guidance for OpenCode agents working in this repo.
Read `CLAUDE.md` for full project context; this file captures only what an agent
would otherwise get wrong.

## Commands

```bash
pnpm install                    # frontend deps
~/.cargo/bin/cargo-tauri dev    # dev mode: Vite hot-reload + Rust rebuild
~/.cargo/bin/cargo-tauri build  # production bundle (.dmg/.msi/.AppImage)

pnpm run typecheck              # tsc --noEmit  (frontend only, src/)
pnpm run lint                   # eslint src --ext ts,tsx
cargo check                     # Rust compile check (run in src-tauri/)
cargo test                      # Rust unit tests (log_parser.rs only so far)
cargo clippy                    # Rust lint
cargo fmt --check               # Rust format check
```

**`pnpm tauri …` does NOT work** — `@tauri-apps/cli` is not in devDependencies.
Use the globally installed `~/.cargo/bin/cargo-tauri` binary instead.

The Vite dev server is pinned to port **1420** (`strictPort: true`); Tauri's
`beforeDevCommand` runs `pnpm dev` for you, so `cargo-tauri dev` is the single
entry point — don't start Vite separately.

## Verification order

`pnpm run lint` → `pnpm run typecheck` → `cargo check` (run all three before
considering work done). CI runs lint + typecheck on Ubuntu, then a 3-OS build
matrix via `cargo-tauri build`.

## Architecture

Two crates share one workspace root:

- `src-tauri/` — Rust + Tauri v2 backend. `main.rs` → `lib.rs::run()` is the
  real entry point; all `#[tauri::command]` handlers live in `src-tauri/src/commands/`.
  `odoodev.rs` is the subprocess wrapper (JSON / text / streaming / spawn).
  `server_manager.rs` holds `HashMap<String, OdooProcess>` for parallel servers.
- `src/` — React 19 + TypeScript frontend. `App.tsx` is the shell
  (Sidebar + Header + active view). Views live in `src/components/{dashboard,server,database,settings}/`.
  State: Zustand (`src/store/appStore.ts`, `toastStore.ts`). IPC calls go through
  `src/lib/tauri.ts` `invokeCmd()` → `useOdoodev` hook.

The GUI is a **pure presentation layer**: it shells out to the `odoodev` Python
CLI and parses JSON/NDJSON/stdout. Never duplicate `odoodev` logic in Rust or TS.
The related CLI repo is `/Users/picard/gitbase/PyPi-Projects/odoo-dev`.

### PATH augmentation (non-obvious)

`odoodev.rs::augment_path()` prepends `~/.local/bin`, `~/.cargo/bin`,
`/opt/homebrew/bin`, `/usr/local/bin` (Unix) to every subprocess's `PATH`.
This is required because `uv`/`odoodev` live in `~/.local/bin`, which is often
not on the Tauri-spawned process's PATH. `find_binary()` falls back to the same
dirs if `which::which()` fails. When adding new subprocess calls, use
`augment_path(&mut cmd)`.

### Runtime detection (Apple Container vs Docker)

`odoodev` config `container_runtime` takes priority over PATH detection.
If config says `apple`, **Docker is never touched** — no `docker ps`, no socket
probes. Apple Container is queried via `container ls --format json` with
port-match over `publishedPorts.hostPort`. Platform + runtime are cached once
at app start in the Zustand store. Don't add Docker calls gated only on platform;
always check the cached runtime first.

### Frontend conventions

- Import alias: `@/*` → `./src/*` (configured in `tsconfig.json` and `vite.config.ts`).
- shadcn/ui primitives live in `src/components/ui/`; `components.json` points at
  `@/components`, `@/lib/utils`, base color `slate`, CSS variables enabled.
- Tailwind v4 via `@tailwindcss/vite` (no `tailwind.config.js` — v4 CSS-first config).
- Log buffer cap is 50 000 lines (`src/lib/constants.ts::LOG_BUFFER_CAP`);
  the LogViewer uses `@tanstack/react-virtual` for virtual scrolling.
- Polling intervals: docker 5 s, venv 30 s, server 1 s (same constants file).

## Style

- Rust: follow existing modules — `anyhow` for errors, `serde` for CLI JSON,
  `tokio` for async subprocess streaming. No comments unless asked.
- TS/React: no comments unless asked. `noUnusedLocals` + `noUnusedParameters`
  are on (`tsconfig.json` strict), so unused imports fail typecheck.

## Tests

Only `src-tauri/src/log_parser.rs` has `#[test]`s (regex parser port from
`odoodev/tui/log_parser.py`). No frontend tests yet. `cargo test` is the only
test runner.

## Docs that matter

- `docs/TAURI_API.md` — every `invoke`/`listen` signature (authoritative for IPC).
- `docs/CLI_INTEGRATION.md` — CLI command → output format matrix.
- `docs/DECISIONS.md` — user-confirmed design choices (don't override without asking).
- `CLAUDE.md` — fuller project guide; this file is the distilled subset.