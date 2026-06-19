import {
  BufferGeometry,
  BufferAttribute,
  Float32BufferAttribute,
  Uint32BufferAttribute,
} from "three";

/**
 * Build the mold shell geometry from the source mesh using vertex-normal extrusion.
 *
 * The shell consists of two surfaces:
 *  - **Outer wall**: source geometry with each vertex displaced outward by `thickness`
 *    along its vertex normal — full topology and surface detail preserved.
 *  - **Inner wall**: source geometry with face normals flipped inward.
 *
 * @param sourceGeometry - Original source mesh (indexed, with vertex normals).
 * @param thickness - Shell wall thickness in world units.
 * @param onProgress - Optional progress callback.
 * @returns A single BufferGeometry representing the closed mold shell.
 */
export function buildShell(
  sourceGeometry: BufferGeometry,
  thickness: number,
  onProgress?: (value: number, label: string) => void,
): BufferGeometry {
  onProgress?.(0, "Building outer wall…");
  const outerGeo = buildOuterWall(sourceGeometry, thickness);

  onProgress?.(0.5, "Preparing inner wall…");
  const flippedInner = prepareInnerWall(sourceGeometry);

  onProgress?.(0.8, "Merging shell halves…");
  const merged = mergeGeometries([outerGeo, flippedInner]);

  onProgress?.(1, "Shell complete");
  return merged;
}

// ---------------------------------------------------------------------------
// Outer-wall construction via vertex-normal extrusion
// ---------------------------------------------------------------------------

/**
 * Displace every vertex of `geo` outward along its vertex normal by `thickness`.
 * Triangle connectivity and winding order are preserved, so normals remain outward-facing.
 */
function buildOuterWall(
  geo: BufferGeometry,
  thickness: number,
): BufferGeometry {
  const result = geo.clone();
  result.computeVertexNormals();

  const posAttr = result.getAttribute("position") as BufferAttribute;
  const normAttr = result.getAttribute("normal") as BufferAttribute;
  const count = posAttr.count;
  const newPos = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    newPos[i * 3] = posAttr.getX(i) + normAttr.getX(i) * thickness;
    newPos[i * 3 + 1] = posAttr.getY(i) + normAttr.getY(i) * thickness;
    newPos[i * 3 + 2] = posAttr.getZ(i) + normAttr.getZ(i) * thickness;
  }

  result.setAttribute("position", new Float32BufferAttribute(newPos, 3));
  result.computeVertexNormals();
  return result;
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
      // Record a draw group so each sub-geometry maps to a material slot.
      // materialIndex 0 = outer wall, 1 = inner wall.
      out.addGroup(iOffset, indArr.length, materialIndex);
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
