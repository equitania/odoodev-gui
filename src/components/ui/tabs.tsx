import { type ReactNode } from "react";
import { cn } from "../../lib/utils";

interface TabsProps {
  tabs: { key: string; label: ReactNode; active: boolean }[];
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, onChange, className }: TabsProps) {
  return (
    <div className={cn("flex border-b border-border", className)}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors",
            tab.active
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}