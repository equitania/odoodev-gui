import { useEffect, useState } from "react";
import { useAppStore } from "../../store/appStore";
import { invokeCmd } from "../../lib/tauri";
import { logError } from "../../lib/errors";
import { VersionCard } from "./VersionCard";
import { RuntimeServiceBanner } from "../docker/RuntimeServiceBanner";
import type { CuratedFiles, ViewKey } from "../../types";

export function Dashboard({
  onNavigate,
}: {
  onNavigate: (view: ViewKey, version?: string, editorPath?: string) => void;
}) {
  const versions = useAppStore((s) => s.versions);
  const activeVersions = useAppStore((s) => s.activeVersions);
  const dashboardLoading = useAppStore((s) => s.dashboardLoading);
  const fetchAllDashboard = useAppStore((s) => s.fetchAllDashboard);
  const [curatedFiles, setCuratedFiles] = useState<CuratedFiles | null>(null);

  useEffect(() => {
    fetchAllDashboard();
    const id = setInterval(() => fetchAllDashboard(), 30_000);
    return () => clearInterval(id);
  }, [fetchAllDashboard]);

  useEffect(() => {
    invokeCmd<CuratedFiles>("curated_files")
      .then(setCuratedFiles)
      .catch(logError("Dashboard: curated_files"));
  }, []);

  if (dashboardLoading && !versions) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg border bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!versions || Object.keys(versions).length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="mb-2 text-lg">No versions configured</p>
          <p className="text-sm">Run <code className="rounded bg-muted px-1 py-0.5">odoodev setup</code> to get started.</p>
        </div>
      </div>
    );
  }

  const sortedKeys = Object.keys(versions).sort();

  return (
    <div className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <div className="mb-4 empty:hidden">
        <RuntimeServiceBanner />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sortedKeys.map((ver) => (
          <VersionCard
            key={ver}
            version={ver}
            info={versions[ver]}
            active={activeVersions.includes(ver)}
            fileGroup={curatedFiles?.version_groups.find((g) => g.version === ver) ?? null}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}