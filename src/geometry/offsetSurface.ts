/**
 * @file offsetSurface.ts
 * Robust outward offset surface via signed-distance field (SDF) + Manifold levelSet.
 *
 * The offset surface at distance `offset` from a closed source mesh is defined
 * as the level set {p : SDF(p) = offset}, where SDF is positive outside and
 * negative inside the mesh.  Because `Manifold.levelSet` uses Marching Tetrahedra
 * on a body-centred cubic grid it is guaranteed to produce a 2-manifold surface,
 * unlike standard Marching Cubes which can generate non-manifold edges at ambiguous
 * cells (e.g. thin features like the teapot handle/spout).
 *
 * Algorithm
 * ─────────
 *   1. Build a BVH of the source mesh (MeshBVH from three-mesh-bvh).
 *   2. Lay a uniform voxel grid over the mesh bbox expanded by `offset` + margin.
 *   3. Sample the signed distance at every grid corner via BVH closest-point
 *      queries; the sign is derived from the geometric face normal at the hit.
 *   4. Extract the isosurface at level `offset` with Manifold.levelSet(), feeding
 *      it a trilinear-interpolating SDF closure over the precomputed field.
 *   5. Return the resulting indexed, watertight BufferGeometry.
 *
 * Preconditions (enforced by the Worker pipeline)
 * ────────────────────────────────────────────────
 *   • `source` is a closed watertight manifold (after STL import + mergeVertices).
 *   • `source` is indexed (BufferGeometry with a Uint32 index buffer).
 *   • `source` has precomputed outward-facing vertex normals.
 */

import { BufferGeometry, Uint32BufferAttribute, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import { fromManifold, type ManifoldToplevel } from "./manifoldConvert.ts";

// ---------------------------------------------------------------------------
// Module-level reusable vectors (no per-call allocation in the hot loop)
// ---------------------------------------------------------------------------
const _queryPt = new Vector3();
const _dir = new Vector3();
const _va = new Vector3();
const _vb = new Vector3();
const _vc = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();
const _faceN = new Vector3();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OffsetSurfaceOptions {
  /**
   * Progress callback; value is in [0, 1].
   * Called periodically during SDF sampling and once before levelSet extraction.
   */
  onProgress?: (value: number, label: string) => void;
}

/**
 * Build a closed outward offset surface at distance `offset` from `source`.
 *
 * @param source  Closed, indexed, watertight source mesh (worker-guaranteed).
 * @param offset  Offset distance in model units (must be > 0).
 * @param wasm    Initialised ManifoldToplevel (used for levelSet extraction).
 * @param opts    Optional settings (progress callback).
 * @returns Indexed BufferGeometry with outward-facing vertex normals.
 */
export function buildOffsetSurface(
  source: BufferGeometry,
  offset: number,
  wasm: ManifoldToplevel,
  opts?: OffsetSurfaceOptions,
): BufferGeometry {
  const onProgress = opts?.onProgress;

  // ── 0. Ensure indexed (defensive; the worker always provides an indexed geo) ─
  const geo = ensureIndexed(source);

  // ── 1. Build BVH ──────────────────────────────────────────────────────────
  const bvh = new MeshBVH(geo);

  // Cache index and position attributes for the face-normal helper.
  const indexArr = geo.getIndex()!.array as Uint32Array;
  const posAttr = geo.getAttribute("position");

  // ── 2. Determine voxel grid dimensions (speed-priority, auto resolution) ──
  geo.computeBoundingBox();
  const bbox0 = geo.boundingBox!.clone();
  const size0 = new Vector3();
  bbox0.getSize(size0);
  const longest = Math.max(size0.x, size0.y, size0.z);

  // Initial resolution: 64 voxels along the longest un-expanded axis.
  let vpa = 64;
  let voxelSize = longest / vpa;

  // Expand the bbox so the offset isosurface is fully inside the grid.
  // We add `offset` (to contain the surface) + 3 voxel layers of margin
  // so levelSet always closes the surface without reaching the grid boundary.
  const safetyPad = offset + 3 * voxelSize;
  const expandedBbox = bbox0.clone().expandByScalar(safetyPad);
  const expandedSize = new Vector3();
  expandedBbox.getSize(expandedSize);

  let nx = Math.ceil(expandedSize.x / voxelSize) + 1;
  let ny = Math.ceil(expandedSize.y / voxelSize) + 1;
  let nz = Math.ceil(expandedSize.z / voxelSize) + 1;

  // Budget clamp: ≤ 1.5 M grid points to stay within ~3 s in the worker.
  const BUDGET = 1_500_000;
  if (nx * ny * nz > BUDGET) {
    const scale = Math.cbrt(BUDGET / (nx * ny * nz));
    vpa = Math.max(Math.floor(vpa * scale), 20);
    voxelSize = longest / vpa;

    const newPad = offset + 3 * voxelSize;
    expandedBbox.copy(bbox0).expandByScalar(newPad);
    expandedBbox.getSize(expandedSize);
    nx = Math.ceil(expandedSize.x / voxelSize) + 1;
    ny = Math.ceil(expandedSize.y / voxelSize) + 1;
    nz = Math.ceil(expandedSize.z / voxelSize) + 1;
  }

  const origin = expandedBbox.min.clone();
  const field = new Float32Array(nx * ny * nz);

  // ── 3. Sample signed distance field ───────────────────────────────────────
  // Reusable HitPointInfo-compatible target object (avoids per-query allocations).
  const hitTarget = { point: new Vector3(), distance: 0, faceIndex: 0 };

  // Progress: SDF sampling covers 0 → 0.85.
  const progressStep = Math.max(1, Math.floor(nz * 0.05));

  for (let iz = 0; iz < nz; iz++) {
    if (iz % progressStep === 0) {
      onProgress?.((iz / nz) * 0.85, "samplingDistanceField");
    }

    const wz = origin.z + iz * voxelSize;

    for (let iy = 0; iy < ny; iy++) {
      const wy = origin.y + iy * voxelSize;
      const rowBase = iy * nx + iz * nx * ny;

      for (let ix = 0; ix < nx; ix++) {
        _queryPt.set(origin.x + ix * voxelSize, wy, wz);

        const hit = bvh.closestPointToPoint(_queryPt, hitTarget);
        if (!hit) {
          // Should not occur with infinite maxThreshold on a non-empty mesh.
          field[ix + rowBase] = offset + 1.0;
          continue;
        }

        // Compute the geometric face normal of the hit triangle directly from
        // the index buffer and position attribute — no heap allocation, no UV.
        const fi = hit.faceIndex * 3;
        _va.fromBufferAttribute(posAttr, indexArr[fi]);
        _vb.fromBufferAttribute(posAttr, indexArr[fi + 1]);
        _vc.fromBufferAttribute(posAttr, indexArr[fi + 2]);
        _e1.subVectors(_vb, _va);
        _e2.subVectors(_vc, _va);
        _faceN.crossVectors(_e1, _e2); // unnormalised; only the sign matters

        // Direction from closest surface point toward query point.
        _dir.subVectors(_queryPt, hit.point);

        // Positive (outside) when dir is on the same side as the face normal.
        const sign = _dir.dot(_faceN) >= 0 ? 1.0 : -1.0;
        field[ix + rowBase] = sign * hit.distance;
      }
    }
  }

  // ── 4. Extract isosurface via Manifold.levelSet ───────────────────────────
  // Manifold.levelSet uses a body-centred cubic grid of Marching Tetrahedra,
  // which guarantees 2-manifold output (unlike standard Marching Cubes).
  //
  // Sign convention difference:
  //   our field: positive = outside mesh   (SDF standard)
  //   levelSet:  positive = inside mesh    (OPPOSITE)
  // So we negate inside the SDF callback.
  //
  // We want the surface where field = offset, i.e. -field = -offset,
  // so we pass level = -offset to levelSet.
  onProgress?.(0.88, "extractingOffsetSurface");

  const nxy = nx * ny;
  const ox = origin.x,
    oy = origin.y,
    oz = origin.z;

  // Trilinear interpolation of the precomputed field at a world-space point.
  // `levelSet`'s BCC grid may sample at any point within `bounds`.
  const sdf = ([wx, wy, wz]: [number, number, number]): number => {
    // World → fractional grid coords.
    let gx = (wx - ox) / voxelSize;
    let gy = (wy - oy) / voxelSize;
    let gz = (wz - oz) / voxelSize;

    // Clamp to grid range [0, n-1].
    gx = Math.max(0, Math.min(nx - 1, gx));
    gy = Math.max(0, Math.min(ny - 1, gy));
    gz = Math.max(0, Math.min(nz - 1, gz));

    // Integer cell origin (clamped so ix+1 is always a valid index).
    const ix0 = Math.min(Math.floor(gx), nx - 2);
    const iy0 = Math.min(Math.floor(gy), ny - 2);
    const iz0 = Math.min(Math.floor(gz), nz - 2);
    const ix1 = ix0 + 1,
      iy1 = iy0 + 1,
      iz1 = iz0 + 1;

    // Fractional offsets within the cell.
    const tx = gx - ix0,
      ty = gy - iy0,
      tz = gz - iz0;
    const sx = 1 - tx,
      sy = 1 - ty,
      sz = 1 - tz;

    // Trilinear interpolation over the 8 cell corners.
    const v =
      field[ix0 + iy0 * nx + iz0 * nxy] * sx * sy * sz +
      field[ix1 + iy0 * nx + iz0 * nxy] * tx * sy * sz +
      field[ix0 + iy1 * nx + iz0 * nxy] * sx * ty * sz +
      field[ix1 + iy1 * nx + iz0 * nxy] * tx * ty * sz +
      field[ix0 + iy0 * nx + iz1 * nxy] * sx * sy * tz +
      field[ix1 + iy0 * nx + iz1 * nxy] * tx * sy * tz +
      field[ix0 + iy1 * nx + iz1 * nxy] * sx * ty * tz +
      field[ix1 + iy1 * nx + iz1 * nxy] * tx * ty * tz;

    // Negate: levelSet's convention is positive = inside.
    return -v;
  };

  const bounds = {
    min: [ox, oy, oz] as [number, number, number],
    max: [
      ox + (nx - 1) * voxelSize,
      oy + (ny - 1) * voxelSize,
      oz + (nz - 1) * voxelSize,
    ] as [number, number, number],
  };

  // level = -offset: surface where -field = -offset ⟺ field = offset.
  // edgeLength = voxelSize gives roughly the same triangle density as before.
  let manifold = wasm.Manifold.levelSet(sdf, bounds, voxelSize, -offset);

  // Multi-component safeguard: keep only the outermost shell.
  // The SDF level set can produce multiple closed components (outer shell +
  // inner cavity shells for hollow models). Pick the one with the largest volume.
  const parts = manifold.decompose();
  if (parts.length > 1) {
    let best = parts[0];
    let bestVol = Math.abs(best.volume());
    for (let i = 1; i < parts.length; i++) {
      const v = Math.abs(parts[i].volume());
      if (v > bestVol) {
        best.delete();
        best = parts[i];
        bestVol = v;
      } else {
        parts[i].delete();
      }
    }
    manifold.delete();
    manifold = best;
  }

  // Convert the guaranteed-manifold Manifold back to a BufferGeometry.
  const result = fromManifold(manifold);
  manifold.delete();

  onProgress?.(1.0, "offsetSurfaceComplete");
  return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return `geo` if it already has an index, or a clone with a sequential index.
 * MeshBVH and getTriangleHitPointInfo both require an indexed geometry.
 */
function ensureIndexed(geo: BufferGeometry): BufferGeometry {
  if (geo.getIndex()) return geo;

  const count = geo.getAttribute("position").count;
  const seq = new Uint32Array(count);
  for (let i = 0; i < count; i++) seq[i] = i;
  const cloned = geo.clone();
  cloned.setIndex(new Uint32BufferAttribute(seq, 1));
  return cloned;
}
