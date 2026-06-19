import { BufferGeometry, BufferAttribute } from "three";
import { moldStore } from "./useMoldStore.ts";
import { mmToModelUnits } from "../geometry/units.ts";
import type {
  WorkerRequest,
  WorkerResponse,
  TransferableGeometry,
  MoldParams,
  CutPlaneSpec,
} from "../geometry/types.ts";

// ---------------------------------------------------------------------------
// Worker instance (created lazily on first use)
// ---------------------------------------------------------------------------

let _worker: Worker | null = null;

/**
 * Whether the current worker instance already holds a cached source model.
 * Reset to false whenever the worker is terminated or replaced.
 */
let _workerHasModel = false;

/**
 * Return the singleton mold computation worker, creating it on first call.
 */
function getWorker(): Worker {
  if (!_worker) {
    _worker = new Worker(new URL("../mold.worker.ts", import.meta.url), {
      type: "module",
    });
    _worker.onmessage = handleWorkerMessage;
    _worker.onerror = (e) => {
      moldStore.status = "error";
      moldStore.errorMessage = e.message ?? "Worker crashed";
    };
  }
  return _worker;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

function handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
  const msg = event.data;

  switch (msg.type) {
    case "progress":
      moldStore.progress = msg.value;
      moldStore.progressLabel = msg.label;
      break;

    case "shellReady":
      moldStore.shellGeometry = deserialiseGeometry(msg.shell);
      break;

    case "piecesReady":
      moldStore.upperPiece = deserialiseGeometry(msg.upper);
      moldStore.lowerPiece = deserialiseGeometry(msg.lower);
      moldStore.status = "ready";
      moldStore.progress = 1;
      moldStore.progressLabel = "Done";
      moldStore.isDirty = false;
      break;

    case "error":
      moldStore.status = "error";
      moldStore.errorMessage = msg.message;
      break;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Reset result state and set status to 'generating'. */
function resetResultState(label: string): void {
  moldStore.status = "generating";
  moldStore.progress = 0;
  moldStore.progressLabel = label;
  moldStore.shellGeometry = null;
  moldStore.upperPiece = null;
  moldStore.lowerPiece = null;
}

/** Convert mm-based params to model units and strip Vue reactive Proxy. */
function toWorkerParams(params: MoldParams): MoldParams {
  return {
    ...params,
    thickness: mmToModelUnits(params.thickness, moldStore.unit),
  };
}

/** Deep-copy a CutPlaneSpec to strip Vue reactive Proxy on nested objects. */
function toPlaneSpec(plane: CutPlaneSpec): CutPlaneSpec {
  return {
    origin: { ...plane.origin },
    normal: { ...plane.normal },
  };
}

// ---------------------------------------------------------------------------
// Public API — model loading
// ---------------------------------------------------------------------------

/**
 * Send the source model geometry to the worker and trigger a full shell
 * generation pipeline (extrusion → shell → cut).
 *
 * Call this only when new geometry has been loaded from a file.
 *
 * @param geometry - Centred source model geometry.
 * @param params   - Shell generation parameters.
 */
export function loadModel(geometry: BufferGeometry, params: MoldParams): void {
  resetResultState("Starting…");

  const transferable = serialiseGeometry(geometry);
  const req: WorkerRequest = {
    type: "setModel",
    geometry: transferable,
    params: toWorkerParams(params),
    plane: toPlaneSpec(moldStore.cutPlane),
  };

  _workerHasModel = true;
  moldStore.isDirty = false;

  getWorker().postMessage(req, [
    transferable.position.buffer,
    transferable.normal.buffer,
    transferable.index.buffer,
  ]);
}

// ---------------------------------------------------------------------------
// Public API — (re)generation
// ---------------------------------------------------------------------------

/**
 * Regenerate the shell with the current params.
 *
 * If the worker already has a cached source model (`_workerHasModel`), a
 * lightweight `generateShell` message is sent (no geometry transfer).
 * Otherwise the full `setModel` path is used automatically (e.g. after the
 * worker was terminated by `cancelGeneration`).
 */
export function regenerateShell(): void {
  if (!moldStore.sourceGeometry) return;

  if (!_workerHasModel) {
    // Worker was terminated or model was never sent — use the full path.
    loadModel(moldStore.sourceGeometry, moldStore.params);
    return;
  }

  resetResultState("Regenerating shell…");

  const req: WorkerRequest = {
    type: "generateShell",
    params: toWorkerParams(moldStore.params),
    plane: toPlaneSpec(moldStore.cutPlane),
  };
  getWorker().postMessage(req);
}

/**
 * Cancel an in-progress generation.
 *
 * Web Worker message handlers run to completion — cooperative cancellation is
 * not possible.  The only reliable approach is to terminate the worker, which
 * destroys its cached source model too.  `_workerHasModel` is reset so the
 * next `regenerateShell()` call transparently falls back to the full
 * `setModel` path.
 */
export function cancelGeneration(): void {
  if (moldStore.status !== "generating") return;

  _worker?.terminate();
  _worker = null;
  _workerHasModel = false;

  // Restore a sensible status: keep results if we already had them.
  const hasResults = !!moldStore.upperPiece && !!moldStore.lowerPiece;
  moldStore.status = hasResults ? "ready" : "idle";
  moldStore.progress = 0;
  moldStore.progressLabel = "";
}

// ---------------------------------------------------------------------------
// Public API — cut-plane update
// ---------------------------------------------------------------------------

/**
 * Ask the worker to re-cut the cached shell along a new plane.
 * This is cheap — no shell rebuild needed.
 */
export function requestCutUpdate(plane: CutPlaneSpec): void {
  const req: WorkerRequest = {
    type: "applyCut",
    plane: toPlaneSpec(plane),
  };
  getWorker().postMessage(req);
}

// ---------------------------------------------------------------------------
// Public API — debounced schedulers
// ---------------------------------------------------------------------------

let _regenTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Mark params as dirty and, when `autoRegen` is enabled, schedule a debounced
 * shell regeneration.  Safe to call on every input event.
 */
export function scheduleRegeneration(): void {
  moldStore.isDirty = true;

  if (!moldStore.autoRegen) return;

  if (_regenTimer) clearTimeout(_regenTimer);
  _regenTimer = setTimeout(() => {
    _regenTimer = null;
    regenerateShell();
  }, 300);
}

let _cutTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule a debounced cut-plane update.  Always runs regardless of the
 * `autoRegen` toggle — cutting is cheap and doesn't rebuild the shell.
 *
 * Skipped when `displayMode === 'section'` because that mode previews the
 * cut in the renderer via clipping planes without needing CSG pieces.
 * When switching back to 'normal', call this once to sync pieces to the
 * latest plane position (handled in the display-mode watcher in the viewport).
 */
export function scheduleCut(): void {
  if (moldStore.displayMode === "section") return;
  if (_cutTimer) clearTimeout(_cutTimer);
  _cutTimer = setTimeout(() => {
    _cutTimer = null;
    if (moldStore.shellGeometry) {
      requestCutUpdate(moldStore.cutPlane);
    }
  }, 300);
}

// ---------------------------------------------------------------------------
// Public API — lifecycle
// ---------------------------------------------------------------------------

/**
 * Terminate the worker and clear all module-level state.
 * Call this when the root component is unmounted.
 */
export function terminateWorker(): void {
  _worker?.terminate();
  _worker = null;
  _workerHasModel = false;
}

// ---------------------------------------------------------------------------
// Geometry serialisation helpers
// ---------------------------------------------------------------------------

function serialiseGeometry(geo: BufferGeometry): TransferableGeometry {
  const pos = geo.getAttribute("position");
  const norm = geo.getAttribute("normal");
  const idx = geo.getIndex();

  return {
    position: new Float32Array(pos.array),
    normal: norm
      ? new Float32Array(norm.array)
      : new Float32Array(pos.count * 3),
    index: idx ? new Uint32Array(idx.array) : new Uint32Array(0),
  };
}

function deserialiseGeometry(raw: TransferableGeometry): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(raw.position, 3));
  if (raw.normal.length > 0) {
    geo.setAttribute("normal", new BufferAttribute(raw.normal, 3));
  }
  if (raw.index.length > 0) {
    geo.setIndex(new BufferAttribute(raw.index, 1));
  }
  // Restore draw groups so per-surface materials work (outer=0, inner=1).
  raw.groups?.forEach(({ start, count, materialIndex }) =>
    geo.addGroup(start, count, materialIndex),
  );
  return geo;
}
