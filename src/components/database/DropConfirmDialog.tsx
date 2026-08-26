import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function DropConfirmDialog({
  open,
  onClose,
  dbName,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  dbName: string;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");

  const matches = confirmText === dbName;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t("database.dropConfirm", { name: dbName })}</DialogTitle>
        <DialogDescription>{t("database.dropWarning")}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-sm">{t("database.typeToConfirm")}</p>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={dbName}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="destructive"
          disabled={!matches}
          onClick={() => {
            onConfirm();
            setConfirmText("");
          }}
        >
          {t("database.drop")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}