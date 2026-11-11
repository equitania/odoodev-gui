import { describe, expect, it } from "vitest";
import {
  isAtLeast,
  MIN_ODOODEV_DOCKER_DEFAULT_CREDS,
  MIN_ODOODEV_EXPORT_VIA_RPC,
  MIN_ODOODEV_EXPORT_VIA_SHELL,
  MIN_ODOODEV_PSQL_META,
} from "./version";

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

describe("MIN_ODOODEV_EXPORT_VIA_SHELL", () => {
  it("gates export --via-shell at 0.76.0", () => {
    expect(isAtLeast("0.76.0", MIN_ODOODEV_EXPORT_VIA_SHELL)).toBe(true);
    expect(isAtLeast("0.76.1", MIN_ODOODEV_EXPORT_VIA_SHELL)).toBe(true);
    expect(isAtLeast("0.75.7", MIN_ODOODEV_EXPORT_VIA_SHELL)).toBe(false);
    expect(isAtLeast(null, MIN_ODOODEV_EXPORT_VIA_SHELL)).toBe(false);
  });
});

describe("0.77.0 gates", () => {
  it("gate export --via-rpc, restore --allow-psql-meta and docker up credentials at 0.77.0", () => {
    for (const min of [
      MIN_ODOODEV_EXPORT_VIA_RPC,
      MIN_ODOODEV_PSQL_META,
      MIN_ODOODEV_DOCKER_DEFAULT_CREDS,
    ]) {
      expect(min).toBe("0.77.0");
      expect(isAtLeast("0.77.0", min)).toBe(true);
      expect(isAtLeast("0.76.9", min)).toBe(false);
      expect(isAtLeast(null, min)).toBe(false);
    }
  });
});
