import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

export function Checkbox({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex items-center gap-2 cursor-pointer text-sm", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-input accent-primary"
      />
      {label && <span>{label}</span>}
    </label>
  );
}