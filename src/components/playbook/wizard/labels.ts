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
