import { useRef, useState, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Checkbox } from "../ui/checkbox";
import { LogLine } from "./LogLine";
import type { LogLevel, OdooLogEntry } from "../../types";
import { Trash2, Copy, ChevronDown } from "lucide-react";

const ALL_LEVELS: LogLevel[] = ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

export function LogViewer({
  entries,
  onClear,
}: {
  entries: OdooLogEntry[];
  onClear: () => void;
}) {
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(new Set(ALL_LEVELS));
  const [searchTerm, setSearchTerm] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [newLinesCount, setNewLinesCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(entries.length);

  const toggleLevel = useCallback((level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }, []);

  const filtered = entries.filter((e) => {
    if (e.is_separator) return true;
    if (!enabledLevels.has(e.effective_level)) return false;
    if (searchTerm && !e.raw.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 50,
  });

  useEffect(() => {
    if (autoScroll && filtered.length > 0) {
      virtualizer.scrollToIndex(filtered.length - 1, { align: "end" });
      setNewLinesCount(0);
    } else if (entries.length > prevLengthRef.current) {
      setNewLinesCount((c) => c + (entries.length - prevLengthRef.current));
    }
    prevLengthRef.current = entries.length;
  }, [entries.length, autoScroll, filtered.length, virtualizer]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    if (atBottom && !autoScroll) {
      setAutoScroll(true);
      setNewLinesCount(0);
    }
  }, [autoScroll]);

  const copyVisible = () => {
    const text = filtered.map((e) => e.raw).join("\n");
    navigator.clipboard.writeText(text);
  };

  const copyErrors = () => {
    const text = entries
      .filter((e) => e.level === "ERROR" || e.level === "CRITICAL")
      .map((e) => e.raw)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  const errorCount = entries.filter((e) => e.level === "ERROR" || e.level === "CRITICAL").length;
  const warnCount = entries.filter((e) => e.level === "WARNING").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">Levels:</span>
          {ALL_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => toggleLevel(level)}
              className={`rounded px-1.5 py-0.5 text-xs font-medium transition-all active:scale-95 ${
                enabledLevels.has(level)
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {level}
            </button>
          ))}
        </div>
        <Input
          type="text"
          placeholder="Search..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-7 w-40 text-xs"
        />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onClear} title="Clear">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={copyVisible} title="Copy visible">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-auto bg-background"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No log entries
          </div>
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
          >
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
              >
                <LogLine entry={filtered[vItem.index]} searchTerm={searchTerm} />
              </div>
            ))}
          </div>
        )}
      </div>

      {newLinesCount > 0 && !autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            setNewLinesCount(0);
          }}
          className="absolute bottom-14 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground shadow-lg"
        >
          {newLinesCount} new lines <ChevronDown className="inline h-3 w-3" />
        </button>
      )}

      <div className="flex items-center justify-between border-t border-border px-3 py-1 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <Checkbox
            checked={autoScroll}
            onChange={setAutoScroll}
            label="Auto-scroll"
          />
        </div>
        <div className="flex items-center gap-3">
          <span>{entries.length} lines</span>
          {errorCount > 0 && <span className="text-red-500">{errorCount} errors</span>}
          {warnCount > 0 && <span className="text-yellow-500">{warnCount} warnings</span>}
          <Button size="sm" variant="ghost" onClick={copyErrors} title="Copy errors">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}