import { Card, CardContent, CardHeader } from "../ui/card";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { GitBranch, GitPullRequest, Loader2, Settings2, FolderOpen } from "lucide-react";
import { VERSION_COLORS, VERSION_BG } from "../../lib/constants";
import type { VersionInfo } from "../../types";

interface ReposCardProps {
  version: string;
  info: VersionInfo;
  active: boolean;
  busy: boolean;
  onRepos: () => void;
  onPull: () => void;
  onConfigOnly: () => void;
}

export function ReposCard({
  version,
  info,
  active,
  busy,
  onRepos,
  onPull,
  onConfigOnly,
}: ReposCardProps) {
  return (
    <Card className={`hover:shadow-md ${!active ? "opacity-50" : ""}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div
            className={`flex items-center gap-2 rounded-md border px-3 py-1 ${VERSION_COLORS[version] ?? ""} ${VERSION_BG[version] ?? ""}`}
          >
            <span className="text-xl font-bold">v{version}</span>
          </div>
          <Badge variant="outline">
            <GitBranch className="h-3 w-3" />
            repos.yaml
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <FolderOpen className="h-3 w-3" />
            Base: <span className="font-mono">{info.base}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={onRepos}
            disabled={busy || !active}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitBranch className="h-3.5 w-3.5" />
            )}
            Repos
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onPull}
            disabled={busy || !active}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5" />
            )}
            Pull
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onConfigOnly}
            disabled={busy || !active}
          >
            <Settings2 className="h-3.5 w-3.5" />
            Config Only
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}