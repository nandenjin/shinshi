import { BufferGeometry, Vector3, Box3 } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/** Result of a successful model load operation. */
export interface LoadedModel {
  /** Parsed and centred geometry ready for SDF construction. */
  geometry: BufferGeometry;
  /** The original file name. */
  fileName: string;
  /**
   * Bounding-box size of the centred geometry in raw model coordinates.
   * Use together with `moldStore.unit` to derive real-world dimensions.
   */
  size: { x: number; y: number; z: number };
}

// A single shared STL loader instance (stateless; safe to reuse)
const _loader = new STLLoader();

/**
 * Load an STL file from a URL, parse it into a {@link BufferGeometry},
 * and centre it at the world origin.
 */
export async function loadModelFromUrl(
  url: string,
  fileName: string,
): Promise<LoadedModel> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const buffer = await response.arrayBuffer();
  return _parseBuffer(buffer, fileName);
}

/**
 * Load an STL file from a {@link File} object, parse it into a
 * {@link BufferGeometry}, and centre it at the world origin.
 *
 * Centering makes it easier to position the cutting plane and ensures the
 * SDF bounding box is symmetric around the origin.
 *
 * @param file - The `.stl` file selected by the user.
 * @returns A promise that resolves with the loaded model data.
 */
export async function loadModelFromFile(file: File): Promise<LoadedModel> {
  const buffer = await file.arrayBuffer();
  return _parseBuffer(buffer, file.name);
}

function _parseBuffer(buffer: ArrayBuffer, fileName: string): LoadedModel {
  const geometry = _loader.parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  centreGeometry(geometry);
  const sizeVec = new Vector3();
  geometry.boundingBox!.getSize(sizeVec);
  const size = { x: sizeVec.x, y: sizeVec.y, z: sizeVec.z };
  return { geometry, fileName, size };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Translate a geometry in-place so that the centre of its bounding box
 * aligns with the world origin (0, 0, 0).
 */
function centreGeometry(geo: BufferGeometry): void {
  const box = new Box3().setFromBufferAttribute(
    geo.getAttribute("position") as Parameters<
      Box3["setFromBufferAttribute"]
    >[0],
  );
  const centre = new Vector3();
  box.getCenter(centre);

  // Negate the centre vector to get the required translation
  geo.translate(-centre.x, -centre.y, -centre.z);
  geo.computeBoundingBox();
}
