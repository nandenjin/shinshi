import { reactive } from "vue";

/** A single step of the onboarding guide. */
export type OnboardingStep = {
  /** Anchor selectors. When multiple are given, the union of the matched rects is highlighted. */
  targets: string[];
  /** Body text shown in the balloon. */
  body: string;
  /** How the balloon is placed relative to the highlighted rect. */
  placement: "auto" | "inside-bottom";
};

/** Ordered steps shown by the onboarding guide. */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    targets: ['[data-onboarding="import"]'],
    body: "最初に、造形するモデルを開きます。サンプルデータを利用することもできます",
    placement: "auto",
  },
  {
    targets: ['[data-onboarding="size"]', '[data-onboarding="thickness"]'],
    body: "完成品のサイズや、型の厚みを調整できます",
    placement: "auto",
  },
  {
    targets: ['[data-onboarding="viewport"]'],
    body: "黄色い円をクリックして移動し、分割位置を決めます",
    placement: "inside-bottom",
  },
  {
    targets: ['[data-onboarding="gizmo-mode"]'],
    body: "ツールの動きは、移動・回転で切り替えられます",
    placement: "auto",
  },
  {
    targets: ['[data-onboarding="section-mode"]'],
    body: "断面を表示すると、型の内部を確認できます",
    placement: "auto",
  },
  {
    targets: ['[data-onboarding="export"]'],
    body: "最後に分割された型のデータをダウンロードします",
    placement: "auto",
  },
];

const SEEN_KEY = "shinshi.onboarding.seen";

/** Global onboarding guide state, shared across all composables and components. */
export const onboardingStore = reactive({
  active: false,
  stepIndex: 0,
});

/** Whether the user has already seen the onboarding guide (or the check itself failed). */
export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

/** Marks the onboarding guide as seen so it won't auto-start again. */
export function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Ignore write failures (e.g. private browsing mode).
  }
}

/** Starts the guide from the first step. */
export function startGuide(): void {
  onboardingStore.stepIndex = 0;
  onboardingStore.active = true;
}

/** Advances to the next step, or finishes the guide if already on the last step. */
export function nextStep(): void {
  if (onboardingStore.stepIndex >= ONBOARDING_STEPS.length - 1) {
    finishGuide();
    return;
  }
  onboardingStore.stepIndex++;
}

/** Goes back to the previous step. No-op on the first step. */
export function previousStep(): void {
  if (onboardingStore.stepIndex <= 0) return;
  onboardingStore.stepIndex--;
}

/** Closes the guide and remembers that it has been seen. */
export function finishGuide(): void {
  onboardingStore.active = false;
  markSeen();
}

/** Cancels the guide partway through. Same effect as finishing it. */
export function cancelGuide(): void {
  finishGuide();
}

/** Starts the guide automatically on first run only. */
export function maybeStartFirstRun(): void {
  if (hasSeenGuide()) return;
  markSeen();
  startGuide();
}
