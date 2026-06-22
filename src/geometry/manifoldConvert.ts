/**
 * @file manifoldConvert.ts
 * Conversion helpers between THREE.js BufferGeometry and the Manifold WASM
 * library (manifold-3d), used to perform guaranteed-manifold CSG operations.
 *
 * The Manifold library always produces 2-manifold (watertight) output, unlike
 * three-bvh-csg which leaves boundary-edge cracks along cut seams.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Uint32BufferAttribute,
} from "three";
import type { ManifoldToplevel } from "manifold-3d";

// Re-export for convenience so callers don't need to import manifold-3d directly.
export type { ManifoldToplevel };

/**
 * Convert a THREE BufferGeometry to a Manifold object.
 *
 * Preconditions (enforced by the Worker pipeline):
 *  - `geo` must be indexed (has an index buffer).
 *  - `geo` must be a closed, welded, 2-manifold mesh.
 *  - Normals must be outward-facing (positive volume when measured by Manifold).
 *
 * If Manifold detects the winding is inverted (negative volume), the index
 * buffer is automatically reversed so the result has correct orientation.
 *
 * The caller is responsible for calling `.delete()` on the returned Manifold
 * when it is no longer needed to free WASM heap memory.
 *
 * @param wasm   Initialised ManifoldToplevel instance from `Module()`.
 * @param geo    Indexed, welded, closed-manifold BufferGeometry.
 * @returns      A live Manifold object; call `.delete()` when done.
 */
export function toManifold(
  wasm: ManifoldToplevel,
  geo: BufferGeometry,
): InstanceType<ManifoldToplevel["Manifold"]> {
  const posArr = geo.getAttribute("position").array as Float32Array;
  const idxArr = geo.getIndex()!.array as Uint32Array;

  const m = buildManifold(wasm, posArr, idxArr);

  // If the winding is inverted (volume < 0), reverse the index order.
  // Acts as a safety net for any CW-wound geometry that reaches this point.
  if (m.numTri() > 0 && m.volume() < 0) {
    m.delete();
    const flippedIdx = new Uint32Array(idxArr.length);
    for (let i = 0; i < idxArr.length; i += 3) {
      flippedIdx[i] = idxArr[i];
      flippedIdx[i + 1] = idxArr[i + 2];
      flippedIdx[i + 2] = idxArr[i + 1];
    }
    return buildManifold(wasm, posArr, flippedIdx);
  }

  return m;
}

/**
 * Construct a Manifold from raw position + index arrays.
 *
 * Stores the intermediate `Mesh` object in a local variable so that
 * `.delete()` can be called on it after the `Manifold` is built —
 * avoiding a potential WASM heap leak when `Mesh` holds native memory.
 */
function buildManifold(
  wasm: ManifoldToplevel,
  vertProperties: Float32Array,
  triVerts: Uint32Array,
): InstanceType<ManifoldToplevel["Manifold"]> {
  const mesh = new wasm.Mesh({ numProp: 3, vertProperties, triVerts });
  try {
    return new wasm.Manifold(mesh);
  } finally {
    // `Mesh` may hold WASM-heap memory not tracked by V8's GC.  Delete it
    // on both success and failure (including if Manifold throws NotManifold).
    (mesh as unknown as { delete?(): void }).delete?.();
  }
}

/**
 * Convert a Manifold object back to a THREE BufferGeometry.
 *
 * The returned geometry is indexed with outward-facing smooth vertex normals
 * (recomputed from the winding order). The Manifold is not deleted — the
 * caller retains ownership and must call `.delete()` when done.
 *
 * @param m  Live Manifold object.
 * @returns  Indexed BufferGeometry with position + normal attributes.
 */
export function fromManifold(
  m: InstanceType<ManifoldToplevel["Manifold"]>,
): BufferGeometry {
  const mesh = m.getMesh();

  // vertProperties is [x0,y0,z0, x1,y1,z1, ...] when numProp=3
  const positions = new Float32Array(mesh.vertProperties);
  const indices = new Uint32Array(mesh.triVerts);
  // Mesh is a plain JS object (no WASM C++ memory); no .delete() needed.

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setIndex(new Uint32BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}
