<script setup lang="ts">
import { ref } from "vue";
import { useThreeViewport } from "../composables/useThreeViewport.ts";
import ViewportOverlay from "./ViewportOverlay.vue";

const showGizmo = defineModel<boolean>("showGizmo", { default: true });

/** Reference to the canvas DOM element. */
const canvasRef = ref<HTMLCanvasElement | null>(null);

// Mount the THREE.js viewport — all scene management is handled inside the composable
useThreeViewport(canvasRef, showGizmo);
</script>

<template>
  <div class="viewport-wrapper">
    <canvas ref="canvasRef" class="viewport-canvas" />
    <ViewportOverlay v-model:show-gizmo="showGizmo" />
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
</style>
