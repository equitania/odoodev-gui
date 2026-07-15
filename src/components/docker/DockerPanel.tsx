import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { usePolling } from "../../hooks/usePolling";
import { useDockerLogs } from "../../hooks/useDockerLogs";
import { useDockerBench } from "../../hooks/useDockerBench";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { RuntimeBanner } from "./RuntimeBanner";
import { RuntimeServiceBanner } from "./RuntimeServiceBanner";
import { ContainerCard } from "./ContainerCard";
import { DockerLogViewer } from "./DockerLogViewer";
import { BenchPanel } from "./BenchPanel";
import { Tabs } from "../ui/tabs";
import { POLL_INTERVALS } from "../../lib/constants";
import type {
  ContainerInfo,
  CuratedFiles,
  DockerStatus,
  RuntimeInfo,
  VersionInfo,
  ViewKey,
} from "../../types";

type PanelMode = "overview" | "logs" | "bench";

interface DockerPanelProps {
  onNavigate: (view: ViewKey, version?: string, editorPath?: string) => void;
}

export function DockerPanel({ onNavigate }: DockerPanelProps) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null);
  const [curatedFiles, setCuratedFiles] = useState<CuratedFiles | null>(null);
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [dockerStatuses, setDockerStatuses] = useState<Record<string, DockerStatus>>({});
  const [busyVersion, setBusyVersion] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<string>("");
  const [mode, setMode] = useState<PanelMode>("overview");

  const dockerLogs = useDockerLogs();
  const dockerBench = useDockerBench();

  // The benchmark compares Docker vs Apple Container PostgreSQL — it only
  // makes sense on macOS with the `container` binary installed ("apple" is
  // only ever reported as available there).
  const appleAvailable = runtimeInfo?.available.includes("apple") ?? false;

  useEffect(() => {
    if (mode === "bench" && !appleAvailable) setMode("overview");
  }, [mode, appleAvailable]);

  useEffect(() => {
    invokeCmd<RuntimeInfo>("get_runtime_info")
      .then(setRuntimeInfo)
      .catch(logError("DockerPanel: get_runtime_info"));
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => {
        setVersions(v);
        const keys = Object.keys(v).sort();
        if (keys.length > 0) setActiveVersion(keys[0]);
      })
      .catch(logError("DockerPanel: get_versions"));
    invokeCmd<CuratedFiles>("curated_files")
      .then(setCuratedFiles)
      .catch(logError("DockerPanel: curated_files"));
  }, []);

  const composePathFor = useCallback(
    (version: string): string | null => {
      const group = curatedFiles?.version_groups.find((g) => g.version === version);
      const entry = group?.entries.find((e) => e.role === "compose");
      return entry?.exists ? entry.path : null;
    },
    [curatedFiles],
  );

  usePolling(
    () => {
      invokeCmd<ContainerInfo[]>("list_containers")
        .then(setContainers)
        .catch(() => {});
      if (runtimeInfo) {
        invokeCmd<RuntimeInfo>("get_runtime_info")
          .then(setRuntimeInfo)
          .catch(() => {});
      }
    },
    POLL_INTERVALS.docker,
    true,
  );

  usePolling(
    () => {
      if (!versions) return;
      const promises = Object.keys(versions).map(async (ver) => {
        try {
          const status = await invokeCmd<DockerStatus>("get_docker_status", {
            version: ver,
            versions: { [ver]: versions[ver] },
          });
          return [ver, status] as const;
        } catch {
          return null;
        }
      });
      Promise.all(promises).then((results) => {
        const map: Record<string, DockerStatus> = {};
        for (const r of results) {
          if (r) map[r[0]] = r[1];
        }
        setDockerStatuses(map);
      });
    },
    POLL_INTERVALS.docker,
    !!versions,
  );

  const findContainer = useCallback(
    (version: string): ContainerInfo | null => {
      if (!versions) return null;
      const dbPort = versions[version]?.ports.db;
      if (!dbPort) return null;
      return containers.find((c) => c.host_port === dbPort) ?? null;
    },
    [containers, versions],
  );

  const handleUp = async (version: string) => {
    setBusyVersion(version);
    const tid = toastLoading(`Starting PostgreSQL for v${version}...`);
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "docker_up",
        { version, runtime: dockerStatuses[version]?.runtime },
      );
      if (result.success) {
        toastUpdate(tid, "success", `PostgreSQL started for v${version}`);
      } else {
        toastUpdate(tid, "error", `Failed to start PostgreSQL`, result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", `Failed to start PostgreSQL`, String(e));
    } finally {
      setBusyVersion(null);
    }
  };

  const handleDown = async (version: string) => {
    setBusyVersion(version);
    const tid = toastLoading(`Stopping PostgreSQL for v${version}...`);
    try {
      const result = await invokeCmd<{ success: boolean; error: string | null }>(
        "docker_down",
        { version, runtime: dockerStatuses[version]?.runtime },
      );
      if (result.success) {
        toastUpdate(tid, "success", `PostgreSQL stopped for v${version}`);
      } else {
        toastUpdate(tid, "error", `Failed to stop PostgreSQL`, result.error ?? "");
      }
    } catch (e) {
      toastUpdate(tid, "error", `Failed to stop PostgreSQL`, String(e));
    } finally {
      setBusyVersion(null);
    }
  };

  const handleLogs = (version: string) => {
    setMode("logs");
    setActiveVersion(version);
    dockerLogs.start(version, dockerStatuses[version]?.runtime, 200);
  };

  const handleBench = (version: string) => {
    setMode("bench");
    setActiveVersion(version);
    dockerBench.clear();
  };

  if (!versions) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("common.loading")}
      </div>
    );
  }

  const sortedKeys = Object.keys(versions).sort();
  const currentRuntime = dockerStatuses[activeVersion]?.runtime ?? runtimeInfo?.runtime ?? "none";

  const tabs = sortedKeys.map((key) => ({
    key,
    label: (
      <span className="flex items-center gap-2">
        v{key}
        {dockerStatuses[key]?.running ? (
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-gray-400" />
        )}
      </span>
    ),
    active: activeVersion === key,
  }));

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t("docker.title")}</h1>
          <div className="flex gap-1">
            {(["overview", "logs", ...(appleAvailable ? ["bench"] : [])] as PanelMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-all ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {m === "overview" ? t("docker.overview") : m === "logs" ? t("docker.logs") : t("docker.benchmark")}
              </button>
            ))}
          </div>
        </div>
        <RuntimeBanner info={runtimeInfo} />
        <RuntimeServiceBanner />
      </div>

      {mode === "overview" && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sortedKeys.map((ver) => (
              <ContainerCard
                key={ver}
                version={ver}
                info={versions[ver]}
                dockerStatus={dockerStatuses[ver] ?? null}
                container={findContainer(ver)}
                busy={busyVersion === ver}
                onUp={() => handleUp(ver)}
                onDown={() => handleDown(ver)}
                onLogs={() => handleLogs(ver)}
                benchAvailable={appleAvailable}
                onBench={() => handleBench(ver)}
                composePath={composePathFor(ver)}
                onEditCompose={(path) => onNavigate("editor", ver, path)}
              />
            ))}
          </div>
        </div>
      )}

      {mode === "logs" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <Tabs tabs={tabs} onChange={(k) => { setActiveVersion(k); dockerLogs.start(k, dockerStatuses[k]?.runtime, 200); }} />
          <div className="flex-1 overflow-hidden">
            <DockerLogViewer
              lines={dockerLogs.lines}
              listening={dockerLogs.listening}
              onClear={dockerLogs.clear}
              onStop={dockerLogs.stop}
            />
          </div>
        </div>
      )}

      {mode === "bench" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <Tabs tabs={tabs} onChange={(k) => { setActiveVersion(k); dockerBench.clear(); }} />
          <div className="flex-1 overflow-hidden">
            <BenchPanel
              lines={dockerBench.lines}
              running={dockerBench.running}
              runtime={currentRuntime}
              onStart={(rt, dur, sc) => dockerBench.start(activeVersion, rt, dur, sc)}
            />
          </div>
        </div>
      )}
    </div>
  );
}