import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Header } from "./components/Header";
import { InstallDialog } from "./components/InstallDialog";
import { ToastContainer } from "./components/ui/toast";
import { Dashboard } from "./components/dashboard/Dashboard";
import { ServerPanel } from "./components/server/ServerPanel";
import { DatabasePanel } from "./components/database/DatabasePanel";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { DockerPanel } from "./components/docker/DockerPanel";
import { VenvPanel } from "./components/venv/VenvPanel";
import { ReposPanel } from "./components/repos/ReposPanel";
import { EnvPanel } from "./components/env/EnvPanel";
import { PlaybookPanel } from "./components/playbook/PlaybookPanel";
import { useAppStore } from "./store/appStore";
import type { ViewKey } from "./types";

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [preselectVersion, setPreselectVersion] = useState<string | null>(null);

  const fetchAllDashboard = useAppStore((s) => s.fetchAllDashboard);
  const fetchPlatformAndRuntime = useAppStore((s) => s.fetchPlatformAndRuntime);
  const checkUvStatus = useAppStore((s) => s.checkUvStatus);
  const checkOdoodevStatus = useAppStore((s) => s.checkOdoodevStatus);

  useEffect(() => {
    (async () => {
      await fetchPlatformAndRuntime();
      await checkUvStatus();
      await checkOdoodevStatus();
      useAppStore.setState({ firstRunChecked: true });
      await fetchAllDashboard();
    })();
  }, [fetchAllDashboard, fetchPlatformAndRuntime, checkUvStatus, checkOdoodevStatus]);

  const handleNavigate = (view: ViewKey, version?: string) => {
    setActiveView(view);
    if (version) setPreselectVersion(version);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar activeView={activeView} onSelect={setActiveView} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onSelectSettings={() => setActiveView("settings")} />
        <main className="flex-1 overflow-auto">
          {activeView === "dashboard" && <Dashboard onNavigate={handleNavigate} />}
          {activeView === "server" && (
            <ServerPanel preselectVersion={preselectVersion} />
          )}
          {activeView === "database" && (
            <DatabasePanel preselectVersion={preselectVersion} />
          )}
          {activeView === "docker" && <DockerPanel />}
          {activeView === "venv" && <VenvPanel />}
          {activeView === "repos" && <ReposPanel />}
          {activeView === "env" && <EnvPanel />}
          {activeView === "playbook" && <PlaybookPanel />}
          {activeView === "settings" && <SettingsPanel />}
        </main>
      </div>
      <InstallDialog />
      <ToastContainer />
    </div>
  );
}