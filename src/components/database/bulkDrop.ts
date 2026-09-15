import type { OpResult } from "../../types";

export interface BulkDropOutcome {
  dropped: string[];
  failed: { name: string; error: string }[];
}

/** Drop databases one after another. A failure never stops the rest and is
 *  always reported — the previous loop only logged it to the console. */
export async function dropMany(
  names: string[],
  drop: (name: string) => Promise<OpResult>,
): Promise<BulkDropOutcome> {
  const outcome: BulkDropOutcome = { dropped: [], failed: [] };
  for (const name of names) {
    try {
      const result = await drop(name);
      if (result.success) outcome.dropped.push(name);
      else outcome.failed.push({ name, error: result.error ?? "unknown error" });
    } catch (e) {
      outcome.failed.push({ name, error: String(e) });
    }
  }
  return outcome;
}
