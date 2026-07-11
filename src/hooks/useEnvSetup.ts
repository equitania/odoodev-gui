import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface EnvSetupState {
  lines: string[];
  running: boolean;
  start: (version: string) => Promise<boolean>;
  clear: () => void;
}

export function useEnvSetup(): EnvSetupState {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const clear = useCallback(() => setLines([]), []);

  const start = useCallback(
    async (version: string): Promise<boolean> => {
      setLines([]);
      setRunning(true);
      const event = `env-setup-progress:${version}`;
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
          "env_setup",
          { version },
        );
        return result.success;
      } catch {
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