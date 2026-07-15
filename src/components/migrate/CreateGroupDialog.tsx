import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import type { VersionInfo } from "../../types";
import type { CreateGroupArgs } from "./useMigrations";

export function CreateGroupDialog({
  open,
  onClose,
  versions,
  busy,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  versions: Record<string, VersionInfo> | null;
  busy: boolean;
  onCreate: (args: CreateGroupArgs) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const sortedVersions = useMemo(
    () => (versions ? Object.keys(versions).sort() : []),
    [versions],
  );

  const [fromVer, setFromVer] = useState("");
  const [toVer, setToVer] = useState("");
  const [groupName, setGroupName] = useState("");
  const [pgVersion, setPgVersion] = useState("");

  // Populate the from/to defaults once versions are known, without clobbering
  // a selection the user already made.
  useEffect(() => {
    if (sortedVersions.length >= 2) {
      setFromVer((prev) => prev || sortedVersions[0]);
      setToVer((prev) => prev || sortedVersions[sortedVersions.length - 1]);
    }
  }, [sortedVersions]);

  const sameVersion = !!fromVer && !!toVer && fromVer === toVer;

  const handleCreate = async () => {
    if (!fromVer || !toVer || sameVersion) return;
    const ok = await onCreate({
      from: fromVer,
      to: toVer,
      name: groupName || null,
      pgVersion: pgVersion || null,
    });
    if (ok) {
      setGroupName("");
      setPgVersion("");
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
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
        {sameVersion && (
          <p className="text-sm text-red-500">
            {t("migrate.sourceTargetMustDiffer")}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleCreate} disabled={busy || !fromVer || !toVer || sameVersion}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t("common.create")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
