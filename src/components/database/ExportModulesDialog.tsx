import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import type { ExportModulesResult, ExportScope } from "../../types";
import { invokeCmd } from "../../lib/tauri";
import { copyToClipboard } from "../../lib/clipboard";
import { useAppStore } from "../../store/appStore";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { isAtLeast, MIN_ODOODEV_EXPORT_VIA_RPC, MIN_ODOODEV_EXPORT_VIA_SHELL } from "../../lib/version";
import { cn } from "../../lib/utils";
import { buildExportArgs } from "./exportArgs";
import { CheckCircle2, Copy, Loader2, TriangleAlert } from "lucide-react";

/** Checkbox with a short explanation of what the CLI flag actually does. */
function OptionRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn("space-y-0.5", disabled && "opacity-50")}>
      <Checkbox checked={checked} onChange={onChange} label={label} disabled={disabled} />
      <p className="ml-6 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function ExportModulesDialog({
  open: isOpen,
  onClose,
  version,
  dbName,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  dbName: string;
}) {
  const { t } = useTranslation();
  const odoodevVersion = useAppStore((s) => s.odoodevInfo?.version ?? null);
  // Unknown version -> show the switch (same rule as the restore dialog).
  const offersViaShell =
    odoodevVersion === null || isAtLeast(odoodevVersion, MIN_ODOODEV_EXPORT_VIA_SHELL);

  // Version unknown -> no --via-rpc: an older CLI would reject it (see buildExportArgs).
  const offersViaRpc = isAtLeast(odoodevVersion, MIN_ODOODEV_EXPORT_VIA_RPC);

  const [scope, setScope] = useState<ExportScope>("all");
  const [updateList, setUpdateList] = useState(false);
  const [cleanup, setCleanup] = useState(false);
  const [viaShell, setViaShell] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExportModulesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Whether the run that produced `error` used the login path (not the live checkbox state).
  const [failedRunUsedLogin, setFailedRunUsedLogin] = useState(false);

  const run = async (overrideViaShell?: boolean) => {
    const form = {
      version,
      dbName,
      scope,
      updateList,
      cleanup,
      viaShell: overrideViaShell ?? viaShell,
    };
    const args = buildExportArgs(form, offersViaShell, offersViaRpc);
    const usesLogin = offersViaShell && !form.viaShell;
    setRunning(true);
    setError(null);
    setResult(null);
    setCopied(false);
    const toastId = toastLoading(t("exportModules.running", { name: dbName }));
    try {
      const res = await invokeCmd<ExportModulesResult>("export_modules", { ...args });
      setResult(res);
      toastUpdate(
        toastId,
        "success",
        res.count === 0
          ? t("exportModules.emptyToast", { name: dbName })
          : t("exportModules.doneToast", { name: dbName, count: res.count }),
      );
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setFailedRunUsedLogin(usesLogin);
      toastUpdate(toastId, "error", t("exportModules.failedToast", { name: dbName }), msg);
    } finally {
      setRunning(false);
    }
  };

  const copyPath = async () => {
    if (!result?.path) return;
    try {
      await copyToClipboard(result.path);
      setCopied(true);
    } catch (e) {
      setError(String(e));
    }
  };

  const retryWithoutLogin = () => {
    setViaShell(true);
    void run(true);
  };

  const canRetryWithoutLogin = error !== null && failedRunUsedLogin;

  return (
    <Dialog open={isOpen} onClose={running ? () => {} : onClose}>
      <DialogHeader>
        <DialogTitle>{t("exportModules.title")}</DialogTitle>
        <DialogDescription>
          <Trans
            i18nKey="exportModules.description"
            values={{ name: dbName, version }}
            components={[<code key="db" className="rounded bg-muted px-1" />]}
          />
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t("exportModules.scope")}</Label>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as ExportScope)}
            disabled={running}
          >
            <option value="all">{t("exportModules.scopeAll")}</option>
            <option value="no-enterprise">{t("exportModules.scopeNoEnterprise")}</option>
            <option value="installed">{t("exportModules.scopeInstalled")}</option>
          </Select>
        </div>

        <OptionRow
          checked={updateList}
          onChange={setUpdateList}
          label={t("exportModules.updateList")}
          hint={t("exportModules.updateListHint")}
          disabled={running}
        />
        <OptionRow
          checked={cleanup}
          onChange={setCleanup}
          label={t("exportModules.cleanup")}
          hint={t("exportModules.cleanupHint")}
          disabled={running}
        />
        {offersViaShell && (
          <OptionRow
            checked={viaShell}
            onChange={setViaShell}
            label={t("exportModules.viaShell")}
            hint={t("exportModules.viaShellHint")}
            disabled={running}
          />
        )}
        <p className="text-xs text-muted-foreground">{t("exportModules.outputHint")}</p>

        {result && result.count === 0 && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
            <span>{t("exportModules.empty")}</span>
          </div>
        )}
        {result && result.count > 0 && (
          <div className="space-y-2 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
              {t("exportModules.done", { count: result.count })}
            </div>
            {result.path && (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-muted px-1 text-xs">
                  {result.path}
                </code>
                <Button variant="outline" size="sm" onClick={copyPath} className="h-7 shrink-0">
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? t("exportModules.copied") : t("exportModules.copyPath")}
                </Button>
              </div>
            )}
          </div>
        )}
        {result && (result.updated !== null || result.cleaned !== null) && (
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {result.cleaned !== null && (
              <li>{t("exportModules.cleanedCount", { count: result.cleaned })}</li>
            )}
            {result.updated !== null && (
              <li>{t("exportModules.updatedCount", { count: result.updated })}</li>
            )}
          </ul>
        )}
        {error && (
          <div className="space-y-2 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span className="break-words">{error}</span>
            </div>
            {canRetryWithoutLogin && (
              <Button variant="outline" size="sm" onClick={retryWithoutLogin} disabled={running}>
                {t("exportModules.retryWithoutLogin")}
              </Button>
            )}
          </div>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={running}>
          {t("common.close")}
        </Button>
        <Button onClick={() => void run()} disabled={running}>
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {running ? t("exportModules.runningShort") : t("exportModules.export")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
