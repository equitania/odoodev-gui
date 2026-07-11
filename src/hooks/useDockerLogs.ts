import { useEffect, useRef, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DockerLogState {
  lines: string[];
  listening: boolean;
  start: (version: string, runtime?: string, tail?: number) => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useDockerLogs(): DockerLogState {
  const [lines, setLines] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const unlistensRef = useRef<UnlistenFn[]>([]);

  const stop = useCallback(() => {
    unlistensRef.current.forEach((u) => u());
    unlistensRef.current = [];
    setListening(false);
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const start = useCallback(
    async (version: string, runtime?: string, tail?: number) => {
      stop();
      setLines([]);
      const event = `docker-logs:${version}`;
      const u = await listen<string>(event, (e) => {
        setLines((prev) => {
          const next = [...prev, e.payload];
          if (next.length > 10_000) next.splice(0, next.length - 10_000);
          return next;
        });
      });
      unlistensRef.current.push(u);
      setListening(true);
      const { invokeCmd } = await import("../lib/tauri");
      invokeCmd<{ success: boolean; error: string | null }>("docker_logs", {
        version,
        runtime,
        tail,
      }).finally(() => {
        setListening(false);
      });
    },
    [stop],
  );

  useEffect(() => {
    return () => {
      unlistensRef.current.forEach((u) => u());
    };
  }, []);

  return { lines, listening, start, stop, clear };
}