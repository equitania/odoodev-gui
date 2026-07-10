import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import { SegmentedControl } from "../ui/segmented-control";
import { Checkbox } from "../ui/checkbox";
import { invokeCmd } from "../../lib/tauri";
import type { DbListResponse, StartServerArgs } from "../../types";
import { ChevronDown, ChevronUp, Play, Square, RotateCcw } from "lucide-react";

const MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "dev", label: "Dev" },
  { value: "shell", label: "Shell" },
  { value: "test", label: "Test" },
  { value: "prepare", label: "Prepare" },
];

export function ServerConfig({
  version,
  running,
  onStart,
  onStop,
  onRestart,
}: {
  version: string;
  running: boolean;
  onStart: (args: StartServerArgs) => void;
  onStop: () => void;
  onRestart: () => void;
}) {
  const [mode, setMode] = useState("normal");
  const [database, setDatabase] = useState("");
  const [databases, setDatabases] = useState<string[]>([]);
  const [dbError, setDbError] = useState<string | null>(null);
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

  useEffect(() => {
    invokeCmd<DbListResponse>("get_databases", { version })
      .then((resp) => {
        setDatabases(resp.databases);
        setDbError(null);
      })
      .catch((e) => {
        setDatabases([]);
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
    extra_args: extraArgs || undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Server Configuration — v{version}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Mode</Label>
          <SegmentedControl options={MODE_OPTIONS} value={mode} onChange={setMode} />
        </div>

        <div className="space-y-2">
          <Label>Database</Label>
          {dbError ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-destructive">PostgreSQL not accessible</span>
              <Button size="sm" variant="outline" onClick={() => invokeCmd("docker_up", { version })}>
                Start Docker
              </Button>
            </div>
          ) : databases.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">No databases — start PostgreSQL first</span>
              <Button size="sm" variant="outline" onClick={() => invokeCmd("docker_up", { version })}>
                Docker Up
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={database} onChange={(e) => setDatabase(e.target.value)} className="flex-1">
                <option value="">— Select database —</option>
                {databases.map((db) => (
                  <option key={db} value={db}>{db}</option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => invokeCmd<DbListResponse>("get_databases", { version }).then((r) => setDatabases(r.databases))}
              >
                Refresh
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Update modules (-u)</Label>
            <Input
              value={updateModules}
              onChange={(e) => setUpdateModules(e.target.value)}
              placeholder="eq_sale,eq_stock"
            />
          </div>
          <div className="space-y-2">
            <Label>Install modules (-i)</Label>
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
          Advanced
        </button>

        {showAdvanced && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="space-y-2">
              <Label>Host override</Label>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="127.0.0.1" />
            </div>
            <div className="space-y-2">
              <Label>Load language</Label>
              <Input value={loadLanguage} onChange={(e) => setLoadLanguage(e.target.value)} placeholder="de_DE" />
              <Checkbox checked={i18nOverwrite} onChange={setI18nOverwrite} label="--i18n-overwrite" />
            </div>
            <Checkbox checked={cleanSessions} onChange={setCleanSessions} label="Clean sessions (--clean-sessions)" />
            <div className="space-y-2">
              <Label>Custom config (-c)</Label>
              <Input value={configPath} onChange={(e) => setConfigPath(e.target.value)} placeholder="/path/to/odoo.conf" />
            </div>
            <Checkbox
              checked={allowDefaultCreds}
              onChange={setAllowDefaultCreds}
              label="Allow default credentials"
            />
            {allowDefaultCreds && (
              <p className="text-xs text-orange-500">
                Warning: allowing default credentials is insecure
              </p>
            )}
            <div className="space-y-2">
              <Label>Extra args (after --)</Label>
              <Input value={extraArgs} onChange={(e) => setExtraArgs(e.target.value)} placeholder="--workers=4" />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {!running ? (
            <Button onClick={() => onStart(buildArgs())}>
              <Play className="h-4 w-4" />
              Start Server
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onRestart}>
                <RotateCcw className="h-4 w-4" />
                Restart
              </Button>
              <Button variant="destructive" onClick={onStop}>
                <Square className="h-4 w-4" />
                Stop
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}