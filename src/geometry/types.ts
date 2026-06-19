import type { BufferGeometry, Vector3 } from "three";

/** Parameters controlling shell (mold) generation. */
export interface MoldParams {
  /**
   * Desired wall thickness of the generated mold shell.
   *
   * **UI layer** (`moldStore.params.thickness`): stored in **millimetres**,
   * as entered by the user in `ThicknessControl`.
   *
   * **Worker layer**: before the value is posted to the worker it is converted
   * to model-coordinate units using `mmToModelUnits(thickness, moldStore.unit)`
   * in `useMoldWorker.ts`.  `buildShell` therefore always receives a value in
   * the same units as the imported geometry.
   */
  thickness: number;
}

/** Specification of a cutting plane in world space. */
export interface CutPlaneSpec {
  /** A point that lies on the cutting plane. */
  origin: { x: number; y: number; z: number };

  /**
   * Unit normal vector of the cutting plane.
   * The "upper" half-space contains points where dot(point - origin, normal) > 0.
   */
  normal: { x: number; y: number; z: number };
}

/**
 * The two halves of a cut mold shell.
 * "upper" is on the side of the plane normal; "lower" is the opposite side.
 */
export interface MoldPieces {
  upper: BufferGeometry;
  lower: BufferGeometry;
}

// ---------------------------------------------------------------------------
// Worker message protocol types
// (imported by both the main thread and mold.worker.ts)
// ---------------------------------------------------------------------------

/** A single geometry draw group, safe to serialise as a plain object. */
export interface SerialiseGeometryGroup {
  start: number;
  count: number;
  materialIndex: number;
}

/** Serialised geometry transferred over Worker boundary via Transferable arrays. */
export interface TransferableGeometry {
  position: Float32Array;
  normal: Float32Array;
  /** Index buffer; may be empty for non-indexed geometry. */
  index: Uint32Array;
  /**
   * Draw groups mapping index ranges to material slots.
   * Present on shell geometry (outer=0, inner=1); absent/empty on cut pieces.
   */
  groups?: SerialiseGeometryGroup[];
}

/** Convert a BufferGeometry into a plain transferable object. */
export type SerialiseGeometry = (geo: BufferGeometry) => TransferableGeometry;

/** Rebuild a BufferGeometry from a plain transferable object. */
export type DeserialiseGeometry = (raw: TransferableGeometry) => BufferGeometry;

// ---------------------------------------------------------------------------
// Worker request / response discriminated unions
// (defined in worker/protocol.ts, re-exported here for convenience)
// ---------------------------------------------------------------------------

/** A discriminated union of all requests sent from the main thread to the worker. */
export type WorkerRequest =
  | {
      type: "setModel";
      /** Serialised source model geometry. */
      geometry: TransferableGeometry;
      params: MoldParams;
      /** Current cutting plane — worker cuts immediately after building the shell. */
      plane: CutPlaneSpec;
    }
  | {
      type: "generateShell";
      params: MoldParams;
      /** Current cutting plane — worker cuts immediately after rebuilding the shell. */
      plane: CutPlaneSpec;
    }
  | {
      type: "applyCut";
      plane: CutPlaneSpec;
    };

/** A discriminated union of all messages sent from the worker to the main thread. */
export type WorkerResponse =
  | {
      type: "progress";
      /** Numeric progress in the range [0, 1]. */
      value: number;
      label: string;
    }
  | {
      type: "shellReady";
      shell: TransferableGeometry;
    }
  | {
      type: "piecesReady";
      upper: TransferableGeometry;
      lower: TransferableGeometry;
    }
  | {
      type: "error";
      message: string;
    };

/** Three.js Vector3 as a plain object, safe to serialise to/from a Worker. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Utility: convert a Three.js Vector3 to a plain Vec3. */
export function vec3ToPlain(v: Vector3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}
