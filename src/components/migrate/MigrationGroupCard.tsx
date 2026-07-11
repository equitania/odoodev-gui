import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";
import { ArrowRight, Play, Trash2, Loader2, Activity } from "lucide-react";
import type { MigrationGroup } from "../../types";

export function MigrationGroupCard({
  group,
  busy,
  onActivate,
  onRemove,
}: {
  group: MigrationGroup;
  busy: boolean;
  onActivate: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const isActive = group.status.toLowerCase() === "active";
  return (
    <Card className={isActive ? "border-green-500/30" : ""}>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Badge variant={isActive ? "success" : "neutral"}>
              v{group.from_version}
            </Badge>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <Badge variant={isActive ? "success" : "neutral"}>
              v{group.to_version}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-mono">{group.name}</span>
            {" | "}
            PostgreSQL <span className="font-mono">{group.postgres}</span>
            {" | "}
            Port <span className="font-mono">{group.shared_port}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive ? (
            <Badge variant="success">
              <Activity className="h-3 w-3" />
              Active
            </Badge>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onActivate(group.name)}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Activate
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(group.name)}
            disabled={busy}
            className="text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
