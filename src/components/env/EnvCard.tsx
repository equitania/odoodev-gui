import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  CircleCheckBig,
  CircleX,
  TriangleAlert,
  Loader2,
  FileCog,
  Eye,
  Pencil,
  RefreshCw,
  FolderOpen,
} from "lucide-react";
import { versionColor, versionBg } from "../../lib/constants";
import type { EnvCheckResult } from "../../types";

interface EnvCardProps {
  version: string;
  envDir: string | null;
  checkResult: EnvCheckResult | null;
  active: boolean;
  busy: boolean;
  setupRunning: boolean;
  onSetup: () => void;
  onShow: () => void;
  onEdit: () => void;
  onCheck: () => void;
}

export function EnvCard({
  version,
  envDir,
  checkResult,
  active,
  busy,
  setupRunning,
  onSetup,
  onShow,
  onEdit,
  onCheck,
}: EnvCardProps) {
  const exists = checkResult?.exists ?? false;
  const complete = checkResult?.complete ?? false;

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
            {checkResult ? (
              complete ? (
                <Badge variant="success">
                  <CircleCheckBig className="h-3 w-3" />
                  Complete
                </Badge>
              ) : exists ? (
                <Badge variant="warning">
                  <TriangleAlert className="h-3 w-3" />
                  Incomplete
                </Badge>
              ) : (
                <Badge variant="neutral">
                  <CircleX className="h-3 w-3" />
                  Missing
                </Badge>
              )
            ) : (
              <Badge variant="neutral">Unknown</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground space-y-0.5">
          {envDir && (
            <div className="flex items-center gap-1">
              <FolderOpen className="h-3 w-3" />
              <span className="font-mono">{envDir}</span>
            </div>
          )}
          {checkResult?.message && (
            <div className="mt-1 font-mono text-xs">{checkResult.message}</div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {!exists || !complete ? (
            <Button
              size="sm"
              variant="default"
              onClick={onSetup}
              disabled={busy || setupRunning || !active}
            >
              {setupRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileCog className="h-3.5 w-3.5" />
              )}
              Setup
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onSetup}
              disabled={busy || setupRunning || !active}
            >
              {setupRunning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Update
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onShow}
            disabled={busy || setupRunning || !exists}
          >
            <Eye className="h-3.5 w-3.5" />
            Show
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onEdit}
            disabled={busy || setupRunning || !exists || !envDir}
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onCheck}
            disabled={busy || setupRunning}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Check
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}