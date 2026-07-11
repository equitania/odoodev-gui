import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { PlaybookEvent } from "../types";

export interface PlaybookRunState {
  events: PlaybookEvent[];
  running: boolean;
  start: (
    playbook: string | null,
    steps: string[],
    version: string | null,
    vars: string[],
    dryRun: boolean,
  ) => Promise<boolean>;
  clear: () => void;
}

export function usePlaybookRun(): PlaybookRunState {
  const [events, setEvents] = useState<PlaybookEvent[]>([]);
  const [running, setRunning] = useState(false);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const clear = useCallback(() => setEvents([]), []);

  const start = useCallback(
    async (
      playbook: string | null,
      steps: string[],
      version: string | null,
      vars: string[],
      dryRun: boolean,
    ): Promise<boolean> => {
      setEvents([]);
      setRunning(true);

      const u = await listen<PlaybookEvent>("playbook-event", (e) => {
        setEvents((prev) => [...prev, e.payload]);
      });
      unlistensRef.current.push(u);

      const { invokeCmd } = await import("../lib/tauri");
      try {
        const result = await invokeCmd<{ success: boolean; error: string | null }>(
          "playbook_run",
          { playbook, steps, version, vars, dry_run: dryRun },
        );
        return result.success;
      } catch {
        return false;
      } finally {
        setRunning(false);
        u();
        unlistensRef.current = unlistensRef.current.filter((fn) => fn !== u);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      unlistensRef.current.forEach((u) => u());
    };
  }, []);

  return { events, running, start, clear };
}