import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Ban, ChevronDown, ChevronRight, CircleCheckBig, CircleX, Clock, Loader2, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cancelDbUpdate } from "../../lib/dbUpdateRunner";
import { finishedCount, isActive, type DbUpdateRow, type DbUpdateRowStatus } from "../../lib/dbUpdateReducer";
import { useDbUpdateStore } from "../../store/dbUpdateStore";
import { useAppStore } from "../../store/appStore";
import { toastError } from "../../store/toastStore";
import { cn } from "../../lib/utils";

/** "Force stop" is offered only when odoodev ignored the SIGTERM this long. */
const FORCE_STOP_AFTER_MS = 20_000;

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;
}

function StatusIcon({ status }: { status: DbUpdateRowStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "ok":
      return <CircleCheckBig className="h-4 w-4 text-green-500" />;
    case "okWithErrors":
      return <TriangleAlert className="h-4 w-4 text-yellow-500" />;
    case "failed":
      return <CircleX className="h-4 w-4 text-red-500" />;
    case "timedOut":
      return <Clock className="h-4 w-4 text-red-500" />;
    case "interrupted":
      return <Ban className="h-4 w-4 text-muted-foreground" />;
    default:
      return <span className="inline-block h-4 w-4 text-center text-muted-foreground">·</span>;
  }
}

export function DbUpdatePanel({ version, onOpenLog }: { version: string; onOpenLog: (path: string) => void }) {
  const { t } = useTranslation();
  const run = useDbUpdateStore((s) => s.runs[version]);
  const dismiss = useDbUpdateStore((s) => s.dismiss);
  const isWindows = useAppStore((s) => s.platform?.os === "windows");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showConsole, setShowConsole] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const active = isActive(run);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!run) return null;

  const statusLabel: Record<DbUpdateRowStatus, string> = {
    pending: t("database.updateStatusPending"),
    running: t("database.updateStatusRunning"),
    ok: t("database.updateStatusOk"),
    okWithErrors: t("database.updateStatusOkWithErrors"),
    failed: t("database.updateStatusFailed"),
    timedOut: t("database.updateStatusTimedOut"),
    interrupted: t("database.updateStatusInterrupted"),
  };
  const done = finishedCount(run);
  const total = run.order.length;
  const canForceStop =
    run.phase === "cancelling" && run.cancelRequestedAt !== null && now - run.cancelRequestedAt >= FORCE_STOP_AFTER_MS;
  const runningDb = run.order.find((db) => run.rows[db].status === "running") ?? null;

  const toggle = (db: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(db)) next.delete(db);
      else next.add(db);
      return next;
    });

  const cancel = async (force: boolean) => {
    setConfirmCancel(false);
    try {
      await cancelDbUpdate(version, force);
    } catch (e) {
      toastError(t("database.updateCancelFailed"), String(e));
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium">
            {active ? (
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            ) : run.phase === "finished" ? (
              <CircleCheckBig className="h-4 w-4 text-green-500" />
            ) : (
              <CircleX className="h-4 w-4 text-red-500" />
            )}
            {t("database.updatePanelTitle", { version, modules: run.modules })}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {t("database.updateProgress", { done, total })} ·{" "}
              {formatDuration(((run.finishedAt ?? now) - run.startedAt) / 1000)}
            </span>
            {active ? (
              canForceStop ? (
                <Button size="sm" variant="destructive" onClick={() => cancel(true)}>
                  {t("database.updateForceStop")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={run.phase === "cancelling"}
                  onClick={() => setConfirmCancel(true)}
                >
                  {run.phase === "cancelling" ? t("database.updateCancelling") : t("common.cancel")}
                </Button>
              )
            ) : (
              <Button size="sm" variant="outline" onClick={() => dismiss(version)}>
                {t("common.close")}
              </Button>
            )}
          </div>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
          />
        </div>

        {run.detailsLost && <p className="text-xs text-muted-foreground">{t("database.updateDetailsLost")}</p>}
        {run.errorMessage && <p className="text-sm text-destructive">{run.errorMessage}</p>}
        {canForceStop && <p className="text-xs text-destructive">{t("database.updateForceStopHint")}</p>}
        {isWindows && active && <p className="text-xs text-muted-foreground">{t("database.updateWindowsCancelHint")}</p>}

        <ul className="space-y-1 text-sm">
          {run.order.map((db) => (
            <UpdateRow
              key={db}
              row={run.rows[db]}
              label={statusLabel[run.rows[db].status]}
              now={now}
              expanded={expanded.has(db)}
              onToggle={() => toggle(db)}
              onOpenLog={onOpenLog}
            />
          ))}
        </ul>

        {run.skippedCurrent.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("database.updatePlanSkipped", { names: run.skippedCurrent.join(", ") })}
          </p>
        )}

        {run.console.length > 0 && (
          <div>
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowConsole((open) => !open)}
            >
              {showConsole ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t("database.updateConsole")}
            </button>
            {showConsole && (
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/50 p-2 font-mono text-xs">
                {run.console.join("\n")}
              </pre>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t("database.updateCancelTitle")}
        description={
          runningDb
            ? t("database.updateCancelDescription", { database: runningDb })
            : t("database.updateCancelDescriptionIdle")
        }
        confirmLabel={t("database.updateCancelConfirm")}
        danger
        onConfirm={() => cancel(false)}
      />
    </Card>
  );
}

function UpdateRow({
  row,
  label,
  now,
  expanded,
  onToggle,
  onOpenLog,
}: {
  row: DbUpdateRow;
  label: string;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenLog: (path: string) => void;
}) {
  const { t } = useTranslation();
  const seconds =
    row.durationS ?? (row.status === "running" && row.startedAt !== null ? (now - row.startedAt) / 1000 : null);
  const hasDetails = row.issues.length > 0 || row.lastError !== null;
  const log = row.log;

  return (
    <li className="rounded-md border border-border/60">
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          className={cn("flex h-4 w-4 items-center justify-center", !hasDetails && "invisible")}
          onClick={onToggle}
          aria-label={label}
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
        <StatusIcon status={row.status} />
        <span className="font-mono">{row.database}</span>
        <span className="text-xs text-muted-foreground">{label}</span>
        {seconds !== null && <span className="text-xs text-muted-foreground">{formatDuration(seconds)}</span>}
        {row.warnings > 0 && (
          <span className="text-xs text-yellow-600 dark:text-yellow-400">
            {t("database.updateWarnings", { count: row.warnings })}
          </span>
        )}
        {row.errors > 0 && (
          <span className="text-xs text-destructive">{t("database.updateErrors", { count: row.errors })}</span>
        )}
        {log && (
          <button className="ml-auto text-xs text-primary hover:underline" onClick={() => onOpenLog(log)}>
            {t("database.updateOpenLog")}
          </button>
        )}
      </div>
      {expanded && hasDetails && (
        <div className="border-t border-border/60 px-2 py-1 font-mono text-xs">
          {row.lastError && <p className="text-destructive">{row.lastError}</p>}
          {row.issues.map((issue, i) => (
            <p
              key={i}
              className={cn(
                issue.level === "RAW" && "pl-6 text-muted-foreground",
                issue.level === "WARNING" && "text-yellow-600 dark:text-yellow-400",
                (issue.level === "ERROR" || issue.level === "CRITICAL") && "text-destructive",
              )}
            >
              {issue.level !== "RAW" && `${issue.level} `}
              {issue.text}
            </p>
          ))}
          {row.issuesTruncated > 0 && (
            <p className="text-muted-foreground">
              {t("database.updateIssuesTruncated", { count: row.issuesTruncated })}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
