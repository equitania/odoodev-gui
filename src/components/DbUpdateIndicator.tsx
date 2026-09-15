import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { finishedCount, isActive } from "../lib/dbUpdateReducer";
import { useDbUpdateStore } from "../store/dbUpdateStore";

/** One chip per version with a running `db update`; click jumps to its database view. */
export function DbUpdateIndicator({ onOpen }: { onOpen: (version: string) => void }) {
  const { t } = useTranslation();
  const runs = useDbUpdateStore((s) => s.runs);
  const active = Object.entries(runs)
    .filter(([, run]) => isActive(run))
    .sort(([a], [b]) => a.localeCompare(b));
  if (active.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {active.map(([version, run]) => (
        <button
          key={version}
          onClick={() => onOpen(version)}
          className="flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
        >
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("database.updateRunningIndicator", { version, done: finishedCount(run), total: run.order.length })}
        </button>
      ))}
    </div>
  );
}
