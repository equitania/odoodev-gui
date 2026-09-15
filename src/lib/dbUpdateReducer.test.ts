import { describe, expect, it } from "vitest";
import type { DbUpdateEvent, DbUpdateResult } from "../types";
import {
  CONSOLE_CAP,
  ISSUE_CAP,
  applyConsoleLine,
  applyEvent,
  applyExit,
  finishedCount,
  isActive,
  markCancelling,
  newRun,
  rowStatusFor,
  type DbUpdateRun,
} from "./dbUpdateReducer";

const plan: DbUpdateEvent = {
  event: "plan",
  version: "19",
  modules: "all",
  targets: [
    { database: "v19_a", reason: "never updated" },
    { database: "v19_b", reason: null },
  ],
  skipped_current: ["v19_c"],
  server_running: false,
};

const resultFields = (database: string, over: Partial<DbUpdateResult> = {}): DbUpdateResult => ({
  database,
  ok: true,
  exit_code: 0,
  duration_s: 12.5,
  warnings: 0,
  errors: 0,
  last_error: null,
  timed_out: false,
  log: `/logs/update_v19_${database}.log`,
  ...over,
});
const result = (database: string, over: Partial<DbUpdateResult> = {}): DbUpdateEvent => ({
  event: "result",
  ...resultFields(database, over),
});
const start = (database: string, index: number): DbUpdateEvent => ({
  event: "start",
  database,
  index,
  total: 2,
  log: `/logs/update_v19_${database}.log`,
});
const replay = (...events: DbUpdateEvent[]): DbUpdateRun =>
  events.reduce((run, e) => applyEvent(run, e, 1000), newRun("all", 0));

describe("applyEvent", () => {
  it("creates pending rows in plan order", () => {
    const run = replay(plan);
    expect(run.order).toEqual(["v19_a", "v19_b"]);
    expect(run.rows.v19_a).toMatchObject({ status: "pending", reason: "never updated" });
    expect(run.skippedCurrent).toEqual(["v19_c"]);
  });

  it("follows a complete run", () => {
    const run = replay(
      plan,
      start("v19_a", 1),
      { event: "issue", database: "v19_a", level: "WARNING", text: "odoo.x: dubious" },
      result("v19_a", { warnings: 1 }),
      start("v19_b", 2),
      result("v19_b", { errors: 2, last_error: "odoo.y: boom" }),
      { event: "summary", results: [], skipped_current: ["v19_c"], exit_code: 0 },
    );
    expect(run.phase).toBe("finished");
    expect(run.rows.v19_a).toMatchObject({ status: "ok", warnings: 1, startedAt: 1000, durationS: 12.5 });
    expect(run.rows.v19_a.issues).toEqual([{ level: "WARNING", text: "odoo.x: dubious" }]);
    expect(run.rows.v19_b).toMatchObject({ status: "okWithErrors", lastError: "odoo.y: boom" });
    expect(finishedCount(run)).toBe(2);
    expect(isActive(run)).toBe(false);
  });

  it("caps issues per database and counts the rest", () => {
    let run = replay(plan, start("v19_a", 1));
    for (let i = 0; i <= ISSUE_CAP; i++) {
      run = applyEvent(run, { event: "issue", database: "v19_a", level: "RAW", text: `line ${i}` }, 1000);
    }
    expect(run.rows.v19_a.issues).toHaveLength(ISSUE_CAP);
    expect(run.rows.v19_a.issuesTruncated).toBe(1);
  });

  it("marks the interrupted database and keeps finished ones", () => {
    const run = replay(plan, start("v19_a", 1), result("v19_a"), start("v19_b", 2), {
      event: "interrupted",
      database: "v19_b",
    });
    expect(run.phase).toBe("interrupted");
    expect(run.rows.v19_a.status).toBe("ok");
    expect(run.rows.v19_b.status).toBe("interrupted");
    expect(applyExit(run, 130).phase).toBe("interrupted");
  });

  it("keeps the CLI's error message", () => {
    const run = applyExit(replay({ event: "error", message: "Development environment not ready" }), 1);
    expect(run.phase).toBe("error");
    expect(run.errorMessage).toBe("Development environment not ready");
  });

  it("creates a row for a start without a plan (re-attached after a reload)", () => {
    const run = replay(start("v19_x", 1));
    expect(run.order).toEqual(["v19_x"]);
    expect(run.rows.v19_x.status).toBe("running");
  });
});

describe("rowStatusFor", () => {
  it("distinguishes failure and timeout", () => {
    expect(rowStatusFor(resultFields("a", { ok: false, exit_code: 255 }))).toBe("failed");
    expect(rowStatusFor(resultFields("a", { ok: false, exit_code: 124, timed_out: true }))).toBe("timedOut");
  });
});

describe("applyExit", () => {
  it("turns an exit without summary into an error and stops running rows", () => {
    const run = applyExit(replay(plan, start("v19_a", 1)), 1);
    expect(run.phase).toBe("error");
    expect(run.rows.v19_a.status).toBe("interrupted");
    expect(run.errorMessage).toBe("odoodev exited with code 1");
  });

  it("treats any exit after a cancel request as interrupted (forced kill has no code)", () => {
    const run = applyExit(markCancelling(replay(plan, start("v19_a", 1)), 5000), null);
    expect(run.phase).toBe("interrupted");
    expect(run.rows.v19_a.status).toBe("interrupted");
  });

  it("does not override a finished run", () => {
    const finished = replay(plan, { event: "summary", results: [], skipped_current: [], exit_code: 1 });
    expect(applyExit(finished, 1).phase).toBe("finished");
  });
});

describe("applyConsoleLine", () => {
  it("keeps the newest lines up to the cap", () => {
    let run = newRun("all", 0);
    for (let i = 0; i <= CONSOLE_CAP; i++) run = applyConsoleLine(run, `line ${i}`);
    expect(run.console).toHaveLength(CONSOLE_CAP);
    expect(run.console[0]).toBe("line 1");
  });
});
