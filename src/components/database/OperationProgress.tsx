import { useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";

export function OperationProgress({
  open,
  onClose,
  title,
  eventName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eventName: string;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [success, setSuccess] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setLines([]);
      setDone(false);
      setSuccess(null);
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
  }, [lines]);

  return (
    <Dialog open={open} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <div className="flex items-center gap-2">
          {done ? (
            success ? <CheckCircle2 className="h-5 w-5 text-green-500" /> : <XCircle className="h-5 w-5 text-red-500" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          )}
          <DialogTitle>{title}</DialogTitle>
        </div>
      </DialogHeader>
      <div ref={scrollRef} className="h-64 overflow-auto rounded-md border border-border bg-muted/50 p-2">
        <pre className="whitespace-pre-wrap break-all font-mono text-xs">{lines.join("\n") || "Waiting..."}</pre>
      </div>
      <DialogFooter>
        <Button onClick={onClose} disabled={!done && success === null}>
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}