import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import type { RestoreArgs, RestoreResult } from "../../types";
import { invokeCmd } from "../../lib/tauri";
import { defaultBackupDir, rememberBackupDir } from "../../lib/backupDir";
import { buildRestoreArgs } from "./restoreArgs";
import { cn } from "../../lib/utils";
import { CheckCircle2, FolderOpen, TriangleAlert } from "lucide-react";

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

export function RestoreDialog({
  open: isOpen,
  onClose,
  version,
  onProgress,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  onProgress: (title: string, eventName: string) => void;
  onFinished: (success: boolean, message?: string) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [backupFile, setBackupFile] = useState("");
  const [dbName, setDbName] = useState("");
  const [dropExisting, setDropExisting] = useState(false);
  const [deactivateCron, setDeactivateCron] = useState(false);
  const [neutralize, setNeutralize] = useState(false);
  const [anonymize, setAnonymize] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [purgeMasterData, setPurgeMasterData] = useState(false);
  const [purgeTransactions, setPurgeTransactions] = useState(false);
  const [anonymizeUsers, setAnonymizeUsers] = useState(false);
  const [userPassword, setUserPassword] = useState("ownerp");
  const [uninstallModules, setUninstallModules] = useState("");
  const [recompute, setRecompute] = useState(true);
  const [checkSpace, setCheckSpace] = useState(true);
  const [dryRunResult, setDryRunResult] = useState<string | null>(null);
  const [dryRunOk, setDryRunOk] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);

  // Derived, never stored: a "sanitize" flag of its own would drift out of sync
  // as soon as a single child is unticked, and this dialog's options are far
  // too destructive to display a stale summary state.
  const sanitize = deactivateCron && neutralize && anonymize && wipe && purgeMasterData;

  const setSanitize = (v: boolean) => {
    setDeactivateCron(v);
    setNeutralize(v);
    setAnonymize(v);
    setWipe(v);
    setPurgeMasterData(v);
  };

  const reset = () => {
    setStep(1);
    setBackupFile("");
    setDbName("");
    setDropExisting(false);
    setDeactivateCron(false);
    setNeutralize(false);
    setAnonymize(false);
    setWipe(false);
    setPurgeMasterData(false);
    setPurgeTransactions(false);
    setAnonymizeUsers(false);
    setUninstallModules("");
    setRecompute(true);
    setCheckSpace(true);
    setDryRunResult(null);
    setDryRunOk(null);
  };

  const browseBackupFile = async () => {
    const picked = await open({
      multiple: false,
      title: t("database.backupFile"),
      defaultPath: await defaultBackupDir(),
      filters: [{ name: "Backups", extensions: ["zip", "7z", "tar", "zst", "gz", "sql"] }],
    });
    if (typeof picked === "string") {
      setBackupFile(picked);
      rememberBackupDir(picked);
    }
  };

  const buildArgs = (dry: boolean): RestoreArgs =>
    buildRestoreArgs(
      {
        version,
        dbName,
        backupFile,
        dropExisting,
        deactivateCron,
        neutralize,
        anonymize,
        wipe,
        purgeMasterData,
        purgeTransactions,
        anonymizeUsers,
        userPassword,
        uninstallModules,
        recompute,
        checkSpace,
      },
      dry,
    );

  const handleDryRun = async () => {
    setRunning(true);
    setDryRunResult(null);
    setDryRunOk(null);
    try {
      const result = await invokeCmd<RestoreResult>("restore_db", { args: buildArgs(true) });
      // The dry run's whole point is its report — which backup file, whether the
      // target database would be dropped or created, where the filestore lands,
      // how much disk space is left and which post-restore steps would run.
      // Show it verbatim instead of collapsing it into a single verdict word.
      const report = result.output?.length
        ? result.output.join("\n")
        : result.error ?? t(result.success ? "database.dryRunPassed" : "database.dryRunFailed");
      setDryRunResult(report);
      setDryRunOk(result.success);
    } catch (e) {
      setDryRunResult(String(e));
      setDryRunOk(false);
    } finally {
      setRunning(false);
    }
  };

  const handleRestore = async () => {
    onClose();
    reset();
    onProgress(`Restore: ${dbName}`, "restore-progress");
    try {
      const result = await invokeCmd<RestoreResult>("restore_db", { args: buildArgs(false) });
      onFinished(result.success, result.error ?? undefined);
    } catch (e) {
      onFinished(false, String(e));
    }
  };

  const stepNames = [t("database.restoreSource"), t("database.restoreTarget"), t("database.restorePostProcessing")];

  return (
    <Dialog open={isOpen} onClose={() => { onClose(); reset(); }} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>{t("database.restoreTitle")} — {step}/3: {stepNames[step - 1]}</DialogTitle>
        <DialogDescription>{t("database.restoreDescription", { version })}</DialogDescription>
      </DialogHeader>

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("database.backupFile")}</Label>
            <div className="flex gap-2">
              <Input
                value={backupFile}
                onChange={(e) => setBackupFile(e.target.value)}
                placeholder="/path/to/backup.zip"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={browseBackupFile} className="h-9">
                <FolderOpen className="h-3.5 w-3.5" />
                {t("common.browse")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("database.supportedFormats")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { onClose(); reset(); }}>{t("common.cancel")}</Button>
            <Button onClick={() => setStep(2)} disabled={!backupFile}>{t("common.next")}</Button>
          </DialogFooter>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("database.newDbName")}</Label>
            <Input
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder={`v${version}_restored`}
            />
          </div>
          <OptionRow
            checked={dropExisting}
            onChange={setDropExisting}
            label={t("database.dropExisting")}
            hint={t("database.restoreHelp.drop")}
          />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>{t("common.back")}</Button>
            <Button onClick={() => setStep(3)} disabled={!dbName}>{t("common.next")}</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div className="rounded-md border border-border p-3 space-y-2">
            <OptionRow
              checked={sanitize}
              onChange={setSanitize}
              label={t("database.sanitize")}
              hint={t("database.restoreHelp.sanitize")}
            />
            <div className="ml-6 space-y-2">
              <OptionRow checked={deactivateCron} onChange={setDeactivateCron} label={t("database.deactivateCron")} hint={t("database.restoreHelp.deactivateCron")} />
              <OptionRow checked={neutralize} onChange={setNeutralize} label={t("database.neutralize")} hint={t("database.restoreHelp.neutralize")} />
              <OptionRow checked={anonymize} onChange={setAnonymize} label={t("database.anonymize")} hint={t("database.restoreHelp.anonymize")} />
              <OptionRow checked={wipe} onChange={setWipe} label={t("database.wipe")} hint={t("database.restoreHelp.wipe")} />
              {wipe && (
                <div className="flex items-start gap-2 rounded-md bg-yellow-500/10 p-2 text-xs text-yellow-600 dark:text-yellow-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("database.wipeWarning")}</span>
                </div>
              )}
              <OptionRow checked={purgeMasterData} onChange={setPurgeMasterData} label={t("database.purgeMasterData")} hint={t("database.restoreHelp.purgeMasterData")} />
              {purgeMasterData && (
                <div className="flex items-start gap-2 rounded-md bg-yellow-500/10 p-2 text-xs text-yellow-600 dark:text-yellow-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("database.purgeMasterDataWarning")}</span>
                </div>
              )}
            </div>
          </div>
          <OptionRow checked={anonymizeUsers} onChange={setAnonymizeUsers} label={t("database.anonymizeUsers")} hint={t("database.restoreHelp.anonymizeUsers")} />
          {anonymizeUsers && (
            <div className="space-y-2 ml-6">
              <Label>{t("database.devPassword")}</Label>
              <Input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
            </div>
          )}
          <OptionRow checked={purgeTransactions} onChange={setPurgeTransactions} label={t("database.purgeTransactions")} hint={t("database.restoreHelp.purgeTransactions")} />
          <div className="space-y-1">
            <Label>{t("database.modulesToUninstall")}</Label>
            <Input value={uninstallModules} onChange={(e) => setUninstallModules(e.target.value)} placeholder="eq_sale,eq_stock" />
            <p className="text-xs text-muted-foreground">{t("database.restoreHelp.uninstallModules")}</p>
          </div>
          {/* The CLI runs recompute only together with anonymize and defaults it
              to anonymize's own value — so the box is meaningless on its own. */}
          <OptionRow
            checked={anonymize && recompute}
            onChange={setRecompute}
            disabled={!anonymize}
            label={t("database.recompute")}
            hint={anonymize ? t("database.restoreHelp.recompute") : t("database.restoreHelp.recomputeNeedsAnonymize")}
          />
          <OptionRow
            checked={checkSpace}
            onChange={setCheckSpace}
            label={t("database.checkSpace")}
            hint={t("database.restoreHelp.checkSpace")}
          />

          {dryRunResult && (
            <div className="space-y-1">
              <div className={cn("flex items-center gap-2 text-xs font-medium", dryRunOk ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                {dryRunOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
                <span>{t(dryRunOk ? "database.dryRunPassed" : "database.dryRunFailed")}</span>
              </div>
              <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted p-2 text-xs whitespace-pre-wrap">{dryRunResult}</pre>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>{t("common.back")}</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDryRun} disabled={running}>
                {running ? t("common.busy") : t("database.dryRun")}
              </Button>
              <Button onClick={handleRestore}>{t("database.restore")}</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
