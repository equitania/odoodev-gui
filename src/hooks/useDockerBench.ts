import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DockerBenchState {
  lines: string[];
  running: boolean;
  start: (version: string, runtime?: string, duration?: number, scale?: number) => Promise<void>;
  clear: () => void;
}

export function useDockerBench(): DockerBenchState {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const clear = useCallback(() => setLines([]), []);

  const start = useCallback(
    async (version: string, runtime?: string, duration?: number, scale?: number) => {
      setLines([]);
      setRunning(true);
      const event = `docker-bench:${version}`;
      const u = await listen<string>(event, (e) => {
        setLines((prev) => {
          const next = [...prev, e.payload];
          if (next.length > 10_000) next.splice(0, next.length - 10_000);
          return next;
        });
      });
      unlistensRef.current.push(u);
      const { invokeCmd } = await import("../lib/tauri");
      try {
        await invokeCmd<{ success: boolean; error: string | null }>("docker_bench", {
          version,
          runtime,
          duration,
          scale,
        });
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