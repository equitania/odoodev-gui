# Decision Log — odoodev-gui

> All user-confirmed design decisions, their rationale, and architectural impact.
> Each decision was discussed and confirmed during the planning phase.

---

## D1: Tech-Stack — Rust + Tauri v2 + React 19 + TypeScript

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** Tauri v2 (Rust backend) + React 19 (TypeScript frontend)

**Rationale:**
- User has existing Rust expertise (claude-workbench, ctop projects)
- Tauri v2 provides native desktop apps with small binary size (~10-15 MB)
- Web frontend (React) allows rich UIs (tables, forms, log viewers) faster than pure-Rust GUI toolkits
- shadcn/ui + Tailwind CSS for polished, native-feeling components
- Cross-platform: macOS (WKWebView), Linux (WebKitGTK), Windows (WebView2)

**Alternatives considered:**

| Option | Pros | Cons | Rejected because |
|--------|------|------|------------------|
| Rust + egui/iced | Single language, tiny binary | Limited components, less polished | Slow UI development for complex forms |
| Go + Wails | Simpler language, fast compile | Larger binary, less mature | Less ecosystem than Tauri |
| Go + Fyne | Pure Go, no WebView | Not native-looking, limited components | Poor UI quality |
| Electron | Huge ecosystem | 100+ MB binary, Chromium bloat | Too heavy for a CLI wrapper GUI |

**Architectural impact:**
- Rust handles subprocess management, JSON parsing, log parsing, uv installation
- React handles all UI rendering, state management (Zustand), event listening
- IPC via Tauri's `invoke` (frontend → Rust) and `emit`/`listen` (Rust → frontend)

---

## D2: Frontend Framework — React 19 + TypeScript

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** React 19 with TypeScript, Vite as bundler

**Rationale:**
- Largest component ecosystem (shadcn/ui, react-virtual, etc.)
- User's primary frontend experience
- TypeScript for type safety mirroring Rust serde models
- Vite for fast dev hot-reload

**Alternatives:**

| Option | Pros | Cons |
|--------|------|------|
| Svelte/SvelteKit | Smaller bundle, excellent DX | Fewer components |
| Vue 3 | Good middle ground | Smaller ecosystem than React |

---

## D3: GUI Coexists with TUI (Not Replacing)

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The existing Textual TUI (`odoodev start --tui`) remains unchanged. GUI and TUI coexist.

**Rationale:**
- TUI is valuable for terminal-power-users and SSH/remote development
- GUI targets users who struggle with CLI
- No breaking changes to odoodev CLI
- Both use the same odoodev subprocess — no logic duplication

**Architectural impact:**
- GUI never passes `--tui` flag to `odoodev start`
- GUI creates its own log viewer (virtual list + syntax highlighting + level filtering)
- TUI's `app.py`, `screens.py`, `widgets/` remain untouched

---

## D4: New Repository — odoodev-gui

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** Separate repository at `/Users/picard/gitbase/odoodev-gui`

**Rationale:**
- Clean separation: CLI stays Python (PyPI package), GUI is Rust/TypeScript (native bundle)
- Different build systems, different release cycles
- odoodev-gui depends on odoodev as a runtime subprocess, not a code dependency

**Architectural impact:**
- No shared code between repos
- odoodev-gui communicates with odoodev via subprocess + JSON/stdout
- Release versions are independent (GUI v1.0.0 works with odoodev v0.49.x)

---

## D5: MVP Scope — Dashboard + Server + Databases

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** Phase 1 MVP includes: Dashboard (4 version cards), Server view (start/stop + log viewer), Database view (list, backup, restore, drop)

**Excluded from MVP:**
- Docker panel (Phase 2)
- Venv panel (Phase 2)
- Repos panel (Phase 2)
- Playbook runner (Phase 2)
- Init wizard (Phase 2)
- Migrate panel (Phase 2)
- Doctor (Phase 2)
- i18n (Phase 2)

**Rationale:**
- These 3 views cover the most common daily workflow: check status → start server → manage databases
- Delivers value quickly (~11 days)
- Demonstrates all integration patterns (JSON, streaming, exit code)

---

## D6: uv Auto-Install — Silent, No Dialog

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** If `uv` is not installed, the GUI installs it automatically (no user dialog).

**Rationale:**
- `uv` is a prerequisite for everything (installing/updating odoodev)
- Asking the user to install a Python package manager they've never heard of is confusing
- The install is non-destructive and fast (~5 seconds)
- Silent install reduces friction for first-time users

**Architectural impact:**
- `ensure_uv()` in Rust: checks PATH → checks common paths → installs if missing → re-checks
- No Tauri event for "uv not installed" — installation happens transparently
- Only surfaces errors if installation fails

---

## D7: odoodev Auto-Install — Dialog with Confirmation

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** If `odoodev` is not installed, show a dialog: "odoodev is not installed. Install now?"

**Rationale:**
- odoodev is the core tool the GUI controls — user should be aware it's being installed
- User may have a specific version or custom installation they want to use
- Respects user autonomy
- Unlike uv (infrastructure), odoodev is the actual application

**Architectural impact:**
- First-run check: `check_odoodev()` → if not installed → emit `odoodev-not-installed` event
- Frontend shows `InstallDialog` with [Install now] [Skip] buttons
- At [Install now]: `install_odoodev()` with progress streaming
- At [Skip]: Dashboard shows "odoodev not installed" state with install button

---

## D8: odoodev Auto-Update — Notification + Manual Click

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The GUI shows an update badge (notification) but does NOT auto-update odoodev. Update happens only on explicit user click.

**Rationale:**
- Auto-updating could break running servers (version mismatch mid-session)
- User might be intentionally on an older version
- Running `uv tool upgrade` is non-trivial and could fail
- Safer to let the user decide when to update

**Architectural impact:**
- On startup: `check_odoodev_update()` → compare installed vs PyPI
- If update available: `UpdateBadge` in header (blue dot + "Update available v0.X → v0.Y")
- Click → dropdown → "Update odoodev" button → `upgrade_odoodev()` → progress → version refresh
- Never auto-updates, even on startup

---

## D9: Parallel Servers — Multiple Simultaneously

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The GUI allows multiple Odoo servers to run simultaneously (e.g., v18 + v19 in parallel).

**Rationale:**
- Useful for migration scenarios (v18 → v19 comparison)
- Each version uses different ports (v18: 18069, v19: 19069) — no port conflict
- Users with multiple monitors can have multiple Odoo instances running
- More powerful than the TUI (which handles one server)

**Architectural impact:**
- Rust: `ServerManager` uses `HashMap<String, OdooProcess>` (key = version)
- Frontend: Multi-tab UI — one tab per running server
- Each tab has its own log buffer (persists across stop/start)
- Dashboard shows running indicator for all running versions
- Warning (not block) if >2 servers running simultaneously

---

## D10: Dashboard — All 4 Versions, Inactive Greyed Out

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The dashboard always shows all 4 version cards (v16–v19). Versions not in `active_versions` are greyed out (50% opacity) with "Not in active versions" subtitle.

**Rationale:**
- Consistent layout — users always know where each version is
- Greyed-out state communicates "this exists but is disabled" better than hiding
- Users can see all versions at a glance
- "More" section would add unnecessary interaction

**Architectural impact:**
- Dashboard fetches `get_versions()` (always 4) + `get_active_versions()` (subset)
- VersionCard component receives `active: boolean` prop
- Inactive cards: opacity 50%, disabled start button, tooltip "Add to active versions in config"
- Docker Up/Down still works on inactive versions (PostgreSQL may be needed)

---

## D11: Log Buffer Persists Across Stop/Start

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** When a server is stopped, the log buffer is NOT cleared. A separator line `--- Server stopped (exit code N) ---` is appended. On restart, new logs are appended after the separator.

**Rationale:**
- Users often need to read logs after stopping (error analysis, copy to clipboard)
- Clearing on stop would lose valuable debugging context
- Separator line clearly distinguishes old vs new sessions
- TUI already does this (writes "--- Odoo server stopped ---")

**Architectural impact:**
- `server-exited:<version>` event → append separator entry (level: RAW, message: separator text)
- Log buffer in Zustand store is NOT cleared on stop
- Buffer cap: 50,000 entries (oldest removed with indicator "… N lines truncated")
- "Clear" button in LogFilterBar for manual clearing

---

## D12: Log Viewer — Syntax Highlighting + Level Filtering

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The log viewer implements both syntax highlighting (colored levels, dimmed timestamps, SQL keyword highlighting) and level filtering (toggle DEBUG/INFO/WARNING/ERROR/CRITICAL).

**Rationale:**
- User explicitly requested this (not a plain text view)
- Matches the TUI's filtering capabilities (the TUI has 6 filter levels + search)
- Syntax highlighting makes error/warning lines immediately visible
- SQL keyword highlighting helps with Odoo's SQL-heavy logs

**Architectural impact:**
- `LogLine.tsx` component renders each line with color-coded fields
- `LogFilterBar.tsx` provides multi-select level toggles
- Filter logic: RAW lines inherit the level of the previous non-RAW line (same as TUI)
- Search: inline search with highlighted matches + prev/next navigation
- Virtual list (`@tanstack/react-virtual`) for 10k+ lines performance
- Copy actions: "Copy visible", "Copy errors only", "Copy warnings+errors"

---

## D13: uv Self-Install by GUI

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The GUI installs `uv` itself if it's missing (no manual installation required by the user).

**Rationale:**
- User explicitly confirmed this (answer: "ja")
- Reduces friction — user downloads the GUI and it just works
- uv is a lightweight, standard tool (Astral's package manager)

**Implementation:**
- macOS/Linux: `sh -c "curl -LsSf https://astral.sh/uv/install.sh | sh"`
- Windows: `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`
- Fallback: direct binary download from GitHub releases
- After install: PATH augmentation ensures subsequent calls find `uv`

---

## D14: Native Bundles — .dmg / .msi / .AppImage

**Date:** 2025-07-10
**Status:** Confirmed
**Decision:** The GUI is distributed as native bundles (.dmg for macOS, .msi/.exe for Windows, .AppImage/.deb for Linux), NOT as a PyPI package.

**Rationale:**
- User explicitly confirmed this (answer: "ja")
- Tauri v2 builds native bundles automatically
- Native bundles are what desktop users expect (not `pip install`)
- The GUI is a Rust/TypeScript app, not a Python package
- Installation: download → drag to Applications (macOS) / run installer (Windows) / chmod+run (Linux)

**Architectural impact:**
- GitHub Actions release workflow builds 3 platform bundles
- GitHub Releases as distribution channel
- Tauri updater plugin for GUI self-updates (checks GitHub releases)
- Code signing: macOS notarization, Windows code signing (Phase 3)

---

## D15: CLI-Wrapper Architecture — Not Python Reimplementation

**Date:** 2025-07-10
**Status:** Confirmed (fundamental design principle)
**Decision:** The GUI is a pure presentation layer. ALL logic stays in `odoodev`. The GUI only calls `odoodev` as a subprocess and parses its output.

**Rationale:**
- No logic duplication = no logic drift
- odoodev remains the single source of truth
- GUI automatically benefits from odoodev bug fixes and new features
- GUI can work with any odoodev version that has the same JSON interface
- Simpler GUI codebase (no database logic, no git logic, no venv logic)

**Architectural impact:**
- Every GUI action maps to one or more `odoodev` subprocess calls
- JSON output (`--json` flag) is the primary integration surface
- stdout streaming for log/progress output
- Exit code for success/failure determination
- The GUI never imports or calls Python code directly

**Limitations:**
- Some commands lack `--json` → text parsing required (fragile)
- Latency overhead for subprocess spawning (mitigated by streaming)
- Can't use Python's Rich console features (colors, tables) in the GUI
- Future: request `--json` flags on more odoodev commands

---

## D16: Restore Dialog Uses Individual Flags (Not --sanitize)

**Date:** 2025-07-10
**Status:** Confirmed (implementation detail)
**Decision:** The GUI restore dialog maps to individual CLI flags (`--deactivate-cron`, `--neutralize`, `--anonymize`, `--wipe`, `--purge-master-data`) rather than the umbrella `--sanitize` flag.

**Rationale:**
- Individual flags give the GUI finer-grained control
- The "sanitize all" checkbox in the GUI toggles all 5 sub-options
- The `--no-purge-master-data` override is cleaner with individual flags
- Avoids ambiguity about what `--sanitize` includes (changed in v0.48.0)

**Architectural impact:**
- When user checks "sanitize (all)" in GUI: set all 5 individual flags
- When user unchecks "purge master data" under sanitize: add `--no-purge-master-data`
- `--anonymize-users` and `--purge-transactions` are always separate (not in sanitize)
- GUI always passes `-y` (the dialog IS the confirmation)

---

## D17: Curl-Pipe-Bash Installer for Linux

**Date:** 2026-07-14
**Status:** Confirmed
**Decision:** Ship `install.sh` at the repo root, invoked via `curl -fsSL https://raw.githubusercontent.com/equitania/odoodev-gui/main/install.sh | bash`. Debian/Ubuntu (detected via `apt-get` presence) → download the latest `.deb` and install it with `apt-get install ./file.deb`, which resolves all runtime dependencies. All other Linux distros → install the AppImage user-locally (`~/.local/bin` + `.desktop` entry + icon), no root required. macOS → placeholder message (builds not yet notarized, manual `.dmg` download); Windows / unsupported arch → polite bail with a link to the Releases page.

**Rationale:**
- A real install on Debian 13 failed because `dpkg -i` does not resolve dependencies (`libwebkit2gtk-4.1-0` missing) — `apt-get install ./file.deb` fixes this class of failure entirely, no manual dependency list needed (the `.deb`'s `Depends:` is auto-generated by the Tauri bundler)
- Matches D14 (GitHub Releases as the distribution channel) with a lower-friction Linux onboarding path
- The AppImage path deliberately stays root-free per AppImage/XDG conventions and keeps `curl | bash` safe on distros without elevated trust
- Follows the same curl-pipe-sh pattern the GUI itself uses to bootstrap `uv` (D13)

**Architectural impact:**
- Re-running the script acts as an update: installed version (`dpkg-query` on deb systems, marker file `~/.local/share/odoodev-gui/version` on AppImage systems) is compared against the fixed-URL updater manifest `releases/latest/download/latest.json`
- No CI/release-workflow changes — the script only consumes already-published release assets
- Script is served from `main` via raw.githubusercontent.com, so installer fixes take effect immediately without cutting a release
- `libfuse2` absence on AppImage systems is a warning with a distro-specific hint (dnf/zypper/pacman/apk), not a hard failure

---

## Summary Decision Matrix

| # | Topic | Decision | Impact |
|---|-------|----------|--------|
| D1 | Tech-stack | Rust + Tauri v2 + React 19 + TS | Subprocess + IPC architecture |
| D2 | Frontend framework | React 19 + TypeScript | shadcn/ui, Zustand, react-virtual |
| D3 | TUI coexistence | TUI stays, GUI is parallel | No changes to odoodev TUI |
| D4 | Repository | Separate repo `odoodev-gui` | Independent release cycles |
| D5 | MVP scope | Dashboard + Server + Databases | ~11 days for Phase 1 |
| D6 | uv auto-install | Silent (no dialog) | `ensure_uv()` transparent |
| D7 | odoodev auto-install | Dialog with confirmation | First-run InstallDialog |
| D8 | odoodev auto-update | Notification + manual click | UpdateBadge, no auto-upgrade |
| D9 | Parallel servers | Multiple simultaneously | HashMap<version, Process> |
| D10 | Dashboard layout | All 4, inactive greyed | Opacity logic in VersionCard |
| D11 | Log buffer at stop | Persists + separator | Buffer not cleared, separator appended |
| D12 | Log viewer | Syntax highlighting + filters | Colored LogLine, level toggles |
| D13 | uv self-install | GUI installs uv itself | Platform-specific download |
| D14 | Distribution | Native bundles (.dmg/.msi/.AppImage) | Tauri bundler, GitHub Releases |
| D15 | CLI-wrapper | Pure presentation, no logic | All via subprocess + JSON |
| D16 | Restore flags | Individual, not --sanitize | Fine-grained flag mapping |
| D17 | Linux installer | curl-pipe-bash: apt for Debian/Ubuntu, AppImage otherwise | Root-free AppImage path, dpkg/marker version tracking, re-run = update |
| D18 | Container service start | One-click button, NO auto-start on app launch | RuntimeServiceBanner (Dashboard + Docker panel); `container system start` / `systemctl start docker` / Docker Desktop launch |