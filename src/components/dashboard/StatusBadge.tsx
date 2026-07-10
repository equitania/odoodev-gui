import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

type StatusType = "ok" | "warn" | "error" | "neutral" | "running" | "stopped" | "disabled";

const STATUS_STYLES: Record<StatusType, string> = {
  ok: "bg-green-500/15 text-green-600 dark:text-green-400",
  warn: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400",
  error: "bg-red-500/15 text-red-600 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
  running: "bg-green-500/15 text-green-600 dark:text-green-400",
  stopped: "bg-muted text-muted-foreground",
  disabled: "bg-muted text-muted-foreground opacity-50",
};

const DOT_STYLES: Record<StatusType, string> = {
  ok: "bg-green-500",
  warn: "bg-yellow-500",
  error: "bg-red-500",
  neutral: "bg-gray-400",
  running: "bg-green-500 animate-pulse",
  stopped: "bg-gray-400",
  disabled: "bg-gray-400",
};

export function StatusBadge({
  status,
  label,
  icon,
  className,
}: {
  status: StatusType;
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", DOT_STYLES[status])} />
      {icon}
      <span>{label}</span>
    </div>
  );
}