import type { ExportScope } from "../../types";

/** Everything the export dialog collects, independent of React state. */
export interface ExportForm {
  version: string;
  dbName: string;
  scope: ExportScope;
  updateList: boolean;
  cleanup: boolean;
  /** "Without Odoo login" switch: ticked = `--via-shell`, unticked = the login path. */
  viaShell: boolean;
}

/** Arguments of the `export_modules` Tauri command (camelCase, as Tauri expects). */
export interface ExportInvokeArgs {
  version: string;
  database: string;
  scope: ExportScope;
  updateList: boolean;
  cleanup: boolean;
  viaShell: boolean;
  viaRpc: boolean;
}

/**
 * Translate the dialog state into `export_modules` arguments.
 *
 * The checkbox must say what it does on every odoodev version, but the CLI's
 * default flipped in 0.77.0 (XML-RPC with a login before, `odoo-bin shell`
 * since):
 * - `offersViaShell` false (< 0.76.0): neither flag is ever sent.
 * - ticked: `--via-shell` (0.76.0+).
 * - unticked on 0.77.0+ (`offersViaRpc` true): `--via-rpc`, because "no flag"
 *   would now mean the shell.
 * - unticked on 0.76.x: no flag, XML-RPC is that version's default.
 * - unticked with an unknown version: also no flag. `offersViaRpc` is false
 *   then, since `--via-rpc` sent to a CLI older than 0.77.0 is a usage error;
 *   the cost is that on 0.77+ the unticked box falls back to the shell.
 */
export function buildExportArgs(
  form: ExportForm,
  offersViaShell: boolean,
  offersViaRpc: boolean,
): ExportInvokeArgs {
  const viaShell = offersViaShell && form.viaShell;
  return {
    version: form.version,
    database: form.dbName,
    scope: form.scope,
    updateList: form.updateList,
    cleanup: form.cleanup,
    viaShell,
    viaRpc: offersViaShell && offersViaRpc && !form.viaShell,
  };
}
