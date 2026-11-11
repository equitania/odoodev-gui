import type { ReactNode } from "react";
import { FieldControl } from "./FieldControl";
import type { WizardField, WizardSchema, WizardValues } from "../../../types/playbookSchema";

/** depends_on is a flat single-condition model resolved against the GLOBAL
 *  wizard values (field keys share one namespace across sections). */
export function isFieldVisible(field: WizardField, values: WizardValues): boolean {
  // Since odoodev 0.73 the rebuild always belongs to the destination: behind the
  // restore it is the update of the restored database, and picking the source
  // here would rebuild the wrong instance. The schema still carries the field.
  if (field.key === "recipe.rebuild.target") return false;
  if (!field.depends_on) return true;
  const actual = values[field.depends_on];
  return actual === field.depends_value;
}

/** Renders a flat field list (one section) against the global values map. */
export function SchemaForm({
  fields,
  values,
  onChange,
  schema,
  targetNames,
  fieldExtras,
}: {
  fields: WizardField[];
  values: WizardValues;
  onChange: (key: string, value: unknown) => void;
  schema: WizardSchema;
  targetNames: string[];
  /** Extra content rendered under a field, by field key. */
  fieldExtras?: Record<string, ReactNode>;
}) {
  return (
    <div className="space-y-4">
      {fields
        .filter((f) => isFieldVisible(f, values))
        .map((f) => (
          <div key={f.key} className="space-y-1.5">
            <FieldControl
              field={f}
              value={values[f.key]}
              onChange={(v) => onChange(f.key, v)}
              schema={schema}
              targetNames={targetNames}
            />
            {fieldExtras?.[f.key]}
          </div>
        ))}
    </div>
  );
}
