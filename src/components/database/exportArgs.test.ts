import { describe, expect, it } from "vitest";
import { buildExportArgs, type ExportForm } from "./exportArgs";

const base: ExportForm = {
  version: "18",
  dbName: "v18_exam",
  scope: "all",
  updateList: false,
  cleanup: false,
  viaShell: true,
};

describe("buildExportArgs", () => {
  it("maps the form to camelCase invoke arguments", () => {
    expect(
      buildExportArgs({ ...base, scope: "installed", updateList: true, cleanup: true }, true, true),
    ).toEqual({
      version: "18",
      database: "v18_exam",
      scope: "installed",
      updateList: true,
      cleanup: true,
      viaShell: true,
      viaRpc: false,
    });
  });

  it("0.77.0+: ticked sends --via-shell, unticked sends --via-rpc", () => {
    const on = buildExportArgs(base, true, true);
    expect([on.viaShell, on.viaRpc]).toEqual([true, false]);
    const off = buildExportArgs({ ...base, viaShell: false }, true, true);
    expect([off.viaShell, off.viaRpc]).toEqual([false, true]);
  });

  it("0.76.x: ticked sends --via-shell, unticked sends no flag", () => {
    const on = buildExportArgs(base, true, false);
    expect([on.viaShell, on.viaRpc]).toEqual([true, false]);
    const off = buildExportArgs({ ...base, viaShell: false }, true, false);
    expect([off.viaShell, off.viaRpc]).toEqual([false, false]);
  });

  it("< 0.76.0: the control is hidden and no flag is ever sent", () => {
    for (const viaShell of [true, false]) {
      const a = buildExportArgs({ ...base, viaShell }, false, false);
      expect([a.viaShell, a.viaRpc]).toEqual([false, false]);
    }
    // Even a (wrongly) set rpc offer must not leak a flag without the control.
    expect(buildExportArgs({ ...base, viaShell: false }, false, true).viaRpc).toBe(false);
  });

  it("unknown version: ticked sends --via-shell, unticked sends no flag (--via-rpc would break old CLIs)", () => {
    // Dialog passes offersViaShell=true and offersViaRpc=false when the version is null.
    const on = buildExportArgs(base, true, false);
    expect([on.viaShell, on.viaRpc]).toEqual([true, false]);
    const off = buildExportArgs({ ...base, viaShell: false }, true, false);
    expect([off.viaShell, off.viaRpc]).toEqual([false, false]);
  });

  it("never sends both flags", () => {
    for (const shell of [true, false])
      for (const a of [true, false])
        for (const b of [true, false]) {
          const r = buildExportArgs({ ...base, viaShell: shell }, a, b);
          expect(r.viaShell && r.viaRpc).toBe(false);
        }
  });

  it("passes every scope through unchanged", () => {
    for (const scope of ["all", "no-enterprise", "installed"] as const) {
      expect(buildExportArgs({ ...base, scope }, true, true).scope).toBe(scope);
    }
  });
});
