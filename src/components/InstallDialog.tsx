import { useState } from "react";
import { useAppStore } from "../store/appStore";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";
import { Button } from "./ui/button";

export function InstallDialog() {
  const odoodevInfo = useAppStore((s) => s.odoodevInfo);
  const uvInfo = useAppStore((s) => s.uvInfo);
  const firstRunChecked = useAppStore((s) => s.firstRunChecked);
  const installUv = useAppStore((s) => s.installUv);
  const installOdoodev = useAppStore((s) => s.installOdoodev);
  const checkUvStatus = useAppStore((s) => s.checkUvStatus);
  const checkOdoodevStatus = useAppStore((s) => s.checkOdoodevStatus);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsUv = !uvInfo?.installed;
  const needsOdoodev = !odoodevInfo?.installed;
  const show = firstRunChecked && (needsUv || needsOdoodev);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      // uv must be installed first — odoodev is installed via `uv tool`.
      // installUv() re-throws on failure, so we won't attempt odoodev if uv fails.
      if (needsUv) {
        await installUv();
      }
      if (needsOdoodev) {
        await installOdoodev();
      }
      await checkUvStatus();
      await checkOdoodevStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  if (!show) return null;

  return (
    <Dialog open onClose={() => {}} className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {needsUv ? "uv is not installed" : "odoodev is not installed"}
        </DialogTitle>
        <DialogDescription>
          {needsUv
            ? "uv is the Python package manager needed to install and update odoodev."
            : "odoodev is the CLI tool that this GUI controls. It will be installed via uv."}
        </DialogDescription>
      </DialogHeader>
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button onClick={handleInstall} disabled={installing}>
          {installing ? "Installing..." : needsUv ? "Install uv now" : "Install now"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}