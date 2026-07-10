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
            "relative px-4 py-2 text-sm font-medium transition-colors",
            tab.active
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
          )}
        >
          {tab.label}
          {tab.active && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
          )}
        </button>
      ))}
    </div>
  );
}