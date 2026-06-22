/**
 * @file cutByPlane.ts
 * Cut the mold shell into two halves using the Manifold library.
 *
 * three-bvh-csg cannot produce watertight cut seams — even a trivial sphere ∩
 * box intersection leaves ~115 boundary-edge cracks (measured empirically).
 * The Manifold library (manifold-3d, Google's WASM port) guarantees 2-manifold
 * output for every Boolean operation, so the cut cross-section is always a
 * clean annular cap with no boundary edges.
 *
 * Algorithm
 * ─────────
 *   1. Extract outer wall (group materialIndex=0) and inner wall (group
 *      materialIndex=1) from the merged shell.
 *   2. Pre-flip the inner wall from CW (inward normals from buildShell) to CCW
 *      before handing it to Manifold, so the Manifold library always receives
 *      consistently CCW-wound meshes.
 *   3. SUBTRACTION: outerManifold − innerManifold → hollow solid.
 *      toManifold() also volume-checks and re-flips if still negative, providing
 *      a second safety net.
 *   4. trimByPlane × 2: split the hollow solid along the cutting plane.
 */

import {
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  Uint32BufferAttribute,
} from "three";
import type { CutPlaneSpec, MoldPieces } from "./types.ts";
import {
  toManifold,
  fromManifold,
  type ManifoldToplevel,
} from "./manifoldConvert.ts";

/**
 * Cut a mold shell into two halves along a specified plane.
 *
 * @param shell - Merged mold shell from `buildShell` (groups 0/1/2 present).
 * @param plane - Cutting plane: `origin` is a point on the plane, `normal`
 *                points toward the "upper" half.
 * @param wasm  - Initialised ManifoldToplevel (from Module() in the worker).
 * @returns `{ upper, lower }` — each a watertight 2-manifold BufferGeometry.
 */
export function cutByPlane(
  shell: BufferGeometry,
  plane: CutPlaneSpec,
  wasm: ManifoldToplevel,
): MoldPieces {
  // ── 1. Extract closed-manifold components from the merged shell ───────────
  const outerGeo = extractGroupGeometry(shell, 0);
  const innerGeo = extractGroupGeometry(shell, 1);

  if (!outerGeo || !innerGeo) {
    throw new Error(
      "cutByPlane: shell has no material groups. " +
        "Expected groups 0 (outer wall) and 1 (inner wall) from buildShell.",
    );
  }

  // ── 2. Pre-flip inner wall from CW → CCW ──────────────────────────────────
  // The inner wall from buildShell has inverted (inward-facing) normals, i.e.
  // CW winding.  We flip it to CCW here so Manifold always receives positively-
  // oriented meshes.  toManifold() also volume-checks and re-flips on negative
  // volume as a second safety net.
  const innerSolidGeo = flipGeometry(innerGeo);

  // ── 3. SUBTRACTION → hollow solid ─────────────────────────────────────────
  // All Manifold handles are created inside a try/finally so every WASM heap
  // allocation is freed on every exit path (including throws).
  // Nested try-catches wrap each toManifold call to report which wall fails.
  type MType = ReturnType<typeof toManifold>;
  let outerM: MType | null = null;
  let innerM: MType | null = null;
  let shellSolid: MType | null = null;
  try {
    try {
      outerM = toManifold(wasm, outerGeo);
    } catch (e) {
      throw new Error(
        `cutByPlane: outer wall rejected by Manifold: ${e instanceof Error ? e.message : e}`,
        { cause: e },
      );
    }
    try {
      innerM = toManifold(wasm, innerSolidGeo);
    } catch (e) {
      throw new Error(
        `cutByPlane: inner wall rejected by Manifold: ${e instanceof Error ? e.message : e}`,
        { cause: e },
      );
    }

    if (outerM.numTri() === 0)
      throw new Error(
        "cutByPlane: outer wall Manifold is empty (check input mesh).",
      );
    if (innerM.numTri() === 0)
      throw new Error(
        "cutByPlane: inner wall Manifold is empty (check input mesh).",
      );

    shellSolid = outerM.subtract(innerM);

    if (shellSolid.numTri() === 0)
      throw new Error(
        "cutByPlane: SUBTRACTION produced empty result. " +
          "Check that the outer wall fully encloses the inner wall.",
      );

    // ── 4. trimByPlane × 2 → upper / lower ──────────────────────────────────
    // trimByPlane keeps the side where dot(point, normal) >= originOffset.
    const nx = plane.normal.x,
      ny = plane.normal.y,
      nz = plane.normal.z;
    const d = nx * plane.origin.x + ny * plane.origin.y + nz * plane.origin.z;

    const upperM = shellSolid.trimByPlane([nx, ny, nz], d);
    const lowerM = shellSolid.trimByPlane([-nx, -ny, -nz], -d);
    try {
      if (upperM.numTri() === 0 || lowerM.numTri() === 0)
        throw new Error(
          "Cut plane does not intersect the model — move the plane onto the object.",
        );
      return { upper: fromManifold(upperM), lower: fromManifold(lowerM) };
    } finally {
      upperM.delete();
      lowerM.delete();
    }
  } finally {
    outerM?.delete();
    innerM?.delete();
    shellSolid?.delete();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the sub-geometry for the first group with the given materialIndex.
 * Returns null if no matching group exists.
 */
function extractGroupGeometry(
  merged: BufferGeometry,
  materialIndex: number,
): BufferGeometry | null {
  const group = merged.groups.find((g) => g.materialIndex === materialIndex);
  if (!group) return null;

  const allPos = merged.getAttribute("position").array as Float32Array;
  const allNorm = merged.getAttribute("normal").array as Float32Array;
  const allIdx = merged.getIndex()!.array as Uint32Array;

  const { start, count } = group;

  // Remap vertex indices for this group into a compact range.
  const vertRemap = new Int32Array(allPos.length / 3).fill(-1);
  let newVertCount = 0;
  for (let i = start; i < start + count; i++) {
    const v = allIdx[i];
    if (vertRemap[v] === -1) vertRemap[v] = newVertCount++;
  }

  const newPos = new Float32Array(newVertCount * 3);
  const newNorm = new Float32Array(newVertCount * 3);
  for (let v = 0; v < allPos.length / 3; v++) {
    const nv = vertRemap[v];
    if (nv === -1) continue;
    newPos[nv * 3] = allPos[v * 3];
    newPos[nv * 3 + 1] = allPos[v * 3 + 1];
    newPos[nv * 3 + 2] = allPos[v * 3 + 2];
    newNorm[nv * 3] = allNorm[v * 3];
    newNorm[nv * 3 + 1] = allNorm[v * 3 + 1];
    newNorm[nv * 3 + 2] = allNorm[v * 3 + 2];
  }

  const newIdx = new Uint32Array(count);
  for (let i = 0; i < count; i++) newIdx[i] = vertRemap[allIdx[start + i]];

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(newPos, 3));
  geo.setAttribute("normal", new Float32BufferAttribute(newNorm, 3));
  geo.setIndex(new Uint32BufferAttribute(newIdx, 1));
  return geo;
}

/**
 * Return a new geometry with triangle winding reversed (CW ↔ CCW).
 * Does not mutate the input.
 */
function flipGeometry(geo: BufferGeometry): BufferGeometry {
  const srcIdx = geo.getIndex()!.array as Uint32Array;
  const flipped = new Uint32Array(srcIdx.length);
  for (let i = 0; i < srcIdx.length; i += 3) {
    flipped[i] = srcIdx[i];
    flipped[i + 1] = srcIdx[i + 2];
    flipped[i + 2] = srcIdx[i + 1];
  }
  const out = geo.clone();
  out.setIndex(new BufferAttribute(flipped, 1));
  out.computeVertexNormals();
  return out;
}
