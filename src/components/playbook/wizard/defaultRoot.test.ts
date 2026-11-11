import { describe, expect, it } from "vitest";
import { pickDefaultRoot, pickEnvDir, versionRootsOf } from "./defaultRoot";

const roots = ["/work/v18/scripts/playbooks", "/work/v19/scripts/playbooks", "/proj/playbooks"];
const byVersion = { "18": roots[0], "19": roots[1] };

describe("pickDefaultRoot", () => {
  it("prefers the directory of the version the wizard works on", () => {
    expect(pickDefaultRoot(roots, byVersion, "19")).toBe(roots[1]);
  });

  it("falls back to the first directory for an unknown or empty version", () => {
    expect(pickDefaultRoot(roots, byVersion, "")).toBe(roots[0]);
    expect(pickDefaultRoot(roots, byVersion, "20")).toBe(roots[0]);
  });

  it("ignores a version directory the backend no longer offers", () => {
    expect(pickDefaultRoot([roots[2]], byVersion, "19")).toBe(roots[2]);
  });

  it("returns null without any directory", () => {
    expect(pickDefaultRoot([], {}, "18")).toBeNull();
  });
});

describe("versionRootsOf", () => {
  it("maps each version to its own scripts/playbooks directory", () => {
    const groups = [
      { version: "18", native_dir: "/work/v18" },
      { version: "19", native_dir: "/work/v19" },
      { version: "17", native_dir: "/work/v17" },
    ];
    expect(versionRootsOf(groups, roots)).toEqual(byVersion);
  });
});

describe("pickEnvDir", () => {
  it("puts a server playbook's secrets into the config directory", () => {
    expect(pickEnvDir("server", "/work/v18/scripts/playbooks", "/home/u/.config/odoodev")).toBe(
      "/home/u/.config/odoodev",
    );
  });

  it("keeps a dev playbook's secrets in the playbook directory", () => {
    expect(pickEnvDir("dev", "/work/v18/scripts/playbooks", "/home/u/.config/odoodev")).toBe(
      "/work/v18/scripts/playbooks",
    );
  });

  it("falls back sensibly while one of the directories is unknown", () => {
    expect(pickEnvDir("server", "/pb", null)).toBe("/pb");
    expect(pickEnvDir("dev", null, "/cfg")).toBe("/cfg");
    expect(pickEnvDir("dev", null, null)).toBeNull();
  });
});
