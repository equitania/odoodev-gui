import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Activity, Square } from "lucide-react";
import type { MigrationStatus } from "../../types";

export function ActiveMigrationCard({
  status,
  busy,
  onDeactivate,
}: {
  status: MigrationStatus;
  busy: boolean;
  onDeactivate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card className="border-green-500/30 bg-green-500/5">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-green-500" />
            <span className="font-semibold">
              Active: {status.group_name ?? "unknown"}
            </span>
          </div>
          <Button size="sm" variant="outline" onClick={onDeactivate} disabled={busy}>
            <Square className="h-3.5 w-3.5" />
            {t("migrate.deactivate")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {status.source && (
          <div>
            Source: <span className="font-mono">{status.source}</span>
          </div>
        )}
        {status.target && (
          <div>
            Target: <span className="font-mono">{status.target}</span>
          </div>
        )}
        {status.shared_port && (
          <div>
            Shared DB Port: <span className="font-mono">{status.shared_port}</span>
          </div>
        )}
        {status.filestore && (
          <div>
            Filestore: <span className="font-mono">{status.filestore}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
