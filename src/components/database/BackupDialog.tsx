import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select } from "../ui/select";
import type { BackupArgs, BackupResult } from "../../types";
import { invokeCmd } from "../../lib/tauri";
import { defaultBackupDir, rememberBackupDir } from "../../lib/backupDir";
import { FolderOpen } from "lucide-react";

export function BackupDialog({
  open: isOpen,
  onClose,
  version,
  dbName,
  onProgress,
  onFinished,
}: {
  open: boolean;
  onClose: () => void;
  version: string;
  dbName: string;
  onProgress: (title: string, eventName: string) => void;
  onFinished: (success: boolean, message?: string) => void;
}) {
  const [format, setFormat] = useState("zip");
  const [level, setLevel] = useState(5);
  const [outputDir, setOutputDir] = useState("");

  const browseOutputDir = async () => {
    const picked = await open({
      directory: true,
      defaultPath: outputDir || (await defaultBackupDir()),
      title: "Select backup output directory",
    });
    if (typeof picked === "string") {
      setOutputDir(picked);
      rememberBackupDir(picked);
    }
  };

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
      const result = await invokeCmd<BackupResult>("backup_db", { args });
      const detail = result.path
        ? `${result.path}${result.size ? ` (${result.size})` : ""}`
        : undefined;
      onFinished(result.success, result.success ? detail : result.error ?? undefined);
    } catch (e) {
      onFinished(false, String(e));
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose}>
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
          <div className="flex gap-2">
            <Input
              value={outputDir}
              onChange={(e) => setOutputDir(e.target.value)}
              placeholder="~/Downloads"
              className="flex-1"
            />
            <Button variant="outline" size="sm" onClick={browseOutputDir} className="h-9">
              <FolderOpen className="h-3.5 w-3.5" />
              Browse
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleBackup}>Backup</Button>
      </DialogFooter>
    </Dialog>
  );
}
