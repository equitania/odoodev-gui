---
name: verify
description: How to build, launch and observe odoodev-gui (Tauri v2) for runtime verification of changes.
---

# Verifying odoodev-gui at runtime

## Launch

```bash
pnpm tauri dev > /tmp/tauri-dev.log 2>&1 &   # native window on the dev Mac
# ready when the log shows: Finished `dev` profile ... / Running `target/debug/odoodev-gui`
```

Rust rebuild takes ~1-2 min cold, ~15 s warm. Stop with
`pkill -f "target/debug/odoodev-gui"` (also kill the vite process).

## Observing without clicking

The vite dev server echoes every webview `console.error`/`console.warn` into
the tauri-dev log as `[vite] (client) [console.error] ...`. Since panels log
failed invokes via `logError("Panel: command")`, a clean log after app boot
means the startup IPC chain (Dashboard → `curated_files`, platform/runtime
fetch, polling) succeeded end-to-end against the real odoodev CLI.

Known pre-existing noise (ignore): `notifyIfAppUpdate: None of the fallback
platforms ... darwin-aarch64` — dev builds have no updater manifest entry.

## Limitations of headless sessions

- `screencapture` returns pure noise without the Screen-Recording TCC
  permission for the invoking terminal — do not trust the PNG, check it.
- `osascript` System Events cannot read the app's windows without the
  Accessibility permission (error -1719 "Ungültiger Index"), so scripted
  clicking/navigation is unavailable. Interactive flows (view switching,
  dialogs, Monaco editing) need the Captain to click through manually.

## What to hand to the Captain for manual checks

Name the exact views/buttons touched by the diff (e.g. "Editor view → v18
group → template conf opens; Docker card → Compose button only under Docker
runtime") — the app has no deep links, all navigation is by clicking.
