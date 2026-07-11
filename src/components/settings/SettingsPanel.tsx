import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { useAppStore } from "../../store/appStore";
import { invokeCmd } from "../../lib/tauri";
import { logError, reportError } from "../../lib/errors";
import { setLanguage } from "../../i18n";

export function SettingsPanel() {
  const { t, i18n } = useTranslation();
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
  const [lang, setLang] = useState(i18n.language || "en");

  useEffect(() => {
    invokeCmd<string>("get_app_version").then(setAppVersion).catch(logError("SettingsPanel: get_app_version"));
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

  const handleLanguageChange = (newLang: string) => {
    setLang(newLang);
    setLanguage(newLang);
  };

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold">{t("settings.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.odoodev")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("settings.installedVersion")}</span>
            <span className="font-mono">{odoodevInfo?.version ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("settings.latestVersion")}</span>
            <span className="font-mono">{updateCheck?.latest_version ?? "—"}</span>
          </div>
          {updateCheck?.update_available && (
            <Button onClick={handleUpdate} disabled={updating} className="mt-2">
              {updating ? "..." : t("settings.updateOdoodev")}
            </Button>
          )}
          <Button variant="outline" onClick={handleReinstall} disabled={updating} className="mt-2 ml-2">
            {t("settings.reinstallOdoodev")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.uv")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("common.version")}</span>
            <span className="font-mono">{uvInfo?.version ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("common.path")}</span>
            <span className="font-mono text-xs">{uvInfo?.path ?? "—"}</span>
          </div>
          <Button variant="outline" onClick={() => invokeCmd("install_uv").catch(reportError("uv reinstall failed"))} className="mt-2">
            {t("common.reinstall")} uv
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.gui")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("common.version")}</span>
            <span className="font-mono">{appVersion}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.language")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => handleLanguageChange("en")}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition-all ${
                lang === "en"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              English
            </button>
            <button
              onClick={() => handleLanguageChange("de")}
              className={`rounded-md border px-4 py-2 text-sm font-medium transition-all ${
                lang === "de"
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              Deutsch
            </button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.about")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>{t("settings.aboutText")}</p>
          <p>{t("settings.copyright")}</p>
          <p>{t("settings.license")}</p>
          <button
            onClick={() => invokeCmd("open_external", { url: "https://github.com/equitania/odoodev-gui" }).catch(reportError("Could not open link"))}
            className="text-blue-500 hover:underline"
          >
            {t("settings.githubLink")}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}