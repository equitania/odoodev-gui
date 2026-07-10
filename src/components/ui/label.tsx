import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn("text-sm font-medium leading-none", className)}>{children}</label>;
}