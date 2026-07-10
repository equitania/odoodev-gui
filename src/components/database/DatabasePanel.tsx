import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Input } from "../ui/input";
import { invokeCmd } from "../../lib/tauri";
import { useAppStore } from "../../store/appStore";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import type { DbListResponse, OpResult, VersionsResponse } from "../../types";
import { BackupDialog } from "./BackupDialog";
import { RestoreDialog } from "./RestoreDialog";
import { DropConfirmDialog } from "./DropConfirmDialog";
import { OperationProgress } from "./OperationProgress";
import { RefreshCw, HardDriveDownload, HardDriveUpload, Trash2, Copy, Pencil, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export function DatabasePanel({ preselectVersion }: { preselectVersion: string | null }) {
  const runtime = useAppStore((s) => s.runtime);
  const [versions, setVersions] = useState<VersionsResponse | null>(null);
  const [versionKeys, setVersionKeys] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [dbList, setDbList] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [backupTarget, setBackupTarget] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [progressTitle, setProgressTitle] = useState("");
  const [progressEvent, setProgressEvent] = useState("");
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    invokeCmd<VersionsResponse>("get_versions")
      .then((v) => {
        setVersions(v);
        setVersionKeys(Object.keys(v).sort());
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (preselectVersion) setSelectedVersion(preselectVersion);
    else if (versionKeys.length > 0 && !selectedVersion) setSelectedVersion(versionKeys[0]);
  }, [preselectVersion, versionKeys]);

  const fetchDatabases = async () => {
    if (!selectedVersion) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await invokeCmd<DbListResponse>("get_databases", { version: selectedVersion });
      setDbList(resp.databases);
    } catch (e) {
      setDbList([]);
      const msg = String(e);
      if (msg.includes("not accessible") || msg.includes("connection") || msg.includes("Connection")) {
        setError("PostgreSQL is not running. Start the container first.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
  }, [selectedVersion]);

  const setDbAction = (name: string, busy: boolean) => {
    setActionLoading((prev) => ({ ...prev, [name]: busy }));
  };

  const handleDrop = async (name: string) => {
    setDbAction(name, true);
    const tid = toastLoading(`Dropping database '${name}'...`);
    setDropTarget(null);
    setProgressTitle(`Drop: ${name}`);
    setProgressEvent("drop-progress");
    setShowProgress(true);
    try {
      const result = await invokeCmd<OpResult>("drop_db", { version: selectedVersion, name, terminateConnections: true });
      if (result.success) {
        toastUpdate(tid, "success", `Database '${name}' dropped`);
      } else {
        toastUpdate(tid, "error", `Failed to drop '${name}'`, result.error ?? "");
      }
      await fetchDatabases();
    } catch (e) {
      toastUpdate(tid, "error", `Failed to drop '${name}'`, String(e));
    } finally {
      setDbAction(name, false);
    }
  };

  const handleCopy = async (name: string) => {
    const dst = prompt(`Copy '${name}' to new name:`);
    if (!dst) return;
    setDbAction(name, true);
    const tid = toastLoading(`Copying '${name}' → '${dst}'...`);
    setProgressTitle(`Copy: ${name} → ${dst}`);
    setProgressEvent("copy-progress");
    setShowProgress(true);
    try {
      const result = await invokeCmd<OpResult>("copy_db", { version: selectedVersion, src: name, dst, terminateConnections: true });
      if (result.success) {
        toastUpdate(tid, "success", `Copied '${name}' → '${dst}'`);
      } else {
        toastUpdate(tid, "error", `Copy failed`, result.error ?? "");
      }
      await fetchDatabases();
    } catch (e) {
      toastUpdate(tid, "error", `Copy failed`, String(e));
    } finally {
      setDbAction(name, false);
    }
  };

  const handleRename = async (name: string) => {
    const dst = prompt(`Rename '${name}' to new name:`);
    if (!dst) return;
    setDbAction(name, true);
    const tid = toastLoading(`Renaming '${name}' → '${dst}'...`);
    setProgressTitle(`Rename: ${name} → ${dst}`);
    setProgressEvent("rename-progress");
    setShowProgress(true);
    try {
      const result = await invokeCmd<OpResult>("rename_db", { version: selectedVersion, src: name, dst, terminateConnections: true });
      if (result.success) {
        toastUpdate(tid, "success", `Renamed '${name}' → '${dst}'`);
      } else {
        toastUpdate(tid, "error", `Rename failed`, result.error ?? "");
      }
      await fetchDatabases();
    } catch (e) {
      toastUpdate(tid, "error", `Rename failed`, String(e));
    } finally {
      setDbAction(name, false);
    }
  };

  const handleProgress = (title: string, eventName: string) => {
    setProgressTitle(title);
    setProgressEvent(eventName);
    setShowProgress(true);
  };

  const sorted = [...dbList].sort((a, b) => sortAsc ? a.localeCompare(b) : b.localeCompare(a));
  const filtered = sorted.filter((d) => d.toLowerCase().includes(search.toLowerCase()));

  const toggleSelect = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleBulkDrop = async () => {
    const names = Array.from(selected);
    const tid = toastLoading(`Dropping ${names.length} database(s)...`);
    for (const name of names) {
      try {
        await invokeCmd<OpResult>("drop_db", { version: selectedVersion, name, terminateConnections: true });
      } catch (e) {
        console.error(e);
      }
    }
    setSelected(new Set());
    await fetchDatabases();
    toastUpdate(tid, "success", `Dropped ${names.length} database(s)`);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Databases</h1>
        <div className="flex items-center gap-2">
          <Select value={selectedVersion} onChange={(e) => setSelectedVersion(e.target.value)} className="w-32">
            {versionKeys.map((k) => (
              <option key={k} value={k}>v{k}</option>
            ))}
          </Select>
          <Button size="sm" variant="outline" onClick={fetchDatabases} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowRestore(true)}>
            <HardDriveUpload className="h-3.5 w-3.5" />
            Restore
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">PostgreSQL not accessible: {error}</span>
              <Button size="sm" variant="outline" onClick={() => invokeCmd("docker_up", { version: selectedVersion, runtime })}>
                Start {runtime === "apple" ? "Container" : "Docker"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!error && !loading && dbList.length === 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">No databases found</span>
              <Button size="sm" variant="outline" onClick={() => invokeCmd("docker_up", { version: selectedVersion, runtime })}>
                Start PostgreSQL
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {dbList.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="Filter databases..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 text-sm"
            />
            <Button size="sm" variant="ghost" onClick={() => setSortAsc(!sortAsc)}>
              {sortAsc ? "A→Z" : "Z→A"}
            </Button>
            {selected.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBulkDrop}>
                Drop selected ({selected.size})
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/50">
                  <th className="w-8 p-2"></th>
                  <th className="p-2 font-medium text-muted-foreground">Database Name</th>
                  <th className="p-2 font-medium text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((db) => {
                  const isSel = selected.has(db);
                  const isBusy = actionLoading[db];
                  return (
                    <tr
                      key={db}
                      className={cn(
                        "border-b border-border/50 transition-colors",
                        isSel ? "bg-primary/5" : "hover:bg-accent/40",
                      )}
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleSelect(db)}
                          className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                        />
                      </td>
                      <td className="p-2 font-mono">{db}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setBackupTarget(db)}
                            title="Backup"
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-blue-500/10 hover:text-blue-500"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleCopy(db)}
                            title="Copy"
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-500"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRename(db)}
                            title="Rename"
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-yellow-500/10 hover:text-yellow-500"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDropTarget(db)}
                            title="Drop"
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-red-500/10 hover:text-red-500"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-muted-foreground">
            {dbList.length} database(s) on port {versions?.[selectedVersion]?.ports.db ?? "?"}
          </div>
        </>
      )}

      {backupTarget && (
        <BackupDialog
          open={!!backupTarget}
          onClose={() => setBackupTarget(null)}
          version={selectedVersion}
          dbName={backupTarget}
          onProgress={handleProgress}
        />
      )}

      {showRestore && (
        <RestoreDialog
          open={showRestore}
          onClose={() => setShowRestore(false)}
          version={selectedVersion}
          onProgress={handleProgress}
        />
      )}

      {dropTarget && (
        <DropConfirmDialog
          open={!!dropTarget}
          onClose={() => setDropTarget(null)}
          dbName={dropTarget}
          onConfirm={() => handleDrop(dropTarget)}
        />
      )}

      <OperationProgress
        open={showProgress}
        onClose={() => setShowProgress(false)}
        title={progressTitle}
        eventName={progressEvent}
      />
    </div>
  );
}