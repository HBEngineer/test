// ============================================================================
//  ar-iphone.js   >>>  NO MODIFICATION NEEDED  <<<
//  (change the "ar" section of twin-config.js instead)
// ============================================================================
//  iPhone Live AR (8th Wall engine binary). Classic (non-module) script:
//  8th Wall expects a global THREE, so this uses its own THREE r128 instance
//  and its own copy of the model, separate from main.js. It stays in sync with
//  the MQTT values through window.TwinShared (twin-shared.js).
//
//  What it does:
//   1. PLACEMENT  Waits until tracking is stable, then places the model on the
//                 ground plane (optionally facing the user) when you tap.
//   2. FEEDBACK   Shows tracking-quality messages and a "Re-scan" button
//                 (recenters the engine and lets you place the model again).
//   3. MARKERS    Optional image targets that anchor the model at an exact
//                 position/orientation/size and re-anchor it every time a
//                 marker comes into view (corrects drift). 1 to 4 markers.
//   4. SMOOTHING  Marker re-anchoring is smoothed with a dead-band so the model
//                 does not tremble.
//
//  8th Wall API used (checked against the engine docs):
//   XR8.XrController.configure({scale, imageTargetData, imageTargets}),
//   XR8.XrController.hitTest, XR8.XrController.recenter, and the pipeline
//   events reality.trackingstatus / reality.imagefound / imageupdated / imagelost.
// ============================================================================

(function () {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const startBtn = document.getElementById('ios-live-ar-btn');
  const exitBtn = document.getElementById('ios-ar-exit-btn');
  const rescanBtn = document.getElementById('ios-ar-rescan-btn');
  const overlay = document.getElementById('ios-ar-scan-overlay');
  const overlayText = document.getElementById('ios-ar-scan-text');
  const canvas = document.getElementById('camerafeed');

  if (!isIOS || !startBtn) return; // only does something on iOS

  const CFG = window.TWIN_CONFIG;
  const Shared = window.TwinShared;

  // ---- AR settings (twin-config.js > ar), with safe defaults ----
  const AR = CFG.ar || {};
  const P = Object.assign({
    stabilizeMs: 800,
    groundOnly: false,        // false = use the tapped point's own height (as before)
    facing: 'world',          // 'world' = no extra rotation (as before)
    yawOffsetDeg: 0,
    preferSurfaces: false     // false = use the first hit-test result (as before)
  }, AR.placement);
  const MK = Object.assign({
    smoothing: 0.15,
    keepUpright: true,
    deadbandM: 0.005,
    deadbandDeg: 0.5
  }, AR.markerOptions);
  const MARKER_CFGS = AR.markers || [];

  // THREE / GLTFLoader captured by an inline script in index.html BEFORE the
  // async 8th Wall engine can overwrite window.THREE.
  const T = window.__CAPTURED_THREE__;
  const CapturedGLTFLoader = window.__CAPTURED_GLTFLOADER__;

  let started = false;
  let modulesAdded = false;
  let markersLoaded = false;
  const markerData = []; // [{ name, widthM, json, pos, quat }]

  const setOverlayText = (text) => { if (overlayText) overlayText.innerText = text; };
  const showOverlay = () => { if (overlay) overlay.classList.add('visible'); };
  const hideOverlay = () => { if (overlay) overlay.classList.remove('visible'); };

  const getViewportSize = () => (window.visualViewport
    ? { width: window.visualViewport.width, height: window.visualViewport.height }
    : { width: window.innerWidth, height: window.innerHeight });

  // Hide/show the rest of the app UI while in live AR
  const appUiIds = ['status-panel', 'canvas-container', 'ios-ar-btn', 'ios-live-ar-btn'];
  const savedDisplayValues = {};
  const setAppUiVisible = (visible) => {
    appUiIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (visible) {
        el.style.display = savedDisplayValues[id] || '';
      } else {
        savedDisplayValues[id] = getComputedStyle(el).display;
        el.style.display = 'none';
      }
    });
  };

  // ---- Load the marker (image target) JSON files listed in the config ----
  async function loadMarkers() {
    if (markersLoaded) return;
    markersLoaded = true;
    if (!T) return;
    for (const m of MARKER_CFGS) {
      try {
        const res = await fetch(m.targetJson);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const r = (m.rotationDeg || [0, 0, 0]).map((d) => (d * Math.PI) / 180);
        markerData.push({
          name: json.name || m.name,
          widthM: m.widthM,
          json,
          pos: new T.Vector3(...(m.position || [0, 0, 0])),
          quat: new T.Quaternion().setFromEuler(new T.Euler(r[0], r[1], r[2], 'XYZ'))
        });
      } catch (err) {
        console.error('[AR] Could not load marker', m.targetJson, err);
      }
    }
  }

  // ---- Pipeline module: model, placement, tracking feedback, markers ----
  let resetPlacementFn = null; // assigned in onStart, used by the Re-scan button

  const twinArPipelineModule = () => {
    let arGroup = null;
    let arCamera = null;
    let axisStateAR = {};
    let modelLoaded = false;
    let placed = false;
    let anchored = false;        // true once a marker has positioned the model
    let markerTarget = null;     // { pos, quat, scale } smoothed toward every frame
    let trackingStatus = 'LIMITED';
    let trackingReason = 'INITIALIZING';
    let normalSince = null;
    let lastReady = false;
    let touchHandler = null;
    const visible = new Map();   // markers currently in view: name -> { m, d }

    const nowMs = () => performance.now();
    const isReady = () =>
      trackingStatus === 'NORMAL' && trackingReason !== 'INITIALIZING' &&
      normalSince !== null && nowMs() - normalSince >= P.stabilizeMs;

    const hasMarkers = () => markerData.length > 0;

    function refreshOverlay() {
      if (!modelLoaded) return; // loading progress owns the overlay until then
      if (placed) {
        if (trackingStatus === 'LIMITED') {
          setOverlayText('Tracking limited - move slowly, or press Re-scan');
          showOverlay();
        } else {
          hideOverlay();
        }
        return;
      }
      if (isReady()) {
        setOverlayText(hasMarkers()
          ? 'Tap the floor to place the model, or point at a marker'
          : 'Tap the floor to place the model');
      } else {
        setOverlayText(hasMarkers()
          ? 'Move your phone slowly to scan the floor, or point at a marker'
          : 'Move your phone slowly to scan the floor...');
      }
      showOverlay();
    }

    function resetPlacement() {
      placed = false;
      anchored = false;
      markerTarget = null;
      visible.clear();
      if (arGroup) {
        arGroup.visible = false;
        arGroup.scale.setScalar(1);
      }
      refreshOverlay();
    }

    // ---- Choose the best hit-test result (surface types beat raw feature points) ----
    function pickHit(results) {
      if (!results || results.length === 0) return null;
      if (!P.preferSurfaces) return results[0]; // same as the original behaviour
      for (const type of ['DETECTED_SURFACE', 'ESTIMATED_SURFACE', 'FEATURE_POINT']) {
        const hit = results.find((h) => h.type === type);
        if (hit) return hit;
      }
      return results[0];
    }

    // ---- Place the model where the user tapped ----
    function placeAt(hit) {
      const x = hit.position.x;
      const z = hit.position.z;
      // The scene origin is where the camera started, so the floor is NOT necessarily at y = 0.
      // Forcing y = 0 (groundOnly) can put the model at eye level, so it is off by default.
      const y = P.groundOnly ? 0 : hit.position.y;

      arGroup.scale.setScalar(1);
      arGroup.position.set(x, y, z);

      let yaw = (P.yawOffsetDeg * Math.PI) / 180;
      if (P.facing === 'camera' && arCamera) {
        yaw += Math.atan2(arCamera.position.x - x, arCamera.position.z - z);
      }
      // Yaw only: a single hit's own rotation is unreliable and skewed the model before.
      arGroup.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), yaw);

      arGroup.visible = true;
      placed = true;
      refreshOverlay();
    }

    // ---- Marker maths ----
    //  Marker pose in the MODEL frame (config) = (pm, qm)
    //  Marker pose in the WORLD (detected)     = (pw, qw), width scaledWidth
    //  Model group pose in the world:  qg = qw * qm^-1 ;  pg = pw - s * (qg * pm)
    //  Scale s (scene units per metre) = detected width / printed width.
    function computeAnchor(m, d) {
      const qw = new T.Quaternion(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w);
      const pw = new T.Vector3(d.position.x, d.position.y, d.position.z);

      let s = 1;
      if (d.scaledWidth && m.widthM) s = d.scaledWidth / m.widthM;
      else if (d.scale) s = d.scale;

      let qg = qw.clone().multiply(m.quat.clone().conjugate());
      if (MK.keepUpright) {
        // Keep the machine upright: use only the heading, ignore tilt from the marker.
        const f = new T.Vector3(0, 0, 1).applyQuaternion(qg);
        qg = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(f.x, f.z));
      }
      const pg = pw.clone().sub(m.pos.clone().applyQuaternion(qg).multiplyScalar(s));
      return { pos: pg, quat: qg, scale: s };
    }

    function updateMarkerAnchor() {
      if (!modelLoaded) return;

      if (visible.size > 0 && arCamera) {
        // With several markers in view, trust the nearest one.
        let best = null;
        let bestDist = Infinity;
        visible.forEach((v) => {
          const dist = arCamera.position.distanceTo(
            new T.Vector3(v.d.position.x, v.d.position.y, v.d.position.z));
          if (dist < bestDist) { bestDist = dist; best = v; }
        });

        const t = computeAnchor(best.m, best.d);
        if (!anchored) {
          // First anchor: snap, no smoothing
          markerTarget = t;
          arGroup.position.copy(t.pos);
          arGroup.quaternion.copy(t.quat);
          arGroup.scale.setScalar(t.scale);
          arGroup.visible = true;
          anchored = true;
          placed = true;
          refreshOverlay();
        } else {
          // Dead-band: ignore tiny changes so the model does not tremble
          const dPos = t.pos.distanceTo(markerTarget.pos);
          const dAng = (t.quat.angleTo(markerTarget.quat) * 180) / Math.PI;
          if (dPos > MK.deadbandM * t.scale || dAng > MK.deadbandDeg ||
              Math.abs(t.scale - markerTarget.scale) > 0.01 * markerTarget.scale) {
            markerTarget = t;
          }
        }
      }

      // Smoothly follow the target
      if (anchored && markerTarget) {
        const k = MK.smoothing;
        arGroup.position.lerp(markerTarget.pos, k);
        arGroup.quaternion.slerp(markerTarget.quat, k);
        arGroup.scale.setScalar(arGroup.scale.x + (markerTarget.scale - arGroup.scale.x) * k);
      }
    }

    // ---- Pipeline event handlers ----
    const onTrackingStatus = ({ detail }) => {
      trackingStatus = detail.status;
      trackingReason = detail.reason;
      normalSince = trackingStatus === 'NORMAL' ? (normalSince !== null ? normalSince : nowMs()) : null;
      refreshOverlay();
    };

    const markerByName = () => {
      const map = {};
      markerData.forEach((m) => { map[m.name] = m; });
      return map;
    };
    let markerLookup = {};

    const onImageSeen = ({ detail }) => {
      const m = markerLookup[detail.name];
      if (m) visible.set(detail.name, { m, d: detail });
    };
    const onImageLost = ({ detail }) => { visible.delete(detail.name); };

    return {
      name: 'twin-ar-placer',

      listeners: [
        { event: 'reality.trackingstatus', process: onTrackingStatus },
        { event: 'reality.imagefound', process: onImageSeen },
        { event: 'reality.imageupdated', process: onImageSeen },
        { event: 'reality.imagelost', process: onImageLost }
      ],

      onStart: ({ canvas: pipelineCanvas }) => {
        try {
          if (!CFG || !Shared) {
            setOverlayText('Error: config not found. Reload the page.');
            return;
          }
          if (!T || !CapturedGLTFLoader) {
            console.error('[AR] THREE/GLTFLoader reference was not captured.');
            setOverlayText('Error: 3D model loader not available. Check your connection and reload.');
            return;
          }

          // Reset per-session state (the module object is reused between sessions)
          axisStateAR = {};
          modelLoaded = false;
          placed = false;
          anchored = false;
          markerTarget = null;
          trackingStatus = 'LIMITED';
          trackingReason = 'INITIALIZING';
          normalSince = null;
          lastReady = false;
          visible.clear();
          markerLookup = markerByName();

          const xr = XR8.Threejs.xrScene();
          const scene = xr.scene;
          arCamera = xr.camera;
          const L = CFG.lighting;
          const A = L.iosAR;

          // Lights (values from twin-config.js > lighting.iosAR)
          const hemi = new T.HemisphereLight(L.hemi.sky, L.hemi.ground, A.hemi);
          hemi.position.set(0, 20, 0);
          scene.add(hemi);

          const key = new T.DirectionalLight(L.key.color, A.key);
          key.position.set(...L.key.position);
          scene.add(key);

          const fill = new T.DirectionalLight(L.fill.color, A.fill);
          fill.position.set(...L.fill.position);
          scene.add(fill);

          scene.add(new T.AmbientLight(L.ambient.color, A.ambient));

          const camLight = new T.DirectionalLight(L.camera.color, A.camera);
          camLight.position.set(...L.camera.position);
          arCamera.add(camLight);

          arGroup = new T.Group();
          arGroup.visible = false;
          scene.add(arGroup);

          // Debug: draw axes where the config says each marker sits on the model
          if (AR.debug) {
            markerData.forEach((m) => {
              const axes = new T.AxesHelper(0.25);
              axes.position.copy(m.pos);
              axes.quaternion.copy(m.quat);
              arGroup.add(axes);
            });
          }

          resetPlacementFn = resetPlacement;

          setOverlayText('Loading model...');
          const loadStartedAt = Date.now();
          let lastProgressAt = Date.now();
          const stallCheckInterval = setInterval(() => {
            const sinceProgress = Math.round((Date.now() - lastProgressAt) / 1000);
            const total = Math.round((Date.now() - loadStartedAt) / 1000);
            if (sinceProgress > 8) {
              setOverlayText(`Still loading... ${total}s elapsed, no progress for ${sinceProgress}s. Check your connection.`);
            }
          }, 2000);

          new CapturedGLTFLoader().load(
            CFG.model.url,
            (gltf) => {
              clearInterval(stallCheckInterval);
              const model = gltf.scene;
              model.scale.setScalar(CFG.model.scale);
              axisStateAR = Shared.bindAxes(model);
              arGroup.add(model);
              modelLoaded = true;
              refreshOverlay();
            },
            (xhr) => {
              lastProgressAt = Date.now();
              if (xhr.lengthComputable) {
                const pct = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
                setOverlayText(`Loading model... ${pct}% (${(xhr.total / 1024 / 1024).toFixed(1)}MB total)`);
              } else {
                setOverlayText(`Loading model... ${(xhr.loaded / 1024 / 1024).toFixed(1)}MB loaded`);
              }
            },
            (error) => {
              clearInterval(stallCheckInterval);
              console.error('[AR] Failed to load GLB model:', error);
              setOverlayText(`Failed to load 3D model: ${error && error.message ? error.message : 'unknown error'}`);
            }
          );

          // Tap to place (ignored once a marker has anchored the model)
          if (touchHandler) pipelineCanvas.removeEventListener('touchstart', touchHandler);
          touchHandler = (e) => {
            if (!arGroup || !modelLoaded || anchored) return;
            if (!isReady()) {
              setOverlayText('Tracking is still starting - keep moving slowly');
              showOverlay();
              return;
            }
            const { width, height } = getViewportSize();
            const results = XR8.XrController.hitTest(
              e.touches[0].clientX / width,
              e.touches[0].clientY / height,
              ['FEATURE_POINT']
            );
            const hit = pickHit(results);
            if (!hit) {
              setOverlayText('No surface found there - aim at the floor and tap again');
              showOverlay();
              return;
            }
            placeAt(hit);
          };
          pipelineCanvas.addEventListener('touchstart', touchHandler);
        } catch (err) {
          console.error('[AR] Unexpected error during AR setup:', err);
          setOverlayText(`Unexpected error: ${err && err.message ? err.message : String(err)}`);
        }
      },

      onUpdate: () => {
        Shared.stepAxes(axisStateAR);
        if (!arGroup) return;

        // "Stable long enough" is time-based, so re-check it every frame
        const ready = isReady();
        if (ready !== lastReady) {
          lastReady = ready;
          refreshOverlay();
        }
        updateMarkerAnchor();
      }
    };
  };

  // ---- Start / stop ----
  const startAR = async () => {
    if (started) return;
    started = true;

    setAppUiVisible(false);
    canvas.style.display = 'block';
    exitBtn.style.display = 'block';
    if (rescanBtn) rescanBtn.style.display = 'block';
    setOverlayText('Starting AR...');
    showOverlay();

    await loadMarkers();

    const startEngine = () => {
      // Must be configured BEFORE the engine runs
      const xrConfig = {};
      if (AR.scale && AR.scale !== 'responsive') xrConfig.scale = AR.scale;
      if (markerData.length > 0) {
        xrConfig.imageTargetData = markerData.map((m) => m.json);
        // Targets flagged loadAutomatically in their json start by themselves;
        // the others are activated by name.
        const manual = markerData.filter((m) => !m.json.loadAutomatically).map((m) => m.name);
        if (manual.length > 0) xrConfig.imageTargets = manual;
      }
      if (Object.keys(xrConfig).length > 0) XR8.XrController.configure(xrConfig);

      if (!modulesAdded) {
        XR8.addCameraPipelineModules([
          XR8.GlTextureRenderer.pipelineModule(),       // camera feed
          XRExtras.FullWindowCanvas.pipelineModule(),   // keeps canvas full-window across rotations
          XR8.Threejs.pipelineModule(),                 // AR three.js scene
          XR8.XrController.pipelineModule(),            // SLAM world tracking (+ image targets)
          twinArPipelineModule()
        ]);
        modulesAdded = true;
      }
      XR8.run({ canvas: canvas, allowedDevices: XR8.XrConfig.device().ANY });
    };

    if (window.XR8) startEngine();
    else window.addEventListener('xrloaded', startEngine, { once: true });
  };

  const stopAR = () => {
    if (!started) return;
    started = false;
    if (window.XR8 && XR8.stop) XR8.stop();
    canvas.style.display = 'none';
    exitBtn.style.display = 'none';
    if (rescanBtn) rescanBtn.style.display = 'none';
    hideOverlay();
    setAppUiVisible(true);
  };

  // Re-scan: restart tracking from the current view and place the model again
  const rescan = () => {
    if (!started) return;
    if (window.XR8 && XR8.XrController && XR8.XrController.recenter) XR8.XrController.recenter();
    if (resetPlacementFn) resetPlacementFn();
  };

  startBtn.addEventListener('click', startAR);
  exitBtn.addEventListener('click', stopAR);
  if (rescanBtn) rescanBtn.addEventListener('click', rescan);
})();