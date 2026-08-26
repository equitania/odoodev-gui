import { describe, expect, it } from "vitest";
import { buildRestoreArgs, type RestoreForm } from "./restoreArgs";

/** All post-processing off — the CLI's own "leave the database untouched" default. */
const base: RestoreForm = {
  version: "18",
  dbName: "v18_restored",
  backupFile: "/backups/v18_exam.zip",
  dropExisting: false,
  deactivateCron: false,
  neutralize: false,
  anonymize: false,
  wipe: false,
  purgeMasterData: false,
  purgeTransactions: false,
  anonymizeUsers: false,
  userPassword: "ownerp",
  uninstallModules: "",
  recompute: true,
  checkSpace: true,
};

const form = (over: Partial<RestoreForm> = {}): RestoreForm => ({ ...base, ...over });

describe("drop", () => {
  it("is always explicit, because the CLI defaults to overwriting the target", () => {
    expect(buildRestoreArgs(form(), false).drop).toBe(false);
    expect(buildRestoreArgs(form({ dropExisting: true }), false).drop).toBe(true);
  });
});

describe("recompute", () => {
  it("is sent as false when anonymize runs but the box is unticked", () => {
    // Omitting it would let the CLI fall back to anonymize's value and
    // recompute anyway — the box would be decorative.
    const args = buildRestoreArgs(form({ anonymize: true, recompute: false }), false);
    expect(args.recompute).toBe(false);
  });

  it("is sent as true when anonymize runs and the box is ticked", () => {
    const args = buildRestoreArgs(form({ anonymize: true, recompute: true }), false);
    expect(args.recompute).toBe(true);
  });

  it("is omitted without anonymize, where the CLI skips the step regardless", () => {
    const args = buildRestoreArgs(form({ anonymize: false, recompute: true }), false);
    expect(args.recompute).toBeUndefined();
  });
});

describe("post-restore options", () => {
  it("sends nothing at all when every box is unticked", () => {
    const args = buildRestoreArgs(form(), false);
    for (const key of [
      "deactivate_cron",
      "neutralize",
      "anonymize",
      "wipe",
      "purge_master_data",
      "purge_transactions",
      "anonymize_users",
      "recompute",
      "uninstall_modules",
      "dry_run",
    ] as const) {
      expect(args[key]).toBeUndefined();
    }
  });

  it("forwards each ticked option independently", () => {
    const args = buildRestoreArgs(
      form({ deactivateCron: true, neutralize: true, anonymize: true, wipe: true, purgeMasterData: true }),
      false,
    );
    expect(args.deactivate_cron).toBe(true);
    expect(args.neutralize).toBe(true);
    expect(args.anonymize).toBe(true);
    expect(args.wipe).toBe(true);
    expect(args.purge_master_data).toBe(true);
  });

  it("never leaks purge-master-data into a plain wipe", () => {
    // The CLI's --sanitize would; that is exactly why the wizard sends the
    // children individually and never --sanitize itself.
    const args = buildRestoreArgs(form({ wipe: true }), false);
    expect(args.purge_master_data).toBeUndefined();
    expect(args.purge_transactions).toBeUndefined();
  });

  it("keeps purge-transactions opt-in even with everything else on", () => {
    const args = buildRestoreArgs(
      form({ deactivateCron: true, neutralize: true, anonymize: true, wipe: true, purgeMasterData: true }),
      false,
    );
    expect(args.purge_transactions).toBeUndefined();
  });
});

describe("anonymize-users", () => {
  it("carries the dev password only when it is enabled", () => {
    expect(buildRestoreArgs(form({ anonymizeUsers: true }), false).user_password).toBe("ownerp");
    expect(buildRestoreArgs(form(), false).user_password).toBeUndefined();
  });
});

describe("check-space", () => {
  it("stays silent while enabled — that is the CLI default", () => {
    expect(buildRestoreArgs(form(), false).check_space).toBeUndefined();
  });

  it("is sent as false when the user turns it off", () => {
    expect(buildRestoreArgs(form({ checkSpace: false }), false).check_space).toBe(false);
  });
});

describe("dry run", () => {
  it("adds the flag only for a dry run", () => {
    expect(buildRestoreArgs(form(), true).dry_run).toBe(true);
    expect(buildRestoreArgs(form(), false).dry_run).toBeUndefined();
  });

  it("otherwise sends exactly the same arguments as the real restore", () => {
    const wet = buildRestoreArgs(form({ anonymize: true, wipe: true }), false);
    const dry = buildRestoreArgs(form({ anonymize: true, wipe: true }), true);
    expect({ ...dry, dry_run: undefined }).toEqual({ ...wet, dry_run: undefined });
  });
});

describe("module list", () => {
  it("is omitted when empty and forwarded verbatim otherwise", () => {
    expect(buildRestoreArgs(form(), false).uninstall_modules).toBeUndefined();
    expect(buildRestoreArgs(form({ uninstallModules: "eq_sale,eq_stock" }), false).uninstall_modules).toBe(
      "eq_sale,eq_stock",
    );
  });
});
