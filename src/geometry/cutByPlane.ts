import {
  BufferGeometry,
  Box3,
  Vector3,
  BoxGeometry,
  Matrix4,
  MeshBasicMaterial,
} from "three";
import { Brush, Evaluator, INTERSECTION } from "three-bvh-csg";
import type { CutPlaneSpec, MoldPieces } from "./types.ts";

// Shared CSG evaluator — stateless, safe to reuse across calls.
const _evaluator = new Evaluator();
_evaluator.useGroups = false; // simplify output to a single material group
// Our geometry has no UV attribute; restrict to the attributes we actually have
// to prevent GeometryBuilder.initFromGeometry from throwing on the missing 'uv' key.
_evaluator.attributes = ["position", "normal"];

/**
 * Cut a shell geometry into two halves along a specified plane.
 *
 * Implementation:
 *  For each half we construct a large axis-aligned box that covers the side of
 *  the plane we want to keep, then compute the CSG INTERSECTION of the shell
 *  with that box.  The CSG library automatically caps the cut face with a
 *  planar polygon, producing a watertight half.
 *
 * The box is sized to fully enclose the shell bounding sphere so that the
 * box boundary never appears in the result.
 *
 * @param shell - Watertight mold shell geometry (in world space).
 * @param plane - Cutting plane specification (origin + unit normal).
 * @returns A {@link MoldPieces} pair: `upper` is on the normal side, `lower` is opposite.
 */
export function cutByPlane(
  shell: BufferGeometry,
  plane: CutPlaneSpec,
): MoldPieces {
  // Compute a radius large enough to fully enclose the shell
  const box = new Box3().setFromBufferAttribute(
    shell.getAttribute("position") as Parameters<
      Box3["setFromBufferAttribute"]
    >[0],
  );
  const sizeVec = new Vector3();
  box.getSize(sizeVec);
  // Extra factor ensures the box extends well beyond the shell boundary
  const bigR = sizeVec.length() * 2 + 10;

  const origin = new Vector3(plane.origin.x, plane.origin.y, plane.origin.z);
  const normal = new Vector3(
    plane.normal.x,
    plane.normal.y,
    plane.normal.z,
  ).normalize();

  // Wrap the shell in a Brush (Brush extends Mesh)
  const shellBrush = new Brush(shell, new MeshBasicMaterial());
  shellBrush.updateMatrixWorld(true);

  const upper = clipToHalfspace(shellBrush, origin, normal, bigR);
  const lower = clipToHalfspace(
    shellBrush,
    origin,
    normal.clone().negate(),
    bigR,
  );

  return { upper, lower };
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Return the CSG INTERSECTION of `shellBrush` with the half-space defined by
 * the plane `(origin, normal)`.  The half-space is represented as a thick box
 * whose near face lies on the cutting plane.
 *
 * @param shellBrush - The mold shell as a Brush.
 * @param origin - A point on the clipping plane.
 * @param normal - Unit normal pointing INTO the half-space to keep.
 * @param radius - Half-length of the clipping box; must exceed the mesh extent.
 */
function clipToHalfspace(
  shellBrush: Brush,
  origin: Vector3,
  normal: Vector3,
  radius: number,
): BufferGeometry {
  // The clipping box extends from 0 to radius along local +Z.
  // The local -Z face (at z = -radius/2) will be placed on the cutting plane.
  const boxGeo = new BoxGeometry(radius * 2, radius * 2, radius);
  const clipBrush = new Brush(boxGeo, new MeshBasicMaterial());

  // Build a combined matrix: first rotate so local +Z → normal, then
  // translate the box centre to (origin + normal * radius/2) so that the
  // near face of the box sits exactly on the plane.
  const rotMatrix = rotationToNormal(normal);
  const centre = origin.clone().addScaledVector(normal, radius * 0.5);
  const translateMatrix = new Matrix4().makeTranslation(
    centre.x,
    centre.y,
    centre.z,
  );

  clipBrush.matrix.copy(translateMatrix.multiply(rotMatrix));
  clipBrush.matrixAutoUpdate = false;
  clipBrush.updateMatrixWorld(true);

  // Perform INTERSECTION: keep only what is inside both meshes
  const result = new Brush();
  _evaluator.evaluate(shellBrush, clipBrush, INTERSECTION, result);

  result.geometry.computeVertexNormals();
  return result.geometry;
}

/**
 * Build a rotation Matrix4 that rotates the vector (0,0,1) to align with `target`.
 * Uses the Rodrigues rotation formula for numerical stability.
 */
function rotationToNormal(target: Vector3): Matrix4 {
  const from = new Vector3(0, 0, 1);
  const dot = from.dot(target);

  if (dot > 0.9999) {
    // Already aligned
    return new Matrix4();
  }

  if (dot < -0.9999) {
    // Opposite direction — rotate 180° around X
    return new Matrix4().makeRotationX(Math.PI);
  }

  const axis = new Vector3().crossVectors(from, target).normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  return new Matrix4().makeRotationAxis(axis, angle);
}
