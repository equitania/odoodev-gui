import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { useReposProgress } from "../../hooks/useReposProgress";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { ReposCard } from "./ReposCard";
import { ReposProgress } from "./ReposProgress";
import type { VersionInfo } from "../../types";

export function ReposPanel() {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [activeVersions, setActiveVersions] = useState<string[]>([]);
  const [busyVersion, setBusyVersion] = useState<string | null>(null);
  const [progressVersion, setProgressVersion] = useState<string | null>(null);
  const [progressCommand, setProgressCommand] = useState<string>("");

  const repos = useReposProgress();

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => setVersions(v))
      .catch(logError("ReposPanel: load"));
    invokeCmd<string[]>("get_active_versions")
      .then(setActiveVersions)
      .catch(logError("ReposPanel: load"));
  }, []);

  const execute = async (
    version: string,
    command: "repos" | "pull",
    configOnly: boolean = false,
    noConfig: boolean = false,
  ) => {
    setBusyVersion(version);
    setProgressVersion(version);
    setProgressCommand(command === "repos" ? (configOnly ? "repos --config-only" : "repos") : "pull");
    const label = command === "repos"
      ? configOnly ? `Regenerating config for v${version}...`
      : `Running repos for v${version}...`
      : `Pulling repos for v${version}...`;
    const tid = toastLoading(label);
    const success = await repos.start(version, command, configOnly, noConfig);
    if (success) {
      toastUpdate(tid, "success", `${command} completed for v${version}`);
    } else {
      toastUpdate(tid, "error", `${command} failed for v${version}`, "Check output below");
    }
    setBusyVersion(null);
  };

  if (!versions) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const sortedKeys = Object.keys(versions).sort();

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("repos.title")}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("repos.description")}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sortedKeys.map((ver) => (
            <ReposCard
              key={ver}
              version={ver}
              info={versions[ver]}
              active={activeVersions.includes(ver)}
              busy={busyVersion === ver}
              onRepos={() => execute(ver, "repos")}
              onPull={() => execute(ver, "pull")}
              onConfigOnly={() => execute(ver, "repos", true)}
            />
          ))}
        </div>

        {progressVersion && (repos.running || repos.lines.length > 0) && (
          <ReposProgress
            version={progressVersion}
            command={progressCommand}
            lines={repos.lines}
            running={repos.running}
            onClose={() => {
              setProgressVersion(null);
              repos.clear();
            }}
          />
        )}
      </div>
    </div>
  );
}