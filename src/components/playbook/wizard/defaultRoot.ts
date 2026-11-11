/**
 * The playbook directory a new file should default to.
 *
 * `roots` is the backend's ordered list of directories where playbooks may be
 * written (each version's `scripts/playbooks` first, the project's `./playbooks`
 * last, a root-level `./playbooks` already removed). When the wizard works on a
 * known version, that version's directory wins; otherwise the first entry.
 * Returns null when the backend offers no directory at all.
 */
export function pickDefaultRoot(
  roots: string[],
  versionRoots: Record<string, string>,
  version: string,
): string | null {
  const own = version ? versionRoots[version] : undefined;
  if (own && roots.includes(own)) return own;
  return roots[0] ?? null;
}

/** Map version -> `<native_dir>/scripts/playbooks`, limited to directories the backend lists. */
export function versionRootsOf(
  groups: { version: string; native_dir: string }[],
  roots: string[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const g of groups) {
    const dir = roots.find((r) => r.startsWith(g.native_dir) && r.endsWith("scripts/playbooks"));
    if (dir) map[g.version] = dir;
  }
  return map;
}

/**
 * Directory for the secrets `.env` file, by playbook type — as the CLI's own
 * interview does (`_wizard_secrets` in `playbook_cmd.py`): a server playbook
 * keeps its secrets in odoodev's config directory (`~/.config/odoodev/<slug>.env`),
 * a dev playbook next to the playbooks (`./playbooks/<slug>.env`). Falls back to
 * the playbook directory while the config directory is unknown.
 */
export function pickEnvDir(
  playbookType: string,
  playbookRoot: string | null,
  configDir: string | null,
): string | null {
  if (playbookType === "server" && configDir) return configDir;
  return playbookRoot ?? configDir;
}
