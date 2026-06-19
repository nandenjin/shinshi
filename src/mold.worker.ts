/**
 * @file mold.worker.ts
 * Web Worker entry point for heavy geometry computations.
 *
 * Responsibilities:
 *  1. Receive a serialised source model geometry and build its shell.
 *  2. Cut the shell along a specified plane and return two pieces.
 *  3. Cache the computed shell so that changing only the cut plane does not
 *     require a full shell rebuild.
 */

import { BufferGeometry, BufferAttribute } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { buildShell } from "./geometry/buildShell.ts";
import { cutByPlane } from "./geometry/cutByPlane.ts";
import type {
  WorkerRequest,
  WorkerResponse,
  TransferableGeometry,
  MoldParams,
  CutPlaneSpec,
} from "./geometry/types.ts";

// ---------------------------------------------------------------------------
// Worker-level state (persists across messages within one Worker lifetime)
// ---------------------------------------------------------------------------

/** Welded, indexed source geometry cached for shell (re)generation. */
let _cachedSourceGeo: BufferGeometry | null = null;

/** Cached shell geometry so a pure plane-change skips the shell rebuild. */
let _cachedShell: BufferGeometry | null = null;

/** Most recently received cut-plane, used for re-cutting after a shell rebuild. */
let _lastPlane: CutPlaneSpec | null = null;

/** Most recently received mold parameters (thickness). */
let _lastParams: MoldParams | null = null;

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    switch (req.type) {
      case "setModel": {
        const rawGeo = deserialiseGeometry(req.geometry);

        // Weld duplicate vertices by position only.
        // STL files store per-face normals, so seam vertices share the same
        // position but differ in normal — mergeVertices would leave them
        // unmerged by default. Stripping normals first forces a position-only
        // merge; smooth normals are then recomputed from the welded topology.
        sendProgress(0.02, "Welding vertices…");
        rawGeo.deleteAttribute("normal");
        const geo = mergeVertices(rawGeo);
        geo.computeVertexNormals();

        _cachedSourceGeo = geo;
        _lastParams = req.params;
        _lastPlane = req.plane;
        _cachedShell = null;

        generateAndCutShell(req.params.thickness, _lastPlane);
        break;
      }

      case "generateShell": {
        if (!_cachedSourceGeo) {
          sendError("No model loaded. Send a setModel request first.");
          return;
        }
        _lastParams = req.params;
        _lastPlane = req.plane;
        _cachedShell = null;
        generateAndCutShell(req.params.thickness, _lastPlane);
        break;
      }

      case "applyCut": {
        _lastPlane = req.plane;
        if (_cachedShell) {
          sendProgress(0.9, "Cutting shell…");
          const pieces = cutByPlane(_cachedShell, req.plane);
          sendPieces(pieces.upper, pieces.lower);
        } else if (_cachedSourceGeo && _lastParams) {
          generateAndCutShell(_lastParams.thickness, req.plane);
        } else {
          sendError("No shell available. Generate a shell first.");
        }
        break;
      }
    }
  } catch (err) {
    sendError(err instanceof Error ? err.message : String(err));
  }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a shell from the cached source geometry, cache it, then cut it by `plane`.
 */
function generateAndCutShell(
  thickness: number,
  plane: CutPlaneSpec | null,
): void {
  if (!_cachedSourceGeo) return;

  sendProgress(0.1, "Building shell…");
  _cachedShell = buildShell(_cachedSourceGeo, thickness, (v, label) =>
    sendProgress(0.1 + v * 0.8, label),
  );

  const shellTransferable = serialiseGeometry(_cachedShell);
  const shellMsg: WorkerResponse = {
    type: "shellReady",
    shell: shellTransferable,
  };
  self.postMessage(shellMsg, [
    shellTransferable.position.buffer,
    shellTransferable.normal.buffer,
    shellTransferable.index.buffer,
  ]);

  if (plane) {
    sendProgress(0.9, "Cutting shell…");
    const pieces = cutByPlane(_cachedShell, plane);
    sendPieces(pieces.upper, pieces.lower);
  }
}

function sendProgress(value: number, label: string): void {
  const msg: WorkerResponse = { type: "progress", value, label };
  self.postMessage(msg);
}

function sendError(message: string): void {
  const msg: WorkerResponse = { type: "error", message };
  self.postMessage(msg);
}

function sendPieces(upper: BufferGeometry, lower: BufferGeometry): void {
  const u = serialiseGeometry(upper);
  const l = serialiseGeometry(lower);
  const msg: WorkerResponse = { type: "piecesReady", upper: u, lower: l };
  self.postMessage(msg, [
    u.position.buffer,
    u.normal.buffer,
    u.index.buffer,
    l.position.buffer,
    l.normal.buffer,
    l.index.buffer,
  ]);
}

// ---------------------------------------------------------------------------
// Geometry serialisation (transferable ArrayBuffers over Worker boundary)
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
    // Draw groups allow the main thread to apply per-surface materials.
    // Present on shell geometry (outer=materialIndex 0, inner=1); empty on cut pieces.
    groups: geo.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
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
  return geo;
}
