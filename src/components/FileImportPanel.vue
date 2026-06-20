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
import type { LengthUnit } from "../geometry/units.ts";

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
    moldStore.sourceGeometry = geometry;
    moldStore.fileName = fileName;
    moldStore.bboxSize = size;
    moldStore.unit = autoDetectUnit(size);
    loadModel(geometry, moldStore.params);
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
    moldStore.sourceGeometry = geometry;
    moldStore.fileName = fileName;
    moldStore.bboxSize = size;
    // Auto-detect the most plausible unit before dispatching to the worker,
    // so the mm→model-unit thickness conversion uses the correct factor.
    moldStore.unit = autoDetectUnit(size);

    // Immediately kick off shell generation with the current params
    loadModel(geometry, moldStore.params);
  } catch (err) {
    moldStore.status = "error";
    moldStore.errorMessage = err instanceof Error ? err.message : String(err);
  }
}

function bestDisplayUnit(mm: number): LengthUnit {
  if (mm >= 1000) return "m";
  if (mm >= 10) return "cm";
  return "mm";
}

const bboxDisplay = computed(() => {
  const s = moldStore.bboxSize;
  if (!s) return null;
  const factor = MM_PER_UNIT[moldStore.unit];
  const xMm = s.x * factor;
  const yMm = s.y * factor;
  const zMm = s.z * factor;
  const displayUnit = bestDisplayUnit(Math.max(xMm, yMm, zMm));
  const div = MM_PER_UNIT[displayUnit];
  return {
    x: (xMm / div).toFixed(2),
    y: (yMm / div).toFixed(2),
    z: (zMm / div).toFixed(2),
    unit: displayUnit,
  };
});

/** Schedule shell regeneration when the unit changes (real-world thickness changes). */
function onUnitChange(): void {
  if (moldStore.sourceGeometry) {
    scheduleRegeneration();
  }
}
</script>

<template>
  <section class="file-import-panel">
    <h2>モデルの取り込み</h2>

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

    <!-- Unit selector + bbox size (shown after a model is loaded) -->
    <template v-if="moldStore.bboxSize">
      <div class="unit-row">
        <label for="unit-select" class="field-label">モデル単位</label>
        <select
          id="unit-select"
          v-model="moldStore.unit"
          @change="onUnitChange"
        >
          <option v-for="u in UNIT_OPTIONS" :key="u" :value="u">{{ u }}</option>
        </select>
      </div>

      <div v-if="bboxDisplay" class="bbox-display">
        <span class="bbox-label">サイズ</span>
        <span class="bbox-values">
          X = {{ bboxDisplay.x }} &nbsp;Y = {{ bboxDisplay.y }} &nbsp;Z =
          {{ bboxDisplay.z }}
          <span class="bbox-unit">{{ bboxDisplay.unit }}</span>
        </span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.file-import-panel {
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

.bbox-display {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.8rem;
}

.bbox-label {
  color: var(--color-label);
  flex-shrink: 0;
}

.bbox-values {
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}

.bbox-unit {
  color: var(--color-muted);
  margin-left: 2px;
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
