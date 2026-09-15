import { describe, expect, it } from "vitest";
import { dropMany } from "./bulkDrop";
import type { OpResult } from "../../types";

describe("dropMany", () => {
  it("reports refused and thrown drops instead of calling everything a success", async () => {
    const drop = async (name: string): Promise<OpResult> => {
      if (name === "busy") return { success: false, error: "database is being accessed by other users" };
      if (name === "boom") throw new Error("odoodev not found");
      return { success: true, error: null };
    };
    const outcome = await dropMany(["a", "busy", "boom", "b"], drop);
    expect(outcome.dropped).toEqual(["a", "b"]);
    expect(outcome.failed).toEqual([
      { name: "busy", error: "database is being accessed by other users" },
      { name: "boom", error: "Error: odoodev not found" },
    ]);
  });

  it("continues after a failure and keeps the order", async () => {
    const seen: string[] = [];
    await dropMany(["x", "y"], async (name) => {
      seen.push(name);
      return { success: name === "y", error: null };
    });
    expect(seen).toEqual(["x", "y"]);
  });

  it("uses a placeholder when the backend gives no reason", async () => {
    const outcome = await dropMany(["x"], async () => ({ success: false, error: null }));
    expect(outcome.failed).toEqual([{ name: "x", error: "unknown error" }]);
  });
});
