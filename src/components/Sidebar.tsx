import { cn } from "../lib/utils";
import { LayoutGrid, Rocket, Database, Container, Package, GitBranch, FileCog, Settings } from "lucide-react";
import type { ViewKey } from "../types";

const NAV_ITEMS: { key: ViewKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "server", label: "Server", icon: Rocket },
  { key: "database", label: "Databases", icon: Database },
  { key: "docker", label: "Docker", icon: Container },
  { key: "venv", label: "Venv", icon: Package },
  { key: "repos", label: "Repos", icon: GitBranch },
  { key: "env", label: "Env", icon: FileCog },
  { key: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({
  activeView,
  onSelect,
}: {
  activeView: ViewKey;
  onSelect: (view: ViewKey) => void;
}) {
  return (
    <aside className="flex w-14 flex-col items-center border-r border-border bg-card py-4">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            title={item.label}
            className={cn(
              "group relative mb-1 flex h-10 w-10 items-center justify-center rounded-lg transition-all active:scale-90",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Icon className="h-5 w-5" />
            {active && (
              <span className="absolute -left-2 top-1/2 h-6 -translate-y-1/2 w-1 rounded-r-full bg-primary" />
            )}
          </button>
        );
      })}
    </aside>
  );
}