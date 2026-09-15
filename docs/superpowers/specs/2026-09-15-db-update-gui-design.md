# `db update` in the GUI — module updates across many databases

**Date:** 15.09.2026 · **Target releases:** odoodev 0.69.0 (CLI), odoodev-gui 1.8.0 · **Status:** design approved in chat

## Problem

odoodev 0.68 added `odoodev db update`: it runs `odoo-bin -u <modules> --stop-after-init`
sequentially over a selection of databases, records which repository commits a clean `-u all`
ran against, and `--stale` updates only databases whose repositories changed since. A
developer keeps several databases per Odoo version and needs this after every repository
sync. The GUI offers none of it: the database list does not show which databases are out of
date, and there is no way to update one or many of them.

A run can take an hour or more (2–5 min per database). The GUI must show progress per
database while it runs, must be able to stop it without leaving `odoo-bin` running on the
database, and must not block the whole app meanwhile.

## Decisions

- **The CLI streams events, the GUI only presents them** (the GUI is a presentation layer).
  odoodev 0.69.0 gains `db update --output ndjson`; the GUI requires odoodev ≥ 0.69.0 for
  every update feature.
  *Rejected:* the GUI looping over `db update -n <db> --json` itself — no CLI release needed,
  but warnings would only arrive after each database, and selection/stale planning would be
  duplicated in the GUI. *Rejected:* streaming the Rich text output — no per-database state,
  summary only readable as text.
- **Scope of the first version:** stale markers + "update stale" button, "update selected"
  for the existing multi-selection, free module list (default `all`), stale count on the
  dashboard version card.
- **Running server on that version:** the start dialog offers *stop, update, restart* /
  *update anyway* / *cancel*.
- **Progress is not a modal.** A docked panel in the database view plus a header indicator.
- **Cancel = SIGTERM, never SIGKILL by default** (odoodev then kills Odoo's process group).
- **Bulk drop reporting fix** ships in the same release (it always reports success today).

Out of scope: `pull --update` in the GUI, parallel updates on one version, signal-based cancel
on Windows (see Error handling).

## 1. CLI contract — odoodev 0.69.0

New option on `odoodev db update`: `--output ndjson`.

- Same selection rules as `--json`: `-n/--name`, `--all` or `--stale` is required; `-m` and the
  interactive picker are refused. `--output ndjson` and `--json` together are refused.
- stdout carries **only** event lines (one JSON object per line); every human-readable message
  goes to stderr. Implies `--yes`.
- Events are produced from the same callbacks that feed the progress bar and the summary today
  (`execute_updates`' `on_issue` / `on_result`, plus the plan and the summary), so the stream
  cannot diverge from the text output.

| `event` | Emitted | Fields |
|---|---|---|
| `plan` | once, after the preflight | `version`, `modules`, `targets: [{database, reason}]` (`reason` null when forced current), `skipped_current: [..]`, `server_running: bool` |
| `start` | before each database | `database`, `index` (1-based), `total`, `log` (path) |
| `issue` | per forwarded Odoo line | `database`, `level` (`WARNING`\|`ERROR`\|`CRITICAL`\|`RAW`), `text` |
| `result` | after each database | `database`, `ok`, `exit_code`, `duration_s`, `warnings`, `errors`, `last_error`, `timed_out`, `log` (same keys as `--json` results) |
| `summary` | once, at the end of a completed run | `results: [..]`, `skipped_current: [..]`, `exit_code` (0 all ok, 1 any failed) |
| `interrupted` | on SIGTERM / SIGHUP / Ctrl+C | `database` (the one that was running, or null) — process exits 130 |
| `error` | preflight failure before `plan` | `message` — process exits 1 |

- `RAW` issues are the continuation lines (tracebacks) Odoo prints after a WARNING/ERROR, as
  the text mode already forwards them.
- `--dry-run` emits `plan` only and exits 0. Nothing to update (all current / no databases)
  emits `plan` with empty `targets` followed by `summary` with empty `results`, exit 0.
- Every exit ≠ 0 before `plan` emits exactly one `error` event, including failures raised as
  `SystemExit` inside helpers (PostgreSQL unreachable, invalid names).
- Documented in `usage/AGENT.md` ("Machine-readable outputs"), RELEASE_NOTES 0.69.0, README.

Tests (CLI): event order for a mixed run (ok / errors logged / failed), `--dry-run`, nothing to
do, preflight `error`, `interrupted` on KeyboardInterrupt, stdout contains only valid JSON
lines, selection rules and the `--json` conflict.

## 2. Backend (Rust, `src-tauri/`)

### Commands

```rust
// camelCase on the wire (Tauri v2 convention in this repo)
#[serde(rename_all = "camelCase")]
struct DbUpdateArgs {
    version: String,
    mode: DbUpdateMode,          // "names" | "stale" | "all"
    names: Vec<String>,          // required non-empty for mode = names
    modules: String,             // default "all"; must be non-empty
    stop_on_error: bool,
    timeout_seconds: Option<u32>,
}
```

- `plan_db_update(args) -> DbUpdatePlan` — runs `db update … --output ndjson --dry-run` to
  completion, returns the `plan` event (or the `error` message as `Err`).
- `start_db_update(args, window) -> ()` — spawns `db update … --output ndjson`, registers the
  process, returns immediately. Rejects a second update on the same version
  (`Err("update already running for v19")`).
- `cancel_db_update(version, force: bool) -> ()` — `force = false`: SIGTERM to the odoodev
  process; `force = true`: kill (SIGKILL).
- `list_db_updates() -> Vec<String>` — versions with a running update (for re-attaching the UI).
- `read_update_log(path) -> String` — read-only; accepts only a file directly inside
  `~/odoodev-logs/` whose name matches `update_v*.log` (canonicalized before the check, so no
  `..` or symlink escape). The editor's allowlist is deliberately *not* widened: it also grants
  write access.

Argument building is a pure function `build_db_update_args(&DbUpdateArgs, dry_run) ->
Result<Vec<String>, String>`: every database name passes `reject_flag_like`, `modules` must be
non-empty and must not start with `-`, `mode = names` requires names.

### Process handling

- Spawned through `build_odoodev_command` (augmented PATH, null stdin, `COLUMNS`/`NO_COLOR`).
- New managed state `DbUpdateManager`: `Arc<Mutex<HashMap<String /*version*/, RunHandle { pid: u32,
  force_kill: UnboundedSender<()> }>>>`. The spawned task owns the `Child` (so no lock is held across
  an await) and kills it when the force channel fires.
  Updates on different versions may run in parallel (separate PostgreSQL per version).
- stdout reader: each line is deserialized into
  `#[serde(tag = "event", rename_all = "snake_case")] enum DbUpdateEvent` and emitted as the
  global event `db-update-event` with `{ version, event }`. A line that is not a known event is
  emitted on the console channel instead (never dropped, never a crash).
- stderr reader: every line emitted as `db-update-log` with `{ version, line }`.
- On exit: remove the handle, emit `db-update-exited` with `{ version, exit_code }` (`null` when
  killed by a signal) — same key as `server-exited`.
- *Amended during planning:* global event names with the version in the payload replace
  `db-update:<version>`, so the frontend needs no per-version listeners (versions load later
  than `App` mounts).
- SIGTERM via `libc::kill(pid, SIGTERM)` (new dependency `libc`, `cfg(unix)`).
- **App exit:** on `RunEvent::ExitRequested` every running update gets SIGTERM; the app waits
  up to 10 s for them to exit. Otherwise closing the GUI would orphan `odoo-bin`, the exact
  problem odoodev 0.68.0 fixed.

### Database list

`DbListResponse` gains `#[serde(default)] stale: Option<HashMap<String, String>>` (database →
reason), serialized as `null` when the CLI sent none — the GUI distinguishes "no update recorded
yet" (button "Update all") from "all current" (empty map).

## 3. Frontend (`src/`)

### Version gate

New helper `src/lib/version.ts`: `isAtLeast(installed: string | null, required: string)`
(numeric major.minor.patch; `null` → false). Reads `useAppStore(s => s.odoodevInfo?.version)`.
`PlaybookPanel` switches to it — its current gate reads `odoodevVersion`, which is never set,
so the playbook gate never fires today. Below 0.69.0 all update buttons are disabled with the
hint "requires odoodev ≥ 0.69.0 — update in Settings".

### State: `src/store/dbUpdateStore.ts`

Per version:

```ts
interface DbUpdateRun {
  phase: "running" | "cancelling" | "finished" | "interrupted" | "error";
  modules: string;
  total: number;
  startedAt: number;
  rows: Record<string, {
    status: "pending" | "running" | "ok" | "okWithErrors" | "failed" | "timedOut" | "interrupted";
    index: number; startedAt?: number; durationS?: number;
    warnings: number; errors: number; lastError?: string; log?: string;
    issues: { level: string; text: string }[];   // capped at 500 per database
  }>;
  skippedCurrent: string[];
  console: string[];                              // capped at 2000 lines
  exitCode?: number; errorMessage?: string;
  restartServer?: StartServerArgs;                // set when "stop, update, restart" was chosen
}
```

The event → state transitions live in a pure reducer `applyDbUpdateEvent(run, event)` (unit
tested). Listeners for `db-update-event`, `db-update-log`, `db-update-exited` are registered
once in `App.tsx` so switching views loses nothing. The running processes live in the Rust
process, so only a webview reload (not an app restart) can lose the frontend state while a run
continues: on mount the store calls `list_db_updates` and shows such a run as "running —
details from before the reload unavailable", still cancellable.

### Database view

- **Stale marker** per row: yellow badge "stale"; tooltip = reason ("2 repos changed:
  v19-addons, v19e" / "never updated").
- **Toolbar:** "Update stale (N)"; when the list has no `stale` map yet (no update ever
  recorded) the button reads "Update all". **Selection bar:** "Update selected" next to
  "Drop selected".
- **Start dialog `DbUpdateDialog`:** calls `plan_db_update` and shows targets with reasons and
  the skipped-current list; module field (default `all`, hint that a partial update never marks
  a database current); "stop at first failure"; timeout per database in minutes (default 60 →
  `timeoutSeconds`). If `servers[version].status.running`: choice *stop, update, restart* /
  *update anyway* / *cancel*.
- **Progress panel `DbUpdatePanel`** (docked above the list, not modal): progress bar `n/total`
  and elapsed time; one row per database with status icon, duration, warning/error counts;
  rows expand to their issues (RAW lines indented); "Open log" loads the file via
  `read_update_log` into a read-only viewer dialog; collapsible console. **Cancel** asks for confirmation ("<db>
  will not be marked current"), then `cancel_db_update(version, false)`; if the process has not
  exited after 20 s the panel offers "Force stop" with the warning that Odoo may keep running.
  After exit: summary line + toast (success / n failed / interrupted), database list reload.
  The panel stays until closed.
- **Header indicator:** "Update v19 running (3/10)" while any run is active; click navigates
  to the database view of that version.

### Stop → update → restart

Orchestrated in the frontend (the server's start configuration lives in the store as
`servers[version].config: StartServerArgs`): `stopServer(version, true)` — `keepDocker` must
stay `true` so PostgreSQL keeps running — → wait for `server-exited:<version>` →
`start_db_update` → on `db-update-exited` (any outcome, including interrupted)
`startServer(restartServer)`. The result stays visible.

### Dashboard

`VersionCard` shows "N databases stale" (click → database view of that version). Fetched when
the card becomes active, every 5 minutes, and after `db-update-exited`, only while PostgreSQL
for that version is running — not on the 30 s venv interval, because every `db list` with a
state file costs one `git status` per repository.

### Bulk drop fix

`handleBulkDrop` collects failures per database. All succeeded → success toast; otherwise an
error toast naming the failed databases (errors are no longer only logged to the console).

### i18n

All new strings in `de.json` / `en.json` under `database.update*` (including the header
indicator `database.updateRunningIndicator` — there is no `header` namespace), `database.stale*`
and `dashboard.staleDatabases`; `locales.test.ts` keeps parity and key resolution.

## Error handling

| Situation | Behaviour |
|---|---|
| odoodev < 0.69.0 | Buttons disabled with upgrade hint; no command is started |
| `error` event / exit 1 before `plan` | Dialog shows the message plus the console lines |
| Update already running on the version | Buttons disabled; `start_db_update` also rejects it |
| Database failed / timed out | Row marked, run continues unless "stop at first failure" |
| Cancel | SIGTERM → `interrupted` event → exit 130 → row "interrupted", panel "interrupted" |
| odoodev does not exit 20 s after SIGTERM | "Force stop" offered with orphan warning |
| Windows | No signals: cancel stops odoodev only; the panel states that `odoo-bin` may keep running |
| Unknown / malformed stdout line | Shown in the console, run continues |
| App closed during a run | SIGTERM to every run, wait ≤ 10 s |

## Testing

- **CLI (odoo-dev):** see section 1.
- **Rust:** `build_db_update_args` (modes, rejected flag-like names, empty modules),
  `DbUpdateEvent` deserialization for every event type from sample lines, unknown event
  tolerated, `read_update_log` path check (accepts `update_v19_x_….log` in the log dir;
  rejects other names, other directories, `..` and a symlink pointing outside).
- **Vitest:** `isAtLeast`; `applyDbUpdateEvent` for plan → start → issue → result → summary,
  interrupted, error, issue cap; bulk-drop result aggregation (extracted as a pure helper).
- **Manual:** real run against two databases on a local version incl. cancel mid-run (verify
  no `odoo-bin` left: `pgrep -f odoo-bin`), stop-update-restart with a running server.

## Documentation

- odoodev: `usage/AGENT.md`, RELEASE_NOTES 0.69.0, README (DE/EN).
- GUI: `docs/TAURI_API.md` (new commands and events; also correct the documented progress
  payload — it is a plain string, not `{ line }`), `docs/CLI_INTEGRATION.md` (new NDJSON
  section, `stale` in `db list`, version compatibility table raised to 0.69.0), `CLAUDE.md`
  status, RELEASE_NOTES / changelog for 1.8.0.

## Release order

1. odoodev 0.69.0 (CLI contract + tests) → tag, push, PyPI (published by the maintainer).
2. odoodev-gui 1.8.0 against the published 0.69.0.

## Amendments during implementation

- The CLI emits `interrupted` for SIGTERM/SIGHUP/Ctrl+C at any point of an NDJSON run (also
  before the first database or between databases, `database: null` outside a database); a
  second SIGTERM during odoodev's cleanup is ignored so the forced kill of odoo-bin still
  happens; a preflight `error` message is the CLI's `[ERROR]` line (not a trailing hint); an
  unexpected exception ends with `error` "unexpected failure: …".
- Every NDJSON run ends with exactly one of `summary`/`interrupted`/`error`, except a dry run,
  which ends when the process exits after `plan`. The GUI treats a process exit without a
  terminal event (including a null exit code) as error/interrupted (`applyExit`).
- `DbUpdateManager` sends SIGTERM at most once per run (`RunHandle.signalled`);
  `terminate_all_and_wait` skips runs already signalled but still waits for them; force kill
  stays possible.
- The reducer applies `summary.results` to the rows, so a run re-attached after a webview
  reload converges to the final state.
- `DbUpdateRun.finishedAt` records when a run left the active phase; the panel's elapsed time
  uses it, so a finished run shows its real duration after the panel remounts.
