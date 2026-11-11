import { describe, expect, it } from "vitest";
import type { WizardSchema, WizardValues } from "../../../types/playbookSchema";
import { buildAnswers } from "./buildAnswers";

const schema = (schema_version: number): WizardSchema =>
  ({ schema_version, sections: [] }) as unknown as WizardSchema;

const values = (over: WizardValues = {}): WizardValues => ({
  playbook_type: "server",
  name: "mirror",
  version: "19",
  server_targets: [
    { name: "live", db_container: "live-db", db_name: "acme" },
    { name: "test", db_container: "test-db", db_name: "acme_test" },
  ],
  "source.mode": "fresh_backup",
  "source.target": "live",
  "recipe.destination": "test",
  "recipe.backup.backup_dir": "/opt/backups/docker",
  "recipe.rebuild.enabled": true,
  ...over,
});

const recipe = (v: WizardValues, version: number) =>
  buildAnswers(schema(version), v).answers.recipe as Record<string, Record<string, unknown>>;

describe("schema v4 server recipe", () => {
  it("places the rebuild behind the restore and points it at the destination", () => {
    // The source is chosen in the (now hidden) target field: it must not win.
    const r = recipe(values({ "recipe.rebuild.target": "live" }), 4);
    expect(r.rebuild.position).toBe("after_restore");
    expect(r.rebuild.target).toBe("test");
  });

  it("passes an explicit position through", () => {
    const r = recipe(values({ "recipe.rebuild.position": "before_restore" }), 4);
    expect(r.rebuild.position).toBe("before_restore");
  });

  it("saves the destination first and verifies afterwards by default", () => {
    const r = recipe(values(), 4);
    expect(r.safety_backup).toEqual({ enabled: true, backup_dir: "/opt/backups/docker" });
    expect(r.verify).toEqual({ enabled: true });
  });

  it("leaves both out when the user switched them off", () => {
    const r = recipe(values({ "recipe.safety_backup.enabled": false, "recipe.verify.enabled": false }), 4);
    expect(r.safety_backup).toBeUndefined();
    expect(r.verify).toBeUndefined();
  });

  it("uses the safety backup directory the user gave", () => {
    const r = recipe(values({ "recipe.safety_backup.backup_dir": "/srv/safe" }), 4);
    expect(r.safety_backup.backup_dir).toBe("/srv/safe");
  });
});

describe("older schemas", () => {
  it("send none of the v4 blocks, so the CLI keeps the old order", () => {
    const r = recipe(values(), 3);
    expect(r.safety_backup).toBeUndefined();
    expect(r.verify).toBeUndefined();
    expect(r.rebuild.position).toBeUndefined();
  });
});

describe("suggested env-file path", () => {
  const envValues = (extra: Record<string, unknown>) => ({
    playbook_type: "dev",
    name: "demo",
    version: "18",
    "env_file.generate": true,
    "env_file.path": "/pb/demo.env",
    ...extra,
  });

  it("is dropped, and nothing is generated, while there are no secrets", () => {
    const { answers } = buildAnswers(schema(4), envValues({}), "/pb/demo.env");
    expect(answers.env_file).toEqual({ generate: false });
  });

  it("is used once secrets exist", () => {
    const { answers } = buildAnswers(
      schema(4),
      envValues({ "env_file.secrets": [{ key: "API_KEY", value: "x" }] }),
      "/pb/demo.env",
    );
    expect(answers.env_file).toMatchObject({ generate: true, path: "/pb/demo.env" });
  });

  it("keeps a path the user typed themselves", () => {
    const { answers } = buildAnswers(schema(4), envValues({ "env_file.path": "/pb/mine.env" }), "/pb/demo.env");
    expect(answers.env_file).toMatchObject({ path: "/pb/mine.env" });
  });
});
