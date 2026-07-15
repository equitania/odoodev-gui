import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { usePolling } from "../../hooks/usePolling";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { Button } from "../ui/button";
import { POLL_INTERVALS } from "../../lib/constants";
import { CircleAlert, Loader2, Play } from "lucide-react";
import type { OpResult, RuntimeInfo } from "../../types";

/**
 * Self-contained warning banner: visible only while the container runtime's
 * backend service is down (Apple Container apiserver / Docker daemon), with
 * a one-click start (`container system start` / `systemctl start docker` /
 * Docker Desktop launch). Renders nothing when everything is fine.
 */
export function RuntimeServiceBanner() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<RuntimeInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    invokeCmd<RuntimeInfo>("get_runtime_info")
      .then(setInfo)
      .catch(() => {});
  }, []);

  usePolling(refresh, POLL_INTERVALS.docker, true);

  if (!info || info.daemon_running !== false) return null;

  const isApple = info.runtime === "apple";

  const handleStart = async () => {
    setBusy(true);
    const tid = toastLoading(t("docker.serviceStarting"));
    try {
      const result = await invokeCmd<OpResult>("runtime_system_start", {
        runtime: info.runtime,
      });
      if (result.success) {
        toastUpdate(tid, "success", t("docker.serviceStarted"));
      } else {
        toastUpdate(tid, "error", t("docker.serviceStartFailed"), result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", t("docker.serviceStartFailed"), String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex items-center gap-3">
        <CircleAlert className="h-5 w-5 text-amber-500" />
        <div>
          <div className="text-sm font-semibold">{t("docker.serviceDown")}</div>
          <div className="text-xs text-muted-foreground">
            {isApple ? t("docker.serviceDownApple") : t("docker.serviceDownDocker")}
          </div>
        </div>
      </div>
      <Button size="sm" onClick={handleStart} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {t("docker.startService")}
      </Button>
    </div>
  );
}
