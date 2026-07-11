import { Apple, Container, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ContainerRuntime, RuntimeInfo } from "../../types";

export function RuntimeBanner({ info }: { info: RuntimeInfo | null }) {
  if (!info) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Detecting runtime...</span>
      </div>
    );
  }

  const runtime = info.runtime;
  const isApple = runtime === "apple";
  const isDocker = runtime === "docker";
  const isNone = runtime === "none";

  const configLabel = info.configured
    ? `configured: ${info.configured}`
    : "auto-detected";

  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-lg border p-3",
        isApple && "border-blue-500/30 bg-blue-500/10",
        isDocker && "border-cyan-500/30 bg-cyan-500/10",
        isNone && "border-red-500/30 bg-red-500/10",
      )}
    >
      <div className="flex items-center gap-3">
        {isApple && <Apple className="h-5 w-5 text-blue-500" />}
        {isDocker && <Container className="h-5 w-5 text-cyan-500" />}
        {isNone && <AlertCircle className="h-5 w-5 text-red-500" />}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              {isApple && "Apple Container"}
              {isDocker && "Docker"}
              {isNone && "No runtime"}
            </span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs",
                isApple && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                isDocker && "bg-cyan-500/20 text-cyan-600 dark:text-cyan-400",
                isNone && "bg-red-500/20 text-red-600 dark:text-red-400",
              )}
            >
              {configLabel}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {isApple && "Native macOS Linux containers on Apple Silicon"}
            {isDocker && "Docker Engine / Docker Desktop"}
            {isNone && "Neither Docker nor Apple Container found in PATH"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {info.available.map((rt) => (
          <span
            key={rt}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs",
              rt === runtime
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground",
            )}
          >
            {rt === "apple" ? "container" : "docker"}
          </span>
        ))}
      </div>
    </div>
  );
}

export function runtimeLabel(rt: ContainerRuntime): string {
  if (rt === "apple") return "Apple Container";
  if (rt === "docker") return "Docker";
  return "None";
}

export function RuntimeDot({ runtime }: { runtime: ContainerRuntime }) {
  const color =
    runtime === "apple"
      ? "bg-blue-500"
      : runtime === "docker"
        ? "bg-cyan-500"
        : "bg-red-500";
  return <span className={cn("h-2 w-2 rounded-full", color)} />;
}