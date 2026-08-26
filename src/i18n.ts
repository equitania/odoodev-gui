import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import de from "./locales/de.json";

const STORAGE_KEY = "odoodev-gui-language";

function detectLanguage(): string {
  // This runs before the first render — a throwing storage accessor (private
  // mode, blocked site data) must not take the whole app down with it.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "de") {
      return stored;
    }
  } catch {
    // fall through to the browser language
  }
  const nav = navigator.language.toLowerCase();
  if (nav.startsWith("de")) {
    return "de";
  }
  return "en";
}

export function setLanguage(lang: string) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // The choice still applies to this session, it just won't be remembered.
  }
  i18n.changeLanguage(lang);
}

export function getLanguage(): string {
  return i18n.language || "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;