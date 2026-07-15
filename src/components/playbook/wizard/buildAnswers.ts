import type { WizardSchema, WizardValues } from "../../../types/playbookSchema";
import type { MapRow } from "./FieldControl";
import type { RepeatableItem } from "./RepeatableSection";

/**
 * Map the flat wizard state onto the nested answers JSON that
 * `odoodev playbook create --answers` expects (usage/playbook.md).
 *
 * This mirrors the CLI wizard's own assembly logic (_wizard_server /
 * _wizard_dev in playbook_cmd.py): the schema drives the QUESTIONS, but a few
 * answers are derived rather than asked directly — `source.mode` selects how
 * `recipe.backup` / `recipe.restore.backup_source` are built, and the restore
 * block is always enabled for server mirrors with the chosen destination.
 * Final validation happens CLI-side; problems returned here are only the
 * GUI-detectable ones (unparseable JSON fields).
 */
export function buildAnswers(
  schema: WizardSchema,
  values: WizardValues,
): { answers: Record<string, unknown>; problems: string[] } {
  const problems: string[] = [];
  const playbookType = str(values["playbook_type"]) || "server";

  const answers: Record<string, unknown> = {
    schema_version: schema.schema_version,
    playbook_type: playbookType,
    name: str(values["name"]),
    description: str(values["description"]),
    version: str(values["version"]),
    on_error: str(values["on_error"]) || "stop",
  };

  const vars = mapRowsToObject(values["vars"]);
  if (Object.keys(vars).length > 0) answers.vars = vars;

  if (playbookType === "dev") {
    answers.dev_steps = Array.isArray(values["dev_steps"]) ? values["dev_steps"] : [];
  } else {
    buildServerAnswers(answers, values, problems, schema.schema_version);
  }

  // The CLI rejects generate:true without a path. Without secrets that combo
  // is harmless intent — quietly disable; with secrets the path is genuinely
  // missing and the user must fix it.
  const envPath = str(values["env_file.path"]);
  const secrets = mapRowsToObject(values["env_file.secrets"]);
  let envGenerate = bool(values["env_file.generate"], true);
  if (envGenerate && !envPath) {
    if (Object.keys(secrets).length > 0) {
      problems.push("env_file.path: required when secrets should be written");
    } else {
      envGenerate = false;
    }
  }
  const envFile: Record<string, unknown> = { generate: envGenerate };
  if (envPath) envFile.path = envPath;
  if (Object.keys(secrets).length > 0) envFile.secrets = secrets;
  answers.env_file = envFile;

  const outputPath = str(values["output_path"]);
  if (outputPath) answers.output_path = outputPath;

  return { answers, problems };
}

function buildServerAnswers(
  answers: Record<string, unknown>,
  values: WizardValues,
  problems: string[],
  schemaVersion: number,
): void {
  // targets: dict keyed by name (NOT a list — see playbook_builder.py)
  const targetItems = (Array.isArray(values["server_targets"])
    ? values["server_targets"]
    : []) as RepeatableItem[];
  const targets: Record<string, Record<string, unknown>> = {};
  for (const item of targetItems) {
    const name = str(item["name"]);
    if (!name) continue;
    const target: Record<string, unknown> = {
      db_container: str(item["db_container"]),
      db_name: str(item["db_name"]),
    };
    for (const optional of ["odoo_container", "owner", "data_dir"]) {
      const v = str(item[optional]);
      if (v) target[optional] = v;
    }
    targets[name] = target;
  }
  answers.targets = targets;

  if (bool(values["rpc.enabled"], false)) {
    answers.rpc = {
      enabled: true,
      host: str(values["rpc.host"]) || "{{ env.ODOO_URL }}",
      db: str(values["rpc.db"]),
    };
  }

  const recipe: Record<string, unknown> = {};
  answers.recipe = recipe;

  const destination = str(values["recipe.destination"]);
  if (destination) recipe.destination = destination;

  // --- source mode → backup + backup_source (mirrors _wizard_source) ---
  const sourceMode = str(values["source.mode"]) || "fresh_backup";
  const sourceTarget = str(values["source.target"]);
  let backupSource: Record<string, unknown>;

  if (sourceMode === "fresh_backup") {
    const backupDir = str(values["recipe.backup.backup_dir"]) || "/opt/backups/docker";
    recipe.backup = {
      enabled: true,
      target: sourceTarget,
      backup_dir: backupDir,
      compression_level: num(values["recipe.backup.compression_level"], 5),
      only_sql: bool(values["recipe.backup.only_sql"], false),
    };
    if (schemaVersion >= 3) {
      // schema v3 (odoodev >= 0.57): the runner hands the backup step's exact
      // file to the restore — no pattern guessing.
      backupSource = { mode: "from_backup_step" };
    } else {
      // Older CLIs: derived pattern mirrors handle_server_backup's naming:
      // {db}_{data_container}_dockerbackup_{ts}.tar.zst
      const src = targets[sourceTarget] ?? {};
      const dataContainer = str(src["odoo_container"]) || str(src["db_container"]);
      backupSource = {
        mode: "newest_in_dir",
        dir: backupDir,
        pattern: `${str(src["db_name"])}_${dataContainer}_dockerbackup_*.tar.zst`,
        select_by: "mtime",
      };
    }
  } else if (sourceMode === "existing_file") {
    backupSource = {
      mode: "file",
      path: str(values["recipe.restore.backup_source.path"]),
    };
  } else {
    backupSource = {
      mode: "newest_in_dir",
      dir: str(values["recipe.restore.backup_source.dir"]),
      pattern: str(values["recipe.restore.backup_source.pattern"]),
      select_by: str(values["recipe.restore.backup_source.select_by"]) || "mtime",
    };
  }

  if (bool(values["recipe.rebuild.enabled"], false)) {
    recipe.rebuild = {
      enabled: true,
      target: str(values["recipe.rebuild.target"]) || destination,
      script_path: str(values["recipe.rebuild.script_path"]) || "~/update_docker_odoo.py",
      config: str(values["recipe.rebuild.config"]) || "~/docker2update.yaml",
      timeout: num(values["recipe.rebuild.timeout"], 7200),
    };
  }

  recipe.stop_before_restore = bool(values["recipe.stop_before_restore"], true);

  // server.restore is the core of the mirror — always included.
  recipe.restore = {
    enabled: true,
    target: destination,
    backup_source: backupSource,
    template: str(values["recipe.restore.template"]) || "template0",
    drop: bool(values["recipe.restore.drop"], true),
    sanitize_flags: Array.isArray(values["recipe.restore.sanitize_flags"])
      ? values["recipe.restore.sanitize_flags"]
      : [],
    purge_master_data: bool(values["recipe.restore.purge_master_data"], false),
  };

  if (bool(values["recipe.sql_after_restore.enabled"], false)) {
    recipe.sql_after_restore = {
      enabled: true,
      statements: Array.isArray(values["recipe.sql_after_restore.statements"])
        ? values["recipe.sql_after_restore.statements"]
        : [],
      on_error: str(values["recipe.sql_after_restore.on_error"]) || "continue",
    };
  }

  recipe.start_after_restore = bool(values["recipe.start_after_restore"], true);

  const sanitizeFlags = Array.isArray(values["recipe.restore.sanitize_flags"])
    ? (values["recipe.restore.sanitize_flags"] as string[])
    : [];
  if (schemaVersion >= 3) {
    // v3: ONE decision — picking the "neutralize" sanitize flag also adds the
    // server.neutralize step, but only when the server is started afterwards
    // (mirrors _wizard_restore; without start the step cannot run).
    if (sanitizeFlags.includes("neutralize") && bool(values["recipe.start_after_restore"], true)) {
      recipe.neutralize = { enabled: true };
    }
  } else {
    // v2 schema still has its own recipe.neutralize.enabled confirm field.
    recipe.neutralize = { enabled: bool(values["recipe.neutralize.enabled"], true) };
  }

  if (bool(values["recipe.update_all.enabled"], false)) {
    recipe.update_all = {
      enabled: true,
      restart: bool(values["recipe.update_all.restart"], true),
      on_error: str(values["recipe.update_all.on_error"]) || "continue",
    };
  }

  if (bool(values["recipe.rpc_call.enabled"], false)) {
    const mode = str(values["recipe.rpc_call.mode"]) || "method";
    const rpcCall: Record<string, unknown> = {
      enabled: true,
      model: str(values["recipe.rpc_call.model"]),
      mode,
    };
    const method = str(values["recipe.rpc_call.method"]);
    if (method) rpcCall.method = method;
    for (const jsonKey of ["args", "kwargs", "domain", "values"]) {
      const raw = str(values[`recipe.rpc_call.${jsonKey}`]);
      if (!raw) continue;
      try {
        rpcCall[jsonKey] = JSON.parse(raw);
      } catch {
        problems.push(`recipe.rpc_call.${jsonKey}: invalid JSON`);
      }
    }
    recipe.rpc_call = rpcCall;
  }

  // extra_steps: a LIST (unlike targets) — see playbook_builder.py
  const extraItems = (Array.isArray(values["server_extra_steps"])
    ? values["server_extra_steps"]
    : []) as RepeatableItem[];
  answers.extra_steps = extraItems
    .filter((item) => str(item["command"]))
    .map((item) => {
      const step: Record<string, unknown> = { command: str(item["command"]) };
      const name = str(item["name"]);
      if (name) step.name = name;
      const args = mapRowsToObject(item["args"]);
      if (Object.keys(args).length > 0) step.args = args;
      const onError = str(item["on_error"]);
      if (onError) step.on_error = onError;
      return step;
    });
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}

function mapRowsToObject(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) {
    for (const row of v as MapRow[]) {
      const key = typeof row?.key === "string" ? row.key.trim() : "";
      if (key) out[key] = typeof row.value === "string" ? row.value : "";
    }
  }
  return out;
}
