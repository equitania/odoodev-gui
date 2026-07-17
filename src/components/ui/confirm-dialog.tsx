import { useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./dialog";
import { Button } from "./button";

/** Generic confirmation dialog (no type-the-name requirement — use
 *  DropConfirmDialog for destructive DB drops). */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant={danger ? "destructive" : "default"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
