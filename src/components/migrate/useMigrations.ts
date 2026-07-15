import { useState, useEffect, useCallback } from "react";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { usePolling } from "../../hooks/usePolling";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { POLL_INTERVALS } from "../../lib/constants";
import type { MigrationGroup, MigrationStatus, VersionInfo } from "../../types";

export interface CreateGroupArgs {
  from: string;
  to: string;
  name: string | null;
  /** Tauri v2 camelCases command params — `pg_version` would silently arrive as None. */
  pgVersion: string | null;
}

type ActionResult = { success: boolean; error: string | null };

/**
 * Data + actions for the migrate panel: loads versions/groups/status, polls,
 * and exposes the four mutating actions. Each action shares the same toast +
 * busy + refresh boilerplate via runAction and returns whether it succeeded.
 */
export function useMigrations() {
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [groups, setGroups] = useState<MigrationGroup[]>([]);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    invokeCmd<MigrationGroup[]>("migrate_list").then(setGroups).catch(() => {});
    invokeCmd<MigrationStatus>("migrate_status").then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then(setVersions)
      .catch(logError("useMigrations: get_versions"));
    refresh();
  }, [refresh]);

  usePolling(refresh, POLL_INTERVALS.venv, true);

  const runAction = useCallback(
    async (
      loading: string,
      cmd: string,
      args: Record<string, unknown> | undefined,
      okMsg: string,
      failMsg: string,
    ): Promise<boolean> => {
      setBusy(true);
      const tid = toastLoading(loading);
      try {
        const result = await invokeCmd<ActionResult>(cmd, args);
        if (result.success) {
          toastUpdate(tid, "success", okMsg);
          refresh();
          return true;
        }
        toastUpdate(tid, "error", failMsg, result.error ?? "");
        return false;
      } catch (e) {
        toastUpdate(tid, "error", failMsg, String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const createGroup = useCallback(
    (args: CreateGroupArgs) =>
      runAction(
        `Creating migration group ${args.from}→${args.to}...`,
        "migrate_create",
        { ...args },
        "Migration group created",
        "Failed to create group",
      ),
    [runAction],
  );

  const activate = useCallback(
    (name: string) =>
      runAction(`Activating ${name}...`, "migrate_activate", { name }, `${name} activated`, "Activation failed"),
    [runAction],
  );

  const deactivate = useCallback(
    () =>
      runAction("Deactivating migration...", "migrate_deactivate", undefined, "Migration deactivated", "Deactivation failed"),
    [runAction],
  );

  const remove = useCallback(
    (name: string) =>
      runAction(`Removing ${name}...`, "migrate_remove", { name }, `${name} removed`, "Removal failed"),
    [runAction],
  );

  return { versions, groups, status, busy, refresh, createGroup, activate, deactivate, remove };
}
