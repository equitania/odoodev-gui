import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Select } from "../../ui/select";
import { Textarea } from "../../ui/textarea";
import { Checkbox } from "../../ui/checkbox";
import { Button } from "../../ui/button";
import { Badge } from "../../ui/badge";
import { Eye, EyeOff, Plus, X } from "lucide-react";
import { resolveLabel } from "./labels";
import type { WizardField, WizardSchema } from "../../../types/playbookSchema";

export type MapRow = { key: string; value: string };

/** One rendered form control for a single schema field.
 *  Value shapes per type: text/password/path/select/json → string,
 *  confirm → boolean, int → number|"", checkbox/list[*] → string[],
 *  map[*] → MapRow[]. Conversion to answers JSON happens in buildAnswers. */
export function FieldControl({
  field,
  value,
  onChange,
  schema,
  targetNames,
}: {
  field: WizardField;
  value: unknown;
  onChange: (value: unknown) => void;
  schema: WizardSchema;
  /** Live names from the server_targets section — feeds choices_source: "targets". */
  targetNames: string[];
}) {
  const { t } = useTranslation();
  const label = resolveLabel(field.label_key, field.key);
  const required = field.required ?? false;

  const labelRow = (
    <Label className="flex items-baseline gap-1.5">
      {label}
      {required && (
        <span className="text-xs text-muted-foreground">({t("playbookWizard.gui.requiredHint")})</span>
      )}
    </Label>
  );

  switch (field.type) {
    case "text":
    case "path": {
      const str = typeof value === "string" ? value : "";
      return (
        <div className="space-y-1.5">
          {labelRow}
          <Input
            value={str}
            onChange={(e) => onChange(e.target.value)}
            placeholder={typeof field.default === "string" ? field.default : ""}
            className="font-mono text-sm"
          />
        </div>
      );
    }

    case "password":
      return (
        <div className="space-y-1.5">
          {labelRow}
          <SecretInput value={typeof value === "string" ? value : ""} onChange={onChange} />
        </div>
      );

    case "int": {
      const num = typeof value === "number" ? String(value) : "";
      return (
        <div className="space-y-1.5">
          {labelRow}
          <Input
            type="number"
            value={num}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              onChange(Number.isNaN(parsed) ? undefined : parsed);
            }}
            placeholder={field.default != null ? String(field.default) : ""}
            className="w-40 font-mono text-sm"
          />
        </div>
      );
    }

    case "confirm":
      return (
        <Checkbox
          checked={typeof value === "boolean" ? value : Boolean(field.default)}
          onChange={onChange}
          label={label}
        />
      );

    case "select": {
      const choices = field.choices_source === "targets" ? targetNames : (field.choices ?? []);
      const str = typeof value === "string" ? value : "";
      return (
        <div className="space-y-1.5">
          {labelRow}
          {field.choices_source === "targets" && choices.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("playbookWizard.gui.noTargets")}</p>
          ) : (
            <Select value={str} onChange={(e) => onChange(e.target.value)}>
              <option value="">{t("playbookWizard.gui.selectPlaceholder")}</option>
              {choices.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </div>
      );
    }

    // Multi-select from choices (NOT a boolean — that is "confirm").
    case "checkbox": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      const groups = field.key === "dev_steps" ? schema.dev_step_groups : undefined;
      const grouped: [string, string[]][] = groups
        ? Object.entries(groups)
        : [["", field.choices ?? []]];
      const toggle = (c: string) =>
        onChange(selected.includes(c) ? selected.filter((s) => s !== c) : [...selected, c]);
      return (
        <div className="space-y-2">
          {labelRow}
          {grouped.map(([group, choices]) => (
            <div key={group} className="space-y-1">
              {group && <p className="text-xs font-medium text-muted-foreground">{group}</p>}
              <div className="grid grid-cols-2 gap-1">
                {choices.map((c) => (
                  <Checkbox key={c} checked={selected.includes(c)} onChange={() => toggle(c)} label={<span className="font-mono text-xs">{c}</span>} />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    case "json": {
      const str = typeof value === "string" ? value : "";
      let invalid = false;
      if (str.trim()) {
        try {
          JSON.parse(str);
        } catch {
          invalid = true;
        }
      }
      return (
        <div className="space-y-1.5">
          {labelRow}
          <Textarea
            value={str}
            onChange={(e) => onChange(e.target.value)}
            placeholder='["arg1", {"key": "value"}]'
            className="font-mono text-xs"
            rows={3}
          />
          {invalid && <p className="text-xs text-destructive">{t("playbookWizard.gui.jsonInvalid")}</p>}
        </div>
      );
    }

    case "list[str]":
    case "list[sql]":
      return (
        <div className="space-y-1.5">
          {labelRow}
          <ListEditor
            items={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
            sqlPresets={field.type === "list[sql]" ? schema.sql_presets : undefined}
          />
        </div>
      );

    case "map[str]":
    case "map[secret_text]":
      return (
        <div className="space-y-1.5">
          {labelRow}
          <MapEditor
            rows={Array.isArray(value) ? (value as MapRow[]) : []}
            onChange={onChange}
            secret={field.type === "map[secret_text]"}
            keySuggestions={field.key === "env_file.secrets" ? (schema.rpc_env_keys ?? []) : []}
          />
        </div>
      );

    default:
      // Unknown field type from a newer CLI: degrade to a plain text input.
      return (
        <div className="space-y-1.5">
          {labelRow}
          <Input
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="font-mono text-sm"
          />
        </div>
      );
  }
}

function SecretInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-1">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-sm"
        autoComplete="off"
      />
      <Button size="sm" variant="ghost" onClick={() => setVisible((v) => !v)} type="button">
        {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

function ListEditor({
  items,
  onChange,
  sqlPresets,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  sqlPresets?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed) {
      onChange([...items, trimmed]);
      setInput("");
    }
  };

  const insertPreset = (presetKey: string) => {
    const preset = sqlPresets?.[presetKey] as
      | { statements?: string[]; prompt_key?: string; prompt_default?: string }
      | undefined;
    if (!preset?.statements) return;
    // Substitute the preset's prompt placeholder with its default; the user
    // edits the inserted statement afterwards (mirrors the CLI wizard default).
    const statements = preset.prompt_key
      ? preset.statements.map((s) =>
          s.split(`{${preset.prompt_key}}`).join(preset.prompt_default ?? ""),
        )
      : preset.statements;
    onChange([...items, ...statements]);
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-1">
          <Textarea
            value={item}
            onChange={(e) => onChange(items.map((s, j) => (j === i ? e.target.value : s)))}
            className="min-h-[36px] font-mono text-xs"
            rows={1}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex gap-1">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={sqlPresets ? t("playbookWizard.gui.sqlCustomPlaceholder") : ""}
          className="font-mono text-xs"
        />
        <Button size="sm" variant="outline" onClick={add} type="button">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {sqlPresets && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-xs text-muted-foreground">{t("playbookWizard.gui.sqlPreset")}:</span>
          {Object.entries(sqlPresets).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              onClick={() => insertPreset(key)}
              className="cursor-pointer"
              title={key}
            >
              <Badge variant="outline">
                {resolveLabel((preset as { label_key?: string }).label_key, key)}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MapEditor({
  rows,
  onChange,
  secret,
  keySuggestions,
}: {
  rows: MapRow[];
  onChange: (rows: MapRow[]) => void;
  secret: boolean;
  keySuggestions: string[];
}) {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<MapRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const unusedSuggestions = keySuggestions.filter((k) => !rows.some((r) => r.key === k));

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1">
          <Input
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder={t("playbookWizard.gui.keyPlaceholder")}
            className="w-1/3 font-mono text-xs uppercase"
          />
          {secret ? (
            <SecretInput value={row.value} onChange={(v) => update(i, { value: v })} />
          ) : (
            <Input
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              placeholder={t("playbookWizard.gui.valuePlaceholder")}
              className="font-mono text-xs"
            />
          )}
          <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} type="button">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => onChange([...rows, { key: "", value: "" }])} type="button">
          <Plus className="h-3.5 w-3.5" />
          {t("playbookWizard.gui.addItem")}
        </Button>
        {unusedSuggestions.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange([...rows, { key: k, value: "" }])}
            className="cursor-pointer"
          >
            <Badge variant="outline">
              <span className="font-mono text-xs">{k}</span>
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
