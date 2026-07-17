import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { TagInput } from "../ui/tag-input";

export function PresetSaveDialog({
  open,
  onClose,
  initialName,
  initialTags,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  initialName?: string;
  initialTags?: string[];
  onConfirm: (name: string, tags: string[]) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName ?? "");
  const [tags, setTags] = useState<string[]>(initialTags ?? []);

  // Re-seed the form whenever the dialog opens for a (possibly different) preset.
  useEffect(() => {
    if (open) {
      setName(initialName ?? "");
      setTags(initialTags ?? []);
    }
  }, [open, initialName, initialTags]);

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t("server.presetSaveTitle")}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t("server.presetName")}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Regression"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid) onConfirm(name.trim(), tags);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label>{t("common.tags")}</Label>
          <TagInput tags={tags} onChange={setTags} placeholder={t("common.addTag")} />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={!valid} onClick={() => onConfirm(name.trim(), tags)}>
          {t("server.presetSave")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
