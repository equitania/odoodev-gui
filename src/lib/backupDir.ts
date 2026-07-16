import { downloadDir } from "@tauri-apps/api/path";

/** Last directory used in a backup/restore file picker. Falls back to
 *  ~/Downloads — the odoodev CLI's own default backup location. */
const STORAGE_KEY = "odoodev-gui.backupDir";

export async function defaultBackupDir(): Promise<string | undefined> {
  const last = localStorage.getItem(STORAGE_KEY);
  if (last) return last;
  try {
    return await downloadDir();
  } catch {
    return undefined;
  }
}

export function rememberBackupDir(path: string): void {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = cut > 0 ? path.slice(0, cut) : path;
  localStorage.setItem(STORAGE_KEY, dir);
}
