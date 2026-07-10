import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { Button } from "./ui/button";
import { ChevronDown } from "lucide-react";

export function UpdateBadge() {
  const updateCheck = useAppStore((s) => s.updateCheck);
  const updateOdoodev = useAppStore((s) => s.updateOdoodev);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  if (!updateCheck?.update_available) return null;

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await updateOdoodev();
    } finally {
      setUpdating(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md bg-blue-500/15 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400"
        title={`Current: v${updateCheck.installed_version} | Latest: v${updateCheck.latest_version}`}
      >
        <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
        Update available
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 rounded-md border border-border bg-popover p-2 shadow-md">
          <p className="mb-2 text-xs text-muted-foreground">
            Current: v{updateCheck.installed_version} → Latest: v{updateCheck.latest_version}
          </p>
          <Button size="sm" className="w-full" onClick={handleUpdate} disabled={updating}>
            {updating ? "Updating..." : `Update odoodev to v${updateCheck.latest_version}`}
          </Button>
        </div>
      )}
    </div>
  );
}