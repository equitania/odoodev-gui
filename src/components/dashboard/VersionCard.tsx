import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";
import { usePolling } from "../../hooks/usePolling";
import { invokeCmd } from "../../lib/tauri";
import { reportError } from "../../lib/errors";
import { versionColor, versionBg, effectivePorts, POLL_INTERVALS } from "../../lib/constants";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import type {
  DockerStatus,
  ServerStatus,
  VenvStatus,
  VersionFileGroup,
  VersionInfo,
  ViewKey,
} from "../../types";
import {
  Rocket,
  Database as DbIcon,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ExternalLink,
  FileCog,
  Loader2,
  HardDrive,
} from "lucide-react";

export function VersionCard({
  version,
  info,
  active,
  fileGroup,
  onNavigate,
}: {
  version: string;
  info: VersionInfo;
  active: boolean;
  fileGroup: VersionFileGroup | null;
  onNavigate: (view: ViewKey, version?: string, editorPath?: string) => void;
}) {
  const { t } = useTranslation();
  const [venvStatus, setVenvStatus] = useState<VenvStatus | null>(null);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [dockerBusy, setDockerBusy] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  usePolling(
    () => {
      invokeCmd<VenvStatus>("get_venv_status", { version })
        .then(setVenvStatus)
        .catch(() => {});
    },
    POLL_INTERVALS.venv,
    active,
  );

  usePolling(
    () => {
      invokeCmd<DockerStatus>("get_docker_status", { version, versions: { [version]: info } })
        .then(setDockerStatus)
        .catch(() => {});
    },
    POLL_INTERVALS.docker,
    active,
  );

  usePolling(
    () => {
      invokeCmd<ServerStatus>("get_server_status", { version })
        .then(setServerStatus)
        .catch(() => {});
    },
    POLL_INTERVALS.server,
    active,
  );

  const odooRunning = serverStatus?.running ?? false;
  const dockerRunning = dockerStatus?.running ?? false;
  const dockerRuntime = dockerStatus?.runtime ?? "none";
  const ports = effectivePorts(info);

  // Jump-to-editor entries: only existing files; compose only under Docker.
  const editableEntries = (fileGroup?.entries ?? []).filter(
    (e) => e.exists && (e.role !== "compose" || dockerRuntime === "docker"),
  );

  const apple = dockerRuntime === "apple";
  const dockerBadge = dockerRunning
    ? { status: "running" as const, label: t(apple ? "dashboard.containerRunning" : "dashboard.dockerRunning") }
    : dockerRuntime === "none"
      ? { status: "neutral" as const, label: t("common.noRuntime") }
      : { status: "stopped" as const, label: t(apple ? "dashboard.containerStopped" : "dashboard.dockerStopped") };

  const venvBadge = !venvStatus?.exists
    ? { status: "error" as const, label: t("dashboard.venvMissing") }
    : venvStatus.requirements_current === false
      ? { status: "warn" as const, label: t("dashboard.venvStale") }
      : venvStatus.requirements_current === true
        ? { status: "ok" as const, label: t("dashboard.venvReady") }
        : { status: "neutral" as const, label: t("dashboard.venvUnknown") };

  const pythonBadge = venvStatus?.python_version
    ? {
        status: venvStatus.python_matches === false ? ("error" as const) : ("ok" as const),
        label: `Python ${venvStatus.python_version}`,
      }
    : { status: "neutral" as const, label: t("dashboard.pythonNone") };

  const odooBadge = odooRunning
    ? { status: "running" as const, label: `Odoo :${ports.odoo}` }
    : { status: "stopped" as const, label: t("dashboard.odooStopped") };

  const odooUrl = odooRunning
    ? `http://localhost:${serverStatus?.port ?? ports.odoo}`
    : null;

  const handleDockerUp = async () => {
    setDockerBusy(true);
    const tid = toastLoading(t("toast.startingPostgresql", { version }));
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>("docker_up", { version, runtime: dockerStatus?.runtime });
      if (result.success) {
        toastUpdate(tid, "success", t("toast.postgresqlStarted", { version }));
      } else {
        toastUpdate(tid, "error", t("toast.postgresqlStartFailed"), result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", t("toast.postgresqlStartFailed"), String(e));
    } finally {
      setDockerBusy(false);
    }
  };

  const handleDockerDown = async () => {
    setDockerBusy(true);
    const tid = toastLoading(t("toast.stoppingPostgresql", { version }));
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>("docker_down", { version, runtime: dockerStatus?.runtime });
      if (result.success) {
        toastUpdate(tid, "success", t("toast.postgresqlStopped", { version }));
      } else {
        toastUpdate(tid, "error", t("toast.postgresqlStopFailed"), result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", t("toast.postgresqlStopFailed"), String(e));
    } finally {
      setDockerBusy(false);
    }
  };

  return (
    <Card className={`transition-opacity ${active ? "" : "opacity-50"} hover:shadow-md`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 rounded-md border px-3 py-1 ${versionColor(version)} ${versionBg(version)}`}>
            <span className="text-xl font-bold">v{version}</span>
          </div>
          {!active && <span className="text-xs text-muted-foreground">{t("dashboard.notInActiveVersions")}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge {...dockerBadge} />
          <StatusBadge {...venvBadge} />
          <StatusBadge {...pythonBadge} />
          <StatusBadge {...odooBadge} />
        </div>

        <div className="text-xs text-muted-foreground">
          <div>{t("dashboard.ports", { db: ports.db, odoo: ports.odoo, mailpit: ports.mailpit })}</div>
          {odooUrl && (
            <button
              onClick={() =>
                invokeCmd("open_external", { url: odooUrl }).catch(
                  reportError(t("dashboard.openOdooFailed")),
                )
              }
              title={t("dashboard.openOdoo")}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {odooUrl}
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
          <div className="truncate" title={info.base}>{info.base}</div>
          <div>PostgreSQL {info.postgres}</div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={!active || odooRunning}
            onClick={() => onNavigate("server", version)}
            title={
              odooRunning
                ? t("dashboard.serverAlreadyRunning")
                : !active
                  ? t("dashboard.versionNotActive")
                  : t("dashboard.startServer")
            }
          >
            <Rocket className="h-3.5 w-3.5" />
            {t("dashboard.startServer")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate("database", version)}
          >
            <DbIcon className="h-3.5 w-3.5" />
            {t("dashboard.databases")}
          </Button>
          {dockerRunning ? (
            <Button size="sm" variant="outline" onClick={handleDockerDown} disabled={!active || dockerBusy} title={t("dashboard.stopPgTitle")}>
              {dockerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDown className="h-3.5 w-3.5" />}
              <HardDrive className="h-3.5 w-3.5" />
              {t("dashboard.stopPg")}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleDockerUp} disabled={!active || dockerBusy} title={t("dashboard.startPgTitle")}>
              {dockerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
              <HardDrive className="h-3.5 w-3.5" />
              {t("dashboard.startPg")}
            </Button>
          )}
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFilesOpen((o) => !o)}
              disabled={editableEntries.length === 0}
              title={t("dashboard.editConfigFiles")}
            >
              <FileCog className="h-3.5 w-3.5" />
              {t("dashboard.config")}
              <ChevronDown className="h-3 w-3" />
            </Button>
            {filesOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setFilesOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-60 rounded-md border bg-background p-1 shadow-lg">
                  {editableEntries.map((entry) => (
                    <button
                      key={entry.path}
                      title={entry.hint ? `${entry.path}\n${entry.hint}` : entry.path}
                      onClick={() => {
                        setFilesOpen(false);
                        onNavigate("editor", version, entry.path);
                      }}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <span className="truncate">{entry.label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}