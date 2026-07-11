import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { usePolling } from "../../hooks/usePolling";
import { useVenvSetup } from "../../hooks/useVenvSetup";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { VenvCard } from "./VenvCard";
import { SetupProgress } from "./SetupProgress";
import { POLL_INTERVALS } from "../../lib/constants";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import type { VersionInfo, VenvStatus } from "../../types";

export function VenvPanel() {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [activeVersions, setActiveVersions] = useState<string[]>([]);
  const [venvStatuses, setVenvStatuses] = useState<Record<string, VenvStatus>>({});
  const [busyVersion, setBusyVersion] = useState<string | null>(null);
  const [setupVersion, setSetupVersion] = useState<string | null>(null);
  const [removeDialog, setRemoveDialog] = useState<string | null>(null);

  const venvSetup = useVenvSetup();

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => setVersions(v))
      .catch(logError("VenvPanel: get_versions"));
    invokeCmd<string[]>("get_active_versions")
      .then(setActiveVersions)
      .catch(logError("VenvPanel: get_active_versions"));
  }, []);

  const refreshStatus = useCallback(
    (version: string) => {
      invokeCmd<VenvStatus>("get_venv_status", { version })
        .then((s) => {
          setVenvStatuses((prev) => ({ ...prev, [version]: s }));
        })
        .catch(() => {});
    },
    [],
  );

  const refreshAll = useCallback(() => {
    if (!versions) return;
    for (const ver of Object.keys(versions)) {
      refreshStatus(ver);
    }
  }, [versions, refreshStatus]);

  usePolling(refreshAll, POLL_INTERVALS.venv, !!versions);

  const handleSetup = async (version: string, force: boolean) => {
    setSetupVersion(version);
    setBusyVersion(version);
    const tid = toastLoading(`Setting up venv for v${version}...`);
    const success = await venvSetup.start(version, force);
    if (success) {
      toastUpdate(tid, "success", `venv setup completed for v${version}`);
    } else {
      toastUpdate(tid, "error", `venv setup failed for v${version}`, "Check output below");
    }
    setBusyVersion(null);
    refreshStatus(version);
  };

  const handleRemove = async (version: string) => {
    setRemoveDialog(null);
    setBusyVersion(version);
    const tid = toastLoading(`Removing venv for v${version}...`);
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "venv_remove",
        { version },
      );
      if (result.success) {
        toastUpdate(tid, "success", `venv removed for v${version}`);
      } else {
        toastUpdate(tid, "error", `Failed to remove venv`, result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", `Failed to remove venv`, String(e));
    } finally {
      setBusyVersion(null);
      refreshStatus(version);
    }
  };

  if (!versions) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const sortedKeys = Object.keys(versions).sort();

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("venv.title")}</h1>
          <Button size="sm" variant="outline" onClick={refreshAll}>
            {t("common.refreshAll")}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("venv.description")}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sortedKeys.map((ver) => (
            <VenvCard
              key={ver}
              version={ver}
              info={versions[ver]}
              status={venvStatuses[ver] ?? null}
              active={activeVersions.includes(ver)}
              busy={busyVersion === ver}
              setupRunning={setupVersion === ver && venvSetup.running}
              onSetup={(force) => handleSetup(ver, force)}
              onRemove={() => setRemoveDialog(ver)}
              onRefresh={() => refreshStatus(ver)}
            />
          ))}
        </div>

        {setupVersion && (venvSetup.running || venvSetup.lines.length > 0) && (
          <SetupProgress
            version={setupVersion}
            lines={venvSetup.lines}
            running={venvSetup.running}
            onClose={() => {
              setSetupVersion(null);
              venvSetup.clear();
            }}
          />
        )}
      </div>

      <Dialog open={!!removeDialog} onClose={() => setRemoveDialog(null)}>
        <DialogHeader>
          <DialogTitle>{t("venv.removeConfirmTitle", { version: removeDialog ?? "" })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("venv.removeConfirmText")}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRemoveDialog(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => removeDialog && handleRemove(removeDialog)}
          >
            {t("common.remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}