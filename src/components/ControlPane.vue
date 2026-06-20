<script setup lang="ts">
import FileImportPanel from "./FileImportPanel.vue";
import ThicknessControl from "./ThicknessControl.vue";
import CutPlaneControl from "./CutPlaneControl.vue";
import ExportPanel from "./ExportPanel.vue";
</script>

<template>
  <aside>
    <FileImportPanel />
    <hr class="divider" />
    <ThicknessControl />
    <hr class="divider" />
    <CutPlaneControl />
    <hr class="divider" />
    <ExportPanel />
  </aside>
</template>

<style scoped>
aside {
  background: var(--color-pane-bg);
  border-left: 1px solid var(--color-border);
  padding: 16px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
}

.divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0;
}

/* ── Child element defaults ────────────────────────────────────────────── */

:deep(h2) {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-label);
  margin: 0;
}

:deep(.field-label) {
  font-size: 0.8rem;
  color: var(--color-label);
}

:deep(.toggle-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: var(--color-label);
  cursor: pointer;
  user-select: none;
}

:deep(input[type="number"]) {
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  padding: 4px 6px;
  font-size: 0.85rem;
  width: 100%;
  min-width: 0;
}

:deep(input[type="number"]:focus) {
  outline: none;
  border-color: var(--color-accent);
}

:deep(select) {
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  padding: 4px 6px;
  font-size: 0.85rem;
  cursor: pointer;
}

:deep(select:focus) {
  outline: none;
  border-color: var(--color-accent);
}

:deep(button) {
  border-radius: 4px;
  cursor: pointer;
}

:deep(button:disabled) {
  opacity: 0.4;
  cursor: not-allowed;
}

:deep(button:not(:disabled):hover) {
  opacity: 0.85;
}

:deep(fieldset) {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 8px;
  margin: 0;
}
</style>
