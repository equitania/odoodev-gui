import type { PlaybookEvent } from "../../types";

/** Same shape as the CLI's own output: 439393 -> "7m 19s", short steps keep their milliseconds. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  if (minutes < 60) return `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m ${rest}s`;
}

/**
 * Position of the `step_start` whose step has not reported a result yet, or -1.
 *
 * The CLI announces a step (`step_start`), may report on it (`step_progress`)
 * and closes it with `step_done`. Only the announcement without a following
 * result is "running"; older announcements are replaced by their result line.
 */
export function activeStepIndex(events: PlaybookEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i].event;
    if (e === "step_done" || e === "playbook_done" || e === "error") return -1;
    if (e === "step_start") return i;
  }
  return -1;
}

/** One line of a preflight finding is prefixed `[error]` or `[warning]` by the CLI. */
export function preflightLineLevel(line: string): "error" | "warning" {
  return line.startsWith("[error]") ? "error" : "warning";
}
