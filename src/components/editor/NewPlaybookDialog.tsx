import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SegmentedControl } from "../ui/segmented-control";

export const PLAYBOOK_TEMPLATE = `version: "18"
on_error: stop
description: "New playbook"

steps:
  - name: "Example step"
    command: docker.up
`;

interface NewPlaybookDialogProps {
  open: boolean;
  roots: string[];
  existingNames: string[];
  onClose: () => void;
  onCreate: (path: string) => void;
}

export function NewPlaybookDialog({
  open,
  roots,
  existingNames,
  onClose,
  onCreate,
}: NewPlaybookDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [root, setRoot] = useState(roots[0] ?? "");

  const trimmed = name.trim().replace(/\.ya?ml$/i, "");
  const invalidChars = /[/\\:]/.test(trimmed);
  const duplicate = existingNames.includes(trimmed);
  const canCreate = trimmed.length > 0 && !invalidChars && !duplicate && !!root;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate(`${root}/${trimmed}.yaml`);
    setName("");
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t("editor.newPlaybook")}</DialogTitle>
        <DialogDescription>{t("editor.newPlaybookDescription")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t("editor.newPlaybookName")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder="my-playbook"
            className="font-mono text-sm"
            autoFocus
          />
          {invalidChars && (
            <p className="text-xs text-destructive">{t("editor.nameInvalidChars")}</p>
          )}
          {duplicate && (
            <p className="text-xs text-destructive">{t("editor.nameDuplicate")}</p>
          )}
        </div>

        {roots.length > 1 && (
          <div className="space-y-2">
            <Label>{t("editor.newPlaybookDestination")}</Label>
            <SegmentedControl
              options={roots.map((r) => ({
                value: r,
                label: r.split("/").slice(-3).join("/"),
              }))}
              value={root}
              onChange={setRoot}
              className="max-w-full flex-wrap"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("editor.newPlaybookTemplate")}</Label>
          <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
            {PLAYBOOK_TEMPLATE}
          </pre>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleCreate} disabled={!canCreate}>
          {t("common.create")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
