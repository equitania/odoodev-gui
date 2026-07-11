import { useRef, useState, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "../ui/button";
import { Gauge, Loader2 } from "lucide-react";
import type { ContainerRuntime } from "../../types";

interface BenchPanelProps {
  lines: string[];
  running: boolean;
  runtime: ContainerRuntime;
  onStart: (runtime?: string, duration?: number, scale?: number) => void;
}

export function BenchPanel({ lines, running, runtime, onStart }: BenchPanelProps) {
  const [duration, setDuration] = useState(10);
  const [scale, setScale] = useState(5);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 30,
  });

  useEffect(() => {
    if (lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
  }, [lines.length, virtualizer]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-2">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Benchmark</span>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            Duration:
            <input
              type="number"
              min={1}
              max={300}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={running}
              className="h-7 w-16 rounded border border-input bg-background px-2"
            />
            s
          </label>
          <label className="flex items-center gap-1">
            Scale:
            <input
              type="number"
              min={1}
              max={100}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              disabled={running}
              className="h-7 w-16 rounded border border-input bg-background px-2"
            />
          </label>
        </div>
        <Button
          size="sm"
          variant="default"
          disabled={running || runtime === "none"}
          onClick={() => onStart(undefined, duration, scale)}
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
          {running ? "Running..." : "Run"}
        </Button>
        {runtime === "apple" && (
          <span className="text-xs text-muted-foreground">
            Both runtimes benchmarked if available
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="relative flex-1 overflow-auto bg-background font-mono text-xs"
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {running ? "Starting benchmark..." : "Click Run to benchmark PostgreSQL"}
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((vItem) => (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${vItem.start}px)`,
                }}
                className="px-3 py-0.5 whitespace-pre-wrap break-all text-muted-foreground"
              >
                {lines[vItem.index]}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}