import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ServerPreset, StartServerArgs } from "../types";

interface PresetState {
  presets: ServerPreset[];
  savePreset: (name: string, tags: string[], args: StartServerArgs) => ServerPreset;
  updatePreset: (id: string, args: StartServerArgs) => void;
  renamePreset: (id: string, name: string, tags: string[]) => void;
  removePreset: (id: string) => void;
}

export const usePresetStore = create<PresetState>()(
  persist(
    (set) => ({
      presets: [],
      savePreset: (name, tags, args) => {
        const now = new Date().toISOString();
        const preset: ServerPreset = {
          id: crypto.randomUUID(),
          name,
          tags,
          args,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ presets: [...s.presets, preset] }));
        return preset;
      },
      updatePreset: (id, args) =>
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id ? { ...p, args, updatedAt: new Date().toISOString() } : p,
          ),
        })),
      renamePreset: (id, name, tags) =>
        set((s) => ({
          presets: s.presets.map((p) =>
            p.id === id ? { ...p, name, tags, updatedAt: new Date().toISOString() } : p,
          ),
        })),
      removePreset: (id) =>
        set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    // version is the seam for a future migrate() when ServerPreset changes.
    { name: "odoodev-gui.serverPresets", version: 1 },
  ),
);
