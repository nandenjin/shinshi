import { reactive } from "vue";
import type { BufferGeometry } from "three";
import type { CutPlaneSpec, MoldParams } from "../geometry/types.ts";
import type { LengthUnit } from "../geometry/units.ts";

/** Possible states of the mold generation pipeline. */
export type GenerationStatus =
  "idle" | "loading" | "generating" | "ready" | "error";

/**
 * Global application state for the mold generator.
 *
 * This is the single source of truth shared across all composables and
 * components.  Kept as a module-level reactive object so every caller
 * receives the same reference.
 */
export const moldStore = reactive({
  // -------------------------------------------------------------------------
  // Source model
  // -------------------------------------------------------------------------

  /** The imported model's BufferGeometry, before any scaling. */
  originalGeometry: null as BufferGeometry | null,

  /** The scaled BufferGeometry (what is displayed and sent to the worker). */
  sourceGeometry: null as BufferGeometry | null,

  /** Name of the imported file, used for display purposes. */
  fileName: "" as string,

  /** Bounding-box size of the original model. */
  originalBboxSize: null as { x: number; y: number; z: number } | null,

  /**
   * Bounding-box size of the scaled model in raw model coordinates.
   * Null until a model has been loaded.
   */
  bboxSize: null as { x: number; y: number; z: number } | null,

  /** Global scale factor applied to the model. */
  modelScale: 1 as number,

  // -------------------------------------------------------------------------
  // Unit interpretation
  // -------------------------------------------------------------------------

  /**
   * The physical unit that one coordinate unit of the imported model
   * represents.  Used to convert the mm thickness input to model units before
   * dispatching to the worker.
   */
  unit: "mm" as LengthUnit,

  // -------------------------------------------------------------------------
  // Mold parameters
  // -------------------------------------------------------------------------

  /**
   * Parameters controlling shell thickness.
   * `thickness` is stored in millimetres in the UI; the worker receives a
   * model-unit-converted value (see useMoldWorker.ts).
   */
  params: {
    thickness: 1,
  } as MoldParams,

  // -------------------------------------------------------------------------
  // Cutting plane
  // -------------------------------------------------------------------------

  /** Specification of the plane that cuts the shell in two. */
  cutPlane: {
    origin: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
  } as CutPlaneSpec,

  /**
   * Current mode of the cutting-plane gizmo, mirroring Blender's move/rotate
   * tools. Switched via the viewport overlay or the G/R keyboard shortcuts.
   */
  gizmoMode: "translate" as "translate" | "rotate",

  // -------------------------------------------------------------------------
  // Generation state
  // -------------------------------------------------------------------------

  /** Current pipeline status. */
  status: "idle" as GenerationStatus,

  /** Progress value in [0, 1]; only meaningful when status === 'generating'. */
  progress: 0 as number,

  /** Human-readable description of the current pipeline step. */
  progressLabel: "" as string,

  /** Error message; only set when status === 'error'. */
  errorMessage: "" as string,

  // -------------------------------------------------------------------------
  // Regeneration behaviour
  // -------------------------------------------------------------------------

  /**
   * When true, thickness / unit changes automatically schedule a debounced
   * shell regeneration.  When false the user must press the button manually.
   */
  autoRegen: true as boolean,

  /**
   * True when the current params have not yet been reflected in the generated
   * pieces (i.e. a regeneration is pending or has never been run).
   */
  isDirty: false as boolean,

  // -------------------------------------------------------------------------
  // Viewport display
  // -------------------------------------------------------------------------

  /** When true, the shell is rendered with a live clipping plane. */
  showSection: false as boolean,

  /**
   * When true (and showSection is active), shows the side above the cut plane.
   * When false (default), shows the side below the cut plane.
   */
  sectionFlipped: false as boolean,

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /** Full mold shell geometry (before cutting), for preview purposes. */
  shellGeometry: null as BufferGeometry | null,

  /** Upper half of the cut mold (on the side of the plane normal). */
  upperPiece: null as BufferGeometry | null,

  /** Lower half of the cut mold (opposite to the plane normal). */
  lowerPiece: null as BufferGeometry | null,
});
