<script setup lang="ts">
import { computed } from "vue";
import { moldStore } from "../composables/useMoldStore.ts";
import { downloadStl } from "../composables/useStlDownload.ts";

/** True while the worker is computing. */
const isGenerating = computed(
  () => moldStore.status === "generating" || moldStore.status === "loading",
);

/** True when both pieces are available for download. */
const hasPieces = computed(
  () => !!moldStore.upperPiece && !!moldStore.lowerPiece,
);

/** Pieces exist but params have changed since they were generated. */
const isStale = computed(() => hasPieces.value && moldStore.isDirty);

/** The base file name (without extension) for downloads. */
const baseName = computed(
  () => moldStore.fileName.replace(/\.stl$/i, "") || "mold",
);

function downloadUpper(): void {
  if (moldStore.upperPiece) {
    downloadStl(moldStore.upperPiece, `${baseName.value}_upper.stl`);
  }
}

function downloadLower(): void {
  if (moldStore.lowerPiece) {
    downloadStl(moldStore.lowerPiece, `${baseName.value}_lower.stl`);
  }
}
</script>

<template>
  <section class="export-panel">
    <h2>エクスポート</h2>

    <!-- Progress bar (visible while generating) -->
    <div v-if="isGenerating" class="progress-wrapper">
      <div
        class="progress-bar"
        :style="{ width: `${moldStore.progress * 100}%` }"
      />
      <span class="progress-label">{{ moldStore.progressLabel }}</span>
    </div>

    <!-- Error message -->
    <p v-if="moldStore.status === 'error'" class="error-msg">
      {{ moldStore.errorMessage }}
    </p>

    <!-- Stale warning: pieces exist but params have changed -->
    <p v-if="isStale" class="stale-msg">
      パラメーターが変更されました。再生成してからダウンロードしてください。
    </p>

    <!-- Download buttons (shown only when pieces are ready and not stale) -->
    <div v-if="hasPieces" class="download-row">
      <button
        class="download-btn upper"
        :disabled="moldStore.isDirty || isGenerating"
        @click="downloadUpper"
      >
        ↓ 上半分 STL
      </button>
      <button
        class="download-btn lower"
        :disabled="moldStore.isDirty || isGenerating"
        @click="downloadLower"
      >
        ↓ 下半分 STL
      </button>
    </div>

    <!-- Placeholder when no pieces exist yet -->
    <p v-else-if="!isGenerating" class="hint-msg">
      形状を生成するとここからダウンロードできます。
    </p>
  </section>
</template>

<style scoped>
.export-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.progress-wrapper {
  position: relative;
  height: 22px;
  background: var(--color-input-bg);
  border-radius: 4px;
  overflow: hidden;
}

.progress-bar {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: var(--color-accent);
  transition: width 0.2s ease;
}

.progress-label {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.72rem;
  color: #000;
  mix-blend-mode: difference;
  pointer-events: none;
}

.error-msg {
  color: #ef5350;
  font-size: 0.82rem;
  margin: 0;
  word-break: break-word;
}

.stale-msg {
  color: #ffa726;
  font-size: 0.78rem;
  margin: 0;
  word-break: break-word;
}

.hint-msg {
  color: var(--color-muted);
  font-size: 0.78rem;
  margin: 0;
}

.download-row {
  display: flex;
  gap: 8px;
}

.download-btn {
  flex: 1;
  padding: 8px 0;
  border: none;
  font-size: 0.82rem;
  font-weight: 600;
  transition: opacity 0.15s;
}

.download-btn:disabled {
  opacity: 0.35;
}

.download-btn.upper {
  background: #ef9a9a;
  color: #1a0000;
}

.download-btn.lower {
  background: #a5d6a7;
  color: #001a00;
}
</style>
