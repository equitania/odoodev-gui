import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../lib/tauri";
import { usePlaybookRun } from "../../hooks/usePlaybookRun";
import { toastLoading, toastUpdate } from "../../store/toastStore";
import { StepList } from "./StepList";
import { EventLog } from "./EventLog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Badge } from "../ui/badge";
import { Play, FileText, Loader2, FlaskConical, Plus, X } from "lucide-react";
import type { PlaybookInfo, VersionInfo } from "../../types";

export function PlaybookPanel() {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<Record<string, VersionInfo> | null>(null);
  const [validSteps, setValidSteps] = useState<string[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybookInfo[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [selectedSteps, setSelectedSteps] = useState<string[]>([]);
  const [selectedPlaybook, setSelectedPlaybook] = useState<string | null>(null);
  const [vars, setVars] = useState<string[]>([]);
  const [varInput, setVarInput] = useState("");
  const [showResults, setShowResults] = useState(false);

  const playbookRun = usePlaybookRun();

  useEffect(() => {
    invokeCmd<Record<string, VersionInfo>>("get_versions")
      .then((v) => {
        setVersions(v);
        const keys = Object.keys(v).sort();
        if (keys.length > 0) setSelectedVersion(keys[0]);
      })
      .catch(() => {});
    invokeCmd<string[]>("playbook_valid_steps")
      .then(setValidSteps)
      .catch(() => {});
    invokeCmd<PlaybookInfo[]>("playbook_list")
      .then(setPlaybooks)
      .catch(() => {});
  }, []);

  const toggleStep = (step: string) => {
    setSelectedSteps((prev) =>
      prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step],
    );
    setSelectedPlaybook(null);
  };

  const addVar = () => {
    const trimmed = varInput.trim();
    if (trimmed && !vars.includes(trimmed)) {
      setVars([...vars, trimmed]);
      setVarInput("");
    }
  };

  const removeVar = (v: string) => {
    setVars(vars.filter((x) => x !== v));
  };

  const handleRun = async (dryRun: boolean) => {
    if (!selectedPlaybook && selectedSteps.length === 0) return;
    setShowResults(true);
    const label = dryRun ? t("playbook.dryRunning") : t("playbook.running");
    const tid = toastLoading(label);
    const success = await playbookRun.start(
      selectedPlaybook,
      selectedSteps,
      selectedVersion || null,
      vars,
      dryRun,
    );
    if (success) {
      toastUpdate(tid, "success", dryRun ? t("playbook.dryRunComplete") : t("playbook.playbookComplete"));
    } else {
      toastUpdate(tid, "error", dryRun ? t("playbook.dryRunFailed") : t("playbook.playbookFailed"), "Check output below");
    }
  };

  const canRun = !!selectedPlaybook || selectedSteps.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <h1 className="text-2xl font-semibold">{t("playbook.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("playbook.description")}
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {playbooks.length > 0 && (
          <div className="space-y-2">
            <Label>{t("playbook.savedPlaybooks")}</Label>
            <div className="flex flex-wrap gap-2">
              {playbooks.map((pb) => (
                <button
                  key={pb.path}
                  onClick={() => {
                    setSelectedPlaybook(pb.path);
                    setSelectedSteps([]);
                  }}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-all ${
                    selectedPlaybook === pb.path
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-accent"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5" />
                  {pb.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label>Version</Label>
          <div className="flex gap-2">
            {versions &&
              Object.keys(versions)
                .sort()
                .map((ver) => (
                  <button
                    key={ver}
                    onClick={() => setSelectedVersion(ver)}
                    className={`rounded-md border px-3 py-1 text-sm font-medium transition-all ${
                      selectedVersion === ver
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    v{ver}
                  </button>
                ))}
          </div>
        </div>

        {!selectedPlaybook && validSteps.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("playbook.inlineSteps", { count: selectedSteps.length })}</Label>
              {selectedSteps.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedSteps([])}
                >
                  {t("playbook.clear")}
                </Button>
              )}
            </div>
            <StepList
              steps={validSteps}
              selected={selectedSteps}
              onToggle={toggleStep}
            />
            {selectedSteps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {selectedSteps.map((s) => (
                  <Badge key={s} variant="outline">
                    {s}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedPlaybook && (
          <div className="flex items-center gap-2">
            <Badge variant="default">
              <FileText className="h-3 w-3" />
              {selectedPlaybook.split("/").pop()}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedPlaybook(null)}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label>{t("playbook.variables")}</Label>
          <div className="flex gap-2">
            <Input
              value={varInput}
              onChange={(e) => setVarInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addVar()}
              placeholder={t("playbook.varPlaceholder")}
              className="font-mono text-sm"
            />
            <Button size="sm" variant="outline" onClick={addVar}>
              <Plus className="h-3.5 w-3.5" />
              {t("playbook.add")}
            </Button>
          </div>
          {vars.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {vars.map((v) => (
                <Badge key={v} variant="outline">
                  <span className="font-mono">{v}</span>
                  <button
                    onClick={() => removeVar(v)}
                    className="ml-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => handleRun(false)}
            disabled={!canRun || playbookRun.running}
          >
            {playbookRun.running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {t("playbook.run")}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleRun(true)}
            disabled={!canRun || playbookRun.running}
          >
            <FlaskConical className="h-4 w-4" />
            {t("playbook.dryRun")}
          </Button>
        </div>

        {showResults && (playbookRun.running || playbookRun.events.length > 0) && (
          <EventLog
            events={playbookRun.events}
            running={playbookRun.running}
            onClose={() => {
              setShowResults(false);
              playbookRun.clear();
            }}
          />
        )}
      </div>
    </div>
  );
}