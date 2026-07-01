import {
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  Uint32BufferAttribute,
} from "three";
import { buildOffsetSurface } from "./offsetSurface.ts";
import type { ManifoldToplevel } from "./manifoldConvert.ts";

/**
 * Build the mold shell geometry from the source mesh.
 *
 * The shell consists of two surfaces:
 *  - **Outer wall**: a closed offset surface at distance `thickness` from the
 *    source mesh, computed via signed-distance field + Manifold.levelSet (marching
 *    tetrahedra).  Guaranteed 2-manifold; robust against self-intersections.
 *  - **Inner wall**: source geometry with face normals flipped inward.
 *
 * @param sourceGeometry - Original source mesh (indexed, with vertex normals).
 * @param thickness - Shell wall thickness in world units.
 * @param wasm - Initialised ManifoldToplevel for levelSet extraction.
 * @param onProgress - Optional progress callback.
 * @returns A single BufferGeometry representing the closed mold shell.
 */
export function buildShell(
  sourceGeometry: BufferGeometry,
  thickness: number,
  wasm: ManifoldToplevel,
  onProgress?: (value: number, label: string) => void,
): BufferGeometry {
  onProgress?.(0, "buildingOuterWall");
  // Outer wall progress is remapped from [0,1] → [0,0.5] of the overall shell build.
  const outerGeo = buildOuterWall(sourceGeometry, thickness, wasm, (v, label) =>
    onProgress?.(v * 0.5, label),
  );

  onProgress?.(0.5, "preparingInnerWall");
  const flippedInner = prepareInnerWall(sourceGeometry);

  onProgress?.(0.8, "mergingShellHalves");
  const merged = mergeGeometries([outerGeo, flippedInner]);

  onProgress?.(1, "shellComplete");
  return merged;
}

// ---------------------------------------------------------------------------
// Outer-wall construction via SDF + Marching Cubes
// ---------------------------------------------------------------------------

/**
 * Build the outer offset surface at distance `thickness` from `geo`.
 *
 * Delegates to {@link buildOffsetSurface}, which samples a signed-distance
 * field via BVH closest-point queries and extracts the isosurface using
 * Manifold.levelSet (marching tetrahedra).  Guaranteed 2-manifold output;
 * robust at any offset distance.
 */
function buildOuterWall(
  geo: BufferGeometry,
  thickness: number,
  wasm: ManifoldToplevel,
  onProgress?: (value: number, label: string) => void,
): BufferGeometry {
  return buildOffsetSurface(geo, thickness, wasm, { onProgress });
}

// ---------------------------------------------------------------------------
// Inner-wall preparation
// ---------------------------------------------------------------------------

/**
 * Prepare the inner wall from the original source geometry.
 *
 * The inner wall IS the source mesh with reversed winding so normals point inward.
 * If the geometry is non-indexed, a sequential index buffer is added first.
 */
function prepareInnerWall(geo: BufferGeometry): BufferGeometry {
  if (!geo.getIndex()) {
    const count = geo.getAttribute("position").count;
    const seq = new Uint32Array(count);
    for (let i = 0; i < count; i++) seq[i] = i;
    const indexed = geo.clone();
    indexed.setIndex(new Uint32BufferAttribute(seq, 1));
    return flipNormals(indexed);
  }
  return flipNormals(geo);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Reverse the triangle winding order of an indexed geometry
 * (returns a new geometry; does not mutate the input).
 */
function flipNormals(geo: BufferGeometry): BufferGeometry {
  const result = geo.clone();
  const index = result.getIndex();
  if (index) {
    const arr = index.array as Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    result.setIndex(new BufferAttribute(arr, 1));
  }
  result.computeVertexNormals();
  return result;
}

/**
 * Concatenate multiple BufferGeometries into one, re-indexing vertex indices
 * so that each sub-geometry's vertices don't collide with the others.
 */
function mergeGeometries(geos: BufferGeometry[]): BufferGeometry {
  let totalVerts = 0;
  let totalTris = 0;

  for (const g of geos) {
    totalVerts += g.getAttribute("position").count;
    totalTris += (g.getIndex()?.count ?? 0) / 3;
  }

  const posOut = new Float32Array(totalVerts * 3);
  const normOut = new Float32Array(totalVerts * 3);
  const idxOut = new Uint32Array(totalTris * 3);
  const out = new BufferGeometry();

  let vOffset = 0;
  let iOffset = 0;
  let materialIndex = 0;

  for (const g of geos) {
    const pos = g.getAttribute("position");
    const norm = g.getAttribute("normal");
    const ind = g.getIndex();

    const vCount = pos.count;
    posOut.set(pos.array as Float32Array, vOffset * 3);
    normOut.set(norm.array as Float32Array, vOffset * 3);

    if (ind) {
      const indArr = ind.array as Uint32Array;
      for (let i = 0; i < indArr.length; i++) {
        idxOut[iOffset + i] = indArr[i] + vOffset;
      }
      // materialIndex 0 = outer wall
      // materialIndex 1 = inner wall upper-half colour (clipped below cut plane)
      // materialIndex 2 = inner wall lower-half colour (clipped above cut plane)
      // Groups 1 and 2 share the same index range so the inner wall is drawn
      // twice — once per colour — with each material's clipping plane masking
      // the opposite half.  No vertex data is duplicated.
      out.addGroup(iOffset, indArr.length, materialIndex);
      if (materialIndex === 1) {
        out.addGroup(iOffset, indArr.length, 2);
      }
      iOffset += indArr.length;
    }

    vOffset += vCount;
    materialIndex++;
  }

  out.setAttribute("position", new Float32BufferAttribute(posOut, 3));
  out.setAttribute("normal", new Float32BufferAttribute(normOut, 3));
  out.setIndex(new Uint32BufferAttribute(idxOut, 1));

  return out;
}
