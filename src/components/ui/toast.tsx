import { CircleCheckBig, CircleX, Loader2, Info, X } from "lucide-react";
import { useToastStore } from "../../store/toastStore";
import { cn } from "../../lib/utils";

const TOAST_STYLES = {
  success: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  error: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
  info: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  loading: "border-border bg-card text-foreground",
};

function ToastIcon({ type }: { type: "success" | "error" | "info" | "loading" }) {
  switch (type) {
    case "success":
      return <CircleCheckBig className="h-4 w-4 text-green-500" />;
    case "error":
      return <CircleX className="h-4 w-4 text-red-500" />;
    case "loading":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case "info":
      return <Info className="h-4 w-4 text-blue-500" />;
  }
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-2 rounded-lg border px-4 py-3 shadow-lg min-w-[280px] max-w-[400px] animate-in slide-in-from-right",
            TOAST_STYLES[t.type],
          )}
        >
          <ToastIcon type={t.type} />
          <div className="flex-1">
            <p className="text-sm font-medium">{t.message}</p>
            {t.detail && <p className="mt-0.5 text-xs opacity-80">{t.detail}</p>}
          </div>
          {t.type !== "loading" && (
            <button
              onClick={() => removeToast(t.id)}
              className="opacity-50 hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}