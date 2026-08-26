import { describe, expect, it } from "vitest";
import de from "./de.json";
import en from "./en.json";

type Catalog = { [k: string]: string | Catalog };

/** Every source file's text, read through Vite rather than node:fs — this is a
 *  browser-targeted project and the test needs no Node types that way. */
const SOURCES = import.meta.glob("../**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** All dotted leaf paths of a catalog, e.g. "database.restoreHelp.wipe". */
function leafKeys(node: Catalog, prefix = ""): string[] {
  return Object.entries(node).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? [path] : leafKeys(v, path);
  });
}

function read(catalog: unknown, dotted: string): string {
  return dotted.split(".").reduce<unknown>((n, p) => (n as Catalog)[p], catalog) as string;
}

const deKeys = new Set(leafKeys(de as Catalog));
const enKeys = new Set(leafKeys(en as Catalog));
const NAMESPACES = new Set(Object.keys(de));

/** Literal keys from t("…") and <Trans i18nKey="…">, plus both branches of the
 *  `t(cond ? "a" : "b")` form. Fully dynamic lookups — the playbook wizard
 *  resolves CLI `label_key`s at runtime — cannot be checked statically. */
function usedKeys(): { key: string; file: string }[] {
  const found: { key: string; file: string }[] = [];
  for (const [file, text] of Object.entries(SOURCES)) {
    if (/\.test\.tsx?$/.test(file)) continue;
    for (const m of text.matchAll(/(?:\bt\(|i18nKey=)\s*"([a-zA-Z0-9_.]+)"/g)) {
      found.push({ key: m[1], file });
    }
    for (const m of text.matchAll(/\bt\(\s*[^)"]*\?\s*"([a-zA-Z0-9_.]+)"\s*:\s*"([a-zA-Z0-9_.]+)"/g)) {
      found.push({ key: m[1], file }, { key: m[2], file });
    }
  }
  return found.filter((f) => f.key.includes(".") && NAMESPACES.has(f.key.split(".")[0]));
}

describe("locale catalogs", () => {
  it("has the same keys in German and English", () => {
    expect([...deKeys].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...enKeys].filter((k) => !deKeys.has(k))).toEqual([]);
  });

  it("has no empty translations", () => {
    for (const [lang, cat] of [["de", de], ["en", en]] as const) {
      const empty = leafKeys(cat as Catalog).filter((k) => read(cat, k).trim() === "");
      expect(empty, `empty ${lang} values`).toEqual([]);
    }
  });

  it("keeps interpolation placeholders identical across languages", () => {
    const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const key of deKeys) {
      expect(placeholders(read(de, key)), `placeholders differ for "${key}"`).toEqual(
        placeholders(read(en, key)),
      );
    }
  });
});

describe("translation usage", () => {
  const used = usedKeys();

  it("finds translation keys in the source tree", () => {
    // Guards the extraction itself: a refactor that breaks the regex would
    // otherwise make the next test pass vacuously.
    expect(used.length).toBeGreaterThan(200);
  });

  it("resolves every key used in components", () => {
    const missing = used
      // i18next stores plural keys as "<key>_one" / "<key>_other".
      .filter(({ key }) => !deKeys.has(key) && !deKeys.has(`${key}_other`))
      .map(({ key, file }) => `${key} (${file})`);
    expect([...new Set(missing)]).toEqual([]);
  });
});
