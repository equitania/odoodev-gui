import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { invokeCmd } from "../../lib/tauri";

/** Read-only view of one `~/odoodev-logs/update_v*.log`. Mount with key={path}. */
export function UpdateLogDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invokeCmd<string>("read_update_log", { path })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <Dialog open onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>{t("database.updateLogTitle")}</DialogTitle>
      </DialogHeader>
      <p className="mb-2 truncate font-mono text-xs text-muted-foreground" title={path}>
        {path}
      </p>
      <div className="h-[60vh] overflow-auto rounded-md border border-border bg-muted/50 p-2">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <pre className="whitespace-pre font-mono text-xs">{content ?? t("common.loading")}</pre>
        )}
      </div>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogFooter>
    </Dialog>
  );
}
