<script setup lang="ts">
import { ref, onUnmounted } from "vue";
import ViewportCanvas from "./components/ViewportCanvas.vue";
import ControlPane from "./components/ControlPane.vue";
import { terminateWorker } from "./composables/useMoldWorker.ts";

/** Shared gizmo-visibility state passed between the viewport and the control pane. */
const showGizmo = ref(true);

// Ensure the worker is terminated when the root component is destroyed
onUnmounted(terminateWorker);
</script>

<template>
  <div class="app-layout">
    <ViewportCanvas v-model:show-gizmo="showGizmo" />
    <ControlPane />
  </div>
</template>

<style>
/* =========================================================================
   Global reset and CSS custom properties
   ========================================================================= */
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body,
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  font-size: 14px;
  color: var(--color-text);
  background: var(--color-bg);
}

:root {
  --color-bg: #1e1e2e;
  --color-pane-bg: #252535;
  --color-text: #cdd6f4;
  --color-label: #a6adc8;
  --color-muted: #6c7086;
  --color-border: #383848;
  --color-accent: #4fc3f7;
  --color-input-bg: #1e1e2e;
}
</style>

<style scoped>
.app-layout {
  display: grid;
  height: 100%;
  width: 100%;
  grid-template-columns: 1fr 280px;
}

@media screen and(max-width: 768px) {
  .app-layout {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr minmax(auto, 50dvh);
    grid-template-columns: 1fr;
  }
}
</style>
