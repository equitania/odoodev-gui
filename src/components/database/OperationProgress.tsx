import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { CircleCheckBig, CircleX, Loader2 } from "lucide-react";

/** Streams CLI output lines for a long-running DB operation. Completion is
 *  controlled by the parent: the resolved invoke promise is the done signal. */
export function OperationProgress({
  open,
  onClose,
  title,
  eventName,
  done,
  success,
  finalMessage,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eventName: string;
  done: boolean;
  success: boolean | null;
  finalMessage?: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setLines([]);
      return;
    }
    let unlisten: UnlistenFn | null = null;
    (async () => {
      unlisten = await listen<string>(eventName, (event) => {
        setLines((prev) => [...prev, event.payload]);
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [open, eventName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, done]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <div className="flex items-center gap-2">
          {done ? (
            success ? <CircleCheckBig className="h-5 w-5 text-green-500" /> : <CircleX className="h-5 w-5 text-red-500" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          )}
          <DialogTitle>{title}</DialogTitle>
        </div>
      </DialogHeader>
      <div ref={scrollRef} className="h-64 overflow-auto rounded-md border border-border bg-muted/50 p-2">
        <pre className="whitespace-pre-wrap break-all font-mono text-xs">{lines.join("\n") || "Waiting..."}</pre>
      </div>
      {done && finalMessage && (
        <p className={`text-sm ${success ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {finalMessage}
        </p>
      )}
      <DialogFooter>
        <Button onClick={onClose} disabled={!done}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
