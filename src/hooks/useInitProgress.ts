import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface InitProgressState {
  lines: string[];
  running: boolean;
  start: (
    command: "init" | "setup",
    version: string | null,
    skipRepos: boolean,
    skipDocker: boolean,
    reset: boolean,
  ) => Promise<boolean>;
  clear: () => void;
}

export function useInitProgress(): InitProgressState {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const clear = useCallback(() => setLines([]), []);

  const start = useCallback(
    async (
      command: "init" | "setup",
      version: string | null,
      skipRepos: boolean,
      skipDocker: boolean,
      reset: boolean,
    ): Promise<boolean> => {
      setLines([]);
      setRunning(true);

      const event =
        command === "init" && version
          ? `init-progress:${version}`
          : "setup-progress";

      const u = await listen<string>(event, (e) => {
        setLines((prev) => {
          const next = [...prev, e.payload];
          if (next.length > 5_000) next.splice(0, next.length - 5_000);
          return next;
        });
      });
      unlistensRef.current.push(u);

      const { invokeCmd } = await import("../lib/tauri");
      const cmd = command === "init" ? "init_version" : "setup_config";
      try {
        const result = await invokeCmd<{ success: boolean; error: string | null }>(cmd, {
          version,
          skip_repos: skipRepos,
          skip_docker: skipDocker,
          reset,
        });
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

  return { lines, running, start, clear };
}