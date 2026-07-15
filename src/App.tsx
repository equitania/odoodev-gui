import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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

// Lazy: pulls in the (large) Monaco bundle only when the editor view opens.
const EditorPanel = lazy(() =>
  import("./components/editor/EditorPanel").then((m) => ({ default: m.EditorPanel })),
);
import { InitPanel } from "./components/init/InitPanel";
import { MigratePanel } from "./components/migrate/MigratePanel";
import { DoctorPanel } from "./components/doctor/DoctorPanel";
import { useAppStore } from "./store/appStore";
import { notifyIfAppUpdate } from "./lib/appUpdate";
import type { ViewKey } from "./types";

export default function App() {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [preselectVersion, setPreselectVersion] = useState<string | null>(null);
  const [pendingEditorPath, setPendingEditorPath] = useState<string | null>(null);

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
      void notifyIfAppUpdate();
    })();
  }, [fetchAllDashboard, fetchPlatformAndRuntime, checkUvStatus, checkOdoodevStatus]);

  const handleNavigate = (view: ViewKey, version?: string, editorPath?: string) => {
    setActiveView(view);
    if (version) setPreselectVersion(version);
    setPendingEditorPath(editorPath ?? null);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar activeView={activeView} onSelect={(view) => handleNavigate(view)} />
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
          {activeView === "docker" && <DockerPanel onNavigate={handleNavigate} />}
          {activeView === "venv" && <VenvPanel />}
          {activeView === "repos" && <ReposPanel onNavigate={handleNavigate} />}
          {activeView === "env" && <EnvPanel onNavigate={handleNavigate} />}
          {activeView === "playbook" && <PlaybookPanel onNavigate={handleNavigate} />}
          {activeView === "editor" && (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              }
            >
              <EditorPanel initialFilePath={pendingEditorPath} />
            </Suspense>
          )}
          {activeView === "init" && <InitPanel />}
          {activeView === "migrate" && <MigratePanel />}
          {activeView === "doctor" && <DoctorPanel />}
          {activeView === "settings" && <SettingsPanel />}
        </main>
      </div>
      <InstallDialog />
      <ToastContainer />
    </div>
  );
}