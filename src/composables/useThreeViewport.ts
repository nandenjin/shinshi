import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  AmbientLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  Plane,
  Vector3,
  Vector2,
  Raycaster,
  Color,
  DoubleSide,
  Box3,
  Sphere,
  LineLoop,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  type Object3D,
  type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { onMounted, onUnmounted, watch, type Ref } from "vue";
import { moldStore } from "./useMoldStore.ts";

// ---------------------------------------------------------------------------
// Reusable materials (created once, shared across all mesh instances)
// ---------------------------------------------------------------------------

const _matSource = new MeshStandardMaterial({
  color: 0x888888,
  transparent: true,
  opacity: 0.5,
  side: DoubleSide,
});

// --- Section (clip) mode ---
const _sectionClipPlane = new Plane(new Vector3(0, 1, 0), 0);

const _matShellSection = new MeshStandardMaterial({
  color: 0x4fc3f7,
  side: DoubleSide,
  clippingPlanes: [_sectionClipPlane],
});

// --- Default (merged interior) mode ---
// materialIndex 0 → outer wall (ghost)
const _matOuterGhost = new MeshStandardMaterial({
  color: 0x4fc3f7,
  transparent: true,
  opacity: 0.12,
  side: DoubleSide,
  depthWrite: false,
});

// materialIndex 1 → inner wall upper half (above cut plane)
// Clips fragments below the cut plane, leaving only the upper side visible.
const _innerUpperClipPlane = new Plane(new Vector3(0, 1, 0), 0);
const _matInnerUpper = new MeshStandardMaterial({
  color: 0xef9a9a,
  side: DoubleSide,
  clippingPlanes: [_innerUpperClipPlane],
});

// materialIndex 2 → inner wall lower half (below cut plane)
// Clips fragments above the cut plane, leaving only the lower side visible.
const _innerLowerClipPlane = new Plane(new Vector3(0, -1, 0), 0);
const _matInnerLower = new MeshStandardMaterial({
  color: 0xa5d6a7,
  side: DoubleSide,
  clippingPlanes: [_innerLowerClipPlane],
});

// Cut-piece materials (kept for future use but pieces are not shown)
const _matUpper = new MeshStandardMaterial({
  color: 0xef9a9a,
  side: DoubleSide,
});
const _matLower = new MeshStandardMaterial({
  color: 0xa5d6a7,
  side: DoubleSide,
});

// Unit-radius circle outline (in the local XY plane) used to visualise the
// cutting plane. Scaled and re-oriented per-instance to match the plane's
// radius, position and normal — kept as a unit shape so it can be shared.
const _planeCircleGeometry = new BufferGeometry();
{
  const segments = 64;
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(theta), Math.sin(theta), 0);
  }
  _planeCircleGeometry.setAttribute(
    "position",
    new Float32BufferAttribute(positions, 3),
  );
}

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
  let gizmoKeydownHandler: ((event: KeyboardEvent) => void) | null = null;

  // Live meshes that are swapped out whenever the store changes
  let sourceMesh: Mesh | null = null;
  let shellMesh: Mesh | null = null;
  let upperMesh: Mesh | null = null;
  let lowerMesh: Mesh | null = null;

  // Circular outline visualising the cutting plane's extent
  let planeHelper: LineLoop | null = null;
  let planeRadius = 100;

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
    camera.up.set(0, 0, 1);
    camera.position.set(100, 150, 50);

    // ------------------------------------------------------------------
    // OrbitControls — panning / zooming / rotating the viewport
    // ------------------------------------------------------------------
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;

    // ------------------------------------------------------------------
    // TransformControls — gizmo for moving the cutting plane
    // ------------------------------------------------------------------
    transformControls = new TransformControls(camera, canvas);
    transformControls.setMode(moldStore.gizmoMode);

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
    // Cutting plane helper (circular outline visualisation)
    // ------------------------------------------------------------------
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    planeHelper = new LineLoop(
      _planeCircleGeometry,
      new LineBasicMaterial({ color: 0xffd54f }),
    );
    planeHelper.scale.setScalar(planeRadius);
    scene.add(planeHelper);

    // ------------------------------------------------------------------
    // Gizmo selection — the gizmo only becomes draggable once the user has
    // clicked on the cutting plane; clicking anywhere else deselects it.
    // The precise TransformControls picker is tiny (and its handles are
    // hidden while unselected), so an unselected click is also accepted
    // anywhere on the visualised plane, not just on the picker itself.
    // ------------------------------------------------------------------
    let gizmoSelected = false;
    let justSelectedGizmo = false;
    const selectionRaycaster = new Raycaster();

    // The arrow handles are only shown while the gizmo is selected.
    function updateGizmoHelperVisibility(): void {
      transformControls.getHelper().visible = showGizmo.value && gizmoSelected;
    }

    /** Whether a pointer event lands within the visualised cutting-plane area. */
    function pointerHitsCutPlane(event: PointerEvent): boolean {
      if (!planeProxy || !canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      selectionRaycaster.setFromCamera(ndc, camera);
      const point = new Vector3();
      if (!selectionRaycaster.ray.intersectPlane(plane, point)) return false;
      return point.distanceTo(planeProxy.position) <= planeRadius;
    }

    // Fires whenever a pointerdown lands on a gizmo handle, right before it
    // would start a drag.
    transformControls.addEventListener("mouseDown", () => {
      if (!gizmoSelected) {
        // First click only selects the gizmo; cancel the drag this pointer
        // press would otherwise have started.
        gizmoSelected = true;
        justSelectedGizmo = true;
        transformControls.dragging = false;
        transformControls.axis = null;
        updateGizmoHelperVisibility();
      }
    });

    // Runs after TransformControls' own pointerdown handling (registered
    // above), so `axis` already reflects whether this click hit a handle.
    canvas.addEventListener("pointerdown", (event) => {
      if (justSelectedGizmo) {
        justSelectedGizmo = false;
        return;
      }
      if (!gizmoSelected) {
        if (pointerHitsCutPlane(event)) {
          gizmoSelected = true;
          updateGizmoHelperVisibility();
        }
        return;
      }
      if (transformControls.axis === null) {
        gizmoSelected = false;
        updateGizmoHelperVisibility();
      }
    });

    // Blender-style keyboard shortcuts: while the gizmo is selected, G
    // switches to move (translate) and R switches to rotate.
    gizmoKeydownHandler = (event: KeyboardEvent) => {
      if (!gizmoSelected) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (event.key === "g" || event.key === "G") {
        moldStore.gizmoMode = "translate";
      } else if (event.key === "r" || event.key === "R") {
        moldStore.gizmoMode = "rotate";
      }
    };
    window.addEventListener("keydown", gizmoKeydownHandler);

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
          shellMesh = new Mesh(geo, [
            _matOuterGhost,
            _matInnerUpper,
            _matInnerLower,
          ]);
          scene.add(shellMesh);
        }
        refreshScene();
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
        refreshScene();
      },
    );

    // showSection changed → update materials and visibility
    watch(
      () => moldStore.showSection,
      () => {
        refreshScene();
      },
    );

    // sectionFlipped changed → re-apply section clipping plane direction
    watch(
      () => moldStore.sectionFlipped,
      () => {
        const spec = moldStore.cutPlane;
        const n = new Vector3(
          spec.normal.x,
          spec.normal.y,
          spec.normal.z,
        ).normalize();
        const d = -n.dot(
          new Vector3(spec.origin.x, spec.origin.y, spec.origin.z),
        );
        if (moldStore.sectionFlipped) {
          _sectionClipPlane.set(n, d);
        } else {
          _sectionClipPlane.set(n.clone().negate(), -d);
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

        // Keep the plane-circle outline centred on and normal to the same point
        // used for gizmo-selection hit-testing.
        planeHelper.position.copy(planeProxy.position);
        planeHelper.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), n);

        const d = -n.dot(planeProxy.position); // plane constant: dot(n, x) + d = 0

        // Keep the section-mode clipping plane in sync with the gizmo.
        // Default (sectionFlipped=false): show the side below the cut plane.
        if (moldStore.sectionFlipped) {
          _sectionClipPlane.set(n, d);
        } else {
          _sectionClipPlane.set(n.clone().negate(), -d);
        }

        // Sync inner-wall colour split planes with the cut plane.
        _innerUpperClipPlane.set(n.clone(), d);
        _innerLowerClipPlane.set(n.clone().negate(), -d);
      },
      { deep: true, immediate: true },
    );

    // Gizmo visibility toggle
    watch(
      showGizmo,
      (visible) => {
        updateGizmoHelperVisibility();
        if (planeHelper) planeHelper.visible = visible;
      },
      { immediate: true },
    );

    // Gizmo mode (translate/rotate) toggle
    watch(
      () => moldStore.gizmoMode,
      (mode) => {
        transformControls.setMode(mode);
      },
    );
  });

  onUnmounted(() => {
    cancelAnimationFrame(animationId);
    resizeObserver?.disconnect();
    if (gizmoKeydownHandler)
      window.removeEventListener("keydown", gizmoKeydownHandler);
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

    // Size the plane-circle outline (and its hit-test radius) to match the
    // bounding sphere radius
    planeRadius = sphere.radius;
    if (planeHelper) planeHelper.scale.setScalar(planeRadius);
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
   * display flags.  Call this whenever showSection, the shell, or cut pieces change.
   */
  function refreshScene(): void {
    if (shellMesh) {
      if (moldStore.showSection) {
        shellMesh.material = _matShellSection as Material;
      } else {
        shellMesh.material = [_matOuterGhost, _matInnerUpper, _matInnerLower];
      }
      shellMesh.visible = true;
    }

    // Cut pieces are not shown; inner-wall colour split conveys the same info.
    if (upperMesh) upperMesh.visible = false;
    if (lowerMesh) lowerMesh.visible = false;
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
