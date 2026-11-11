import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCmd } from "../../../lib/tauri";
import { logError } from "../../../lib/errors";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "../../ui/dialog";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import { SchemaForm, isFieldVisible } from "./SchemaForm";
import { RepeatableSection, type RepeatableItem } from "./RepeatableSection";
import { buildAnswers } from "./buildAnswers";
import { parsePathError } from "./outputPathError";
import { pickDefaultRoot, pickEnvDir } from "./defaultRoot";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Play,
  Sparkles,
} from "lucide-react";
import type {
  WizardField,
  WizardSchema,
  WizardSection,
  WizardValues,
} from "../../../types/playbookSchema";

const SUMMARY_STEP = "summary";

/** GUI-injected virtual fields that the CLI wizard asks as flow questions
 *  rather than schema fields (_wizard_source / _wizard_destination). Their
 *  values are consumed by buildAnswers, never sent under these keys. */
const SOURCE_TARGET_FIELD: WizardField = {
  key: "source.target",
  type: "select",
  label_key: "playbook.gui.sourceTarget",
  required: true,
  choices_source: "targets",
  depends_on: "source.mode",
  depends_value: "fresh_backup",
};

const DESTINATION_FIELD: WizardField = {
  key: "recipe.destination",
  type: "select",
  label_key: "playbook.gui.destinationTarget",
  required: true,
  choices_source: "targets",
};

function seedDefaults(schema: WizardSchema): WizardValues {
  const values: WizardValues = {};
  for (const section of schema.sections) {
    if (section.repeatable) {
      values[section.key] = (section.min_items ?? 0) > 0 ? [{}] : [];
      continue;
    }
    for (const f of section.fields ?? []) {
      if (f.default != null) values[f.key] = f.default;
    }
  }
  return values;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The directories a new file may be saved in, shown under a path field. */
function AllowedDirs({ roots, text }: { roots: string[]; text: string }) {
  const { t } = useTranslation();
  return (
    <div className="text-xs text-muted-foreground">
      <p>{text}</p>
      {roots.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5">
          {roots.map((dir) => (
            <li key={dir}>
              <code className="break-all rounded bg-muted px-1">{dir}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("playbookWizard.gui.outputAllowedUnknown")}</p>
      )}
    </div>
  );
}

export function PlaybookWizard({
  open,
  onClose,
  playbookRoots,
  versionRoots = {},
  onOpenInEditor,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Directories where playbooks may be written, in the backend's priority order. */
  playbookRoots: string[];
  /** Version -> that version's own playbook directory (subset of `playbookRoots`). */
  versionRoots?: Record<string, string>;
  onOpenInEditor?: (path: string) => void;
  /** Called after successful creation, e.g. to refresh the playbook list / preselect for run. */
  onCreated?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [schema, setSchema] = useState<WizardSchema | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState<WizardValues>({});
  const [stepIndex, setStepIndex] = useState(0);
  const [outputPath, setOutputPath] = useState("");
  const [outputTouched, setOutputTouched] = useState(false);
  const [force, setForce] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Result of the backend's output-path check: the translated reason, or null when fine.
  const [outputProblem, setOutputProblem] = useState<string | null>(null);
  // Where the secrets file may go (backend): allowed directories + odoodev's config dir.
  const [envDirs, setEnvDirs] = useState<{ dirs: string[]; config_dir: string } | null>(null);
  const [envProblem, setEnvProblem] = useState<string | null>(null);
  // The env-file path the wizard suggested itself (so it can tell it from user input).
  const [envSuggestion, setEnvSuggestion] = useState("");
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; steps?: number; error?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSchema(null);
    setLoadError(false);
    setStepIndex(0);
    setCreatedPath(null);
    setCreateError(null);
    setValidation(null);
    setForce(false);
    setOutputTouched(false);
    setEnvSuggestion("");
    setEnvProblem(null);
    invokeCmd<{ dirs: string[]; config_dir: string }>("playbook_env_dirs")
      .then(setEnvDirs)
      .catch(logError("PlaybookWizard: env dirs"));
    invokeCmd<WizardSchema>("playbook_schema")
      .then((s) => {
        setSchema(s);
        setValues(seedDefaults(s));
      })
      .catch((e) => {
        setLoadError(true);
        logError("PlaybookWizard: schema")(e);
      });
  }, [open]);

  const playbookType = (values["playbook_type"] as string) || "server";

  const steps: WizardSection[] = useMemo(() => {
    if (!schema) return [];
    const applicable = schema.sections.filter((s) => s.applies_to.includes(playbookType));
    return [...applicable, { key: SUMMARY_STEP, applies_to: [] }];
  }, [schema, playbookType]);

  const targetNames = useMemo(() => {
    const items = (values["server_targets"] as RepeatableItem[]) ?? [];
    return items
      .map((item) => (typeof item["name"] === "string" ? item["name"].trim() : ""))
      .filter(Boolean);
  }, [values]);

  // Defaults follow the CLI convention <dir>/<slug>.yaml (and <slug>.env for the
  // secrets file), rooted in a playbook directory the backend allows — the one of
  // the version being worked on, else the first. The wizard never depends on the
  // subprocess working directory, and a default always passes the backend check.
  const name = (values["name"] as string) ?? "";
  const wizardVersion = (values["version"] as string) ?? "";
  const defaultRoot = pickDefaultRoot(playbookRoots, versionRoots, wizardVersion);
  const slug = slugify(name);
  useEffect(() => {
    if (outputTouched || !slug || !defaultRoot) return;
    setOutputPath(`${defaultRoot}/${slug}.yaml`);
  }, [slug, defaultRoot, outputTouched]);

  // Secrets file: suggest <dir>/<slug>.env until the user types their own path.
  const envPathValue = String(values["env_file.path"] ?? "");
  useEffect(() => {
    const envDir = pickEnvDir(playbookType, defaultRoot, envDirs?.config_dir ?? null);
    if (!slug || !envDir) return;
    const suggestion = `${envDir}/${slug}.env`;
    if (envPathValue !== "" && envPathValue !== envSuggestion) return; // user's own path
    if (envPathValue !== suggestion) setValues((prev) => ({ ...prev, "env_file.path": suggestion }));
    if (envSuggestion !== suggestion) setEnvSuggestion(suggestion);
  }, [slug, defaultRoot, envDirs, playbookType, envPathValue, envSuggestion]);

  const pathProblem = (e: unknown): string => {
    const err = parsePathError(e);
    if (!err) return String(e);
    return t(
      err.field === "env_file"
        ? `playbookWizard.gui.envFileError.${err.code}`
        : `playbookWizard.gui.outputError.${err.code}`,
    );
  };

  // Ask the backend (same check as on submit) shortly after the user stops typing.
  // The backend alone knows the real playbook directories and resolves symlinks.
  const wantsOutputCheck = open && !!outputPath.trim() && !createdPath;
  useEffect(() => {
    if (!wantsOutputCheck) {
      setOutputProblem(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      invokeCmd<string>("playbook_check_output", { outputPath })
        .then(() => !cancelled && setOutputProblem(null))
        .catch((e) => !cancelled && setOutputProblem(pathProblem(e)));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputPath, wantsOutputCheck, t]);

  // Same for the secrets file, while the wizard is going to write one.
  const envWanted = open && !createdPath && values["env_file.generate"] !== false;
  useEffect(() => {
    if (!envWanted || !envPathValue.trim()) {
      setEnvProblem(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      invokeCmd<string>("playbook_check_output", { outputPath: envPathValue, kind: "env_file" })
        .then(() => !cancelled && setEnvProblem(null))
        .catch((e) => !cancelled && setEnvProblem(pathProblem(e)));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envPathValue, envWanted, t]);

  const currentStep = steps[stepIndex];
  const isSummary = currentStep?.key === SUMMARY_STEP;

  const setValue = (key: string, value: unknown) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  /** Schema fields of the current step, with the GUI flow fields injected. */
  const stepFields: WizardField[] = useMemo(() => {
    if (!currentStep || currentStep.repeatable || isSummary) return [];
    const fields = currentStep.fields ?? [];
    if (currentStep.key === "server_source") {
      const idx = fields.findIndex((f) => f.key === "source.mode");
      return [...fields.slice(0, idx + 1), SOURCE_TARGET_FIELD, ...fields.slice(idx + 1)];
    }
    if (currentStep.key === "server_recipe") {
      return [DESTINATION_FIELD, ...fields];
    }
    return fields;
  }, [currentStep, isSummary]);

  const stepComplete = (section: WizardSection, index: number): boolean => {
    if (index > stepIndex) return false;
    if (section.repeatable) {
      const items = (values[section.key] as RepeatableItem[]) ?? [];
      return items.length >= (section.min_items ?? 0);
    }
    return index < stepIndex;
  };

  const requiredMissing = stepFields.some(
    (f) =>
      f.required &&
      isFieldVisible(f, values) &&
      !(f.type === "confirm" || f.type === "checkbox") &&
      !String(values[f.key] ?? "").trim(),
  );

  const { answers, problems } = useMemo(
    () => (schema ? buildAnswers(schema, values, envSuggestion) : { answers: {}, problems: [] }),
    [schema, values, envSuggestion],
  );

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    setValidation(null);
    try {
      const path = await invokeCmd<string>("playbook_create", {
        answers,
        outputPath,
        force,
      });
      setCreatedPath(path);
      onCreated?.(path);
      try {
        const result = await invokeCmd<{ valid: boolean; steps?: number; error?: string }>(
          "playbook_validate",
          { path },
        );
        setValidation(result);
      } catch (e) {
        setValidation({ valid: false, error: String(e) });
      }
    } catch (e) {
      setCreateError(pathProblem(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-4xl">
      <DialogHeader>
        <DialogTitle>
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {t("playbookWizard.gui.title")}
          </span>
        </DialogTitle>
        <DialogDescription>{t("playbookWizard.gui.subtitle")}</DialogDescription>
      </DialogHeader>

      {loadError && (
        <p className="text-sm text-destructive">{t("playbookWizard.gui.loadFailed")}</p>
      )}
      {!schema && !loadError && (
        <div className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {schema && (
        <div className="flex gap-4" style={{ height: "60vh" }}>
          {/* Section list with progress */}
          <div className="w-48 shrink-0 space-y-0.5 overflow-auto border-r border-border pr-2">
            {steps.map((s, i) => (
              <button
                key={s.key}
                onClick={() => i <= stepIndex && setStepIndex(i)}
                disabled={i > stepIndex || !!createdPath}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  i === stepIndex
                    ? "bg-primary/10 font-medium text-foreground"
                    : i < stepIndex
                      ? "text-muted-foreground hover:bg-accent"
                      : "text-muted-foreground/50"
                }`}
              >
                {stepComplete(s, i) ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-green-500" />
                ) : (
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${i === stepIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
                  />
                )}
                <span className="truncate">
                  {t(`playbookWizard.gui.section.${s.key}`, s.key)}
                </span>
              </button>
            ))}
          </div>

          {/* Current step */}
          <div className="flex-1 overflow-auto pr-1">
            {currentStep && !isSummary && currentStep.repeatable && (
              <RepeatableSection
                itemFields={currentStep.item_fields ?? []}
                items={(values[currentStep.key] as RepeatableItem[]) ?? []}
                onChange={(items) => setValue(currentStep.key, items)}
                minItems={currentStep.min_items ?? 0}
                schema={schema}
                targetNames={targetNames}
              />
            )}
            {currentStep && !isSummary && !currentStep.repeatable && (
              <SchemaForm
                fields={stepFields}
                values={values}
                onChange={setValue}
                schema={schema}
                targetNames={targetNames}
                fieldExtras={{
                  "env_file.path": (
                    <div className="space-y-1">
                      {envProblem && <p className="text-xs text-destructive">{envProblem}</p>}
                      <AllowedDirs roots={envDirs?.dirs ?? playbookRoots} text={t("playbookWizard.gui.envFileAllowed")} />
                    </div>
                  ),
                }}
              />
            )}
            {isSummary && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>{t("playbookWizard.gui.outputPath")}</Label>
                  <Input
                    value={outputPath}
                    onChange={(e) => {
                      setOutputTouched(true);
                      setOutputPath(e.target.value);
                    }}
                    className="font-mono text-sm"
                  />
                  {outputProblem ? (
                    <p className="text-xs text-destructive">{outputProblem}</p>
                  ) : null}
                  <AllowedDirs roots={playbookRoots} text={t("playbookWizard.gui.outputAllowed")} />
                </div>
                <Checkbox
                  checked={force}
                  onChange={setForce}
                  label={t("playbookWizard.gui.overwriteExisting")}
                />
                {problems.length > 0 && (
                  <div className="space-y-1">
                    {problems.map((p) => (
                      <p key={p} className="text-xs text-destructive">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{t("playbookWizard.gui.summary")}</Label>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs text-muted-foreground">
                    {JSON.stringify(answers, null, 2)}
                  </pre>
                </div>
                {createError && <p className="text-sm text-destructive">{createError}</p>}
                {createdPath && validation && (
                  <p className={`text-sm ${validation.valid ? "text-green-600" : "text-destructive"}`}>
                    {validation.valid
                      ? `${t("playbookWizard.gui.created")} — ${t("playbookWizard.gui.valid", { steps: validation.steps ?? 0 })}`
                      : `${t("playbookWizard.gui.invalid")}: ${validation.error ?? ""}`}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {schema && (
        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
            disabled={stepIndex === 0 || creating || !!createdPath}
          >
            <ChevronLeft className="h-4 w-4" />
            {t("playbookWizard.gui.back")}
          </Button>
          <div className="flex gap-2">
            {!isSummary && (
              <Button
                onClick={() => setStepIndex((i) => Math.min(steps.length - 1, i + 1))}
                disabled={requiredMissing}
              >
                {t("playbookWizard.gui.next")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {isSummary && !createdPath && (
              <Button onClick={handleCreate} disabled={creating || !outputPath.trim() || problems.length > 0 || !!outputProblem || !!envProblem}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {creating ? t("playbookWizard.gui.creating") : t("playbookWizard.gui.createButton")}
              </Button>
            )}
            {createdPath && onOpenInEditor && (
              <Button variant="outline" onClick={() => onOpenInEditor(createdPath)}>
                <Pencil className="h-4 w-4" />
                {t("playbookWizard.gui.openInEditor")}
              </Button>
            )}
            {createdPath && (
              <Button onClick={onClose}>
                <Play className="h-4 w-4" />
                {t("playbookWizard.gui.runNow")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
