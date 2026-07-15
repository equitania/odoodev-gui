import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Copy text to the system clipboard.
 *  navigator.clipboard is unreliable inside Tauri WebViews (missing or
 *  permission-blocked depending on platform), so the Tauri plugin is the
 *  primary path; the browser API remains as a dev-in-browser fallback. */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await writeText(text);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}
