import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  CircleCheckBig,
  CircleX,
  TriangleAlert,
  Loader2,
  Package,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { versionColor, versionBg } from "../../lib/constants";
import type { VersionInfo, VenvStatus } from "../../types";

interface VenvCardProps {
  version: string;
  info: VersionInfo;
  status: VenvStatus | null;
  active: boolean;
  busy: boolean;
  setupRunning: boolean;
  onSetup: (force: boolean) => void;
  onRemove: () => void;
  onRefresh: () => void;
}

export function VenvCard({
  version,
  info,
  status,
  active,
  busy,
  setupRunning,
  onSetup,
  onRemove,
  onRefresh,
}: VenvCardProps) {
  const exists = status?.exists ?? false;
  const pythonMatches = status?.python_matches;
  const reqCurrent = status?.requirements_current;
  const isStale = exists && reqCurrent === false;
  const pythonMismatch = exists && pythonMatches === false;

  return (
    <Card className={`hover:shadow-md ${!active ? "opacity-50" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-1 ${versionColor(version)} ${versionBg(version)}`}
          >
            <span className="text-xl font-bold">v{version}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {exists ? (
              <Badge variant={isStale || pythonMismatch ? "warning" : "success"}>
                {isStale || pythonMismatch ? (
                  <TriangleAlert className="h-3 w-3" />
                ) : (
                  <CircleCheckBig className="h-3 w-3" />
                )}
                {isStale ? "Stale" : pythonMismatch ? "Mismatch" : "Ready"}
              </Badge>
            ) : (
              <Badge variant="neutral">
                <CircleX className="h-3 w-3" />
                Missing
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">
            Python {info.python}
          </Badge>
          {status?.python_version && (
            <Badge variant={pythonMatches === false ? "warning" : "outline"}>
              {pythonMatches === false ? "⚠ " : "✓ "}
              {status.python_version}
            </Badge>
          )}
          {exists && reqCurrent === true && (
            <Badge variant="success">Requirements current</Badge>
          )}
          {exists && reqCurrent === false && (
            <Badge variant="warning">Requirements stale</Badge>
          )}
          {exists && reqCurrent === null && (
            <Badge variant="neutral">No requirements.txt</Badge>
          )}
          {status?.is_symlink && (
            <Badge variant="outline">symlink</Badge>
          )}
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {status?.venv_dir && (
            <div>
              Path: <span className="font-mono">{status.venv_dir}</span>
            </div>
          )}
          <div>
            Expected Python: <span className="font-mono">{info.python}</span>
          </div>
        </div>

        <div className="flex gap-2">
          {!exists || isStale || pythonMismatch ? (
            <Button
              size="sm"
              variant="default"
              onClick={() => onSetup(isStale || pythonMismatch)}
              disabled={busy || setupRunning || !active}
            >
              {setupRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isStale || pythonMismatch ? (
                <RefreshCw className="h-3.5 w-3.5" />
              ) : (
                <Package className="h-3.5 w-3.5" />
              )}
              {exists ? "Recreate" : "Setup"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onSetup(true)}
              disabled={busy || setupRunning || !active}
            >
              {setupRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Reinstall
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onRefresh}
            disabled={busy || setupRunning}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Check
          </Button>
          {exists && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRemove}
              disabled={busy || setupRunning || !active}
              className="text-red-500 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}