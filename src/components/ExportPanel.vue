<script setup lang="ts">
import { computed } from "vue";
import { Quaternion, Vector3, type BufferGeometry } from "three";
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

/**
 * Helper to clone, rotate, and download a single mold piece.
 * @param piece - The geometry of the piece to export.
 * @param suffix - Suffix for the file name (e.g. "upper" or "lower").
 * @param normalMultiplier - Direction of the flat cut face relative to the cut plane normal (-1 for upper, 1 for lower).
 */
function downloadPiece(
  piece: BufferGeometry | null,
  suffix: string,
  normalMultiplier: 1 | -1,
): void {
  if (!piece) return;

  // Clone the geometry so we don't mutate the instance used for viewport rendering.
  const geo = piece.clone();

  // The cut plane normal points towards the "upper" half.
  // Therefore, the flat cut face has an outward normal proportional to normalMultiplier.
  const n = moldStore.cutPlane.normal;
  const cutNormal = new Vector3(
    n.x * normalMultiplier,
    n.y * normalMultiplier,
    n.z * normalMultiplier,
  ).normalize();

  // Rotate the piece so its flat cut face points straight up (+Z).
  // This ensures the STL is optimally oriented for 3D printing (flat side down or cavity up).
  const up = new Vector3(0, 0, 1);
  const q = new Quaternion().setFromUnitVectors(cutNormal, up);
  geo.applyQuaternion(q);

  downloadStl(geo, `${baseName.value}_${suffix}.stl`);
}

function downloadUpper(): void {
  downloadPiece(moldStore.upperPiece, "upper", -1);
}

function downloadLower(): void {
  downloadPiece(moldStore.lowerPiece, "lower", 1);
}
</script>

<template>
  <section class="export-panel" data-onboarding="export">
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

    <!-- Download buttons. Disabled (not hidden) until pieces are ready, so
         the onboarding guide has a real element to point at even before the
         first generation. -->
    <div class="download-row">
      <button
        class="download-btn upper"
        :disabled="!hasPieces || moldStore.isDirty || isGenerating"
        @click="downloadUpper"
      >
        ↓ 上半分 STL
      </button>
      <button
        class="download-btn lower"
        :disabled="!hasPieces || moldStore.isDirty || isGenerating"
        @click="downloadLower"
      >
        ↓ 下半分 STL
      </button>
    </div>

    <!-- Placeholder when no pieces exist yet -->
    <p v-if="!hasPieces && !isGenerating" class="hint-msg">
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
