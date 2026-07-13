import { useTranslation } from "react-i18next";
import { Badge } from "../ui/badge";
import { Label } from "../ui/label";
import { Server, TriangleAlert, FileKey, Network } from "lucide-react";
import type { PlaybookDetails, StepCapability } from "../../types";

interface PlaybookDetailsCardProps {
  details: PlaybookDetails;
  capabilities: StepCapability[];
}

export function PlaybookDetailsCard({ details, capabilities }: PlaybookDetailsCardProps) {
  const { t } = useTranslation();

  const serverCommands = new Set(
    capabilities.filter((c) => c.mode === "server").map((c) => c.command),
  );
  const hasServerSteps = details.step_commands.some((c) => serverCommands.has(c));

  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Label>{t("playbook.details.title")}</Label>
        {details.version && <Badge variant="outline">v{details.version}</Badge>}
        {details.on_error && (
          <Badge variant="outline" className="font-mono text-xs">
            on_error: {details.on_error}
          </Badge>
        )}
      </div>

      {details.description && (
        <p className="text-sm text-muted-foreground">{details.description}</p>
      )}

      {details.step_names.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {details.step_names.map((name, i) => (
            <Badge key={`${name}-${i}`} variant="outline" className="font-mono text-xs">
              {serverCommands.has(details.step_commands[i]) && (
                <Server className="mr-1 h-3 w-3" />
              )}
              {name}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {details.targets.length > 0 && (
          <span className="flex items-center gap-1.5">
            {t("playbook.details.targets")}:
            {details.targets.map((target) => (
              <Badge key={target} variant="outline">
                {target}
              </Badge>
            ))}
          </span>
        )}
        {details.env_file && (
          <span className="flex items-center gap-1">
            <FileKey className="h-3 w-3" />
            {details.env_file}
          </span>
        )}
        {details.has_rpc && (
          <Badge variant="outline">
            <Network className="mr-1 h-3 w-3" />
            RPC
          </Badge>
        )}
      </div>

      {hasServerSteps && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {details.targets.length > 0
              ? t("playbook.details.serverModeWarningTargets", {
                  targets: details.targets.join(", "),
                })
              : t("playbook.details.serverModeWarning")}
          </span>
        </div>
      )}
    </div>
  );
}
