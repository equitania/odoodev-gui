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
