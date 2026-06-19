<script setup lang="ts">
import { moldStore } from "../composables/useMoldStore.ts";

const showGizmo = defineModel<boolean>("showGizmo", { default: true });
</script>

<template>
  <div class="viewport-overlay">
    <!-- Display mode -->
    <div class="overlay-section">
      <label class="label" for="overlay-display-mode">表示</label>
      <select id="overlay-display-mode" v-model="moldStore.displayMode">
        <option value="normal">通常</option>
        <option value="section">断面クリップ</option>
        <option value="interior">内面ハイライト</option>
      </select>
      <p v-if="moldStore.displayMode === 'section'" class="hint">
        切断面を動かして殻をリアルタイムにスライス。
      </p>
      <p v-else-if="moldStore.displayMode === 'interior'" class="hint">
        外面ゴースト・内面オレンジ強調。
      </p>
    </div>

    <!-- Gizmo toggle -->
    <label class="toggle-row">
      <input v-model="showGizmo" type="checkbox" />
      <span class="label">ツールを表示</span>
    </label>
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

.hint {
  font-size: 0.72rem;
  color: var(--color-label);
  margin: 0;
  line-height: 1.4;
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
</style>
