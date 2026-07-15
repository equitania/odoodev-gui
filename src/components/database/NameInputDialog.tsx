import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// Mirrors the CLI's _validate_db_name: letters/digits/underscore, no leading digit.
const DB_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Asks for a new database name (used by Duplicate and Rename).
 *  window.prompt() is not available in Tauri's WebView — this Dialog is the
 *  proper replacement, with the CLI's name rules validated client-side. */
export function NameInputDialog({
  open,
  onClose,
  title,
  description,
  sourceName,
  existingNames,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  sourceName: string;
  existingNames: string[];
  confirmLabel: string;
  onConfirm: (newName: string) => void;
}) {
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const invalid = trimmed.length > 0 && !DB_NAME_RE.test(trimmed);
  const duplicate = existingNames.includes(trimmed);
  const canConfirm = trimmed.length > 0 && !invalid && !duplicate && trimmed !== sourceName;

  const confirm = () => {
    if (!canConfirm) return;
    onConfirm(trimmed);
    setName("");
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="text-sm">
          Source: <span className="font-mono">{sourceName}</span>
        </div>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          placeholder={`${sourceName}_copy`}
          className="font-mono text-sm"
          autoFocus
        />
        {invalid && (
          <p className="text-xs text-destructive">
            Only letters, digits and underscore; must not start with a digit.
          </p>
        )}
        {duplicate && (
          <p className="text-xs text-destructive">A database with this name already exists.</p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button disabled={!canConfirm} onClick={confirm}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
