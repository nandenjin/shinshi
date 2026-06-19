/** Supported physical length units for STL model interpretation. */
export type LengthUnit = "m" | "cm" | "mm" | "in";

/**
 * How many millimetres one coordinate unit equals for each {@link LengthUnit}.
 * Used to convert a mm thickness value into model-coordinate units before
 * passing it to the shell-generation pipeline.
 */
export const MM_PER_UNIT: Record<LengthUnit, number> = {
  m: 1000,
  cm: 10,
  mm: 1,
  in: 25.4,
};

/** The order in which unit options are presented in the UI. */
export const UNIT_OPTIONS: LengthUnit[] = ["mm", "cm", "m", "in"];

/**
 * Convert a thickness expressed in millimetres to the equivalent value in
 * model-coordinate units.
 *
 * @param mm   - Thickness in millimetres (as entered by the user).
 * @param unit - The physical unit that one model-coordinate unit represents.
 * @returns Thickness in model units, ready to pass to {@link buildShell}.
 */
export function mmToModelUnits(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit];
}

/**
 * Maximum build-edge of a typical consumer FDM printer in millimetres.
 * Used as the upper bound when auto-detecting model units on load.
 */
export const DEFAULT_PRINTER_MAX_MM = 256;

/**
 * Infer the most plausible {@link LengthUnit} for a freshly-loaded STL file
 * by finding the largest unit under which the model's smallest non-degenerate
 * edge still fits within a typical printer's build volume.
 *
 * STL files carry no unit metadata, so this heuristic assumes the model was
 * designed for 3D printing and therefore has at least one dimension ≤ 256 mm
 * when interpreted in the correct unit.
 *
 * Algorithm:
 * 1. Compute `minRaw` — the smallest bbox edge, ignoring near-zero edges
 *    (< 1/10 000 of the max edge) to tolerate thin/flat models.
 * 2. Sort candidates by `MM_PER_UNIT` ascending (mm → cm → in → m).
 * 3. Return the largest candidate `u` for which
 *    `minRaw × MM_PER_UNIT[u] ≤ maxEdgeMm`.
 * 4. Fall back to `'mm'` if the bbox is degenerate or no candidate fits.
 *
 * @param size       - Raw bbox size in model coordinates.
 * @param maxEdgeMm  - Printer build threshold in mm (default 256 mm).
 * @param candidates - Unit options to consider (default {@link UNIT_OPTIONS}).
 * @returns The auto-detected {@link LengthUnit}.
 */
export function autoDetectUnit(
  size: { x: number; y: number; z: number },
  maxEdgeMm: number = DEFAULT_PRINTER_MAX_MM,
  candidates: LengthUnit[] = UNIT_OPTIONS,
): LengthUnit {
  const edges = [size.x, size.y, size.z];
  const maxRaw = Math.max(...edges);

  // Degenerate bbox — fall back to mm
  if (maxRaw <= 0) return "mm";

  const threshold = maxRaw * 1e-4;
  const significant = edges.filter((e) => e > threshold);
  const minRaw = significant.length > 0 ? Math.min(...significant) : maxRaw;

  // Sort candidates by MM_PER_UNIT ascending so we can find the largest that fits
  const sorted = [...candidates].sort(
    (a, b) => MM_PER_UNIT[a] - MM_PER_UNIT[b],
  );

  let best: LengthUnit | null = null;
  for (const u of sorted) {
    if (minRaw * MM_PER_UNIT[u] <= maxEdgeMm) {
      best = u;
    }
  }

  // If nothing fits (model is huge even in mm), return the smallest unit to
  // avoid inflating the apparent size further.
  return best ?? sorted[0];
}
