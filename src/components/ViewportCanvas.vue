<script setup lang="ts">
import { ref } from "vue";
import { useThreeViewport } from "../composables/useThreeViewport.ts";
import { startGuide } from "../composables/useOnboarding.ts";
import ViewportOverlay from "./ViewportOverlay.vue";

const showGizmo = defineModel<boolean>("showGizmo", { default: true });

/** Reference to the canvas DOM element. */
const canvasRef = ref<HTMLCanvasElement | null>(null);

// Mount the THREE.js viewport — all scene management is handled inside the composable
useThreeViewport(canvasRef, showGizmo);
</script>

<template>
  <div class="viewport-wrapper" data-onboarding="viewport">
    <canvas ref="canvasRef" class="viewport-canvas" />
    <ViewportOverlay v-model:show-gizmo="showGizmo" />
    <button type="button" class="guide-btn" @click="startGuide">
      ? 使い方ガイド
    </button>
  </div>
</template>

<style scoped>
.viewport-wrapper {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #1e1e2e;
}

.viewport-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.guide-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.guide-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
