import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ReposProgressState {
  lines: string[];
  running: boolean;
  activeVersion: string | null;
  start: (version: string, command: "repos" | "pull", configOnly?: boolean, noConfig?: boolean) => Promise<boolean>;
  clear: () => void;
}

export function useReposProgress(): ReposProgressState {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const clear = useCallback(() => setLines([]), []);

  const start = useCallback(
    async (
      version: string,
      command: "repos" | "pull",
      configOnly?: boolean,
      noConfig?: boolean,
    ): Promise<boolean> => {
      setLines([]);
      setRunning(true);
      setActiveVersion(version);
      const event =
        command === "repos"
          ? `repos-progress:${version}`
          : `repos-pull-progress:${version}`;
      const u = await listen<string>(event, (e) => {
        setLines((prev) => {
          const next = [...prev, e.payload];
          if (next.length > 5_000) next.splice(0, next.length - 5_000);
          return next;
        });
      });
      unlistensRef.current.push(u);
      const { invokeCmd } = await import("../lib/tauri");
      const cmd = command === "repos" ? "repos_run" : "repos_pull";
      try {
        const result = await invokeCmd<{ success: boolean; error: string | null }>(cmd, {
          version,
          configOnly: configOnly ?? false,
          noConfig: noConfig ?? false,
        });
        return result.success;
      } catch (e) {
        console.error("useReposProgress:", e);
        return false;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  useEffect(() => {
    return () => {
      // Intentional: unlisten every listener `start` accumulated over the
      // component's lifetime, not a stale mount-time snapshot of the ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      unlistensRef.current.forEach((u) => u());
    };
  }, []);

  return { lines, running, activeVersion, start, clear };
}