import { useEffect, useRef } from "react";

export function usePolling(fn: () => void, intervalMs: number, enabled: boolean = true) {
  const savedFn = useRef(fn);
  useEffect(() => {
    savedFn.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => savedFn.current();
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}