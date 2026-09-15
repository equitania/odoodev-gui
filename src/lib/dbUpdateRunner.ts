import { invokeCmd } from "./tauri";
import { useAppStore } from "../store/appStore";
import { useDbUpdateStore } from "../store/dbUpdateStore";
import type { DbUpdateArgs, StartServerArgs } from "../types";

/** What to do with an Odoo server running on the version: stop it and start it
 *  again afterwards, or leave it running. `null` = no server running. */
export type ServerChoice = "restart" | "ignore";

export async function startDbUpdate(args: DbUpdateArgs, serverChoice: ServerChoice | null): Promise<void> {
  const app = useAppStore.getState();
  const updates = useDbUpdateStore.getState();
  let restart: StartServerArgs | null = null;
  if (serverChoice === "restart") {
    restart = app.servers[args.version]?.config ?? null;
    // keepDocker must stay true: the update needs PostgreSQL.
    await app.stopServer(args.version, true);
  }
  updates.begin(args.version, args.modules, restart);
  try {
    await invokeCmd("start_db_update", { args });
  } catch (e) {
    updates.event(args.version, { event: "error", message: String(e) });
    updates.exited(args.version, 1);
    await restartServerAfterUpdate(args.version);
    throw e;
  }
}

/** Start the server again with the configuration it had before the update — once. */
export async function restartServerAfterUpdate(version: string): Promise<boolean> {
  const updates = useDbUpdateStore.getState();
  const config = updates.runs[version]?.restartServer;
  if (!config) return false;
  updates.clearRestart(version);
  await useAppStore.getState().startServer(config);
  return true;
}

/** SIGTERM (force = false) lets odoodev stop odoo-bin cleanly; force kills odoodev only. */
export async function cancelDbUpdate(version: string, force: boolean): Promise<void> {
  useDbUpdateStore.getState().cancelling(version);
  await invokeCmd("cancel_db_update", { version, force });
}
