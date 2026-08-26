import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, CircleCheckBig, Terminal } from "lucide-react";
import { Button } from "../ui/button";

interface SetupProgressProps {
  version: string;
  lines: string[];
  running: boolean;
  onClose: () => void;
}

export function SetupProgress({ version, lines, running, onClose }: SetupProgressProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t("venv.setupProgress", { version })}</span>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <CircleCheckBig className="h-4 w-4 text-green-500" />
          )}
        </div>
        {!running && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
        )}
      </div>
      <div
        ref={scrollRef}
        className="max-h-64 overflow-auto rounded-md bg-black/90 p-3 font-mono text-xs leading-relaxed text-green-400"
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground">{t("common.waitingForOutput")}</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}