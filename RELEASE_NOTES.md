# Release Notes

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
