import { cn } from "../../lib/utils";

interface SegmentedControlProps {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function SegmentedControl({ options, value, onChange, className }: SegmentedControlProps) {
  return (
    <div className={cn("inline-flex rounded-md border border-border p-0.5", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-sm px-3 py-1 text-sm font-medium transition-colors",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}