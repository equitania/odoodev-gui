import { useTranslation } from "react-i18next";
import { Button } from "../../ui/button";
import { FieldControl } from "./FieldControl";
import { Plus, Trash2 } from "lucide-react";
import type { WizardField, WizardSchema } from "../../../types/playbookSchema";

export type RepeatableItem = Record<string, unknown>;

function emptyItem(itemFields: WizardField[]): RepeatableItem {
  const item: RepeatableItem = {};
  for (const f of itemFields) {
    if (f.default != null) item[f.key] = f.default;
  }
  return item;
}

/** Add/remove/edit rows for a repeatable section (server_targets,
 *  server_extra_steps). Item field keys are item-local (not dot-paths into
 *  the global namespace); depends_on is not used inside item_fields. */
export function RepeatableSection({
  itemFields,
  items,
  onChange,
  minItems,
  schema,
  targetNames,
}: {
  itemFields: WizardField[];
  items: RepeatableItem[];
  onChange: (items: RepeatableItem[]) => void;
  minItems: number;
  schema: WizardSchema;
  targetNames: string[];
}) {
  const { t } = useTranslation();

  const updateItem = (i: number, key: string, value: unknown) =>
    onChange(items.map((item, j) => (j === i ? { ...item, [key]: value } : item)));

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="space-y-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">#{i + 1}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={items.length <= minItems}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              title={t("playbookWizard.gui.removeItem")}
              type="button"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {itemFields.map((f) => (
            <FieldControl
              key={f.key}
              field={f}
              value={item[f.key]}
              onChange={(v) => updateItem(i, f.key, v)}
              schema={schema}
              targetNames={targetNames}
            />
          ))}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => onChange([...items, emptyItem(itemFields)])}
        type="button"
      >
        <Plus className="h-3.5 w-3.5" />
        {t("playbookWizard.gui.addItem")}
      </Button>
    </div>
  );
}
