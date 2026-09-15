import { useState, useEffect } from "react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { Input } from "../ui/input";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { useAppStore } from "../../store/appStore";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import type { DbListResponse, DbUpdateMode, OpResult, VersionsResponse } from "../../types";
import { BackupDialog } from "./BackupDialog";
import { RestoreDialog } from "./RestoreDialog";
import { DropConfirmDialog } from "./DropConfirmDialog";
import { NameInputDialog } from "./NameInputDialog";
import { OperationProgress } from "./OperationProgress";
import { dropMany } from "./bulkDrop";
import { RefreshCw, RefreshCcw, HardDriveDownload, HardDriveUpload, Trash2, Copy, Pencil, Loader2, Plus } from "lucide-react";
import { cn } from "../../lib/utils";
import { effectivePorts, tagColor } from "../../lib/constants";
import { useDbTagStore, dbTagKey } from "../../store/dbTagStore";
import { TagInput } from "../ui/tag-input";
import { DbUpdateDialog } from "./DbUpdateDialog";
import { DbUpdatePanel } from "./DbUpdatePanel";
import { UpdateLogDialog } from "./UpdateLogDialog";
import { useDbUpdateStore } from "../../store/dbUpdateStore";
import { isActive } from "../../lib/dbUpdateReducer";
import { isAtLeast, MIN_ODOODEV_DB_UPDATE } from "../../lib/version";

export function DatabasePanel({ preselectVersion }: { preselectVersion: string | null }) {
  const { t } = useTranslation();
  const runtime = useAppStore((s) => s.runtime);
  const [versions, setVersions] = useState<VersionsResponse | null>(null);
  const [versionKeys, setVersionKeys] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState("");
  const [dbList, setDbList] = useState<string[]>([]);
  const [dbResp, setDbResp] = useState<DbListResponse | null>(null);
  /** null = not probed; the probe only runs when the CLI returned an empty
   *  list, which it also does silently on connection failures. */
  const [pgReachable, setPgReachable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tagsByDb = useDbTagStore((s) => s.tagsByDb);
  const setDbTags = useDbTagStore((s) => s.setTags);
  const removeDbTags = useDbTagStore((s) => s.removeDb);
  const renameDbTags = useDbTagStore((s) => s.renameDb);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  /** DB name whose tag editor is currently open (inline in the table row). */
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const [backupTarget, setBackupTarget] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [progressTitle, setProgressTitle] = useState("");
  const [progressEvent, setProgressEvent] = useState("");
  const [showProgress, setShowProgress] = useState(false);
  const [progressDone, setProgressDone] = useState(false);
  const [progressSuccess, setProgressSuccess] = useState<boolean | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | undefined>(undefined);
  const [updateDialog, setUpdateDialog] = useState<{ mode: DbUpdateMode; names: string[] } | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const odoodevVersion = useAppStore((s) => s.odoodevInfo?.version ?? null);
  const updateSupported = isAtLeast(odoodevVersion, MIN_ODOODEV_DB_UPDATE);
  const updateRun = useDbUpdateStore((s) => s.runs[selectedVersion]);
  const updateActive = isActive(updateRun);
  const updatePhase = updateRun?.phase;

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
    // Pick a default version once when inputs change; reading selectedVersion
    // (the "already chosen?" guard) is intentional, not a missing dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectVersion, versionKeys]);

  const fetchDatabases = async () => {
    if (!selectedVersion) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await invokeCmd<DbListResponse>("get_databases", { version: selectedVersion });
      setDbList(resp.databases);
      setDbResp(resp);
      if (resp.databases.length === 0) {
        // The CLI reports an empty list on connection failures too — probe the
        // exact port it queried to tell "no databases" from "no connection".
        setPgReachable(await invokeCmd<boolean>("check_postgres_port", { port: resp.port }));
      } else {
        setPgReachable(true);
      }
    } catch (e) {
      setDbList([]);
      setDbResp(null);
      setPgReachable(null);
      // Keep the CLI's own message — it names the exact host:port it probed,
      // which is the key diagnostic on multi-user hosts with port prefixes.
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDatabases();
    // Tags are keyed per version — a filter kept from another version would
    // just hide everything.
    setSelectedTags(new Set());
    setEditingTagsFor(null);
    // Re-fetch whenever the selected version changes; fetchDatabases is a plain
    // (non-memoized) function, intentionally omitted to avoid a re-fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion]);

  // A finished, failed or interrupted update changes the stale markers.
  useEffect(() => {
    if (updatePhase && updatePhase !== "running" && updatePhase !== "cancelling") fetchDatabases();
    // fetchDatabases is a plain function (see above); only the phase change matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updatePhase]);

  const setDbAction = (name: string, busy: boolean) => {
    setActionLoading((prev) => ({ ...prev, [name]: busy }));
  };

  /** Start the DB container, wait until PostgreSQL accepts connections,
   *  then refresh the list — the error banner must not linger after a
   *  successful start. */
  const handleStartPostgres = async () => {
    const tid = toastLoading("Starting PostgreSQL...");
    try {
      await invokeCmd("docker_up", { version: selectedVersion, runtime });
    } catch (e) {
      toastUpdate(tid, "error", "Failed to start PostgreSQL", String(e));
      return;
    }
    // Postgres needs a moment inside the fresh container; poll the list.
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const resp = await invokeCmd<DbListResponse>("get_databases", { version: selectedVersion });
        // An empty list is also what the CLI reports while Postgres is still
        // starting up — only accept it once the port actually answers.
        const reachable =
          resp.databases.length > 0 ||
          (await invokeCmd<boolean>("check_postgres_port", { port: resp.port }));
        if (reachable) {
          setDbList(resp.databases);
          setDbResp(resp);
          setPgReachable(true);
          setError(null);
          toastUpdate(tid, "success", "PostgreSQL started");
          return;
        }
      } catch {
        // not ready yet — keep polling
      }
    }
    toastUpdate(tid, "error", "PostgreSQL did not become ready", "Check the container logs");
  };

  // Drop does not stream any output — the toast is the whole feedback.
  const handleDrop = async (name: string) => {
    setDbAction(name, true);
    const tid = toastLoading(`Dropping database '${name}'...`);
    setDropTarget(null);
    try {
      const result = await invokeCmd<OpResult>("drop_db", { version: selectedVersion, name, terminateConnections: true });
      if (result.success) {
        removeDbTags(selectedVersion, name);
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

  // `db copy` duplicates database + filestore; `db rename` moves both.
  const handleDuplicate = async (name: string, dst: string) => {
    setDuplicateTarget(null);
    setDbAction(name, true);
    const tid = toastLoading(`Duplicating '${name}' → '${dst}'...`);
    try {
      const result = await invokeCmd<OpResult>("copy_db", { version: selectedVersion, src: name, dst, terminateConnections: true });
      if (result.success) {
        toastUpdate(tid, "success", `Duplicated '${name}' → '${dst}' (incl. filestore)`);
      } else {
        toastUpdate(tid, "error", `Duplicate failed`, result.error ?? "");
      }
      await fetchDatabases();
    } catch (e) {
      toastUpdate(tid, "error", `Duplicate failed`, String(e));
    } finally {
      setDbAction(name, false);
    }
  };

  const handleRename = async (name: string, dst: string) => {
    setRenameTarget(null);
    setDbAction(name, true);
    const tid = toastLoading(`Renaming '${name}' → '${dst}'...`);
    try {
      const result = await invokeCmd<OpResult>("rename_db", { version: selectedVersion, src: name, dst, terminateConnections: true });
      if (result.success) {
        renameDbTags(selectedVersion, name, dst);
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
    setProgressDone(false);
    setProgressSuccess(null);
    setProgressMessage(undefined);
    setShowProgress(true);
  };

  /** The dialogs report the resolved invoke promise here — that IS the
   *  completion signal for the progress dialog. */
  const handleProgressFinished = async (success: boolean, message?: string) => {
    setProgressDone(true);
    setProgressSuccess(success);
    setProgressMessage(message);
    await fetchDatabases();
  };

  const selectedInfo = versions?.[selectedVersion] ?? null;
  const stale = dbResp?.stale ?? null;
  const staleCount = stale ? dbList.filter((d) => stale[d]).length : dbList.length;
  const updateBlockedReason = !updateSupported
    ? t("database.updateRequiresVersion", { version: MIN_ODOODEV_DB_UPDATE })
    : updateActive
      ? t("database.updateRunningHere")
      : undefined;
  const sorted = [...dbList].sort((a, b) => sortAsc ? a.localeCompare(b) : b.localeCompare(a));
  const filtered = sorted.filter((d) => {
    if (!d.toLowerCase().includes(search.toLowerCase())) return false;
    if (selectedTags.size === 0) return true;
    const tags = tagsByDb[dbTagKey(selectedVersion, d)] ?? [];
    return [...selectedTags].every((tag) => tags.includes(tag));
  });
  const allVersionTags = Array.from(
    new Set(dbList.flatMap((d) => tagsByDb[dbTagKey(selectedVersion, d)] ?? [])),
  ).sort();

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

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
    const tid = toastLoading(t("database.bulkDropping", { count: names.length }));
    const outcome = await dropMany(names, (name) =>
      invokeCmd<OpResult>("drop_db", { version: selectedVersion, name, terminateConnections: true }),
    );
    outcome.dropped.forEach((name) => removeDbTags(selectedVersion, name));
    // Keep the failed ones selected so a retry is one click.
    setSelected(new Set(outcome.failed.map((f) => f.name)));
    await fetchDatabases();
    if (outcome.failed.length === 0) {
      toastUpdate(tid, "success", t("database.bulkDropDone", { count: outcome.dropped.length }));
    } else {
      toastUpdate(
        tid,
        "error",
        t("database.bulkDropFailed", { failed: outcome.failed.length, total: names.length }),
        outcome.failed.map((f) => `${f.name}: ${f.error}`).join("\n"),
      );
    }
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("database.title")}</h1>
        <div className="flex items-center gap-2">
          {dbResp && (
            <span className="text-xs text-muted-foreground">
              {t("database.connectedTo", { host: dbResp.host, port: dbResp.port })}
            </span>
          )}
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
            {t("database.restore")}
          </Button>
          {dbList.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={updateBlockedReason !== undefined || (stale !== null && staleCount === 0)}
              title={updateBlockedReason}
              onClick={() => setUpdateDialog({ mode: "stale", names: [] })}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {stale === null ? t("database.updateAll") : t("database.updateStaleCount", { count: staleCount })}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">{error}</span>
              <Button size="sm" variant="outline" onClick={handleStartPostgres}>
                Start {runtime === "apple" ? "Container" : "Docker"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!error && !loading && dbList.length === 0 && pgReachable === false && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-destructive">
                {t("database.pgUnreachable", {
                  version: selectedVersion,
                  port: dbResp?.port ?? (selectedInfo ? effectivePorts(selectedInfo).db : "?"),
                })}
              </span>
              <Button size="sm" variant="outline" onClick={handleStartPostgres}>
                {t("database.startPostgresql")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!error && !loading && dbList.length === 0 && pgReachable !== false && (
        <Card>
          <CardContent className="p-4">
            <span className="text-sm text-muted-foreground">
              {t("database.noDatabasesGenuine")}
            </span>
          </CardContent>
        </Card>
      )}

      {updateRun && <DbUpdatePanel version={selectedVersion} onOpenLog={setLogPath} />}

      {dbList.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder={t("database.filterPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-48 text-sm"
            />
            <Button size="sm" variant="ghost" onClick={() => setSortAsc(!sortAsc)}>
              {sortAsc ? "A→Z" : "Z→A"}
            </Button>
            {selected.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={updateBlockedReason !== undefined}
                title={updateBlockedReason}
                onClick={() => setUpdateDialog({ mode: "names", names: Array.from(selected) })}
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                {t("database.updateSelectedCount", { count: selected.size })}
              </Button>
            )}
            {selected.size > 0 && (
              <Button size="sm" variant="destructive" onClick={handleBulkDrop}>
                {t("database.dropSelectedCount", { count: selected.size })}
              </Button>
            )}
            {allVersionTags.length > 0 && (
              <div className="ml-2 flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">{t("database.tagsFilter")}:</span>
                {allVersionTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => toggleTagFilter(tag)}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-xs font-medium transition-opacity",
                      tagColor(tag),
                      selectedTags.has(tag) ? "ring-1 ring-current" : "opacity-60 hover:opacity-100",
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left bg-muted/50">
                  <th className="w-8 p-2"></th>
                  <th className="p-2 font-medium text-muted-foreground">{t("database.dbNameColumn")}</th>
                  <th className="p-2 font-medium text-muted-foreground">{t("common.tags")}</th>
                  <th className="p-2 font-medium text-muted-foreground text-right">{t("database.actionsColumn")}</th>
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
                      <td className="p-2">
                        <span className="font-mono">{db}</span>
                        {stale?.[db] && (
                          <span
                            title={stale[db]}
                            className="ml-2 rounded-md bg-yellow-500/15 px-1.5 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400"
                          >
                            {t("database.staleBadge")}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {editingTagsFor === db ? (
                          <div
                            onBlur={(e) => {
                              // Close the inline editor once focus leaves it entirely
                              // (chip remove buttons inside must not close it).
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                setEditingTagsFor(null);
                              }
                            }}
                          >
                            <TagInput
                              tags={tagsByDb[dbTagKey(selectedVersion, db)] ?? []}
                              onChange={(tags) => setDbTags(selectedVersion, db, tags)}
                              placeholder={t("common.addTag")}
                              className="min-h-7 py-0.5"
                            />
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1">
                            {(tagsByDb[dbTagKey(selectedVersion, db)] ?? []).map((tag) => (
                              <span
                                key={tag}
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-xs font-medium",
                                  tagColor(tag),
                                )}
                              >
                                {tag}
                              </span>
                            ))}
                            <button
                              onClick={() => setEditingTagsFor(db)}
                              title={t("common.addTag")}
                              className="rounded-md p-0.5 text-muted-foreground opacity-50 hover:bg-accent hover:opacity-100"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setBackupTarget(db)}
                            title={t("database.backup")}
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-blue-500/10 hover:text-blue-500"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HardDriveDownload className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDuplicateTarget(db)}
                            title={t("database.duplicateTitle")}
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-green-500/10 hover:text-green-500"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRenameTarget(db)}
                            title={t("database.rename")}
                            disabled={isBusy}
                            className="h-7 w-7 p-0 hover:bg-yellow-500/10 hover:text-yellow-500"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setDropTarget(db)}
                            title={t("database.drop")}
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
            {dbList.length} database(s) on port{" "}
            {selectedInfo ? effectivePorts(selectedInfo).db : "?"}
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
          onFinished={handleProgressFinished}
        />
      )}

      {showRestore && (
        <RestoreDialog
          open={showRestore}
          onClose={() => setShowRestore(false)}
          version={selectedVersion}
          onProgress={handleProgress}
          onFinished={handleProgressFinished}
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

      {duplicateTarget && (
        <NameInputDialog
          open={!!duplicateTarget}
          onClose={() => setDuplicateTarget(null)}
          title={`Duplicate database '${duplicateTarget}'`}
          description="Creates a full copy of the database including its filestore."
          sourceName={duplicateTarget}
          existingNames={dbList}
          confirmLabel="Duplicate"
          onConfirm={(dst) => handleDuplicate(duplicateTarget, dst)}
        />
      )}

      {renameTarget && (
        <NameInputDialog
          open={!!renameTarget}
          onClose={() => setRenameTarget(null)}
          title={`Rename database '${renameTarget}'`}
          description="Renames the database and moves its filestore."
          sourceName={renameTarget}
          existingNames={dbList}
          confirmLabel="Rename"
          onConfirm={(dst) => handleRename(renameTarget, dst)}
        />
      )}

      {updateDialog && (
        <DbUpdateDialog
          open
          onClose={() => setUpdateDialog(null)}
          version={selectedVersion}
          mode={updateDialog.mode}
          names={updateDialog.names}
        />
      )}

      {logPath && <UpdateLogDialog key={logPath} path={logPath} onClose={() => setLogPath(null)} />}

      <OperationProgress
        open={showProgress}
        onClose={() => setShowProgress(false)}
        title={progressTitle}
        eventName={progressEvent}
        done={progressDone}
        success={progressSuccess}
        finalMessage={progressMessage}
      />
    </div>
  );
}