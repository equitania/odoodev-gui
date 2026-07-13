import { cn } from "../lib/utils";
import { LayoutGrid, Rocket, Database, Container, Package, GitBranch, FileCog, Play, FileCode, Wand2, ArrowRightLeft, Stethoscope, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ViewKey } from "../types";

const NAV_ITEMS: { key: ViewKey; labelKey: string; icon: typeof LayoutGrid }[] = [
  { key: "dashboard", labelKey: "sidebar.dashboard", icon: LayoutGrid },
  { key: "server", labelKey: "sidebar.server", icon: Rocket },
  { key: "database", labelKey: "sidebar.databases", icon: Database },
  { key: "docker", labelKey: "sidebar.docker", icon: Container },
  { key: "venv", labelKey: "sidebar.venv", icon: Package },
  { key: "repos", labelKey: "sidebar.repos", icon: GitBranch },
  { key: "env", labelKey: "sidebar.env", icon: FileCog },
  { key: "playbook", labelKey: "sidebar.playbook", icon: Play },
  { key: "editor", labelKey: "sidebar.editor", icon: FileCode },
  { key: "init", labelKey: "sidebar.init", icon: Wand2 },
  { key: "migrate", labelKey: "sidebar.migrate", icon: ArrowRightLeft },
  { key: "doctor", labelKey: "sidebar.doctor", icon: Stethoscope },
  { key: "settings", labelKey: "sidebar.settings", icon: Settings },
];

export function Sidebar({
  activeView,
  onSelect,
}: {
  activeView: ViewKey;
  onSelect: (view: ViewKey) => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-14 flex-col items-center border-r border-border bg-card py-4">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = activeView === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onSelect(item.key)}
            title={t(item.labelKey)}
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