# Release Notes

## Version 1.4.0 (15.07.2026)

### Added
- **Playbook Assistant (schema-driven wizard):** a stepper dialog in the
  Playbooks view renders its form live from `odoodev playbook schema --json`
  (CLI ≥ 0.55) — all 12 field types, conditional visibility, repeatable
  targets/extra-steps sections, SQL presets and masked secrets. Answers are
  passed through a 0600 temp file to `playbook create --non-interactive`,
  the result is auto-validated, then opened in the editor or preselected for
  running. CLI field labels ship bundled (DE/EN) with a humanized fallback
  for fields from newer CLIs.
- **Clickable server URL:** while an Odoo server is running, the Dashboard
  version card and the Server tab header show `http://localhost:<port>` —
  one click opens the system browser (live port preferred over config port).
- **Container service start:** when the runtime backend is down, an amber
  banner on the Dashboard and Docker panel offers a one-click start —
  `container system start` (Apple Container), `systemctl start docker`
  (Linux) or launching Docker Desktop (macOS). No auto-start on app launch
  by design (decision D18).

### Fixed
- **Log level filter during live runs:** RAW continuation lines (tracebacks,
  wrapped output) bypassed both the level checkboxes and the search box.
  They now inherit the level of the preceding parsed line (tracked per
  stdout/stderr stream in Rust), so hiding ERROR also hides its traceback;
  the "Server stopped" separator carries an explicit flag and stays always
  visible.

## Version 1.3.0 (14.07.2026)

### Added
- **Per-version config-file editing:** the Editor view now lists every
  odoodev-managed file per version — `.env`, `docker-compose.yml`,
  `requirements.txt`, `repos.yaml`, `postgresql.conf`, the
  `odoo{version}_template.conf` and the latest generated `odoo_YYMMDD.conf`
  (with a hint that generated files are overwritten by the next
  `odoodev repos` run). Paths come from the new `odoodev config paths --json`
  (CLI ≥ 0.53.0); older CLIs get the previous reduced list plus an upgrade hint.
- **Editor shortcuts everywhere:** Edit button on the Env cards, a Config
  dropdown on each Dashboard version card, and a Compose edit button on the
  Docker container cards (Docker runtime only) — all jump straight into the
  Monaco editor.
- **Linux one-line installer** (`install.sh`): curl-pipe-bash with apt/.deb
  and AppImage fallback.

### Fixed
- **PostgreSQL benchmark hidden on Linux/Windows:** the Docker-vs-Apple
  benchmark tab and buttons now only appear on macOS with Apple Container
  installed.

### Changed
- macOS signing guide: the p12 must be 3DES/SHA1
  (`openssl pkcs12 -export -legacy`) or `security import` fails on CI runners.

## Version 1.2.6 (14.07.2026)

### Fixed
- `release.yml`: removed a duplicated `APPLE_*` env block (invalid YAML broke
  the release workflow).

## Version 1.2.5 (13.07.2026)

### Added
- Release pipeline: macOS code signing + notarization via `APPLE_*` secrets.

## Version 1.2.4 (13.07.2026)

### Added
- Docs: macOS signing & notarization guide (Developer ID + GitHub secrets).

### Changed
- GitHub repository moved to `equitania/odoodev-gui` (release + updater URLs).
- App icon: bundle icons regenerated from the new `public/icon.png` source.

## Version 1.2.3 (13.07.2026)

### Fixed
- Database panel: the Start-Container button now waits for readiness and
  refreshes the list.

## Version 1.2.2 (13.07.2026)

### Fixed
- Opaque dialogs (missing Tailwind v4 `@theme` tokens) and PostgreSQL client
  tools resolution in the packaged app.

## Version 1.2.1 (13.07.2026)

### Fixed
- Packaged-app bugs found in the v1.2.0 end-to-end test (minimal PATH of
  bundled macOS apps, camelCase invoke arguments).

## Version 1.2.0 (12.07.2026)

### Added
- Playbook sync with odoodev 0.51 and a Monaco-based curated file editor
  (global config, per-version `.env`, playbooks with YAML validation).

### Changed
- Bilingual DE/EN README with eyecatcher and dashboard screenshot.

## Version 1.1.1 (11.07.2026)

First release with built-in cross-platform auto-update.

### Added
- **Auto-update:** the app now updates itself on new releases via the Tauri
  updater. It checks on launch and offers a one-click update under
  **Settings → Check for Updates**; every update is cryptographically verified
  (Ed25519/minisign) before it installs.
- **Cross-platform release pipeline:** GitHub Actions + `tauri-action` builds
  macOS/Windows/Linux installers on each `vX.Y.Z` tag and publishes them (with
  `latest.json`) to GitHub Releases. macOS builds are notarized; Windows is
  currently unsigned (SmartScreen prompt on first install).
- README **Download & Install** section with per-platform instructions.

### Fixed
- Corrected the copyright year (2025 → 2026) across app metadata, locales and docs.

### Internal
- CI actions moved to the Node 24 runtime; lint is warning-free; the CI build
  job uses `tauri build --no-bundle` as a compile check.

## Version 1.1.0 (11.07.2026)

Audit-driven hardening and dependency-modernization release. No user-facing
feature changes — this cycle focused on security, up-to-date dependencies,
error visibility, and code health.

### Security
- Removed the unscoped `shell:allow-execute` capability, closing an arbitrary-
  command (RCE) vector that a future XSS could have reached; dropped the unused
  `tauri-plugin-shell` entirely.
- Enabled a restrictive Content Security Policy (was previously disabled).
- `open_external` now validates the URL scheme (only `http`/`https`), so a
  compromised frontend can no longer open `file://` paths or OS URI handlers.
- Reject flag-like user values (leading `-`) before passing them to the
  odoodev CLI — defense-in-depth against argument injection.

### Changed
- Upgraded major dependencies: lucide-react 0.500 → 1.24, Vite 6 → 8,
  TypeScript 5.7 → 6, @vitejs/plugin-react 4 → 6, reqwest 0.12 → 0.13.
- Replaced the deprecated/archived `serde_yaml` with the maintained
  `serde_yaml_ng`.
- Migrated ESLint 8 (EOL) → 10 with flat config, activating the
  typescript-eslint and react-hooks rule sets (previously registered but never
  enabled).
- `invoke()` failures now surface as error toasts for user actions and are
  logged for background fetches, instead of being silently swallowed.
- Decomposed `MigratePanel` (403 → 91 lines) into a `useMigrations` hook plus
  focused sub-components.

### Fixed
- InstallDialog never actually installed uv — the "Install uv now" button only
  re-checked status; it now installs uv (then odoodev).
- Doctor "[WARN]" health-check lines showed a stray leading `]` (off-by-one in
  the line parser); parsing now uses `strip_prefix` to prevent that bug class.
- Two latent bugs surfaced by the stricter lint config: a `checkUvStatus`
  comparison that never invoked the function, and a `let` that should be `const`.
