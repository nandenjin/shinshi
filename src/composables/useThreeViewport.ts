import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PlaneHelper,
  Plane,
  Vector3,
  Color,
  DoubleSide,
  Box3,
  Sphere,
  type Object3D,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { moldStore } from "./useMoldStore.ts";
import { scheduleCut } from "./useMoldWorker.ts";

// ---------------------------------------------------------------------------
// Reusable materials (created once, shared across all mesh instances)
// ---------------------------------------------------------------------------

const _matSource = new MeshStandardMaterial({
  color: 0x888888,
  transparent: true,
  opacity: 0.5,
  side: DoubleSide,
});

// --- Normal mode ---
const _matShell = new MeshStandardMaterial({
  color: 0x4fc3f7,
  transparent: true,
  opacity: 0.6,
  side: DoubleSide,
});

// --- Section (clip) mode ---
// A single THREE.Plane shared between the material and the PlaneHelper sync path.
const _sectionClipPlane = new Plane(new Vector3(0, 1, 0), 0);

const _matShellSection = new MeshStandardMaterial({
  color: 0x4fc3f7,
  side: DoubleSide,
  clippingPlanes: [_sectionClipPlane],
});

// --- Interior-highlight mode ---
// materialIndex 0 → outer wall (ghost)
const _matOuterGhost = new MeshStandardMaterial({
  color: 0x4fc3f7,
  transparent: true,
  opacity: 0.12,
  side: DoubleSide,
  depthWrite: false,
});
// materialIndex 1 → inner wall (accent)
const _matInner = new MeshStandardMaterial({
  color: 0xffb74d,
  side: DoubleSide,
});

// --- Cut-piece materials (unchanged) ---
const _matUpper = new MeshStandardMaterial({
  color: 0xef9a9a,
  side: DoubleSide,
});
const _matLower = new MeshStandardMaterial({
  color: 0xa5d6a7,
  side: DoubleSide,
});

/**
 * Set up and manage a THREE.js viewport inside a canvas element.
 *
 * Encapsulates:
 *  - Scene, camera, renderer and render loop
 *  - OrbitControls for viewport navigation
 *  - TransformControls (translate/rotate) for the cutting plane gizmo
 *  - Reactive mesh updates driven by the mold store
 *
 * @param canvasRef - A Vue ref holding the `<canvas>` element to render into.
 * @param showGizmo - A Vue ref controlling whether the cutting-plane gizmo is visible.
 */
export function useThreeViewport(
  canvasRef: Ref<HTMLCanvasElement | null>,
  showGizmo: Ref<boolean>,
): void {
  let renderer: WebGLRenderer | null = null;
  let scene: Scene;
  let camera: OrthographicCamera;
  // Vertical world-unit extent visible at zoom=1; updated by fitCameraToObject
  let frustumSize = 200;
  let controls: OrbitControls;
  let transformControls: TransformControls;
  let animationId: number;
  let resizeObserver: ResizeObserver;

  // Live meshes that are swapped out whenever the store changes
  let sourceMesh: Mesh | null = null;
  let shellMesh: Mesh | null = null;
  let upperMesh: Mesh | null = null;
  let lowerMesh: Mesh | null = null;

  // Plane helper geometry for the cutting plane visualisation
  let planeHelper: PlaneHelper | null = null;

  // An invisible Object3D whose position and rotation define the cutting plane.
  // TransformControls modifies this object when the user drags the gizmo.
  let planeProxy: Mesh | null = null;

  onMounted(() => {
    const canvas = canvasRef.value;
    if (!canvas) return;

    // ------------------------------------------------------------------
    // Renderer
    // ------------------------------------------------------------------
    renderer = new WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(new Color(0x1e1e2e));
    // Required for per-material clippingPlanes (used by section display mode).
    renderer.localClippingEnabled = true;

    // ------------------------------------------------------------------
    // Scene
    // ------------------------------------------------------------------
    scene = new Scene();

    // Ambient light for base illumination
    scene.add(new AmbientLight(0xffffff, 0.6));

    // Key directional light
    const dirLight = new DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 2, 3);
    scene.add(dirLight);

    // Fill light from the opposite side
    const fillLight = new DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-2, -1, -1);
    scene.add(fillLight);

    // ------------------------------------------------------------------
    // Camera
    // ------------------------------------------------------------------
    {
      const aspect = canvas.clientWidth / canvas.clientHeight;
      camera = new OrthographicCamera(
        (-frustumSize * aspect) / 2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.01,
        10000,
      );
    }
    camera.position.set(100, 50, 150);

    // ------------------------------------------------------------------
    // OrbitControls — panning / zooming / rotating the viewport
    // ------------------------------------------------------------------
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;

    // ------------------------------------------------------------------
    // TransformControls — gizmo for moving the cutting plane
    // ------------------------------------------------------------------
    transformControls = new TransformControls(camera, canvas);
    transformControls.setMode("translate");

    // When the user drags the gizmo, disable orbit to avoid conflicts
    transformControls.addEventListener("dragging-changed", (event) => {
      controls.enabled = !(event as { value: boolean }).value;
    });

    // Sync the proxy position/rotation back to the store when the gizmo moves
    transformControls.addEventListener("objectChange", () => {
      syncGizmoToStore();
    });

    // TransformControls does not extend Object3D; use getHelper() to get the
    // renderable Object3D that should be added to the scene.
    scene.add(transformControls.getHelper());

    // ------------------------------------------------------------------
    // Cutting plane proxy (invisible Object3D the gizmo controls)
    // ------------------------------------------------------------------
    planeProxy = new Mesh(); // invisible — no material needed
    planeProxy.visible = false;
    scene.add(planeProxy);
    transformControls.attach(planeProxy);

    // ------------------------------------------------------------------
    // Cutting plane helper (infinite-plane wireframe visualisation)
    // ------------------------------------------------------------------
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    planeHelper = new PlaneHelper(plane, 200, 0xffd54f);
    scene.add(planeHelper);

    // ------------------------------------------------------------------
    // Resize handling
    // ------------------------------------------------------------------
    resizeObserver = new ResizeObserver(() => {
      if (!renderer || !canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      updateCameraFrustum(w / h);
    });
    resizeObserver.observe(canvas);

    // Trigger an initial size
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);

    // ------------------------------------------------------------------
    // Render loop
    // ------------------------------------------------------------------
    function animate() {
      animationId = requestAnimationFrame(animate);
      controls.update();
      renderer!.render(scene, camera);
    }
    animate();

    // ------------------------------------------------------------------
    // Reactive watchers — respond to store changes
    // ------------------------------------------------------------------

    // Source model changed → swap the source preview mesh
    watch(
      () => moldStore.sourceGeometry,
      (geo) => {
        if (sourceMesh) {
          scene.remove(sourceMesh);
          sourceMesh.geometry.dispose();
          sourceMesh = null;
        }
        if (geo) {
          sourceMesh = new Mesh(geo, _matSource);
          scene.add(sourceMesh);
          fitCameraToObject(sourceMesh);
          fitCutPlaneToObject(sourceMesh);
        }
      },
    );

    // Shell generated → rebuild shell mesh, then apply current display mode
    watch(
      () => moldStore.shellGeometry,
      (geo) => {
        clearPieceMeshes();
        if (shellMesh) {
          scene.remove(shellMesh);
          shellMesh.geometry.dispose();
          shellMesh = null;
        }
        if (geo) {
          // Start with the default normal-mode material; refreshSceneForMode will override.
          shellMesh = new Mesh(geo, _matShell);
          scene.add(shellMesh);
        }
        refreshSceneForMode();
      },
    );

    // Cut pieces ready → update pieces and re-apply display mode
    watch(
      () => [moldStore.upperPiece, moldStore.lowerPiece] as const,
      ([upper, lower]) => {
        clearPieceMeshes();
        if (upper) {
          upperMesh = new Mesh(upper, _matUpper);
          scene.add(upperMesh);
        }
        if (lower) {
          lowerMesh = new Mesh(lower, _matLower);
          scene.add(lowerMesh);
        }
        refreshSceneForMode();
      },
    );

    // Display mode changed → update materials and visibility; sync pieces if needed
    watch(
      () => moldStore.displayMode,
      (mode, prevMode) => {
        refreshSceneForMode();
        // Switching away from section mode: trigger a cut to ensure pieces
        // reflect the latest plane position (they were skipped while in section mode).
        if (
          prevMode === "section" &&
          mode === "normal" &&
          moldStore.shellGeometry
        ) {
          scheduleCut();
        }
      },
    );

    // Cut plane store changed (e.g. from numeric inputs or presets) → update gizmo & helper
    watch(
      () => moldStore.cutPlane,
      (spec) => {
        if (!planeProxy || !planeHelper) return;
        // Move the proxy object to match the new plane origin
        planeProxy.position.set(spec.origin.x, spec.origin.y, spec.origin.z);

        const n = new Vector3(
          spec.normal.x,
          spec.normal.y,
          spec.normal.z,
        ).normalize();

        // Rotate the proxy so its local +Y aligns with the new normal, so that
        // subsequent translate-gizmo drags read the correct orientation from quaternion.
        planeProxy.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), n);

        // Update the PlaneHelper to reflect the new plane equation
        const d = -n.dot(planeProxy.position); // plane constant: dot(n, x) + d = 0
        planeHelper.plane.set(n, d);

        // Keep the section-mode clipping plane in sync with the gizmo.
        _sectionClipPlane.set(n, d);
      },
      { deep: true, immediate: true },
    );

    // Gizmo visibility toggle
    watch(showGizmo, (visible) => {
      transformControls.getHelper().visible = visible;
      if (planeHelper) planeHelper.visible = visible;
    });
  });

  onUnmounted(() => {
    cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
    renderer?.dispose();
    controls?.dispose();
    transformControls?.dispose();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Update the orthographic frustum to fit `frustumSize` world units vertically,
   * preserving the given aspect ratio.
   */
  function updateCameraFrustum(aspect: number): void {
    camera.left = (-frustumSize * aspect) / 2;
    camera.right = (frustumSize * aspect) / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
  }

  /**
   * Reposition the camera so that `object` fills the viewport with some padding.
   * Keeps the current viewing direction; updates near/far to avoid clipping.
   */
  function fitCameraToObject(object: Object3D): void {
    const box = new Box3().setFromObject(object);
    const sphere = new Sphere();
    box.getBoundingSphere(sphere);
    const { radius, center } = sphere;

    // For orthographic projection the apparent size is controlled by the
    // frustum height (frustumSize), not camera distance.
    frustumSize = radius * 2 * 1.2; // diameter + 20 % breathing room

    // Derive current aspect from the frustum (avoids needing the canvas ref here)
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
    updateCameraFrustum(aspect);

    // Reset any zoom applied by OrbitControls so the fit is exact
    camera.zoom = 1;

    // Move the camera along its current viewing direction at a safe distance
    // (does not affect visible size, but matters for near/far clipping)
    const dist = radius * 4;
    const dir = camera.position.clone().sub(controls.target).normalize();
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(dir, dist);

    // Bracket near/far around the object
    camera.near = 0.01;
    camera.far = dist * 2 + radius * 4;
    camera.updateProjectionMatrix();
    controls.update();
  }

  /**
   * Update the cutting-plane helper and section-mode clipping plane to match the object's bounding sphere.p
   * @param object
   */
  function fitCutPlaneToObject(object: Object3D): void {
    const box = new Box3().setFromObject(object);
    const sphere = new Sphere();
    box.getBoundingSphere(sphere);

    // Set size of the plane helper to match the bounding sphere diameter
    if (planeHelper) {
      planeHelper.size = sphere.radius * 2;
      planeHelper.updateMatrixWorld();
    }
  }

  /** Remove and dispose both cut-piece meshes from the scene. */
  function clearPieceMeshes(): void {
    if (upperMesh) {
      scene.remove(upperMesh);
      upperMesh.geometry.dispose();
      upperMesh = null;
    }
    if (lowerMesh) {
      scene.remove(lowerMesh);
      lowerMesh.geometry.dispose();
      lowerMesh = null;
    }
  }

  /**
   * Apply materials and visibility to all scene meshes based on the current
   * `moldStore.displayMode`.  Call this whenever the mode, the shell, or the
   * cut pieces change.
   *
   * Mode behaviour:
   *  - `normal`   Shell is semi-transparent; hidden when cut pieces are present.
   *  - `section`  Shell is rendered with a live clipping plane; pieces hidden.
   *  - `interior` Shell rendered with ghost outer wall + highlighted inner wall; pieces hidden.
   */
  function refreshSceneForMode(): void {
    const mode = moldStore.displayMode;
    const hasPieces = !!upperMesh || !!lowerMesh;

    if (shellMesh) {
      if (mode === "normal") {
        shellMesh.material = _matShell as Material;
        // Show the full shell only when no cut pieces are ready.
        shellMesh.visible = !hasPieces;
      } else if (mode === "section") {
        shellMesh.material = _matShellSection as Material;
        shellMesh.visible = true;
      } else {
        // interior
        shellMesh.material = [_matOuterGhost, _matInner];
        shellMesh.visible = true;
      }
    }

    // Cut pieces are only meaningful (and shown) in normal mode.
    const showPieces = mode === "normal";
    if (upperMesh) upperMesh.visible = showPieces;
    if (lowerMesh) lowerMesh.visible = showPieces;
  }

  /**
   * Read the proxy object's world position and write it back to the store as
   * the new cut-plane origin.  The plane normal is derived from the proxy's
   * local +Y axis after applying its current rotation.
   */
  function syncGizmoToStore(): void {
    if (!planeProxy) return;

    const pos = planeProxy.position;
    moldStore.cutPlane.origin.x = pos.x;
    moldStore.cutPlane.origin.y = pos.y;
    moldStore.cutPlane.origin.z = pos.z;

    // Derive the cutting-plane normal from the proxy's local +Y direction
    const n = new Vector3(0, 1, 0).applyQuaternion(planeProxy.quaternion);
    moldStore.cutPlane.normal.x = parseFloat(n.x.toFixed(4));
    moldStore.cutPlane.normal.y = parseFloat(n.y.toFixed(4));
    moldStore.cutPlane.normal.z = parseFloat(n.z.toFixed(4));
  }
}
