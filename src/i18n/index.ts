import { createI18n } from "vue-i18n";
import { messages } from "./messages.ts";
import { detectInitialLocale } from "../composables/useLocale.ts";

export const i18n = createI18n({
  legacy: false,
  locale: detectInitialLocale(),
  fallbackLocale: "en",
  messages,
});
