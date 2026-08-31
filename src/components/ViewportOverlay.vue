<script setup lang="ts">
import { moldStore } from "../composables/useMoldStore.ts";

const showGizmo = defineModel<boolean>("showGizmo", { default: true });
</script>

<template>
  <div class="viewport-overlay">
    <!-- Display options -->
    <label class="toggle-row" data-onboarding="section-mode">
      <input v-model="moldStore.showSection" type="checkbox" />
      <span class="label">断面を表示</span>
    </label>
    <template v-if="moldStore.showSection">
      <label class="toggle-row">
        <input v-model="moldStore.sectionFlipped" type="checkbox" />
        <span class="label">反対側の断面を表示</span>
      </label>
    </template>

    <!-- Gizmo toggle -->
    <label class="toggle-row">
      <input v-model="showGizmo" type="checkbox" />
      <span class="label">ツールを表示</span>
    </label>

    <!-- Gizmo mode (Blender-style: move / rotate) -->
    <template v-if="showGizmo">
      <div class="mode-buttons" data-onboarding="gizmo-mode">
        <button
          type="button"
          class="mode-btn"
          :class="{ active: moldStore.gizmoMode === 'translate' }"
          title="移動 (G)"
          @click="moldStore.gizmoMode = 'translate'"
        >
          移動
        </button>
        <button
          type="button"
          class="mode-btn"
          :class="{ active: moldStore.gizmoMode === 'rotate' }"
          title="回転 (R)"
          @click="moldStore.gizmoMode = 'rotate'"
        >
          回転
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.viewport-overlay {
  position: absolute;
  top: 12px;
  left: 12px;
  background: color-mix(in srgb, var(--color-pane-bg) 88%, transparent);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 160px;
  pointer-events: auto;
  backdrop-filter: blur(4px);
}

.overlay-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 0.75rem;
  color: var(--color-label);
  user-select: none;
}

select {
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  color: var(--color-text);
  padding: 3px 6px;
  font-size: 0.8rem;
  cursor: pointer;
  width: 100%;
}

select:focus {
  outline: none;
  border-color: var(--color-accent);
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;

  input[type="checkbox"] {
    accent-color: var(--color-accent);
    cursor: pointer;
  }
}

.mode-buttons {
  display: flex;
  gap: 4px;
}

.mode-btn {
  flex: 1;
  padding: 4px 8px;
  font-size: 0.78rem;
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: 4px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.mode-btn:hover {
  border-color: var(--color-accent);
}

.mode-btn.active {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
