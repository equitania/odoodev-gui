import i18n from "../../../i18n";

/**
 * Resolve a CLI schema `label_key` (e.g. "playbook.common.name") against the
 * GUI catalog (namespace `playbookWizard.*`, extracted from odoodev's own
 * i18n catalog). Unknown keys — e.g. a newer installed CLI with fields this
 * GUI build has never seen — fall back to a humanized last key segment so
 * the form always renders.
 */
export function resolveLabel(labelKey: string | undefined, fieldKey: string): string {
  if (labelKey) {
    const guiKey = labelKey.replace(/^playbook\./, "playbookWizard.");
    if (i18n.exists(guiKey)) return i18n.t(guiKey);
    // Leaf-and-branch collisions are stored under "_label" during extraction.
    if (i18n.exists(`${guiKey}._label`)) return i18n.t(`${guiKey}._label`);
  }
  return humanize(fieldKey.split(".").pop() ?? fieldKey);
}

export function humanize(segment: string): string {
  return segment
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Plain-language labels for select/checkbox choices (odoodev >= 0.56).
 *  The CLI catalog has per-choice keys in a few known shapes; unknown
 *  choices render as their raw value. */
export function resolveChoiceLabel(
  fieldLabelKey: string | undefined,
  fieldKey: string,
  choice: string,
): string {
  const candidates: string[] = [];
  if (fieldLabelKey) {
    // e.g. sanitize flags: playbook.server.restore.sanitize → …restore.flag.<choice>
    const parent = fieldLabelKey.split(".").slice(0, -1).join(".");
    candidates.push(`${parent}.flag.${choice}`);
  }
  if (fieldKey === "playbook_type") candidates.push(`playbook.type.${choice}`);
  if (fieldKey === "source.mode") {
    const modeKey = { fresh_backup: "fresh", existing_file: "file", newest_in_dir: "newest" }[choice];
    if (modeKey) candidates.push(`playbook.server.source.${modeKey}`);
  }
  if (fieldKey.endsWith("on_error")) candidates.push(`playbook.choice.on_error_${choice}`);
  if (fieldKey.endsWith("select_by")) {
    candidates.push(
      `playbook.choice.select_${choice === "filename_timestamp" ? "filename_ts" : choice}`,
    );
  }
  for (const key of candidates) {
    const guiKey = key.replace(/^playbook\./, "playbookWizard.");
    if (i18n.exists(guiKey)) return i18n.t(guiKey);
  }
  return choice;
}
