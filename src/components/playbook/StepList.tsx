import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

interface StepListProps {
  steps: string[];
  selected: string[];
  onToggle: (step: string) => void;
}

export function StepList({ steps, selected, onToggle }: StepListProps) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {steps.map((step) => {
        const isSel = selected.includes(step);
        return (
          <button
            key={step}
            onClick={() => onToggle(step)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs font-mono transition-all",
              isSel
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                isSel
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30",
              )}
            >
              {isSel && <Check className="h-3 w-3" />}
            </span>
            {step}
          </button>
        );
      })}
    </div>
  );
}