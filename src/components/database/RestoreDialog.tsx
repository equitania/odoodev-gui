import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Checkbox } from "../ui/checkbox";
import type { RestoreArgs } from "../../types";
import { invokeCmd } from "../../lib/tauri";
import { TriangleAlert } from "lucide-react";

export function RestoreDialog({
  open,
  onClose,
  version,
  onProgress,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  onProgress: (title: string, eventName: string) => void;
}) {
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
      const result = await invokeCmd<{ success: boolean; error: string | null }>("restore_db", { args: buildArgs(true) });
      setDryRunResult(result.success ? "Dry run passed — ready to restore" : result.error ?? "Dry run failed");
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
      await invokeCmd("restore_db", { args: buildArgs(false) });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Dialog open={open} onClose={() => { onClose(); reset(); }} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Restore Database — Step {step}/3</DialogTitle>
        <DialogDescription>Restore a backup into a new or existing database (v{version})</DialogDescription>
      </DialogHeader>

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Backup file</Label>
            <Input
              value={backupFile}
              onChange={(e) => setBackupFile(e.target.value)}
              placeholder="/path/to/backup.zip"
            />
            <p className="text-xs text-muted-foreground">Supported: .zip .7z .tar .tar.zst .gz .sql</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { onClose(); reset(); }}>Cancel</Button>
            <Button onClick={() => setStep(2)} disabled={!backupFile}>Next</Button>
          </DialogFooter>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New database name</Label>
            <Input
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              placeholder="v18_restored"
            />
          </div>
          <Checkbox checked={dropExisting} onChange={setDropExisting} label="Drop existing database first" />
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
            <Button onClick={() => setStep(3)} disabled={!dbName}>Next</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-md border border-border p-3 space-y-2">
            <Checkbox checked={sanitize} onChange={(v) => {
              setSanitize(v);
              if (v) { setDeactivateCron(true); setNeutralize(true); setAnonymize(true); setWipe(true); setPurgeMasterData(true); }
              else { setDeactivateCron(false); setNeutralize(false); setAnonymize(false); setWipe(false); setPurgeMasterData(false); }
            }} label="—sanitize (enable all below)" />
            <div className="ml-6 space-y-1.5">
              <Checkbox checked={deactivateCron} onChange={setDeactivateCron} label="Deactivate cron (--deactivate-cron)" />
              <Checkbox checked={neutralize} onChange={setNeutralize} label="Neutralize (--neutralize)" />
              <Checkbox checked={anonymize} onChange={setAnonymize} label="Anonymize (--anonymize)" />
              <Checkbox checked={wipe} onChange={setWipe} label="Wipe content (--wipe)" />
              <Checkbox checked={purgeMasterData} onChange={setPurgeMasterData} label="Purge master data (--purge-master-data)" />
              {sanitize && purgeMasterData && (
                <div className="flex items-start gap-2 rounded-md bg-yellow-500/10 p-2 text-xs text-yellow-600 dark:text-yellow-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>WARNING: This DELETEs customers/vendors, CRM/HR data, messages, attachments. Keeps products, pricelists, users, companies, config.</span>
                </div>
              )}
            </div>
          </div>
          <Checkbox checked={anonymizeUsers} onChange={setAnonymizeUsers} label="Anonymize users (--anonymize-users)" />
          {anonymizeUsers && (
            <div className="space-y-2">
              <Label>Dev password</Label>
              <Input value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
            </div>
          )}
          <Checkbox checked={purgeTransactions} onChange={setPurgeTransactions} label="Purge transactions (--purge-transactions)" />
          <div className="space-y-2">
            <Label>Modules to uninstall (comma-separated)</Label>
            <Input value={uninstallModules} onChange={(e) => setUninstallModules(e.target.value)} placeholder="eq_sale,eq_stock" />
          </div>
          <Checkbox checked={recompute} onChange={setRecompute} label="Recompute stored fields (--recompute)" />

          {dryRunResult && (
            <pre className="rounded-md border border-border bg-muted p-2 text-xs">{dryRunResult}</pre>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleDryRun} disabled={running}>
                {running ? "Running..." : "Dry Run"}
              </Button>
              <Button onClick={handleRestore}>Restore</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}