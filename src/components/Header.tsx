import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { invokeCmd } from "../lib/tauri";
import { logError } from "../lib/errors";
import { UpdateBadge } from "./UpdateBadge";
import { Settings as SettingsIcon } from "lucide-react";

export function Header({ onSelectSettings }: { onSelectSettings: () => void }) {
  const odoodevInfo = useAppStore((s) => s.odoodevInfo);
  const updateCheck = useAppStore((s) => s.updateCheck);
  const checkOdoodevUpdate = useAppStore((s) => s.checkOdoodevUpdate);
  const [appVersion, setAppVersion] = useState<string>("");

  useEffect(() => {
    invokeCmd<string>("get_app_version").then(setAppVersion).catch(logError("Header: get_app_version"));
    checkOdoodevUpdate();
    const id = setInterval(() => checkOdoodevUpdate(), 300_000);
    return () => clearInterval(id);
  }, [checkOdoodevUpdate]);

  return (
    <header className="flex h-12 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold">odoodev</span>
        {odoodevInfo?.version && (
          <span className="text-xs text-muted-foreground">v{odoodevInfo.version}</span>
        )}
        <span className="text-xs text-muted-foreground">GUI v{appVersion}</span>
      </div>
      <div className="flex items-center gap-2">
        {updateCheck?.update_available && <UpdateBadge />}
        <button
          onClick={onSelectSettings}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}