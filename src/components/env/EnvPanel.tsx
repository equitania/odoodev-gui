import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { useEnvSetup } from "../../hooks/useEnvSetup";
import { usePolling } from "../../hooks/usePolling";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { EnvCard } from "./EnvCard";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Loader2, Terminal } from "lucide-react";
import { POLL_INTERVALS } from "../../lib/constants";
import type { EnvCheckResult, VersionInfo } from "../../types";

export function EnvPanel() {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [activeVersions, setActiveVersions] = useState<string[]>([]);
  const [envDirs, setEnvDirs] = useState<Record<string, string>>({});
  const [envChecks, setEnvChecks] = useState<Record<string, EnvCheckResult>>({});
  const [busyVersion, setBusyVersion] = useState<string | null>(null);
  const [setupVersion, setSetupVersion] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState<{ version: string; content: string } | null>(null);

  const envSetup = useEnvSetup();

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => setVersions(v))
      .catch(logError("EnvPanel: get_versions"));
    invokeCmd<string[]>("get_active_versions")
      .then(setActiveVersions)
      .catch(logError("EnvPanel: get_active_versions"));
  }, []);

  const refreshVersion = useCallback((version: string) => {
    invokeCmd<string>("env_dir", { version })
      .then((dir) => {
        setEnvDirs((prev) => ({ ...prev, [version]: dir.trim() }));
      })
      .catch(() => {});
    invokeCmd<EnvCheckResult>("env_check", { version })
      .then((check) => {
        setEnvChecks((prev) => ({ ...prev, [version]: check }));
      })
      .catch(() => {});
  }, []);

  const refreshAll = useCallback(() => {
    if (!versions) return;
    for (const ver of Object.keys(versions)) {
      refreshVersion(ver);
    }
  }, [versions, refreshVersion]);

  usePolling(refreshAll, POLL_INTERVALS.venv, !!versions);

  const handleSetup = async (version: string) => {
    setSetupVersion(version);
    setBusyVersion(version);
    const tid = toastLoading(`Setting up .env for v${version}...`);
    const success = await envSetup.start(version);
    if (success) {
      toastUpdate(tid, "success", `.env setup completed for v${version}`);
    } else {
      toastUpdate(tid, "error", `.env setup failed for v${version}`, "Check output below");
    }
    setBusyVersion(null);
    refreshVersion(version);
  };

  const handleShow = async (version: string) => {
    setBusyVersion(version);
    const tid = toastLoading(`Loading .env for v${version}...`);
    try {
      const content = await invokeCmd<string>("env_show", { version });
      setShowDialog({ version, content });
      toastUpdate(tid, "success", `.env loaded for v${version}`);
    } catch (e) {
      toastUpdate(tid, "error", `Failed to load .env`, String(e));
    } finally {
      setBusyVersion(null);
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
        <h1 className="text-2xl font-semibold">{t("env.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("env.description")}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sortedKeys.map((ver) => (
            <EnvCard
              key={ver}
              version={ver}
              envDir={envDirs[ver] ?? null}
              checkResult={envChecks[ver] ?? null}
              active={activeVersions.includes(ver)}
              busy={busyVersion === ver}
              setupRunning={setupVersion === ver && envSetup.running}
              onSetup={() => handleSetup(ver)}
              onShow={() => handleShow(ver)}
              onCheck={() => refreshVersion(ver)}
            />
          ))}
        </div>

        {setupVersion && (envSetup.running || envSetup.lines.length > 0) && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">env setup v{setupVersion}</span>
                {envSetup.running ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : null}
              </div>
              {!envSetup.running && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSetupVersion(null);
                    envSetup.clear();
                  }}
                >
                  Close
                </Button>
              )}
            </div>
            <div className="max-h-64 overflow-auto rounded-md bg-black/90 p-3 font-mono text-xs leading-relaxed text-green-400">
              {envSetup.lines.length === 0 ? (
                <span className="text-muted-foreground">Waiting for output...</span>
              ) : (
                envSetup.lines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!showDialog} onClose={() => setShowDialog(null)}>
        <DialogHeader>
          <DialogTitle>{t("env.envDialogTitle", { version: showDialog?.version ?? "" })}</DialogTitle>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto rounded-md bg-black/90 p-4 font-mono text-xs text-green-400">
          {showDialog?.content}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowDialog(null)}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}