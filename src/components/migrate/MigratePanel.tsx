import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { Plus, RefreshCw } from "lucide-react";
import { useMigrations } from "./useMigrations";
import { ActiveMigrationCard } from "./ActiveMigrationCard";
import { MigrationGroupCard } from "./MigrationGroupCard";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { RemoveConfirmDialog } from "./RemoveConfirmDialog";

export function MigratePanel() {
  const { t } = useTranslation();
  const { versions, groups, status, busy, refresh, createGroup, activate, deactivate, remove } =
    useMigrations();
  const [showCreate, setShowCreate] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("migrate.title")}</h1>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t("common.refresh")}
            </Button>
            <Button size="sm" variant="default" onClick={() => setShowCreate(true)} disabled={busy}>
              <Plus className="h-3.5 w-3.5" />
              {t("migrate.newGroup")}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("migrate.description")}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {status && status.active && (
          <ActiveMigrationCard status={status} busy={busy} onDeactivate={deactivate} />
        )}

        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="text-sm">{t("migrate.noGroups")}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("migrate.createFirst")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <MigrationGroupCard
                key={g.name}
                group={g}
                busy={busy}
                onActivate={activate}
                onRemove={setRemoveTarget}
              />
            ))}
          </div>
        )}
      </div>

      <CreateGroupDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        versions={versions}
        busy={busy}
        onCreate={createGroup}
      />

      <RemoveConfirmDialog
        target={removeTarget}
        onClose={() => setRemoveTarget(null)}
        busy={busy}
        onConfirm={(name) => {
          setRemoveTarget(null);
          remove(name);
        }}
      />
    </div>
  );
}
