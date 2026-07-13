import { useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";

interface UnsavedChangesDialogProps {
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  open,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogHeader>
        <DialogTitle>{t("editor.unsavedTitle")}</DialogTitle>
        <DialogDescription>{t("editor.unsavedMessage")}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="destructive" onClick={onDiscard}>
          {t("editor.unsavedDiscard")}
        </Button>
        <Button onClick={onSave}>{t("editor.unsavedSave")}</Button>
      </DialogFooter>
    </Dialog>
  );
}
