import { useTranslation } from "react-i18next";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Trash2 } from "lucide-react";

export function RemoveConfirmDialog({
  target,
  onClose,
  busy,
  onConfirm,
}: {
  target: string | null;
  onClose: () => void;
  busy: boolean;
  onConfirm: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!target} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t("migrate.removeConfirmTitle", { name: target ?? "" })}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">
        {t("migrate.removeConfirmText")}
      </p>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          onClick={() => target && onConfirm(target)}
          disabled={busy}
        >
          <Trash2 className="h-4 w-4" />
          {t("common.remove")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
