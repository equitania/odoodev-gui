/** odoodev release that added the pgvector check (and `--without-pgvector`) to `db restore`. */
export const MIN_ODOODEV_PGVECTOR = "0.71.0";

/** odoodev release that added the preflight for server playbooks (`--no-preflight`). */
export const MIN_ODOODEV_PREFLIGHT = "0.72.0";

/** odoodev release that added `export modules --via-shell` (export without an Odoo login). */
export const MIN_ODOODEV_EXPORT_VIA_SHELL = "0.76.0";

/** odoodev release where `export modules` reads through `odoo-bin shell` by default and
 *  XML-RPC needs `--via-rpc`. */
export const MIN_ODOODEV_EXPORT_VIA_RPC = "0.77.0";

/** odoodev release that added `db restore --allow-psql-meta` (dump check for psql meta commands). */
export const MIN_ODOODEV_PSQL_META = "0.77.0";

/** odoodev release where `docker up` refuses the placeholder password (`--allow-default-credentials`). */
export const MIN_ODOODEV_DOCKER_DEFAULT_CREDS = "0.77.0";

/** odoodev release that introduced `db update --output ndjson`. */
export const MIN_ODOODEV_DB_UPDATE = "0.69.0";

/** True when `installed` ("0.69.1", "0.70.0.dev1") is at least `required`
 *  ("major.minor.patch"). An unknown version never satisfies a requirement. */
export function isAtLeast(installed: string | null | undefined, required: string): boolean {
  if (!installed) return false;
  const parse = (v: string) =>
    v
      .split(".")
      .slice(0, 3)
      .map((n) => parseInt(n, 10) || 0);
  const a = parse(installed);
  const b = parse(required);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
