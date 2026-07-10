import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function DropConfirmDialog({
  open,
  onClose,
  dbName,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  dbName: string;
  onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");

  const matches = confirmText === dbName;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Drop database '{dbName}'?</DialogTitle>
        <DialogDescription>
          This action cannot be undone. All data will be permanently lost.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-sm">Type the database name to confirm:</p>
        <Input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={dbName}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          variant="destructive"
          disabled={!matches}
          onClick={() => {
            onConfirm();
            setConfirmText("");
          }}
        >
          Drop
        </Button>
      </DialogFooter>
    </Dialog>
  );
}