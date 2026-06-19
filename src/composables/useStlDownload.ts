import type { BufferGeometry } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { Mesh, MeshBasicMaterial } from "three";

// A single shared exporter instance (stateless)
const _exporter = new STLExporter();

/**
 * Export a {@link BufferGeometry} to a binary STL file and trigger a browser
 * download.
 *
 * Binary STL is used instead of ASCII because it produces significantly
 * smaller files and is universally supported by slicer software.
 *
 * @param geometry - The geometry to export.
 * @param fileName - The suggested download file name (should end in `.stl`).
 */
export function downloadStl(geometry: BufferGeometry, fileName: string): void {
  // STLExporter operates on a Mesh, so wrap the geometry temporarily
  const mesh = new Mesh(geometry, new MeshBasicMaterial());

  // Export as binary — STLExporter returns a DataView<ArrayBuffer> in binary mode.
  // Access its underlying ArrayBuffer via the .buffer property, then cast to ensure
  // TypeScript knows it is a plain ArrayBuffer (not SharedArrayBuffer).
  const dataView = _exporter.parse(mesh, {
    binary: true,
  }) as unknown as DataView<ArrayBuffer>;
  const buffer = dataView.buffer as ArrayBuffer;

  // Create a temporary download link and click it programmatically
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  // Release the object URL after a tick to allow the browser to start the download
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
