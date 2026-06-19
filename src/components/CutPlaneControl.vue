<script setup lang="ts">
import { watch } from "vue";
import { moldStore } from "../composables/useMoldStore.ts";
import { scheduleCut } from "../composables/useMoldWorker.ts";

/** Preset: cut along the XZ plane (horizontal, normal = +Y). */
function presetHorizontal(): void {
  moldStore.cutPlane.normal = { x: 0, y: 1, z: 0 };
  moldStore.cutPlane.origin = { x: 0, y: 0, z: 0 };
  scheduleCut();
}

/** Preset: cut along the YZ plane (sagittal, normal = +X). */
function presetSagittal(): void {
  moldStore.cutPlane.normal = { x: 1, y: 0, z: 0 };
  moldStore.cutPlane.origin = { x: 0, y: 0, z: 0 };
  scheduleCut();
}

/** Preset: cut along the XY plane (frontal, normal = +Z). */
function presetFrontal(): void {
  moldStore.cutPlane.normal = { x: 0, y: 0, z: 1 };
  moldStore.cutPlane.origin = { x: 0, y: 0, z: 0 };
  scheduleCut();
}

// Watch for external store changes (e.g. gizmo drag) and propagate to worker
watch(
  () => moldStore.cutPlane,
  () => scheduleCut(),
  { deep: true },
);
</script>

<template>
  <section class="cut-plane-control">
    <h2>切断面</h2>

    <!-- Axis presets -->
    <div class="presets">
      <span class="field-label">プリセット</span>
      <div class="preset-buttons">
        <button class="preset-btn" @click="presetHorizontal">X-Z</button>
        <button class="preset-btn" @click="presetSagittal">Y-Z</button>
        <button class="preset-btn" @click="presetFrontal">X-Y</button>
      </div>
    </div>

    <!-- Origin inputs -->
    <fieldset>
      <legend class="field-label">原点</legend>
      <div class="coord-row">
        <label>X</label>
        <input
          v-model.number="moldStore.cutPlane.origin.x"
          type="number"
          step="0.5"
          @input="scheduleCut"
        />
        <label>Y</label>
        <input
          v-model.number="moldStore.cutPlane.origin.y"
          type="number"
          step="0.5"
          @input="scheduleCut"
        />
        <label>Z</label>
        <input
          v-model.number="moldStore.cutPlane.origin.z"
          type="number"
          step="0.5"
          @input="scheduleCut"
        />
      </div>
    </fieldset>

    <!-- Normal inputs -->
    <fieldset>
      <legend class="field-label">法線</legend>
      <div class="coord-row">
        <label>X</label>
        <input
          v-model.number="moldStore.cutPlane.normal.x"
          type="number"
          step="0.1"
          min="-1"
          max="1"
          @input="scheduleCut"
        />
        <label>Y</label>
        <input
          v-model.number="moldStore.cutPlane.normal.y"
          type="number"
          step="0.1"
          min="-1"
          max="1"
          @input="scheduleCut"
        />
        <label>Z</label>
        <input
          v-model.number="moldStore.cutPlane.normal.z"
          type="number"
          step="0.1"
          min="-1"
          max="1"
          @input="scheduleCut"
        />
      </div>
    </fieldset>
  </section>
</template>

<style scoped>
.cut-plane-control {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.presets {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preset-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-btn {
  padding: 4px 10px;
  font-size: 0.78rem;
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  transition: border-color 0.15s;
}

.preset-btn:hover {
  border-color: var(--color-accent);
}

.coord-row {
  display: grid;
  grid-template-columns: auto 1fr auto 1fr auto 1fr;
  align-items: center;
  gap: 4px 6px;
  margin-top: 6px;
}

.coord-row label {
  font-size: 0.75rem;
  color: var(--color-label);
  text-align: right;
}
</style>
