import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../lib/tauri";
import { finishedCount } from "../lib/dbUpdateReducer";
import { restartServerAfterUpdate } from "../lib/dbUpdateRunner";
import { useDbUpdateStore } from "../store/dbUpdateStore";
import { toast, toastError, toastSuccess } from "../store/toastStore";
import type { DbUpdateEvent } from "../types";

/** Global listeners for `db update` runs — mount once in App. */
export function useDbUpdateEvents() {
  const { t } = useTranslation();

  useEffect(() => {
    const store = useDbUpdateStore.getState;
    let disposed = false;
    let unlistens: UnlistenFn[] = [];

    (async () => {
      const subscriptions = await Promise.all([
        listen<{ version: string; event: DbUpdateEvent }>("db-update-event", (e) =>
          store().event(e.payload.version, e.payload.event),
        ),
        listen<{ version: string; line: string }>("db-update-log", (e) =>
          store().consoleLine(e.payload.version, e.payload.line),
        ),
        listen<{ version: string; exit_code: number | null }>("db-update-exited", (e) => {
          const { version, exit_code } = e.payload;
          const run = store().exited(version, exit_code);
          if (!run) return;
          const failed = run.order.filter((db) => ["failed", "timedOut"].includes(run.rows[db].status)).length;
          const withErrors = run.order.filter((db) => run.rows[db].status === "okWithErrors").length;
          if (run.phase === "finished" && failed === 0 && withErrors > 0) {
            toast("info", t("database.updateFinishedWithErrors", { count: withErrors }));
          } else if (run.phase === "finished" && failed === 0) {
            toastSuccess(t("database.updateFinishedOk", { count: finishedCount(run) }));
          } else if (run.phase === "finished") {
            toastError(t("database.updateFinishedFailed", { failed, total: run.order.length }));
          } else if (run.phase === "interrupted") {
            toast("info", t("database.updateInterrupted"));
          } else {
            toastError(t("database.updateFailed"), run.errorMessage ?? undefined);
          }
          if (run.restartServer) {
            toast("info", t("database.updateRestartingServer", { version }));
            restartServerAfterUpdate(version).catch((err) =>
              toastError(t("database.updateRestartFailed"), String(err)),
            );
          }
        }),
      ]);
      if (disposed) {
        subscriptions.forEach((unlisten) => unlisten());
        return;
      }
      unlistens = subscriptions;
      // After a webview reload the backend may still be running updates.
      const running = await invokeCmd<string[]>("list_db_updates").catch(() => [] as string[]);
      if (disposed) return;
      const attached = running.filter((version) => !store().runs[version]);
      store().attach(running);
      if (attached.length === 0) return;
      // A run that exited between subscribing and the reply above had its
      // `db-update-exited` ignored (unknown version) — ask again and close it.
      const stillRunning = await invokeCmd<string[]>("list_db_updates").catch(() => null);
      if (disposed || stillRunning === null) return;
      for (const version of attached) {
        if (!stillRunning.includes(version)) store().exited(version, null);
      }
    })();

    return () => {
      disposed = true;
      unlistens.forEach((unlisten) => unlisten());
    };
  }, [t]);
}
