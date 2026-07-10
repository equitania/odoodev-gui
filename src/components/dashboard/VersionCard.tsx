import { useState } from "react";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { StatusBadge } from "./StatusBadge";
import { usePolling } from "../../hooks/usePolling";
import { invokeCmd } from "../../lib/tauri";
import { VERSION_COLORS, VERSION_BG, POLL_INTERVALS } from "../../lib/constants";
import type { DockerStatus, ServerStatus, VenvStatus, VersionInfo, ViewKey } from "../../types";
import { Rocket, Database as DbIcon, ArrowUp, ArrowDown } from "lucide-react";

export function VersionCard({
  version,
  info,
  active,
  onNavigate,
}: {
  version: string;
  info: VersionInfo;
  active: boolean;
  onNavigate: (view: ViewKey, version: string) => void;
}) {
  const [venvStatus, setVenvStatus] = useState<VenvStatus | null>(null);
  const [dockerStatus, setDockerStatus] = useState<DockerStatus | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);

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

  const dockerBadge = dockerRunning
    ? { status: "running" as const, label: dockerRuntime === "apple" ? "Container running" : "Docker running" }
    : dockerRuntime === "none"
      ? { status: "neutral" as const, label: "No runtime" }
      : { status: "stopped" as const, label: dockerRuntime === "apple" ? "Container stopped" : "Docker stopped" };

  const venvBadge = !venvStatus?.exists
    ? { status: "error" as const, label: "Venv missing" }
    : venvStatus.requirements_current === false
      ? { status: "warn" as const, label: "Venv stale" }
      : venvStatus.requirements_current === true
        ? { status: "ok" as const, label: "Venv current" }
        : { status: "neutral" as const, label: "Venv unknown" };

  const pythonBadge = venvStatus?.python_version
    ? {
        status: venvStatus.python_matches === false ? ("error" as const) : ("ok" as const),
        label: `Python ${venvStatus.python_version}`,
      }
    : { status: "neutral" as const, label: "Python —" };

  const odooBadge = odooRunning
    ? { status: "running" as const, label: `Odoo :${info.ports.odoo}` }
    : { status: "stopped" as const, label: "Odoo stopped" };

  const handleDockerUp = async () => {
    try {
      await invokeCmd("docker_up", { version, runtime: dockerStatus?.runtime });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDockerDown = async () => {
    try {
      await invokeCmd("docker_down", { version, runtime: dockerStatus?.runtime });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Card className={active ? "" : "opacity-50"}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className={`flex items-center gap-2 rounded-md border px-3 py-1 ${VERSION_COLORS[version] ?? ""} ${VERSION_BG[version] ?? ""}`}>
            <span className="text-xl font-bold">v{version}</span>
          </div>
          {!active && <span className="text-xs text-muted-foreground">Not in active versions</span>}
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
          <div>DB: {info.ports.db} | Odoo: {info.ports.odoo} | Mailpit: {info.ports.mailpit}</div>
          <div className="truncate" title={info.base}>{info.base}</div>
          <div>PostgreSQL {info.postgres}</div>
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="default"
            disabled={!active || odooRunning}
            onClick={() => onNavigate("server", version)}
            title={odooRunning ? "Server already running" : !active ? "Version not active" : "Start server"}
          >
            <Rocket className="h-3.5 w-3.5" />
            Start Server
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onNavigate("database", version)}
          >
            <DbIcon className="h-3.5 w-3.5" />
            Databases
          </Button>
          {dockerRunning ? (
            <Button size="sm" variant="outline" onClick={handleDockerDown} disabled={!active}>
              <ArrowDown className="h-3.5 w-3.5" />
              {dockerRuntime === "apple" ? "Stop" : "Docker Down"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={handleDockerUp} disabled={!active}>
              <ArrowUp className="h-3.5 w-3.5" />
              {dockerRuntime === "apple" ? "Start" : "Docker Up"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}