import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { SegmentedControl } from "../ui/segmented-control";
import { Checkbox } from "../ui/checkbox";
import { invokeCmd } from "../../lib/tauri";
import { reportError } from "../../lib/errors";
import { useAppStore } from "../../store/appStore";
import { effectivePorts } from "../../lib/constants";
import type { DbListResponse, StartServerArgs } from "../../types";
import { ChevronDown, ChevronUp, Play, Square, RotateCcw, Loader2 } from "lucide-react";

export function ServerConfig({
  version,
  running,
  busy,
  onStart,
  onStop,
  onRestart,
}: {
  version: string;
  running: boolean;
  busy: boolean;
  onStart: (args: StartServerArgs) => void;
  onStop: () => void;
  onRestart: (args: StartServerArgs) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState("normal");
  const [database, setDatabase] = useState("");
  const [databases, setDatabases] = useState<string[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
  /** Set when the CLI returned an empty list AND the DB port does not answer —
   *  the CLI reports connection failures as an empty list. */
  const [dbUnreachablePort, setDbUnreachablePort] = useState<number | null>(null);
  const [updateModules, setUpdateModules] = useState("");
  const [installModules, setInstallModules] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [host, setHost] = useState("");
  const [loadLanguage, setLoadLanguage] = useState("");
  const [i18nOverwrite, setI18nOverwrite] = useState(false);
  const [cleanSessions, setCleanSessions] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [allowDefaultCreds, setAllowDefaultCreds] = useState(false);
  const [extraArgs, setExtraArgs] = useState("");
  const runtime = useAppStore((s) => s.runtime);
  const versions = useAppStore((s) => s.versions);

  const modeOptions = [
    { value: "normal", label: t("server.normal") },
    { value: "dev", label: t("server.dev") },
    { value: "shell", label: t("server.shell") },
    { value: "test", label: t("server.test") },
    { value: "prepare", label: t("server.prepare") },
  ];

  useEffect(() => {
    invokeCmd<DbListResponse>("get_databases", { version })
      .then(async (resp) => {
        setDatabases(resp.databases);
        // Each version has its own PostgreSQL (own port) — a selection kept
        // from another version tab would send a wrong -d to the CLI.
        setDatabase((cur) => (resp.databases.includes(cur) ? cur : ""));
        setDbError(null);
        if (resp.databases.length === 0) {
          const reachable = await invokeCmd<boolean>("check_postgres_port", { port: resp.port });
          setDbUnreachablePort(reachable ? null : resp.port);
        } else {
          setDbUnreachablePort(null);
        }
      })
      .catch((e) => {
        setDatabases([]);
        setDatabase("");
        setDbError(String(e));
      });
  }, [version]);

  const buildArgs = (): StartServerArgs => ({
    version,
    mode: mode !== "normal" ? mode : undefined,
    database: database || undefined,
    update_modules: updateModules || undefined,
    install_modules: installModules || undefined,
    host: host || undefined,
    load_language: loadLanguage || undefined,
    i18n_overwrite: i18nOverwrite || undefined,
    clean_sessions: cleanSessions || undefined,
    config_path: configPath || undefined,
    allow_default_credentials: allowDefaultCreds || undefined,
    runtime: runtime || undefined,
    extra_args: extraArgs || undefined,
    port: versions?.[version] ? effectivePorts(versions[version]).odoo : undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("server.configTitle", { version })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("server.mode")}</Label>
          <SegmentedControl options={modeOptions} value={mode} onChange={setMode} />
        </div>

        <div className="space-y-2">
          <Label>{t("server.database")}</Label>
          {dbError ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">{t("server.postgresNotAccessible")}</span>
              <Button size="sm" variant="outline" onClick={() => invokeCmd("docker_up", { version, runtime }).catch(reportError(t("toast.postgresqlStartFailed")))}>
                {runtime === "apple" ? t("server.startContainer") : t("server.startDocker")}
              </Button>
            </div>
          ) : databases.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className={dbUnreachablePort !== null ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {dbUnreachablePort !== null
                  ? t("server.pgUnreachableShort", { port: dbUnreachablePort })
                  : t("server.noDatabases")}
              </span>
              <Button size="sm" variant="outline" onClick={() => invokeCmd("docker_up", { version, runtime }).catch(reportError(t("toast.postgresqlStartFailed")))}>
                {runtime === "apple" ? t("common.start") : t("dashboard.dockerUp")}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={database} onChange={(e) => setDatabase(e.target.value)} className="flex-1">
                <option value="">{t("server.selectDatabase")}</option>
                {databases.map((db) => (
                  <option key={db} value={db}>{db}</option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  invokeCmd<DbListResponse>("get_databases", { version })
                    .then((r) => {
                      setDatabases(r.databases);
                      setDatabase((cur) => (r.databases.includes(cur) ? cur : ""));
                    })
                    .catch(reportError(t("server.refreshDatabasesFailed")))
                }
              >
                {t("common.refresh")}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>{t("server.modulesUpdate")} (-u)</Label>
            <Input
              value={updateModules}
              onChange={(e) => setUpdateModules(e.target.value)}
              placeholder="eq_sale,eq_stock"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("server.modulesInstall")} (-i)</Label>
            <Input
              value={installModules}
              onChange={(e) => setInstallModules(e.target.value)}
              placeholder="eq_sale,eq_stock"
            />
          </div>
        </div>

        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          {t("server.advanced")}
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="space-y-2">
              <Label>{t("server.host")}</Label>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" />
            </div>
            <div className="space-y-2">
              <Label>{t("server.loadLanguage")}</Label>
              <Input value={loadLanguage} onChange={(e) => setLoadLanguage(e.target.value)} placeholder="de_DE" />
              <Checkbox checked={i18nOverwrite} onChange={setI18nOverwrite} label={t("server.i18nOverwrite")} />
            </div>
            <Checkbox checked={cleanSessions} onChange={setCleanSessions} label={`${t("server.cleanSessions")} (--clean-sessions)`} />
            <div className="space-y-2">
              <Label>{t("server.customConfig")} (-c)</Label>
              <Input value={configPath} onChange={(e) => setConfigPath(e.target.value)} placeholder="/path/to/odoo.conf" />
            </div>
            <Checkbox
              checked={allowDefaultCreds}
              onChange={setAllowDefaultCreds}
              label={t("server.allowDefaultCredentials")}
            />
            {allowDefaultCreds && (
              <p className="text-xs text-orange-500">
                {t("server.allowDefaultCredentialsWarning")}
              </p>
            )}
            <div className="space-y-2">
              <Label>{t("server.extraArgs")} (--)</Label>
              <Input value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder="--workers=4" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {!running ? (
            <Button onClick={() => onStart(buildArgs())} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? t("common.busy") : t("server.startServer")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onRestart(buildArgs())} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {busy ? t("common.busy") : t("server.restart")}
              </Button>
              <Button variant="destructive" onClick={onStop} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                {busy ? t("common.busy") : t("common.stop")}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
