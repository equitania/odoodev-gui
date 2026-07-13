import { useTranslation } from "react-i18next";
import { CircleCheckBig, CircleX, Loader2 } from "lucide-react";
import type { SemanticValidation, YamlError } from "../../types";

interface ValidationPanelProps {
  yamlError: YamlError | null;
  semantic: SemanticValidation | null;
  validating: boolean;
}

export function ValidationPanel({ yamlError, semantic, validating }: ValidationPanelProps) {
  const { t } = useTranslation();

  if (!yamlError && !semantic && !validating) return null;

  return (
    <div className="space-y-1.5 border-t border-border px-3 py-2 text-xs">
      {yamlError && (
        <p className="flex items-start gap-1.5 text-destructive">
          <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t("editor.invalidYaml")}
            {yamlError.line != null && ` (${t("editor.line")} ${yamlError.line})`}
            {": "}
            <span className="font-mono">{yamlError.message}</span>
          </span>
        </p>
      )}
      {validating && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("editor.validating")}
        </p>
      )}
      {!validating && semantic && semantic.valid && (
        <p className="flex items-center gap-1.5 text-green-600">
          <CircleCheckBig className="h-3.5 w-3.5" />
          {t("editor.semanticValid")}
        </p>
      )}
      {!validating && semantic && !semantic.valid && (
        <p className="flex items-start gap-1.5 text-destructive">
          <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {t("editor.semanticInvalid")}
            {semantic.message && (
              <>
                {": "}
                <span className="font-mono">{semantic.message}</span>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );
}
