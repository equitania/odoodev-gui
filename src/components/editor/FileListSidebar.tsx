import { useTranslation } from "react-i18next";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { FileCog, FileKey, FileText, Plus } from "lucide-react";
import type { CuratedFiles } from "../../types";

interface FileListSidebarProps {
  files: CuratedFiles;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onNewPlaybook: () => void;
}

function FileButton({
  label,
  path,
  exists,
  selected,
  icon: Icon,
  onSelect,
}: {
  label: string;
  path: string;
  exists: boolean;
  selected: boolean;
  icon: typeof FileText;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      onClick={() => exists && onSelect(path)}
      disabled={!exists}
      title={path}
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

      {files.env_files.length > 0 && (
        <div className="space-y-1">
          <p className="px-2 text-xs font-medium uppercase text-muted-foreground">
            {t("editor.sectionEnvFiles")}
          </p>
          {files.env_files.map((entry) => (
            <FileButton
              key={entry.path}
              label={entry.label}
              path={entry.path}
              exists={entry.exists}
              selected={selectedPath === entry.path}
              icon={FileKey}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

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
