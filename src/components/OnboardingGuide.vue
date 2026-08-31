<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import {
  ONBOARDING_STEPS,
  onboardingStore,
  maybeStartFirstRun,
  nextStep,
  previousStep,
  cancelGuide,
} from "../composables/useOnboarding.ts";

const MARGIN = 12;

type Rect = { top: number; left: number; width: number; height: number };

// Reactive view state consumed by the template.
const state = reactive({
  highlight: null as Rect | null,
  balloonTop: 0,
  balloonLeft: 0,
  arrow: null as "top" | "bottom" | "left" | "right" | null,
});

let rafId: number | null = null;

/** Resolves the current step's target elements to the union of their rects. */
function resolveTargetRect(): DOMRect | null {
  const step = ONBOARDING_STEPS[onboardingStore.stepIndex];
  if (!step) return null;

  const rects = step.targets
    .map((selector) => document.querySelector(selector))
    .filter((el): el is Element => el !== null)
    .map((el) => el.getBoundingClientRect());

  if (rects.length === 0) return null;

  const top = Math.min(...rects.map((r) => r.top));
  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const bottom = Math.max(...rects.map((r) => r.bottom));

  return new DOMRect(left, top, right - left, bottom - top);
}

/** Clamps a balloon position so it stays fully within the viewport. */
function clamp(
  left: number,
  top: number,
  width: number,
  height: number,
): { left: number; top: number } {
  const maxLeft = window.innerWidth - width - MARGIN;
  const maxTop = window.innerHeight - height - MARGIN;
  return {
    left: Math.min(Math.max(left, MARGIN), Math.max(maxLeft, MARGIN)),
    top: Math.min(Math.max(top, MARGIN), Math.max(maxTop, MARGIN)),
  };
}

/** Recomputes the highlight rect and balloon position for the current step. */
function updatePosition(): void {
  const step = ONBOARDING_STEPS[onboardingStore.stepIndex];
  if (!step) return;

  const rect = resolveTargetRect();

  // Balloon dimensions are approximated; exact size doesn't matter much since
  // we clamp to the viewport afterwards.
  const balloonWidth = 280;
  const balloonHeight = 120;

  if (!rect) {
    state.highlight = null;
    const { left, top } = clamp(
      window.innerWidth / 2 - balloonWidth / 2,
      window.innerHeight / 2 - balloonHeight / 2,
      balloonWidth,
      balloonHeight,
    );
    state.balloonLeft = left;
    state.balloonTop = top;
    state.arrow = null;
    return;
  }

  state.highlight = {
    top: rect.top - 4,
    left: rect.left - 4,
    width: rect.width + 8,
    height: rect.height + 8,
  };

  if (step.placement === "inside-bottom") {
    const left = rect.left + rect.width / 2 - balloonWidth / 2;
    const top = rect.top + rect.height - balloonHeight - 24;
    const clamped = clamp(left, top, balloonWidth, balloonHeight);
    state.balloonLeft = clamped.left;
    state.balloonTop = clamped.top;
    state.arrow = null;
    return;
  }

  // "auto" placement: try left, bottom, top, right (in that order) and pick
  // the first side with enough clearance along its own axis. The cross-axis
  // position is only clamped afterwards, so a target near a screen edge
  // (e.g. the top-left viewport overlay) still gets a balloon placed clear
  // of it rather than clamped back on top of it.
  const gap = 12;
  const candidates: Array<{
    side: "left" | "bottom" | "top" | "right";
    left: number;
    top: number;
    fits: boolean;
  }> = [
    {
      side: "left",
      left: rect.left - gap - balloonWidth,
      top: rect.top + rect.height / 2 - balloonHeight / 2,
      fits: rect.left >= balloonWidth + gap,
    },
    {
      side: "bottom",
      left: rect.left + rect.width / 2 - balloonWidth / 2,
      top: rect.top + rect.height + gap,
      fits: window.innerHeight - rect.bottom >= balloonHeight + gap,
    },
    {
      side: "top",
      left: rect.left + rect.width / 2 - balloonWidth / 2,
      top: rect.top - gap - balloonHeight,
      fits: rect.top >= balloonHeight + gap,
    },
    {
      side: "right",
      left: rect.left + rect.width + gap,
      top: rect.top + rect.height / 2 - balloonHeight / 2,
      fits: window.innerWidth - rect.right >= balloonWidth + gap,
    },
  ];

  const chosen = candidates.find((c) => c.fits) ?? candidates[0]!;
  const clamped = clamp(chosen.left, chosen.top, balloonWidth, balloonHeight);
  state.balloonLeft = clamped.left;
  state.balloonTop = clamped.top;
  // Arrow points from the balloon toward the target, i.e. the opposite side.
  const arrowMap = {
    left: "right",
    bottom: "top",
    top: "bottom",
    right: "left",
  } as const;
  state.arrow = arrowMap[chosen.side];
}

function tick(): void {
  updatePosition();
  rafId = requestAnimationFrame(tick);
}

function startLoop(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

function stopLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

watch(
  () => onboardingStore.active,
  (active) => {
    if (active) {
      startLoop();
    } else {
      stopLoop();
    }
  },
  { immediate: true },
);

watch(
  () => onboardingStore.stepIndex,
  async () => {
    if (!onboardingStore.active) return;
    await nextTick();
    const step = ONBOARDING_STEPS[onboardingStore.stepIndex];
    if (!step) return;
    for (const selector of step.targets) {
      const el = document.querySelector(selector);
      el?.scrollIntoView({ block: "center" });
    }
  },
);

onMounted(async () => {
  await nextTick();
  maybeStartFirstRun();
});

onBeforeUnmount(stopLoop);
</script>

<template>
  <Teleport to="body">
    <div v-if="onboardingStore.active" class="onboarding-layer">
      <div
        v-if="state.highlight"
        class="onboarding-highlight"
        :style="{
          top: `${state.highlight.top}px`,
          left: `${state.highlight.left}px`,
          width: `${state.highlight.width}px`,
          height: `${state.highlight.height}px`,
        }"
      />

      <div
        class="onboarding-balloon"
        :class="state.arrow ? `arrow-${state.arrow}` : ''"
        :style="{
          top: `${state.balloonTop}px`,
          left: `${state.balloonLeft}px`,
        }"
      >
        <p class="body-text">
          {{ ONBOARDING_STEPS[onboardingStore.stepIndex]?.body }}
        </p>
        <div class="progress">
          <span
            v-for="(_, i) in ONBOARDING_STEPS"
            :key="i"
            class="dot"
            :class="{ current: i === onboardingStore.stepIndex }"
          />
          <span class="counter"
            >{{ onboardingStore.stepIndex + 1 }} /
            {{ ONBOARDING_STEPS.length }}</span
          >
        </div>
        <div class="footer-row">
          <button type="button" class="cancel-btn" @click="cancelGuide">
            中止
          </button>
          <div class="nav-buttons">
            <button
              v-if="onboardingStore.stepIndex > 0"
              type="button"
              class="prev-btn"
              @click="previousStep"
            >
              戻る
            </button>
            <button type="button" class="next-btn" @click="nextStep">
              {{
                onboardingStore.stepIndex === ONBOARDING_STEPS.length - 1
                  ? "終了"
                  : "次へ"
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.onboarding-layer {
  --onboarding-highlight-color: #ffdd00;

  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
}

.onboarding-highlight {
  position: absolute;
  border: 2px solid var(--onboarding-highlight-color);
  border-radius: 6px;
  box-shadow: 0 0 0 4px
    color-mix(in srgb, var(--onboarding-highlight-color) 25%, transparent);
  pointer-events: none;
  animation: onboarding-highlight-blink 1s ease-in-out infinite;
  transition:
    top 0.1s ease-out,
    left 0.1s ease-out,
    width 0.1s ease-out,
    height 0.1s ease-out;
}

@keyframes onboarding-highlight-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.onboarding-balloon {
  position: absolute;
  width: 280px;
  pointer-events: auto;
  background: var(--color-pane-bg);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 12px 14px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.body-text {
  margin: 0 0 10px;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--color-text);
}

.progress {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 10px;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-muted);
}

.dot.current {
  background: var(--onboarding-highlight-color);
}

.counter {
  margin-left: 4px;
  font-size: 0.72rem;
  color: var(--color-label);
}

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nav-buttons {
  display: flex;
  gap: 6px;
}

.cancel-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-muted);
  font-size: 0.76rem;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 0.15s;
}

.cancel-btn:hover {
  color: var(--color-text);
}

.prev-btn,
.next-btn {
  background: var(--color-input-bg);
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: 4px;
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    border-color 0.15s,
    color 0.15s;
}

.prev-btn:hover {
  border-color: var(--color-label);
}

.next-btn:hover {
  border-color: var(--onboarding-highlight-color);
  color: var(--onboarding-highlight-color);
}

/* Arrow pointing from the balloon toward the highlighted target. */
.arrow-left::after,
.arrow-right::after,
.arrow-top::after,
.arrow-bottom::after {
  content: "";
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--color-pane-bg);
  border: 1px solid var(--color-border);
}

/* Balloon is to the right of the target: tip sits on the balloon's left
   edge, pointing left (visible corner = bottom+left border). */
.arrow-left::after {
  left: -6px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  border-top: none;
  border-right: none;
}

/* Balloon is to the left of the target: tip sits on the balloon's right
   edge, pointing right (visible corner = top+right border). */
.arrow-right::after {
  right: -6px;
  top: 50%;
  transform: translateY(-50%) rotate(45deg);
  border-left: none;
  border-bottom: none;
}

/* Balloon is below the target: tip sits on the balloon's top edge,
   pointing up (visible corner = top+left border). */
.arrow-top::after {
  top: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  border-right: none;
  border-bottom: none;
}

/* Balloon is above the target: tip sits on the balloon's bottom edge,
   pointing down (visible corner = right+bottom border). */
.arrow-bottom::after {
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  border-top: none;
  border-left: none;
}
</style>
