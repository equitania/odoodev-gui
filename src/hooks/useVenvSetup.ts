import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface VenvSetupState {
  lines: string[];
  running: boolean;
  start: (version: string, force: boolean) => Promise<boolean>;
  clear: () => void;
}

export function useVenvSetup(): VenvSetupState {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const clear = useCallback(() => setLines([]), []);

  const start = useCallback(
    async (version: string, force: boolean): Promise<boolean> => {
      setLines([]);
      setRunning(true);
      const event = `venv-setup-progress:${version}`;
      const u = await listen<string>(event, (e) => {
        setLines((prev) => {
          const next = [...prev, e.payload];
          if (next.length > 5_000) next.splice(0, next.length - 5_000);
          return next;
        });
      });
      unlistensRef.current.push(u);
      const { invokeCmd } = await import("../lib/tauri");
      try {
        const result = await invokeCmd<{ success: boolean; error: string | null }>(
          "venv_setup",
          { version, force },
        );
        return result.success;
      } catch (e) {
        console.error("useVenvSetup:", e);
        return false;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      unlistensRef.current.forEach((u) => u());
    };
  }, []);

  return { lines, running, start, clear };
}