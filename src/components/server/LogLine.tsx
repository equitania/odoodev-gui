import { cn } from "../../lib/utils";
import type { LogLevel, OdooLogEntry } from "../../types";

const LEVEL_STYLES: Record<LogLevel, string> = {
  DEBUG: "text-gray-500",
  INFO: "text-foreground",
  WARNING: "text-yellow-500",
  ERROR: "text-red-500",
  CRITICAL: "text-red-500 font-bold",
  RAW: "text-gray-600 italic",
};

export function LogLine({
  entry,
  searchTerm,
}: {
  entry: OdooLogEntry;
  searchTerm: string;
}) {
  const isRaw = entry.level === "RAW";
  const hasMatch = searchTerm && entry.raw.toLowerCase().includes(searchTerm.toLowerCase());

  return (
    <div
      className={cn(
        "flex flex-col border-b border-border/30 px-2 py-0.5 font-mono text-xs hover:bg-accent/30",
        hasMatch && "bg-yellow-500/10",
      )}
    >
      {isRaw ? (
        <span className={cn("whitespace-pre-wrap break-all", LEVEL_STYLES.RAW)}>
          {entry.message}
        </span>
      ) : (
        <div className="flex gap-2">
          <span className="shrink-0 text-gray-500">{entry.timestamp}</span>
          <span className="shrink-0 text-blue-400">{entry.pid}</span>
          <span className={cn("shrink-0 font-semibold", LEVEL_STYLES[entry.level])}>
            {entry.level}
          </span>
          <span className="shrink-0 text-cyan-400">{entry.database}</span>
          <span className="shrink-0 text-blue-400">{entry.logger}:</span>
          <span className="break-all">{entry.message}</span>
        </div>
      )}
    </div>
  );
}