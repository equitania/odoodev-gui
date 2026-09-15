import { create } from "zustand";
import type { DbUpdateEvent, StartServerArgs } from "../types";
import {
  applyConsoleLine,
  applyEvent,
  applyExit,
  attachedRun,
  markCancelling,
  newRun,
  type DbUpdateRun,
} from "../lib/dbUpdateReducer";

interface DbUpdateState {
  runs: Record<string, DbUpdateRun>;
  begin: (version: string, modules: string, restartServer: StartServerArgs | null) => void;
  event: (version: string, event: DbUpdateEvent) => void;
  consoleLine: (version: string, line: string) => void;
  exited: (version: string, exitCode: number | null) => DbUpdateRun | undefined;
  cancelling: (version: string) => void;
  clearRestart: (version: string) => void;
  dismiss: (version: string) => void;
  attach: (versions: string[]) => void;
}

/** Per-version `db update` runs. Lives outside any view so progress survives navigation. */
export const useDbUpdateStore = create<DbUpdateState>((set, get) => ({
  runs: {},

  begin: (version, modules, restartServer) =>
    set((s) => ({ runs: { ...s.runs, [version]: newRun(modules, Date.now(), restartServer) } })),

  event: (version, event) =>
    set((s) => ({
      runs: { ...s.runs, [version]: applyEvent(s.runs[version] ?? attachedRun(Date.now()), event, Date.now()) },
    })),

  consoleLine: (version, line) =>
    set((s) => ({
      runs: { ...s.runs, [version]: applyConsoleLine(s.runs[version] ?? attachedRun(Date.now()), line) },
    })),

  exited: (version, exitCode) => {
    const run = get().runs[version];
    if (!run) return undefined;
    const next = applyExit(run, exitCode);
    set((s) => ({ runs: { ...s.runs, [version]: next } }));
    return next;
  },

  cancelling: (version) =>
    set((s) => {
      const run = s.runs[version];
      return run ? { runs: { ...s.runs, [version]: markCancelling(run, Date.now()) } } : s;
    }),

  clearRestart: (version) =>
    set((s) => {
      const run = s.runs[version];
      return run ? { runs: { ...s.runs, [version]: { ...run, restartServer: null } } } : s;
    }),

  dismiss: (version) =>
    set((s) => {
      const runs = { ...s.runs };
      delete runs[version];
      return { runs };
    }),

  attach: (versions) =>
    set((s) => {
      const runs = { ...s.runs };
      for (const version of versions) {
        if (!runs[version]) runs[version] = attachedRun(Date.now());
      }
      return { runs };
    }),
}));
