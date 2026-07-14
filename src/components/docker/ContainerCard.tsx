import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { RuntimeDot } from "./RuntimeBanner";
import { ArrowUp, ArrowDown, FileCog, FileText, Gauge, Loader2 } from "lucide-react";
import { VERSION_COLORS, VERSION_BG } from "../../lib/constants";
import type { ContainerInfo, DockerStatus, VersionInfo } from "../../types";

interface ContainerCardProps {
  version: string;
  info: VersionInfo;
  dockerStatus: DockerStatus | null;
  container: ContainerInfo | null;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onLogs: () => void;
  /** Benchmark is macOS + Apple Container only (Docker vs Apple comparison). */
  benchAvailable: boolean;
  onBench: () => void;
  /** docker-compose.yml path (null when unknown/missing). */
  composePath: string | null;
  onEditCompose: (path: string) => void;
}

export function ContainerCard({
  version,
  info,
  dockerStatus,
  container,
  busy,
  onUp,
  onDown,
  onLogs,
  benchAvailable,
  onBench,
  composePath,
  onEditCompose,
}: ContainerCardProps) {
  const running = dockerStatus?.running ?? false;
  const runtime = dockerStatus?.runtime ?? "none";

  return (
    <Card className="hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-1 ${VERSION_COLORS[version] ?? ""} ${VERSION_BG[version] ?? ""}`}
          >
            <span className="text-xl font-bold">v{version}</span>
          </div>
          <div className="flex items-center gap-2">
            <RuntimeDot runtime={runtime} />
            <span className="text-xs text-muted-foreground">
              {runtime === "apple" ? "Apple" : runtime === "docker" ? "Docker" : "—"}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {running ? (
            <Badge variant="success">PostgreSQL running</Badge>
          ) : runtime === "none" ? (
            <Badge variant="neutral">No runtime</Badge>
          ) : (
            <Badge variant="neutral">PostgreSQL stopped</Badge>
          )}
          {container && (
            <>
              <Badge variant="outline">{container.image.split(":").pop()}</Badge>
              {container.ip && (
                <Badge variant="outline">{container.ip}</Badge>
              )}
            </>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          <div>
            DB port: <span className="font-mono">{info.ports.db}</span>
            {" | "}
            PostgreSQL {info.postgres}
          </div>
          {container && (
            <div className="mt-1 space-y-0.5">
              <div>
                Container: <span className="font-mono">{container.id}</span>
              </div>
              <div>
                CPUs: {container.cpus} | RAM: {container.memory_mb} MB
              </div>
              {container.started && (
                <div>Started: {container.started}</div>
              )}
            </div>
          )}
          {dockerStatus?.container_name && !container && (
            <div className="mt-1">
              Container: <span className="font-mono">{dockerStatus.container_name}</span>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={onDown} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDown className="h-3.5 w-3.5" />}
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="default" onClick={onUp} disabled={busy || runtime === "none"}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
              Start
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onLogs} disabled={!running}>
            <FileText className="h-3.5 w-3.5" />
            Logs
          </Button>
          {benchAvailable && (
            <Button size="sm" variant="ghost" onClick={onBench} disabled={runtime === "none"}>
              <Gauge className="h-3.5 w-3.5" />
              Bench
            </Button>
          )}
          {runtime === "docker" && composePath && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEditCompose(composePath)}
              title={composePath}
            >
              <FileCog className="h-3.5 w-3.5" />
              Compose
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}