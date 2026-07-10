import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import type { BackupArgs } from "../../types";
import { invokeCmd } from "../../lib/tauri";

export function BackupDialog({
  open,
  onClose,
  version,
  dbName,
  onProgress,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  dbName: string;
  onProgress: (title: string, eventName: string) => void;
}) {
  const [format, setFormat] = useState("zip");
  const [level, setLevel] = useState(5);
  const [outputDir, setOutputDir] = useState("");

  const handleBackup = async () => {
    const args: BackupArgs = {
      version,
      name: dbName,
      type: format,
      output_dir: outputDir || undefined,
      level: format === "tar.zst" ? level : undefined,
    };
    onClose();
    onProgress(`Backup: ${dbName}`, "backup-progress");
    try {
      await invokeCmd("backup_db", { args });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Backup Database</DialogTitle>
        <DialogDescription>Creating a backup of <code className="rounded bg-muted px-1">{dbName}</code> (v{version})</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Format</Label>
          <Select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="sql">SQL</option>
            <option value="zip">ZIP</option>
            <option value="tar.zst">tar.zst</option>
          </Select>
        </div>
        {format === "tar.zst" && (
          <div className="space-y-2">
            <Label>Compression level ({level})</Label>
            <input
              type="range"
              min={1}
              max={22}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
              className="w-full"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label>Output directory (default: ~/Downloads)</Label>
          <Input
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="~/Downloads"
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleBackup}>Backup</Button>
      </DialogFooter>
    </Dialog>
  );
}