import { useEffect, useRef } from "react";
import { Loader2, Terminal, CircleCheckBig, CircleX, CircleAlert } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import type { PlaybookEvent } from "../../types";

interface EventLogProps {
  events: PlaybookEvent[];
  running: boolean;
  onClose: () => void;
}

function statusIcon(status?: string) {
  if (status === "ok") return <CircleCheckBig className="h-3.5 w-3.5 text-green-500" />;
  if (status === "error") return <CircleX className="h-3.5 w-3.5 text-red-500" />;
  if (status === "skipped") return <CircleAlert className="h-3.5 w-3.5 text-yellow-500" />;
  return null;
}

function statusColor(status?: string) {
  if (status === "ok") return "text-green-600 dark:text-green-400";
  if (status === "error") return "text-red-600 dark:text-red-400";
  if (status === "skipped") return "text-yellow-600 dark:text-yellow-400";
  return "text-muted-foreground";
}

export function EventLog({ events, running, onClose }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const summary = events.find((e) => e.event === "playbook_done");
  const hasError = events.some((e) => e.event === "error" || e.status === "error");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Playbook Output</span>
          {running && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {!running && summary && (
            <span
              className={cn(
                "text-xs font-medium",
                hasError ? "text-red-500" : "text-green-500",
              )}
            >
              {summary.steps_ok ?? 0} ok / {summary.steps_error ?? 0} error
              {summary.total_duration_ms
                ? ` · ${(summary.total_duration_ms / 1000).toFixed(1)}s`
                : ""}
            </span>
          )}
        </div>
        {!running && events.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="max-h-96 overflow-auto rounded-md border border-border bg-black/90 p-3 font-mono text-xs leading-relaxed"
      >
        {events.length === 0 ? (
          <span className="text-muted-foreground">Waiting for events...</span>
        ) : (
          events.map((e, i) => {
            if (e.event === "error") {
              return (
                <div key={i} className="text-red-400">
                  ERROR: {e.message}
                </div>
              );
            }
            if (e.event === "playbook_start") {
              return (
                <div key={i} className="text-blue-400">
                  ── Start: {e.playbook ?? "<inline>"} v{e.version}
                  {e.dry_run ? " (dry-run)" : ""} ──
                </div>
              );
            }
            if (e.event === "playbook_done") {
              return (
                <div key={i} className="text-blue-400">
                  ── Done: {e.status} ──
                </div>
              );
            }
            if (e.event === "step_done") {
              return (
                <div key={i} className="flex items-start gap-2 text-gray-300">
                  <span className={statusColor(e.status)}>{statusIcon(e.status)}</span>
                  <span className="text-cyan-400">{e.name}</span>
                  {e.duration_ms !== undefined && e.duration_ms > 0 && (
                    <span className="text-gray-500">({e.duration_ms}ms)</span>
                  )}
                  {e.message && (
                    <span className="text-gray-400"> — {e.message}</span>
                  )}
                </div>
              );
            }
            return (
              <div key={i} className="text-gray-500">
                {e.event}: {e.message ?? ""}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}