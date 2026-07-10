import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { useAppStore } from "../../store/appStore";
import { invokeCmd } from "../../lib/tauri";

export function SettingsPanel() {
  const odoodevInfo = useAppStore((s) => s.odoodevInfo);
  const uvInfo = useAppStore((s) => s.uvInfo);
  const updateCheck = useAppStore((s) => s.updateCheck);
  const updateOdoodev = useAppStore((s) => s.updateOdoodev);
  const checkOdoodevUpdate = useAppStore((s) => s.checkOdoodevUpdate);
  const checkUvStatus = useAppStore((s) => s.checkUvStatus);
  const checkOdoodevStatus = useAppStore((s) => s.checkOdoodevStatus);
  const installOdoodev = useAppStore((s) => s.installOdoodev);

  const [appVersion, setAppVersion] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    invokeCmd<string>("get_app_version").then(setAppVersion).catch(() => {});
    checkOdoodevUpdate();
    checkUvStatus();
    checkOdoodevStatus();
  }, [checkOdoodevUpdate, checkUvStatus, checkOdoodevStatus]);

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await updateOdoodev();
    } finally {
      setUpdating(false);
    }
  };

  const handleReinstall = async () => {
    setUpdating(true);
    try {
      await installOdoodev();
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>odoodev</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Installed version</span>
            <span className="font-mono">{odoodevInfo?.version ?? "not installed"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Latest version</span>
            <span className="font-mono">{updateCheck?.latest_version ?? "—"}</span>
          </div>
          {updateCheck?.update_available && (
            <Button onClick={handleUpdate} disabled={updating} className="mt-2">
              {updating ? "Updating..." : `Update odoodev to v${updateCheck.latest_version}`}
            </Button>
          )}
          <Button variant="outline" onClick={handleReinstall} disabled={updating} className="mt-2 ml-2">
            Reinstall odoodev
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>uv</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">{uvInfo?.version ?? "not installed"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Path</span>
            <span className="font-mono text-xs">{uvInfo?.path ?? "—"}</span>
          </div>
          <Button variant="outline" onClick={() => invokeCmd("install_uv")} className="mt-2">
            Reinstall uv
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GUI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono">{appVersion}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>odoodev-gui — Odoo Development Manager</p>
          <p>Copyright 2025 Equitania Software GmbH</p>
          <p>License: AGPL-3.0</p>
          <button
            onClick={() => invokeCmd("open_external", { url: "https://github.com/equitania/odoodev-gui" })}
            className="text-blue-500 hover:underline"
          >
            GitHub Repository
          </button>
        </CardContent>
      </Card>
    </div>
  );
}