import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { usePolling } from "../../hooks/usePolling";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader } from "../ui/card";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import {
  ArrowRight,
  Plus,
  Play,
  Square,
  Trash2,
  RefreshCw,
  Loader2,
  Activity,
} from "lucide-react";
import { POLL_INTERVALS } from "../../lib/constants";
import type { MigrationGroup, MigrationStatus, VersionInfo } from "../../types";

export function MigratePanel() {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [groups, setGroups] = useState<MigrationGroup[]>([]);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const [fromVer, setFromVer] = useState("");
  const [toVer, setToVer] = useState("");
  const [groupName, setGroupName] = useState("");
  const [pgVersion, setPgVersion] = useState("");

  const refresh = useCallback(() => {
    invokeCmd<MigrationGroup[]>("migrate_list")
      .then(setGroups)
      .catch(() => {});
    invokeCmd<MigrationStatus>("migrate_status")
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => {
        setVersions(v);
        const keys = Object.keys(v).sort();
        if (keys.length >= 2) {
          setFromVer(keys[0]);
          setToVer(keys[keys.length - 1]);
        }
      })
      .catch(logError("MigratePanel: get_versions"));
    refresh();
  }, [refresh]);

  usePolling(refresh, POLL_INTERVALS.venv, true);

  const handleCreate = async () => {
    if (!fromVer || !toVer || fromVer === toVer) return;
    setBusy(true);
    const tid = toastLoading(`Creating migration group ${fromVer}→${toVer}...`);
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "migrate_create",
        {
          from: fromVer,
          to: toVer,
          name: groupName || null,
          pg_version: pgVersion || null,
        },
      );
      if (result.success) {
        toastUpdate(tid, "success", `Migration group created`);
        setShowCreate(false);
        setGroupName("");
        setPgVersion("");
        refresh();
      } else {
        toastUpdate(tid, "error", "Failed to create group", result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", "Failed to create group", String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleActivate = async (name: string) => {
    setBusy(true);
    const tid = toastLoading(`Activating ${name}...`);
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "migrate_activate",
        { name },
      );
      if (result.success) {
        toastUpdate(tid, "success", `${name} activated`);
        refresh();
      } else {
        toastUpdate(tid, "error", "Activation failed", result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", "Activation failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async () => {
    setBusy(true);
    const tid = toastLoading("Deactivating migration...");
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "migrate_deactivate",
      );
      if (result.success) {
        toastUpdate(tid, "success", "Migration deactivated");
        refresh();
      } else {
        toastUpdate(tid, "error", "Deactivation failed", result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", "Deactivation failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (name: string) => {
    setRemoveTarget(null);
    setBusy(true);
    const tid = toastLoading(`Removing ${name}...`);
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "migrate_remove",
        { name },
      );
      if (result.success) {
        toastUpdate(tid, "success", `${name} removed`);
        refresh();
      } else {
        toastUpdate(tid, "error", "Removal failed", result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", "Removal failed", String(e));
    } finally {
      setBusy(false);
    }
  };

  const sortedVersions = versions ? Object.keys(versions).sort() : [];

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
          <Card className="border-green-500/30 bg-green-500/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-green-500" />
                  <span className="font-semibold">
                    Active: {status.group_name ?? "unknown"}
                  </span>
                </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeactivate}
              disabled={busy}
            >
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
            {groups.map((g) => {
              const isActive = g.status.toLowerCase() === "active";
              return (
                <Card key={g.name} className={isActive ? "border-green-500/30" : ""}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <Badge variant={isActive ? "success" : "neutral"}>
                          v{g.from_version}
                        </Badge>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                        <Badge variant={isActive ? "success" : "neutral"}>
                          v{g.to_version}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        <span className="font-mono">{g.name}</span>
                        {" | "}
                        PostgreSQL <span className="font-mono">{g.postgres}</span>
                        {" | "}
                        Port <span className="font-mono">{g.shared_port}</span>
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
                          onClick={() => handleActivate(g.name)}
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
                        onClick={() => setRemoveTarget(g.name)}
                        disabled={busy}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showCreate} onClose={() => setShowCreate(false)}>
        <DialogHeader>
          <DialogTitle>{t("migrate.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("migrate.from")}</Label>
            <select
              value={fromVer}
              onChange={(e) => setFromVer(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {sortedVersions.map((v) => (
                <option key={v} value={v}>
                  v{v}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("migrate.to")}</Label>
            <select
              value={toVer}
              onChange={(e) => setToVer(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {sortedVersions.map((v) => (
                <option key={v} value={v}>
                  v{v}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t("migrate.groupName")}</Label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={`${fromVer}-to-${toVer}`}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("migrate.pgOverride")}</Label>
            <Input
              value={pgVersion}
              onChange={(e) => setPgVersion(e.target.value)}
              placeholder={t("migrate.pgPlaceholder")}
              className="font-mono text-sm"
            />
          </div>
          {fromVer && toVer && fromVer === toVer && (
            <p className="text-sm text-red-500">
              {t("migrate.sourceTargetMustDiffer")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowCreate(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={busy || !fromVer || !toVer || fromVer === toVer}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("common.create")}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <DialogHeader>
          <DialogTitle>{t("migrate.removeConfirmTitle", { name: removeTarget ?? "" })}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {t("migrate.removeConfirmText")}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setRemoveTarget(null)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => removeTarget && handleRemove(removeTarget)}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
            {t("common.remove")}
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}