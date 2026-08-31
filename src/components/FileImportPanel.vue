<script setup lang="ts">
import { ref, computed } from "vue";
import teapotUrl from "../assets/teapot.stl?url";
import {
  loadModelFromFile,
  loadModelFromUrl,
} from "../composables/useModelLoader.ts";
import { moldStore } from "../composables/useMoldStore.ts";
import {
  loadModel,
  scheduleRegeneration,
} from "../composables/useMoldWorker.ts";
import {
  UNIT_OPTIONS,
  MM_PER_UNIT,
  autoDetectUnit,
} from "../geometry/units.ts";

/** Whether the user is currently dragging a file over the drop zone. */
const isDragging = ref(false);

/** Hidden file input element used for the "Browse" button. */
const fileInputRef = ref<HTMLInputElement | null>(null);

/** Open the native file picker. */
function openFilePicker(): void {
  fileInputRef.value?.click();
}

/** Handle files selected via the native file picker. */
function onFileInputChange(event: Event): void {
  const files = (event.target as HTMLInputElement).files;
  if (files && files[0]) void processFile(files[0]);
}

function onDragEnter(event: DragEvent): void {
  event.preventDefault();
  isDragging.value = true;
}

function onDragLeave(): void {
  isDragging.value = false;
}

function onDragOver(event: DragEvent): void {
  event.preventDefault(); // required to allow drop
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  isDragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) void processFile(file);
}

/** Load the bundled teapot sample model. */
async function loadSample(): Promise<void> {
  moldStore.status = "loading";
  moldStore.errorMessage = "";
  try {
    const { geometry, fileName, size } = await loadModelFromUrl(
      teapotUrl,
      "Utah teapot by Martin Newell.stl",
    );
    moldStore.originalGeometry = geometry;
    moldStore.originalBboxSize = size;
    moldStore.fileName = fileName;
    moldStore.unit = autoDetectUnit(size);
    moldStore.modelScale = 1;
    applyScaleAndLoad();
  } catch (err) {
    moldStore.status = "error";
    moldStore.errorMessage = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Parse the STL file, update the store, and dispatch the model to the Worker.
 */
async function processFile(file: File): Promise<void> {
  if (!file.name.toLowerCase().endsWith(".stl")) {
    alert(
      "Unsupported file type. Please select an STL file.\n対応していないファイル形式です。STL ファイルを選択してください。",
    );
    return;
  }

  moldStore.status = "loading";
  moldStore.errorMessage = "";

  try {
    const { geometry, fileName, size } = await loadModelFromFile(file);
    moldStore.originalGeometry = geometry;
    moldStore.originalBboxSize = size;
    moldStore.fileName = fileName;
    moldStore.unit = autoDetectUnit(size);
    moldStore.modelScale = 1;
    applyScaleAndLoad();
  } catch (err) {
    moldStore.status = "error";
    moldStore.errorMessage = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Apply the current global scale to the original geometry and dispatch
 * the scaled model to the Worker for shell generation.
 *
 * This function preserves the original loaded geometry without destructive
 * modifications to prevent floating-point drift over multiple scaling operations.
 */
function applyScaleAndLoad(): void {
  if (!moldStore.originalGeometry || !moldStore.originalBboxSize) return;

  const scale = moldStore.modelScale;

  // Clone the geometry to keep the original unmutated
  const scaledGeometry = moldStore.originalGeometry.clone();
  scaledGeometry.scale(scale, scale, scale);

  moldStore.sourceGeometry = scaledGeometry;

  // Update the bounding box size to reflect the new scale
  moldStore.bboxSize = {
    x: moldStore.originalBboxSize.x * scale,
    y: moldStore.originalBboxSize.y * scale,
    z: moldStore.originalBboxSize.z * scale,
  };

  // Dispatch the newly scaled geometry to the worker
  loadModel(scaledGeometry, moldStore.params);
}

/** Whether a model is loaded and its bounding box is known. */
const hasModel = computed(
  () => !!moldStore.bboxSize && !!moldStore.originalBboxSize,
);

const bboxDisplay = computed(() => {
  const s = moldStore.bboxSize;
  if (!s) return null;
  const factor = MM_PER_UNIT[moldStore.unit];
  const xMm = s.x * factor;
  const yMm = s.y * factor;
  const zMm = s.z * factor;
  return {
    x: xMm.toFixed(2),
    y: yMm.toFixed(2),
    z: zMm.toFixed(2),
  };
});

function onUnitChange(): void {
  if (moldStore.sourceGeometry) {
    scheduleRegeneration();
  }
}

/**
 * Calculate and apply a new scale factor when the user manually modifies
 * one of the bounding box size fields (X, Y, or Z).
 *
 * The UI inputs strictly display sizes in millimetres. Therefore, the typed
 * value must be compared against the original size *converted to mm*.
 *
 * @param axis  - The axis that was modified ('x', 'y', or 'z').
 * @param event - The DOM change/keyup event from the input field.
 */
function updateScaleFromAxis(axis: "x" | "y" | "z", event: Event): void {
  const target = event.target as HTMLInputElement;
  const newValueMm = parseFloat(target.value);
  if (isNaN(newValueMm) || newValueMm <= 0 || !moldStore.originalBboxSize)
    return;

  // Convert the original coordinate-unit size to real-world mm.
  const originalModelUnits = moldStore.originalBboxSize[axis];
  const originalMm = originalModelUnits * MM_PER_UNIT[moldStore.unit];

  // Derive the uniform scale factor needed to reach the desired mm size.
  const newScale = newValueMm / originalMm;
  moldStore.modelScale = newScale;

  applyScaleAndLoad();
}
</script>

<template>
  <section class="file-import-panel">
    <h2>モデルの取り込み</h2>

    <!-- Wrapped separately from the unit/size editors below so the
         onboarding guide's "import" step highlights only the drop zone,
         not the whole panel. -->
    <div class="import-controls" data-onboarding="import">
      <div
        class="drop-zone"
        :class="{ dragging: isDragging }"
        role="button"
        tabindex="0"
        aria-label="STL ファイルをドロップするか、クリックして選択"
        @click="openFilePicker"
        @keydown.enter="openFilePicker"
        @dragenter="onDragEnter"
        @dragleave="onDragLeave"
        @dragover="onDragOver"
        @drop="onDrop"
      >
        <span v-if="moldStore.fileName" class="file-name">{{
          moldStore.fileName
        }}</span>
        <span v-else class="placeholder"
          >STL ファイルをドロップ<br />または クリックして選択</span
        >
      </div>

      <div v-if="!moldStore.fileName" class="sample">
        <button type="button" @click="loadSample">
          代わりにサンプルモデルを使う
        </button>
      </div>

      <!-- Hidden native file input -->
      <input
        ref="fileInputRef"
        type="file"
        accept=".stl"
        style="display: none"
        @change="onFileInputChange"
      />
    </div>

    <!-- Unit selector + Scale and size editors. Disabled (not hidden) until a
         model is loaded, so the onboarding guide has a real element to point
         at even before the first import. -->
    <div class="unit-row">
      <label for="unit-select" class="field-label">モデル単位</label>
      <select
        id="unit-select"
        v-model="moldStore.unit"
        :disabled="!hasModel"
        @change="onUnitChange"
      >
        <option v-for="u in UNIT_OPTIONS" :key="u" :value="u">{{ u }}</option>
      </select>
    </div>

    <div class="scale-row">
      <label class="field-label">スケール</label>
      <span class="scale-value">{{
        hasModel
          ? `${(moldStore.modelScale * 100).toFixed(1)}% (${moldStore.modelScale.toFixed(3)}x)`
          : "-"
      }}</span>
    </div>

    <div class="bbox-display" data-onboarding="size">
      <span class="bbox-label">サイズ (mm)</span>
      <div class="bbox-inputs">
        <div class="input-group">
          <label>X</label>
          <input
            type="number"
            step="any"
            :value="bboxDisplay?.x ?? ''"
            :disabled="!hasModel"
            @change="(e) => updateScaleFromAxis('x', e)"
            @keyup.enter="(e) => updateScaleFromAxis('x', e)"
          />
        </div>
        <div class="input-group">
          <label>Y</label>
          <input
            type="number"
            step="any"
            :value="bboxDisplay?.y ?? ''"
            :disabled="!hasModel"
            @change="(e) => updateScaleFromAxis('y', e)"
            @keyup.enter="(e) => updateScaleFromAxis('y', e)"
          />
        </div>
        <div class="input-group">
          <label>Z</label>
          <input
            type="number"
            step="any"
            :value="bboxDisplay?.z ?? ''"
            :disabled="!hasModel"
            @change="(e) => updateScaleFromAxis('z', e)"
            @keyup.enter="(e) => updateScaleFromAxis('z', e)"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.file-import-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.import-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.drop-zone {
  border: 2px dashed var(--color-border);
  border-radius: 6px;
  padding: 20px 16px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background-color 0.15s;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.drop-zone:hover,
.drop-zone:focus {
  border-color: var(--color-accent);
  outline: none;
}

.drop-zone.dragging {
  border-color: var(--color-accent);
  background-color: rgba(79, 195, 247, 0.08);
}

.placeholder {
  color: var(--color-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.file-name {
  color: var(--color-text);
  font-size: 0.9rem;
  word-break: break-all;
}

.unit-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scale-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scale-value {
  font-weight: 500;
  font-size: 0.9rem;
}

.bbox-display {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  font-size: 0.8rem;
}

.bbox-label {
  color: var(--color-label);
}

.bbox-inputs {
  display: flex;
  gap: 8px;
}

.unit-row select:disabled,
.input-group input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;

  label {
    color: var(--color-muted);
    font-size: 0.8rem;
  }

  input {
    width: 100%;
    min-width: 0;
    padding: 4px;
    font-size: 0.85rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    background: var(--color-bg-input);
    color: var(--color-text);
    font-variant-numeric: tabular-nums;

    &:focus {
      border-color: var(--color-accent);
      outline: none;
    }
  }
}

.sample {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: wrap;

  button {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    font-size: 0.8rem;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
}

.sample-btn:hover {
  opacity: 0.75;
}
</style>
