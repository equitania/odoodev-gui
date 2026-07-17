import { create } from "zustand";
import { persist } from "zustand/middleware";

/** GUI-only database tags — the CLI has no concept of tags, so they are keyed
 *  by `${version}::${dbName}` and live in localStorage. */
export function dbTagKey(version: string, db: string): string {
  return `${version}::${db}`;
}

interface DbTagState {
  tagsByDb: Record<string, string[]>;
  setTags: (version: string, db: string, tags: string[]) => void;
  /** Prune tags when a database is dropped so stale keys don't accumulate. */
  removeDb: (version: string, db: string) => void;
  /** Re-key tags when a database is renamed so they follow the new name. */
  renameDb: (version: string, from: string, to: string) => void;
}

export const useDbTagStore = create<DbTagState>()(
  persist(
    (set) => ({
      tagsByDb: {},
      setTags: (version, db, tags) =>
        set((s) => {
          const next = { ...s.tagsByDb };
          const key = dbTagKey(version, db);
          if (tags.length === 0) delete next[key];
          else next[key] = tags;
          return { tagsByDb: next };
        }),
      removeDb: (version, db) =>
        set((s) => {
          const next = { ...s.tagsByDb };
          delete next[dbTagKey(version, db)];
          return { tagsByDb: next };
        }),
      renameDb: (version, from, to) =>
        set((s) => {
          const fromKey = dbTagKey(version, from);
          if (!(fromKey in s.tagsByDb)) return s;
          const next = { ...s.tagsByDb };
          next[dbTagKey(version, to)] = next[fromKey];
          delete next[fromKey];
          return { tagsByDb: next };
        }),
    }),
    { name: "odoodev-gui.dbTags", version: 1 },
  ),
);
