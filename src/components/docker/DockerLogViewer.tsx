import { useRef, useState, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "../ui/button";
import { Trash2, Copy, Loader2, Circle } from "lucide-react";

export function DockerLogViewer({
  lines,
  listening,
  onClear,
  onStop,
}: {
  lines: string[];
  listening: boolean;
  onClear: () => void;
  onStop: () => void;
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(lines.length);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 18,
    overscan: 50,
  });

  useEffect(() => {
    if (autoScroll && lines.length > 0) {
      virtualizer.scrollToIndex(lines.length - 1, { align: "end" });
    }
    prevLengthRef.current = lines.length;
  }, [lines.length, autoScroll, virtualizer]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom && !autoScroll) setAutoScroll(true);
  }, [autoScroll]);

  const copyAll = () => {
    navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border p-2">
        <div className="flex items-center gap-2">
          {listening ? (
            <Circle className="h-2 w-2 animate-pulse fill-green-500 text-green-500" />
          ) : (
            <Circle className="h-2 w-2 fill-muted-foreground text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {listening ? "Streaming..." : "Stopped"}
          </span>
          <span className="text-xs text-muted-foreground">{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          {listening && (
            <Button size="sm" variant="ghost" onClick={onStop} title="Stop">
              <Loader2 className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClear} title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={copyAll} title="Copy all">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-auto bg-background font-mono text-xs"
      >
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No log entries
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
                className="px-3 py-0.5 whitespace-pre-wrap break-all text-muted-foreground hover:bg-accent/30"
              >
                {lines[vItem.index]}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3"
          />
          Auto-scroll
        </label>
      </div>
    </div>
  );
}