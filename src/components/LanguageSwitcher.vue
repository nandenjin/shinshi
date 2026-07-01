<script setup lang="ts">
import { useI18n } from "vue-i18n";
import {
  persistLocale,
  type SupportedLocale,
} from "../composables/useLocale.ts";

const { locale, t } = useI18n();

function selectLocale(next: SupportedLocale): void {
  locale.value = next;
  persistLocale(next);
}
</script>

<template>
  <div class="language-switcher">
    <span class="field-label">{{ t("languageSwitcher.label") }}</span>
    <div class="lang-buttons">
      <button
        type="button"
        class="lang-btn"
        :class="{ active: locale === 'en' }"
        @click="selectLocale('en')"
      >
        EN
      </button>
      <button
        type="button"
        class="lang-btn"
        :class="{ active: locale === 'ja' }"
        @click="selectLocale('ja')"
      >
        日本語
      </button>
    </div>
  </div>
</template>

<style scoped>
.language-switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lang-buttons {
  display: flex;
  gap: 6px;
}

.lang-btn {
  padding: 4px 10px;
  font-size: 0.78rem;
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  transition: border-color 0.15s;
}

.lang-btn:hover {
  border-color: var(--color-accent);
}

.lang-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
