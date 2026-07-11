import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { useInitProgress } from "../../hooks/useInitProgress";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import {
  Rocket,
  Settings2,
  Loader2,
  Terminal,
  CheckCircle2,
} from "lucide-react";
import { VERSION_COLORS, VERSION_BG } from "../../lib/constants";
import type { VersionInfo } from "../../types";

type Mode = "init" | "setup";

export function InitPanel() {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [mode, setMode] = useState<Mode>("init");
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [skipRepos, setSkipRepos] = useState(false);
  const [skipDocker, setSkipDocker] = useState(false);
  const [resetConfig, setResetConfig] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  const initProgress = useInitProgress();

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => {
        setVersions(v);
        const keys = Object.keys(v).sort();
        if (keys.length > 0) setSelectedVersion(keys[0]);
      })
      .catch(logError("InitPanel: get_versions"));
  }, []);

  const handleRun = async () => {
    if (mode === "init" && !selectedVersion) return;
    setShowOutput(true);
    const label =
      mode === "init"
        ? `Initializing v${selectedVersion}...`
        : resetConfig
          ? "Resetting odoodev config..."
          : "Running setup...";
    const tid = toastLoading(label);
    const success = await initProgress.start(
      mode,
      mode === "init" ? selectedVersion : null,
      skipRepos,
      skipDocker,
      resetConfig,
    );
    if (success) {
      toastUpdate(tid, "success", mode === "init" ? `v${selectedVersion} initialized` : "Setup completed");
    } else {
      toastUpdate(tid, "error", `${mode} failed`, "Check output below");
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <h1 className="text-2xl font-semibold">{t("init.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("init.description")}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        <div className="space-y-2">
          <Label>{t("init.mode")}</Label>
          <div className="flex gap-2">
            <button
              onClick={() => setMode("init")}
              className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all ${
                mode === "init"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              <Rocket className="h-4 w-4" />
              {t("init.initVersion")}
            </button>
            <button
              onClick={() => setMode("setup")}
              className={`flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all ${
                mode === "setup"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              <Settings2 className="h-4 w-4" />
              {t("init.setupConfig")}
            </button>
          </div>
        </div>

        {mode === "init" && (
          <>
            <div className="space-y-2">
              <Label>Version</Label>
              <div className="flex gap-2">
                {versions &&
                  Object.keys(versions)
                    .sort()
                    .map((ver) => (
                      <button
                        key={ver}
                        onClick={() => setSelectedVersion(ver)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-bold transition-all ${
                          selectedVersion === ver
                            ? `border-primary ${VERSION_COLORS[ver] ?? ""} ${VERSION_BG[ver] ?? ""}`
                            : "border-border text-muted-foreground hover:bg-accent"
                        }`}
                      >
                        v{ver}
                      </button>
                    ))}
              </div>
              {selectedVersion && versions && (
                <p className="text-xs text-muted-foreground">
                  Base: <span className="font-mono">{versions[selectedVersion].base}</span>
                  {" | "}
                  Python {versions[selectedVersion].python}
                  {" | "}
                  PostgreSQL {versions[selectedVersion].postgres}
                </p>
              )}
            </div>

            <div className="space-y-3">
              <Label>{t("init.options")}</Label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={skipRepos}
                  onChange={(v) => setSkipRepos(v)}
                />
                <div>
                  <div className="text-sm font-medium">{t("init.skipRepos")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("init.skipReposDesc")}
                  </div>
                </div>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={skipDocker}
                  onChange={(v) => setSkipDocker(v)}
                />
                <div>
                  <div className="text-sm font-medium">{t("init.skipDocker")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("init.skipDockerDesc")}
                  </div>
                </div>
              </label>
            </div>
          </>
        )}

        {mode === "setup" && (
          <div className="space-y-3">
            <Label>{t("init.options")}</Label>
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="text-sm">
                {t("init.configPath")}
              </div>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <Checkbox
                checked={resetConfig}
                onChange={(v) => setResetConfig(v)}
              />
              <div>
                <div className="text-sm font-medium">{t("init.resetToDefaults")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("init.resetToDefaultsDesc")}
                </div>
              </div>
            </label>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={handleRun}
            disabled={initProgress.running || (mode === "init" && !selectedVersion)}
          >
            {initProgress.running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : mode === "init" ? (
              <Rocket className="h-4 w-4" />
            ) : (
              <Settings2 className="h-4 w-4" />
            )}
            {mode === "init" ? `Initialize v${selectedVersion}` : resetConfig ? t("init.resetConfig") : t("init.runSetup")}
          </Button>
        </div>

        {showOutput && (initProgress.running || initProgress.lines.length > 0) && (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">
                  {mode === "init" ? `init v${selectedVersion}` : "setup"}
                </span>
                {initProgress.running ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
              </div>
              {!initProgress.running && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowOutput(false);
                    initProgress.clear();
                  }}
                >
                  Close
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-auto rounded-md bg-black/90 p-3 font-mono text-xs leading-relaxed">
              {initProgress.lines.map((line, i) => {
                const isOk = line.includes("[OK]");
                const isWarn = line.includes("[WARN]");
                const isInfo = line.includes("[INFO]");
                const isError = line.includes("[ERROR]") || line.includes("Error:");
                return (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all ${
                      isOk
                        ? "text-green-400"
                        : isWarn
                          ? "text-yellow-400"
                          : isError
                            ? "text-red-400"
                            : isInfo
                              ? "text-blue-400"
                              : "text-gray-300"
                    }`}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}