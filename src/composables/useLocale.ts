export type SupportedLocale = "en" | "ja";

const LOCALE_STORAGE_KEY = "shinshi:locale";

function isSupportedLocale(value: string | null): value is SupportedLocale {
  return value === "en" || value === "ja";
}

/** Detect the initial locale: explicit prior choice > browser language > 'en'. */
export function detectInitialLocale(): SupportedLocale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isSupportedLocale(stored)) return stored;
  return navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";
}

/** Persist the user's explicit locale choice so it sticks across reloads. */
export function persistLocale(locale: SupportedLocale): void {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
