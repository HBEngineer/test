// ==========================================
// iPhone Live AR (8th Wall)
// ==========================================
// This is a classic (non-module) script, not an ES module like main.js -
// 8th Wall's Three.js integration expects a global `THREE`, and ARButton
// (used for the Android/desktop WebXR path in main.js) is only ever
// published as an ES module. Those two requirements conflict, so this file
// uses its own separate THREE.js instance (loaded via classic <script>
// tags in index.html) and its own separate scene/model, rather than
// sharing main.js's ES-module THREE objects directly.
//
// To stay in sync with the live joint angles without a second MQTT
// connection or duplicated config, this reads from window.GANTRY_CONFIG,
// which main.js populates and keeps updated on every MQTT message.
// ==========================================

(function () {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const startBtn = document.getElementById('ios-live-ar-btn');
  const exitBtn = document.getElementById('ios-ar-exit-btn');
  const overlay = document.getElementById('ios-ar-scan-overlay');
  const overlayText = document.getElementById('ios-ar-scan-text');
  const canvas = document.getElementById('camerafeed');

  if (!isIOS || !startBtn) return; // this script only does anything on iOS

  let started = false;
  let modulesAdded = false;
  let resizeSafetyNetInterval = null;

  // --- Capture OUR OWN loaded THREE/GLTFLoader reference immediately,
  // rather than reading window.THREE fresh later inside onStart. The 8th
  // Wall engine script loads with `async`, so it can finish loading and
  // execute at an unpredictable time - including AFTER our classic
  // three.min.js/GLTFLoader.js tags have already run. If 8th Wall's engine
  // bundles its own internal Three.js and assigns it to window.THREE
  // (overwriting ours), reading window.THREE late inside onStart would
  // silently get their instance instead of ours, which never had
  // GLTFLoader attached. Capturing early and holding the reference via
  // closure sidesteps that entirely. ---
  // Captured in index.html via an inline script placed immediately after
  // our classic THREE/GLTFLoader tags and BEFORE the async 8th Wall engine
  // tag - guaranteed to run before any overwrite of window.THREE is
  // possible. Reading window.THREE fresh here would be too late.
  const CapturedTHREE = window.__CAPTURED_THREE__;
  const CapturedGLTFLoader = window.__CAPTURED_GLTFLOADER__;

  const setOverlayText = (text) => {
    if (overlayText) overlayText.innerText = text;
  };
  const showOverlay = () => { if (overlay) overlay.classList.add('visible'); };
  const hideOverlay = () => { if (overlay) overlay.classList.remove('visible'); };

  // --- Canvas sizing (see the 8th Wall test project for why this needs to
  // be this thorough - the canvas's actual drawing-buffer resolution
  // doesn't automatically match its CSS display size, and different
  // mobile browsers resolve window.innerWidth/innerHeight inconsistently,
  // so the Visual Viewport API is used instead where available) ---
  const getViewportSize = () => {
    if (window.visualViewport) {
      return { width: window.visualViewport.width, height: window.visualViewport.height };
    }
    return { width: window.innerWidth, height: window.innerHeight };
  };

  // Manual canvas resize code removed - XRExtras.FullWindowCanvas.pipelineModule()
  // (added to the pipeline below) is the official 8th Wall solution for this,
  // and properly syncs across orientation changes, which our hand-rolled
  // version never did correctly (that was the root cause of the small-canvas,
  // deformation, and trembling symptoms).

  // --- Hide/show the rest of the app's UI while in live AR, so nothing
  // overlaps the full-screen camera feed ---
  const appUiIds = ['status-panel', 'light-panel', 'canvas-container', 'ios-ar-btn', 'ios-live-ar-btn'];
  const savedDisplayValues = {}; // captures each element's actual display value before hiding, so it can be restored exactly (setting style.display = '' falls back to the stylesheet default, which is 'none' for the AR buttons - that was the bug)
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

  // --- The pipeline module that actually loads the robot model and
  // drives its six rotary joints from the live MQTT-derived angles (degrees) ---
  const robotArPipelineModule = () => {
    let arGroup = null;
    let placed = false;
    const axisStateAR = {}; // { PosA1: { node, axisVec, sign, offsetRad, restQuat, current }, ... } - this scene's own copy
    let jointQuat = null;   // scratch quaternion, created in onStart once THREE is known to be available

    return {
      name: 'robot-ar-placer',

      onStart: ({ canvas: pipelineCanvas }) => {
        try {

          const cfg = window.GANTRY_CONFIG;
          if (!cfg) {
            console.error('[AR] window.GANTRY_CONFIG is missing - main.js may not have run/finished.');
            setOverlayText('Error: shared config not found. Try reloading the page.');
            return;
          }

          if (!CapturedTHREE || !CapturedGLTFLoader) {
            console.error('[AR] Our own THREE/GLTFLoader reference was never captured - the classic script tags may have failed to load, or window.THREE was overwritten before we captured it.');
            setOverlayText('Error: 3D model loader not available. Check your connection and reload.');
            return;
          }

          jointQuat = new CapturedTHREE.Quaternion();

          const { scene } = XR8.Threejs.xrScene();

          // *** MODIFY HERE if you retune lighting in main.js ***
          // Lighting for this scene - independent of the desktop scene's
          // lights, since this is a separate THREE instance (this file runs
          // its own copy of THREE.js, not the ES-module one in main.js).
          // These values are NOT read from main.js automatically - they're
          // hand-copied. If you change BASE_INTENSITIES or the light setup
          // in main.js, update the matching values below by hand to keep
          // the desktop view and the iPhone AR view looking consistent.
          const hemi = new CapturedTHREE.HemisphereLight(0xb0e0e6, 0x555555, 1);
          hemi.position.set(0, 20, 0);
          scene.add(hemi);

          const key = new CapturedTHREE.DirectionalLight(0xffffff, 1.0);
          key.position.set(4, 6, 4);
          scene.add(key);

          const fill = new CapturedTHREE.DirectionalLight(0xbbe0ff, 0.5);
          fill.position.set(-4, 3, -3);
          scene.add(fill);

          scene.add(new CapturedTHREE.AmbientLight(0xedf5ff, 0.5));

          const arCameraLight = new CapturedTHREE.DirectionalLight(0xffffff, 2);
          arCameraLight.position.set(0, 1, 1);
          XR8.Threejs.xrScene().camera.add(arCameraLight);

          arGroup = new CapturedTHREE.Group();
          arGroup.visible = false;
          scene.add(arGroup);

          // *** No edits usually needed here *** - cfg.MODEL_URL comes from
          // main.js's MODEL_URL automatically via window.GANTRY_CONFIG, so
          // changing which GLB loads only needs to happen in main.js.
          setOverlayText('Loading robot model...');
          const gltfLoader = new CapturedGLTFLoader();
          const loadStartedAt = Date.now();
          let lastProgressAt = Date.now();

          // If no progress event fires for a while, the load is likely
          // genuinely stalled (network/CORS issue) rather than just slow -
          // let the person testing know, instead of a silent infinite spinner.
          const stallCheckInterval = setInterval(() => {
            const secsSinceProgress = Math.round((Date.now() - lastProgressAt) / 1000);
            const secsTotal = Math.round((Date.now() - loadStartedAt) / 1000);
            if (secsSinceProgress > 8) {
              setOverlayText(`Still loading... ${secsTotal}s elapsed, no progress for ${secsSinceProgress}s. Model may be stalled - check your connection.`);
            }
          }, 2000);

          gltfLoader.load(
            cfg.MODEL_URL,
            (gltf) => {
              clearInterval(stallCheckInterval);
              const model = gltf.scene;

              // *** No edits usually needed here *** - this reads
              // window.GANTRY_CONFIG (populated by main.js's AXIS_CONFIG),
              // so changing the DOF count / node names / axes only needs
              // to happen in main.js - this file picks up the same config
              // automatically and doesn't need touching for that.
              model.traverse((child) => {
                Object.entries(cfg.AXIS_CONFIG).forEach(([axisKey, axisCfg]) => {
                  if (child.name === axisCfg.nodeName) {
                    axisStateAR[axisKey] = {
                      node: child,
                      axisVec: new CapturedTHREE.Vector3(
                        axisCfg.axis === 'x' ? 1 : 0,
                        axisCfg.axis === 'y' ? 1 : 0,
                        axisCfg.axis === 'z' ? 1 : 0
                      ),
                      sign: axisCfg.sign,
                      offsetRad: CapturedTHREE.MathUtils.degToRad(axisCfg.offset || 0),
                      restQuat: child.quaternion.clone(), // orientation baked into the GLB
                      current: 0 // smoothed angle, degrees
                    };
                  }
                });
              });

              arGroup.add(model);
              setOverlayText('Move your phone to find a surface, then tap it.');
            },
            (xhr) => {
              lastProgressAt = Date.now();
              if (xhr.lengthComputable) {
                const pct = Math.min(100, Math.round((xhr.loaded / xhr.total) * 100));
                const mb = (xhr.total / 1024 / 1024).toFixed(1);
                setOverlayText(`Loading robot model... ${pct}% (${mb}MB total)`);
                console.log(`[AR] Model load progress: ${pct}% (${xhr.loaded}/${xhr.total} bytes)`);
              } else {
                const mbLoaded = (xhr.loaded / 1024 / 1024).toFixed(1);
                setOverlayText(`Loading robot model... ${mbLoaded}MB loaded`);
                console.log(`[AR] Model load progress: ${xhr.loaded} bytes (total size unknown)`);
              }
            },
            (error) => {
              clearInterval(stallCheckInterval);
              console.error('[AR] Failed to load GLB model:', error);
              setOverlayText(`Failed to load 3D model: ${error && error.message ? error.message : 'unknown error'}`);
            }
          );

          pipelineCanvas.addEventListener('touchstart', (e) => {
            if (!arGroup) return;
            const { width, height } = getViewportSize();
            const x = e.touches[0].clientX / width;
            const y = e.touches[0].clientY / height;
            const results = XR8.XrController.hitTest(x, y, ['FEATURE_POINT']);

            if (results.length > 0) {
              const { position } = results[0];
              arGroup.position.set(position.x, position.y, position.z);
              arGroup.quaternion.identity(); // a single FEATURE_POINT hit's rotation isn't reliably clean and was causing the model to render skewed/deformed on placement
              arGroup.visible = true;
              placed = true;
              hideOverlay();
            }
          });
        } catch (err) {
          console.error('[AR] Unexpected error during AR scene setup:', err);
          setOverlayText(`Unexpected error: ${err && err.message ? err.message : String(err)}`);
        }
      },

      onUpdate: () => {
        const cfg = window.GANTRY_CONFIG;
        if (!cfg || !jointQuat) return;
        Object.entries(axisStateAR).forEach(([key, state]) => {
          const target = cfg.mqttTargets[key] || 0; // degrees, from main.js
          state.current += (target - state.current) * cfg.LERP_FACTOR;
          const angle = CapturedTHREE.MathUtils.degToRad(state.current * state.sign) + state.offsetRad;
          // rest orientation * rotation about the node's local axis (same maths as main.js)
          jointQuat.setFromAxisAngle(state.axisVec, angle);
          state.node.quaternion.copy(state.restQuat).multiply(jointQuat);
        });
      }
    };
  };

  const startAR = () => {
    if (started) return;
    started = true;

    setAppUiVisible(false);
    canvas.style.display = 'block';
    exitBtn.style.display = 'block';
    setOverlayText('Starting AR...');
    showOverlay();

    const startEngine = () => {
      if (!modulesAdded) {
        XR8.addCameraPipelineModules([
          XR8.GlTextureRenderer.pipelineModule(), // draws the camera feed
          XRExtras.FullWindowCanvas.pipelineModule(), // official 8th Wall module: keeps the canvas correctly filling the window across orientation changes - replaces our hand-rolled resize code, which was causing the small-canvas/deformation/trembling symptoms
          XR8.Threejs.pipelineModule(),           // creates the AR three.js scene
          XR8.XrController.pipelineModule(),      // enables SLAM world tracking
          robotArPipelineModule()
        ]);
        modulesAdded = true;
      }

      XR8.run({
        canvas: canvas,
        allowedDevices: XR8.XrConfig.device().ANY
      });

    };

    if (window.XR8) {
      startEngine();
    } else {
      window.addEventListener('xrloaded', startEngine, { once: true });
    }
  };

  const stopAR = () => {
    if (!started) return;
    started = false;

    if (window.XR8 && XR8.stop) XR8.stop(); // closes the camera feed and stops tracking

    if (resizeSafetyNetInterval) {
      clearInterval(resizeSafetyNetInterval);
      resizeSafetyNetInterval = null;
    }

    canvas.style.display = 'none';
    exitBtn.style.display = 'none';
    hideOverlay();
    setAppUiVisible(true);
  };

  startBtn.addEventListener('click', startAR);
  exitBtn.addEventListener('click', stopAR);
})();