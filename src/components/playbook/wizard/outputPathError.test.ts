import { describe, expect, it } from "vitest";
import de from "../../../locales/de.json";
import en from "../../../locales/en.json";
import { ENV_ERROR_CODES, OUTPUT_ERROR_CODES, parsePathError } from "./outputPathError";

describe("parsePathError", () => {
  it("extracts every output code from the backend message", () => {
    for (const code of OUTPUT_ERROR_CODES) {
      expect(parsePathError(`playbook_output:${code}: some detail`)).toEqual({ field: "output", code });
    }
  });

  it("extracts every env-file code and names the env field", () => {
    for (const code of ENV_ERROR_CODES) {
      expect(parsePathError(`playbook_env_file:${code}: some detail`)).toEqual({ field: "env_file", code });
    }
  });

  it("also works on an Error object (invoke rejections are stringified)", () => {
    expect(parsePathError(new Error("playbook_output:outside_roots: x is outside"))).toEqual({
      field: "output",
      code: "outside_roots",
    });
  });

  it("returns null for unrelated errors and unknown codes", () => {
    expect(parsePathError("[ERROR] File exists")).toBeNull();
    expect(parsePathError("playbook_output:something_new: x")).toBeNull();
    expect(parsePathError("playbook_env_file:nothing_known: x")).toBeNull();
    expect(parsePathError(null)).toBeNull();
  });
});

describe("path error messages", () => {
  it("exist in both languages for every code (the keys are built dynamically)", () => {
    for (const lang of [de, en]) {
      const out = lang.playbookWizard.gui.outputError as Record<string, string>;
      const env = lang.playbookWizard.gui.envFileError as Record<string, string>;
      for (const code of OUTPUT_ERROR_CODES) expect(out[code], `output ${code}`).toBeTruthy();
      for (const code of ENV_ERROR_CODES) expect(env[code], `env ${code}`).toBeTruthy();
    }
  });
});
