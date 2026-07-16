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
import { FolderOpen, TriangleAlert } from "lucide-react";

/** Checkbox with a short explanation of what the CLI flag actually does. */
function OptionRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="space-y-0.5">
      <Checkbox checked={checked} onChange={onChange} label={label} />
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
  const [sanitize, setSanitize] = useState(false);
  const [deactivateCron, setDeactivateCron] = useState(false);
  const [neutralize, setNeutralize] = useState(false);
  const [anonymize, setAnonymize] = useState(false);
  const [wipe, setWipe] = useState(false);
  const [purgeMasterData, setPurgeMasterData] = useState(false);
  const [purgeTransactions, setPurgeTransactions] = useState(false);
  const [anonymizeUsers, setAnonymizeUsers] = useState(false);
  const [userPassword, setUserPassword] = useState("ownerp");
  const [uninstallModules, setUninstallModules] = useState("");
  const [recompute, setRecompute] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const reset = () => {
    setStep(1);
    setBackupFile("");
    setDbName("");
    setDropExisting(false);
    setSanitize(false);
    setDeactivateCron(false);
    setNeutralize(false);
    setAnonymize(false);
    setWipe(false);
    setPurgeMasterData(false);
    setPurgeTransactions(false);
    setAnonymizeUsers(false);
    setUninstallModules("");
    setRecompute(false);
    setDryRunResult(null);
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

  const buildArgs = (dry: boolean): RestoreArgs => ({
    version,
    name: dbName,
    backup_file: backupFile,
    // Always send an explicit boolean: the CLI defaults to --drop (overwrite),
    // so omitting the field would silently drop the target database.
    drop: dropExisting,
    deactivate_cron: (sanitize && deactivateCron) || undefined,
    neutralize: (sanitize && neutralize) || undefined,
    anonymize: (sanitize && anonymize) || undefined,
    wipe: (sanitize && wipe) || undefined,
    purge_master_data: (sanitize && purgeMasterData) || undefined,
    no_purge_master_data: (sanitize && !purgeMasterData) || undefined,
    purge_transactions: purgeTransactions || undefined,
    anonymize_users: anonymizeUsers || undefined,
    user_password: anonymizeUsers ? userPassword : undefined,
    uninstall_modules: uninstallModules || undefined,
    recompute: recompute || undefined,
    dry_run: dry || undefined,
  });

  const handleDryRun = async () => {
    setRunning(true);
    try {
      const result = await invokeCmd<RestoreResult>("restore_db", { args: buildArgs(true) });
      setDryRunResult(result.success ? t("database.dryRunPassed") : result.error ?? t("database.dryRunFailed"));
    } catch (e) {
      setDryRunResult(String(e));
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
              onChange={(v) => {
                setSanitize(v);
                if (v) { setDeactivateCron(true); setNeutralize(true); setAnonymize(true); setWipe(true); setPurgeMasterData(true); }
                else { setDeactivateCron(false); setNeutralize(false); setAnonymize(false); setWipe(false); setPurgeMasterData(false); }
              }}
              label={t("database.sanitize")}
              hint={t("database.restoreHelp.sanitize")}
            />
            <div className="ml-6 space-y-2">
              <OptionRow checked={deactivateCron} onChange={setDeactivateCron} label={t("database.deactivateCron")} hint={t("database.restoreHelp.deactivateCron")} />
              <OptionRow checked={neutralize} onChange={setNeutralize} label={t("database.neutralize")} hint={t("database.restoreHelp.neutralize")} />
              <OptionRow checked={anonymize} onChange={setAnonymize} label={t("database.anonymize")} hint={t("database.restoreHelp.anonymize")} />
              <OptionRow checked={wipe} onChange={setWipe} label={t("database.wipe")} hint={t("database.restoreHelp.wipe")} />
              <OptionRow checked={purgeMasterData} onChange={setPurgeMasterData} label={t("database.purgeMasterData")} hint={t("database.restoreHelp.purgeMasterData")} />
              {sanitize && purgeMasterData && (
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
          <OptionRow checked={recompute} onChange={setRecompute} label={t("database.recompute")} hint={t("database.restoreHelp.recompute")} />

          {dryRunResult && (
            <pre className="rounded-md border border-border bg-muted p-2 text-xs whitespace-pre-wrap">{dryRunResult}</pre>
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
