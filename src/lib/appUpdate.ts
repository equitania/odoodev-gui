import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast, toastLoading, toastUpdate } from "../store/toastStore";
import i18n from "i18next";

// GUI *app* self-update via the Tauri updater. This is deliberately separate
// from the odoodev *CLI* update (appStore.checkOdoodevUpdate/updateOdoodev),
// which upgrades the wrapped Python tool over PyPI/uv — a different thing.
//
// The updater only works inside the packaged Tauri app (it needs the native
// IPC + a configured endpoint/pubkey), so every call is guarded and fails soft
// in a plain browser dev context.

function t(key: string, fallback: string): string {
  const v = i18n.t(key);
  return v === key ? fallback : v;
}

/**
 * Startup check: if a newer GUI version is published, show a non-blocking
 * info toast pointing the user at Settings. Silent when up to date or on error
 * (e.g. running outside the packaged app, offline).
 */
export async function notifyIfAppUpdate(): Promise<void> {
  try {
    const update = await check();
    if (update) {
      toast(
        "info",
        t("gui.updateAvailable", "GUI update available") + ` (${update.version})`,
        t("gui.updateHint", "Settings → Check for updates"),
      );
    }
  } catch (e) {
    console.error("notifyIfAppUpdate:", e);
  }
}

/**
 * Full self-update flow driven by the Settings button: check → download +
 * install → relaunch, with toast feedback. No-op (info toast) if already current.
 */
export async function runAppUpdate(): Promise<void> {
  let update: Update | null;
  try {
    update = await check();
  } catch (e) {
    toast("error", t("gui.updateCheckFailed", "Update check failed"), String(e));
    return;
  }
  if (!update) {
    toast("success", t("gui.upToDate", "odoodev-gui is up to date"));
    return;
  }
  const tid = toastLoading(
    t("gui.installing", "Installing GUI update") + ` ${update.version}…`,
  );
  try {
    await update.downloadAndInstall();
    toastUpdate(
      tid,
      "success",
      t("gui.installed", "Updated — restarting…") + ` ${update.version}`,
    );
    await relaunch();
  } catch (e) {
    toastUpdate(tid, "error", t("gui.updateFailed", "GUI update failed"), String(e));
  }
}
