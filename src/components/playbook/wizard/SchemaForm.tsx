import { FieldControl } from "./FieldControl";
import type { WizardField, WizardSchema, WizardValues } from "../../../types/playbookSchema";

/** depends_on is a flat single-condition model resolved against the GLOBAL
 *  wizard values (field keys share one namespace across sections). */
export function isFieldVisible(field: WizardField, values: WizardValues): boolean {
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
}: {
  fields: WizardField[];
  values: WizardValues;
  onChange: (key: string, value: unknown) => void;
  schema: WizardSchema;
  targetNames: string[];
}) {
  return (
    <div className="space-y-4">
      {fields
        .filter((f) => isFieldVisible(f, values))
        .map((f) => (
          <FieldControl
            key={f.key}
            field={f}
            value={values[f.key]}
            onChange={(v) => onChange(f.key, v)}
            schema={schema}
            targetNames={targetNames}
          />
        ))}
    </div>
  );
}
