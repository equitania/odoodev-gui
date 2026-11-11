/** Rejection codes of the backend's path checks. */
export const OUTPUT_ERROR_CODES = [
  "flag_like",
  "empty",
  "bad_tilde",
  "bad_extension",
  "parent_escape",
  "unresolvable",
  "outside_roots",
  "not_a_file",
] as const;

/** The env-file check additionally rejects malformed answers. */
export const ENV_ERROR_CODES = [...OUTPUT_ERROR_CODES, "malformed"] as const;

export type OutputErrorCode = (typeof OUTPUT_ERROR_CODES)[number];
export type EnvErrorCode = (typeof ENV_ERROR_CODES)[number];

export type PathError =
  | { field: "output"; code: OutputErrorCode }
  | { field: "env_file"; code: EnvErrorCode };

const OUTPUT_PATTERN = /playbook_output:([a-z_]+)/;
const ENV_PATTERN = /playbook_env_file:([a-z_]+)/;

/**
 * Pull the field and machine-readable code out of a rejection from
 * `playbook_create` / `playbook_check_output` (`playbook_output:<code>: …` for
 * the playbook path, `playbook_env_file:<code>: …` for the secrets file).
 * Returns null for any other error (for example a CLI failure), which the
 * caller shows verbatim.
 */
export function parsePathError(error: unknown): PathError | null {
  const text = String(error);
  const env = ENV_PATTERN.exec(text);
  if (env && (ENV_ERROR_CODES as readonly string[]).includes(env[1])) {
    return { field: "env_file", code: env[1] as EnvErrorCode };
  }
  const out = OUTPUT_PATTERN.exec(text);
  if (out && (OUTPUT_ERROR_CODES as readonly string[]).includes(out[1])) {
    return { field: "output", code: out[1] as OutputErrorCode };
  }
  return null;
}
