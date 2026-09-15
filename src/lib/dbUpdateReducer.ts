import type { DbUpdateEvent, DbUpdateResult, StartServerArgs } from "../types";

export const ISSUE_CAP = 500;
export const CONSOLE_CAP = 2000;

export type DbUpdateRowStatus =
  | "pending"
  | "running"
  | "ok"
  | "okWithErrors"
  | "failed"
  | "timedOut"
  | "interrupted";

export type DbUpdatePhase = "running" | "cancelling" | "finished" | "interrupted" | "error";

export interface DbUpdateIssue {
  level: string;
  text: string;
}

export interface DbUpdateRow {
  database: string;
  status: DbUpdateRowStatus;
  reason: string | null;
  startedAt: number | null;
  durationS: number | null;
  warnings: number;
  errors: number;
  lastError: string | null;
  log: string | null;
  issues: DbUpdateIssue[];
  issuesTruncated: number;
}

export interface DbUpdateRun {
  phase: DbUpdatePhase;
  modules: string;
  startedAt: number;
  order: string[];
  rows: Record<string, DbUpdateRow>;
  skippedCurrent: string[];
  console: string[];
  exitCode: number | null;
  errorMessage: string | null;
  cancelRequestedAt: number | null;
  /** Server config to start again when the run ends ("stop, update, restart"). */
  restartServer: StartServerArgs | null;
  /** Re-attached after a webview reload — earlier events were not seen. */
  detailsLost: boolean;
}

export function newRun(modules: string, startedAt: number, restartServer: StartServerArgs | null = null): DbUpdateRun {
  return {
    phase: "running",
    modules,
    startedAt,
    order: [],
    rows: {},
    skippedCurrent: [],
    console: [],
    exitCode: null,
    errorMessage: null,
    cancelRequestedAt: null,
    restartServer,
    detailsLost: false,
  };
}

export function attachedRun(now: number): DbUpdateRun {
  return { ...newRun("?", now), detailsLost: true };
}

function emptyRow(database: string, reason: string | null = null): DbUpdateRow {
  return {
    database,
    status: "pending",
    reason,
    startedAt: null,
    durationS: null,
    warnings: 0,
    errors: 0,
    lastError: null,
    log: null,
    issues: [],
    issuesTruncated: 0,
  };
}

function withRow(run: DbUpdateRun, database: string, update: (row: DbUpdateRow) => DbUpdateRow): DbUpdateRun {
  const existing = run.rows[database];
  return {
    ...run,
    order: existing ? run.order : [...run.order, database],
    rows: { ...run.rows, [database]: update(existing ?? emptyRow(database)) },
  };
}

function interruptRunningRows(run: DbUpdateRun): DbUpdateRun {
  const rows = { ...run.rows };
  for (const db of run.order) {
    if (rows[db].status === "running") rows[db] = { ...rows[db], status: "interrupted" };
  }
  return { ...run, rows };
}

function applyResultToRow(row: DbUpdateRow, result: DbUpdateResult): DbUpdateRow {
  return {
    ...row,
    status: rowStatusFor(result),
    durationS: result.duration_s,
    warnings: result.warnings,
    errors: result.errors,
    lastError: result.last_error,
    log: result.log,
  };
}

export function rowStatusFor(result: DbUpdateResult): DbUpdateRowStatus {
  if (result.timed_out) return "timedOut";
  if (!result.ok) return "failed";
  return result.errors > 0 ? "okWithErrors" : "ok";
}

export function isActive(run: DbUpdateRun | undefined): boolean {
  return run !== undefined && (run.phase === "running" || run.phase === "cancelling");
}

export function finishedCount(run: DbUpdateRun): number {
  return run.order.filter((db) => {
    const status = run.rows[db].status;
    return status !== "pending" && status !== "running";
  }).length;
}

export function applyEvent(run: DbUpdateRun, event: DbUpdateEvent, now: number): DbUpdateRun {
  switch (event.event) {
    case "plan": {
      const rows: Record<string, DbUpdateRow> = {};
      for (const target of event.targets) rows[target.database] = emptyRow(target.database, target.reason);
      return {
        ...run,
        modules: event.modules,
        order: event.targets.map((target) => target.database),
        rows,
        skippedCurrent: event.skipped_current,
      };
    }
    case "start":
      return withRow(run, event.database, (row) => ({ ...row, status: "running", startedAt: now, log: event.log }));
    case "issue":
      return withRow(run, event.database, (row) =>
        row.issues.length >= ISSUE_CAP
          ? { ...row, issuesTruncated: row.issuesTruncated + 1 }
          : { ...row, issues: [...row.issues, { level: event.level, text: event.text }] },
      );
    case "result":
      return withRow(run, event.database, (row) => applyResultToRow(row, event));
    case "summary": {
      let updated = run;
      for (const result of event.results) {
        updated = withRow(updated, result.database, (row) => applyResultToRow(row, result));
      }
      return { ...updated, phase: "finished", exitCode: event.exit_code, skippedCurrent: event.skipped_current };
    }
    case "interrupted": {
      const marked = event.database
        ? withRow(run, event.database, (row) => ({ ...row, status: "interrupted" }))
        : run;
      return { ...interruptRunningRows(marked), phase: "interrupted" };
    }
    case "error":
      return { ...run, phase: "error", errorMessage: event.message };
  }
}

export function applyConsoleLine(run: DbUpdateRun, line: string): DbUpdateRun {
  const lines = run.console.length >= CONSOLE_CAP ? [...run.console.slice(1), line] : [...run.console, line];
  return { ...run, console: lines };
}

export function markCancelling(run: DbUpdateRun, now: number): DbUpdateRun {
  return isActive(run) ? { ...run, phase: "cancelling", cancelRequestedAt: now } : run;
}

export function applyExit(run: DbUpdateRun, exitCode: number | null): DbUpdateRun {
  if (!isActive(run)) return { ...run, exitCode: run.exitCode ?? exitCode };
  if (exitCode === 0) return { ...run, phase: "finished", exitCode };
  if (exitCode === 130 || run.phase === "cancelling") {
    return { ...interruptRunningRows(run), phase: "interrupted", exitCode };
  }
  return {
    ...interruptRunningRows(run),
    phase: "error",
    exitCode,
    errorMessage: run.errorMessage ?? `odoodev exited with code ${exitCode ?? "unknown"}`,
  };
}
