<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { moldStore } from "../composables/useMoldStore.ts";
import {
  regenerateShell,
  cancelGeneration,
  scheduleRegeneration,
} from "../composables/useMoldWorker.ts";
import { mmToModelUnits } from "../geometry/units.ts";

const { t } = useI18n();

const isGenerating = computed(() => moldStore.status === "generating");

/**
 * The regen button is active only when:
 *  - A source model is loaded.
 *  - Params are dirty (not yet reflected in the output).
 *  - Not currently generating (generating ⇒ the button becomes "Stop").
 */
const canRegen = computed(
  () => !!moldStore.sourceGeometry && moldStore.isDirty && !isGenerating.value,
);

/** Called on every thickness input event. */
function onThicknessChange(): void {
  scheduleRegeneration();
}

/** Manual regen / stop toggle. */
function onActionClick(): void {
  if (isGenerating.value) {
    cancelGeneration();
  } else {
    regenerateShell();
  }
}

/** Thickness converted to model units, shown as a hint to the user. */
const thicknessInModelUnits = computed(() =>
  mmToModelUnits(moldStore.params.thickness, moldStore.unit).toFixed(4),
);
</script>

<template>
  <section class="thickness-control">
    <h2>{{ t("thicknessControl.heading") }}</h2>

    <div class="field">
      <label for="thickness-input" class="field-label">{{
        t("thicknessControl.thicknessLabel")
      }}</label>
      <input
        id="thickness-input"
        v-model.number="moldStore.params.thickness"
        type="number"
        min="0.1"
        step="0.5"
        @input="onThicknessChange"
      />
      <span v-if="moldStore.bboxSize" class="field-hint">
        {{
          t("thicknessControl.thicknessHint", {
            value: thicknessInModelUnits,
            unit: moldStore.unit,
          })
        }}
      </span>
    </div>

    <!-- Auto-regen toggle -->
    <label class="toggle-row">
      <input v-model="moldStore.autoRegen" type="checkbox" />
      <span>{{ t("thicknessControl.autoRegen") }}</span>
    </label>

    <!-- Action button: Stop (while generating) | Regen (dirty) | disabled (clean) -->
    <button
      class="action-btn"
      :class="{ 'stop-btn': isGenerating }"
      :disabled="!isGenerating && !canRegen"
      @click="onActionClick"
    >
      {{
        isGenerating
          ? t("thicknessControl.stop")
          : t("thicknessControl.regenerate")
      }}
    </button>
  </section>
</template>

<style scoped>
.thickness-control {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-hint {
  font-size: 0.72rem;
  color: var(--color-muted);
}

.action-btn {
  margin-top: 4px;
  padding: 8px 12px;
  background: var(--color-accent);
  color: #000;
  border: none;
  font-weight: 600;
  font-size: 0.85rem;
  transition: opacity 0.15s;
}

/* Stop button gets a distinct destructive colour */
.stop-btn {
  background: #ef5350;
  color: #fff;
}
</style>
