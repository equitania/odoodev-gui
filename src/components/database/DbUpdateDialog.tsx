import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { invokeCmd } from "../../lib/tauri";
import { startDbUpdate, type ServerChoice } from "../../lib/dbUpdateRunner";
import { useAppStore } from "../../store/appStore";
import { toastError } from "../../store/toastStore";
import type { DbUpdateArgs, DbUpdateMode, DbUpdatePlan } from "../../types";

/** Mount only while open: the target list is taken once, and the plan is a
 *  `db update --dry-run` of exactly that selection. */
export function DbUpdateDialog({
  open,
  onClose,
  version,
  mode,
  names,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  mode: DbUpdateMode;
  names: string[];
}) {
  const { t } = useTranslation();
  const [targetNames] = useState(() => names);
  const serverConfig = useAppStore((s) =>
    s.servers[version]?.status?.running ? (s.servers[version]?.config ?? null) : null,
  );
  const [plan, setPlan] = useState<DbUpdatePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [modules, setModules] = useState("all");
  const [stopOnError, setStopOnError] = useState(false);
  const [timeoutMinutes, setTimeoutMinutes] = useState("60");
  const [serverChoice, setServerChoice] = useState<ServerChoice>("restart");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const planArgs: DbUpdateArgs = {
      version,
      mode,
      names: targetNames,
      modules: "all",
      stopOnError: false,
      timeoutSeconds: null,
    };
    invokeCmd<DbUpdatePlan>("plan_db_update", { args: planArgs })
      .then((p) => {
        if (!cancelled) setPlan(p);
      })
      .catch((e) => {
        if (!cancelled) setPlanError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [version, mode, targetNames, open]);

  const targets = plan?.targets ?? [];

  const handleStart = async () => {
    const minutes = parseInt(timeoutMinutes, 10);
    const args: DbUpdateArgs = {
      version,
      mode,
      names: targetNames,
      modules: modules.trim() || "all",
      stopOnError,
      timeoutSeconds: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null,
    };
    setStarting(true);
    try {
      await startDbUpdate(args, plan?.server_running && serverConfig ? serverChoice : null);
      onClose();
    } catch (e) {
      toastError(t("database.updateFailed"), String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{t("database.updateDialogTitle", { version })}</DialogTitle>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        {!plan && !planError && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("database.updatePlanLoading")}
          </div>
        )}
        {planError && <p className="text-destructive">{planError}</p>}
        {plan && (
          <div className="space-y-2">
            {targets.length === 0 ? (
              <p className="text-muted-foreground">{t("database.updateNothingToDo")}</p>
            ) : (
              <>
                <p className="font-medium">{t("database.updatePlanTargets")}</p>
                <ul className="max-h-40 overflow-auto rounded-md border border-border p-2 font-mono text-xs">
                  {targets.map((target) => (
                    <li key={target.database}>
                      {target.database}
                      {target.reason && <span className="ml-2 text-muted-foreground">({target.reason})</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {plan.skipped_current.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("database.updatePlanSkipped", { names: plan.skipped_current.join(", ") })}
              </p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <label className="font-medium" htmlFor="db-update-modules">
            {t("database.updateModules")}
          </label>
          <Input
            id="db-update-modules"
            value={modules}
            onChange={(e) => setModules(e.target.value)}
            className="h-8 font-mono"
          />
          <p className="text-xs text-muted-foreground">{t("database.updateModulesHint")}</p>
        </div>

        <Checkbox checked={stopOnError} onChange={setStopOnError} label={t("database.updateStopOnError")} />

        <div className="flex items-center gap-2">
          <label htmlFor="db-update-timeout">{t("database.updateTimeout")}</label>
          <Input
            id="db-update-timeout"
            type="number"
            min={1}
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(e.target.value)}
            className="h-8 w-20"
          />
        </div>

        {plan?.server_running && (
          <div className="space-y-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3">
            <p className="font-medium">{t("database.updateServerRunning", { version })}</p>
            {serverConfig ? (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="db-update-server"
                    checked={serverChoice === "restart"}
                    onChange={() => setServerChoice("restart")}
                  />
                  {t("database.updateServerRestart")}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="db-update-server"
                    checked={serverChoice === "ignore"}
                    onChange={() => setServerChoice("ignore")}
                  />
                  {t("database.updateServerIgnore")}
                </label>
              </>
            ) : (
              <p className="text-xs">{t("database.updateServerExternal")}</p>
            )}
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button onClick={handleStart} disabled={!plan || targets.length === 0 || starting}>
          {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {t("database.updateStart")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
