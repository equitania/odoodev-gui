import { useState, useEffect } from "react";
import { Tabs } from "../ui/tabs";
import { ServerConfig } from "./ServerConfig";
import { LogViewer } from "./LogViewer";
import { useAppStore } from "../../store/appStore";
import { useLogStream } from "../../hooks/useLogStream";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import type { StartServerArgs } from "../../types";

export function ServerPanel({ preselectVersion }: { preselectVersion: string | null }) {
  const versions = useAppStore((s) => s.versions);
  const servers = useAppStore((s) => s.servers);
  const startServer = useAppStore((s) => s.startServer);
  const stopServer = useAppStore((s) => s.stopServer);
  const clearLog = useAppStore((s) => s.clearLog);
  const initServerTab = useAppStore((s) => s.initServerTab);

  const versionKeys = versions ? Object.keys(versions).sort() : [];

  const [activeTab, setActiveTab] = useState<string>("");
  const [serverBusy, setServerBusy] = useState(false);

  useEffect(() => {
    if (preselectVersion && versionKeys.includes(preselectVersion)) {
      initServerTab(preselectVersion);
      setActiveTab(preselectVersion);
    } else if (versionKeys.length > 0 && !versionKeys.includes(activeTab)) {
      setActiveTab(versionKeys[0]);
    }
  }, [preselectVersion, versionKeys]);

  const activeVersion = activeTab || versionKeys[0] || "";
  useLogStream(activeVersion);

  const handleStart = async (args: StartServerArgs) => {
    setServerBusy(true);
    const tid = toastLoading(`Starting server v${args.version}...`);
    try {
      await startServer(args);
      toastUpdate(tid, "success", `Server v${args.version} started`);
    } catch (e) {
      toastUpdate(tid, "error", `Failed to start server v${args.version}`, String(e));
    } finally {
      setServerBusy(false);
    }
  };

  const handleStop = async (version: string) => {
    setServerBusy(true);
    const tid = toastLoading(`Stopping server v${version}...`);
    try {
      await stopServer(version);
      toastUpdate(tid, "success", `Server v${version} stopped`);
    } catch (e) {
      toastUpdate(tid, "error", `Failed to stop server v${version}`, String(e));
    } finally {
      setServerBusy(false);
    }
  };

  const handleRestart = async (version: string) => {
    setServerBusy(true);
    const tid = toastLoading(`Restarting server v${version}...`);
    try {
      await stopServer(version, true, false);
      const server = servers[version];
      if (server?.config) {
        await startServer(server.config);
      }
      toastUpdate(tid, "success", `Server v${version} restarted`);
    } catch (e) {
      toastUpdate(tid, "error", `Failed to restart server v${version}`, String(e));
    } finally {
      setServerBusy(false);
    }
  };

  if (versionKeys.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No versions configured
      </div>
    );
  }

  const tabs = versionKeys.map((key) => ({
    key,
    label: (
      <span className="flex items-center gap-2">
        v{key}
        {servers[key]?.status?.running ? (
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-gray-400" />
        )}
      </span>
    ),
    active: activeVersion === key,
  }));

  const currentServer = activeVersion ? servers[activeVersion] : null;
  const isRunning = currentServer?.status?.running ?? false;

  return (
    <div className="flex h-full flex-col">
      <Tabs tabs={tabs} onChange={setActiveTab} />
      {activeVersion && (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-96 shrink-0 overflow-auto border-r border-border p-3">
            <ServerConfig
              version={activeVersion}
              running={isRunning}
              busy={serverBusy}
              onStart={handleStart}
              onStop={() => handleStop(activeVersion)}
              onRestart={() => handleRestart(activeVersion)}
            />
          </div>
          <div className="flex-1 overflow-hidden">
            <LogViewer
              entries={currentServer?.logBuffer ?? []}
              onClear={() => clearLog(activeVersion)}
            />
          </div>
        </div>
      )}
    </div>
  );
}