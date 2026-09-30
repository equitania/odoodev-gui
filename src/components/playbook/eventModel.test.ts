import { describe, expect, it } from "vitest";
import type { PlaybookEvent } from "../../types";
import { activeStepIndex, formatDuration, preflightLineLevel } from "./eventModel";

const ev = (event: string, extra: Partial<PlaybookEvent> = {}): PlaybookEvent => ({ event, ...extra });

describe("formatDuration", () => {
  it("keeps milliseconds below a second", () => expect(formatDuration(850)).toBe("850ms"));
  it("shows tenths of seconds below a minute", () => expect(formatDuration(3240)).toBe("3.2s"));
  it("matches the CLI for minutes", () => expect(formatDuration(439393)).toBe("7m 19s"));
  it("pads seconds and handles hours", () => {
    expect(formatDuration(65000)).toBe("1m 05s");
    expect(formatDuration(3_725_000)).toBe("1h 02m 05s");
  });
});

describe("activeStepIndex", () => {
  it("is -1 for an empty log", () => expect(activeStepIndex([])).toBe(-1));
  it("finds a step that was announced but not finished", () => {
    const events = [ev("playbook_start"), ev("step_start"), ev("step_done"), ev("step_start"), ev("step_progress")];
    expect(activeStepIndex(events)).toBe(3);
  });
  it("is -1 once the step reported its result", () => {
    expect(activeStepIndex([ev("step_start"), ev("step_progress"), ev("step_done")])).toBe(-1);
  });
  it("is -1 after an error or the end of the run", () => {
    expect(activeStepIndex([ev("step_start"), ev("error")])).toBe(-1);
    expect(activeStepIndex([ev("step_start"), ev("playbook_done")])).toBe(-1);
  });
});

describe("preflightLineLevel", () => {
  it("separates errors from warnings", () => {
    expect(preflightLineLevel("[error] container missing")).toBe("error");
    expect(preflightLineLevel("[warning] no safety backup")).toBe("warning");
  });
});
