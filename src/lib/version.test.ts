import { describe, expect, it } from "vitest";
import { isAtLeast } from "./version";

describe("isAtLeast", () => {
  it("compares numerically, not as strings", () => {
    expect(isAtLeast("0.69.0", "0.69.0")).toBe(true);
    expect(isAtLeast("0.70.0", "0.69.0")).toBe(true);
    expect(isAtLeast("0.100.0", "0.69.0")).toBe(true);
    expect(isAtLeast("1.0.0", "0.69.0")).toBe(true);
    expect(isAtLeast("0.68.1", "0.69.0")).toBe(false);
  });

  it("ignores anything after the patch number and fills missing parts with zero", () => {
    expect(isAtLeast("0.69.0.dev1", "0.69.0")).toBe(true);
    expect(isAtLeast("0.69", "0.69.0")).toBe(true);
  });

  it("never satisfies a requirement with an unknown version", () => {
    expect(isAtLeast(null, "0.1.0")).toBe(false);
    expect(isAtLeast(undefined, "0.1.0")).toBe(false);
    expect(isAtLeast("", "0.1.0")).toBe(false);
  });
});
