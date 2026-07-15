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

export function PlaybookWizard({
  open,
  onClose,
  playbookRoots,
  onOpenInEditor,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  playbookRoots: string[];
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

  // Default output path follows the CLI convention ./playbooks/<slug>.yaml,
  // but rooted in a known playbook root so the GUI never depends on the
  // subprocess working directory.
  const name = (values["name"] as string) ?? "";
  useEffect(() => {
    if (outputTouched || !name.trim()) return;
    const root = playbookRoots[0] ?? "playbooks";
    setOutputPath(`${root}/${slugify(name)}.yaml`);
  }, [name, playbookRoots, outputTouched]);

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
    () => (schema ? buildAnswers(schema, values) : { answers: {}, problems: [] }),
    [schema, values],
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
      setCreateError(String(e));
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
              <Button onClick={handleCreate} disabled={creating || !outputPath.trim() || problems.length > 0}>
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
