/**
 * Light TypeScript view of the `odoodev playbook schema --json` contract
 * (schema_version 2). Only the attributes the form renderer needs are typed;
 * everything else is passed through untouched so a newer CLI schema cannot
 * break the GUI.
 */

export type WizardFieldType =
  | "text"
  | "password"
  | "select"
  | "checkbox" // multi-select from `choices` (NOT a boolean — that is `confirm`)
  | "confirm"
  | "path"
  | "int"
  | "json"
  | "list[str]"
  | "list[sql]"
  | "map[str]"
  | "map[secret_text]";

export interface WizardField {
  /** Dot-path into the (global) answers namespace, e.g. "recipe.backup.only_sql". */
  key: string;
  type: WizardFieldType;
  label_key: string;
  required?: boolean;
  default?: unknown;
  choices?: string[] | null;
  /** "targets" is the only source resolved dynamically in the GUI. */
  choices_source?: string | null;
  depends_on?: string | null;
  depends_value?: unknown;
  secret?: boolean;
}

export interface WizardSection {
  key: string;
  applies_to: string[];
  fields?: WizardField[];
  repeatable?: boolean;
  min_items?: number;
  item_fields?: WizardField[];
}

export interface WizardSchema {
  schema_version: number;
  playbook_types: string[];
  sections: WizardSection[];
  sql_presets?: Record<string, unknown>;
  rpc_env_keys?: string[];
  dev_step_groups?: Record<string, string[]>;
  step_args?: unknown;
}

/** Flat wizard state: schema field key (dot-path) → entered value.
 *  Repeatable sections store an array of item objects under the section key. */
export type WizardValues = Record<string, unknown>;
