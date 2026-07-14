import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { useAppStore } from "../../store/appStore";
import {
  Container,
  Database,
  FileClock,
  FileCode,
  FileCog,
  FileKey,
  FileText,
  Package,
  Plus,
} from "lucide-react";
import type { CuratedFiles, VersionFileRole } from "../../types";

interface FileListSidebarProps {
  files: CuratedFiles;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNewPlaybook: () => void;
}

const ROLE_ICONS: Record<VersionFileRole, typeof FileText> = {
  env: FileKey,
  compose: Container,
  requirements: Package,
  repos_yaml: FileText,
  postgresql_conf: Database,
  template_conf: FileCode,
  generated_conf: FileClock,
};

function FileButton({
  label,
  path,
  exists,
  selected,
  icon: Icon,
  hint,
  onSelect,
}: {
  label: string;
  path: string;
  exists: boolean;
  selected: boolean;
  icon: typeof FileText;
  hint?: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      onClick={() => exists && onSelect(path)}
      disabled={!exists}
      title={hint ? `${path}\n${hint}` : path}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        selected
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        !exists && "cursor-not-allowed opacity-50",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function FileListSidebar({
  files,
  selectedPath,
  onSelect,
  onNewPlaybook,
}: FileListSidebarProps) {
  const { t } = useTranslation();
  const runtime = useAppStore((s) => s.runtime);

  return (
    <div className="flex h-full w-56 shrink-0 flex-col gap-4 overflow-auto border-r border-border p-3">
      <div className="space-y-1">
        <p className="px-2 text-xs font-medium uppercase text-muted-foreground">
          {t("editor.sectionConfig")}
        </p>
        <FileButton
          label={files.config.label}
          path={files.config.path}
          exists={files.config.exists}
          selected={selectedPath === files.config.path}
          icon={FileCog}
          onSelect={onSelect}
        />
      </div>

      {files.version_groups.map((group) => (
        <div key={group.version} className="space-y-1">
          <p className="px-2 text-xs font-medium uppercase text-muted-foreground">
            {t("editor.sectionVersionFiles", { version: group.version })}
          </p>
          {group.entries
            // docker-compose.yml only matters when PostgreSQL runs under Docker
            .filter((entry) => entry.role !== "compose" || runtime === "docker")
            .map((entry) => (
              <FileButton
                key={entry.path}
                label={entry.label}
                path={entry.path}
                exists={entry.exists}
                selected={selectedPath === entry.path}
                icon={ROLE_ICONS[entry.role] ?? FileText}
                hint={entry.hint}
                onSelect={onSelect}
              />
            ))}
        </div>
      ))}

      <div className="space-y-1">
        <div className="flex items-center justify-between px-2">
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {t("editor.sectionPlaybooks")}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            title={t("editor.newPlaybook")}
            onClick={onNewPlaybook}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {files.playbooks.map((pb) => (
          <FileButton
            key={pb.path}
            label={pb.name}
            path={pb.path}
            exists={true}
            selected={selectedPath === pb.path}
            icon={FileText}
            onSelect={onSelect}
          />
        ))}
        {files.playbooks.length === 0 && (
          <p className="px-2 text-xs text-muted-foreground">
            {t("editor.noPlaybooks")}
          </p>
        )}
      </div>
    </div>
  );
}
