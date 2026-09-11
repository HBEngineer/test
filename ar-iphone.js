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
// To stay in sync with the live gantry position without a second MQTT
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

  const resizeCanvasToWindow = () => {
    if (!canvas) return;
    const { width, height } = getViewportSize();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.setProperty('width', width + 'px', 'important');
    canvas.style.setProperty('height', height + 'px', 'important');
    canvas.style.setProperty('position', 'fixed', 'important');
    canvas.style.setProperty('top', '0', 'important');
    canvas.style.setProperty('left', '0', 'important');
  };

  const startResizeSafetyNet = () => {
    const start = Date.now();
    resizeSafetyNetInterval = setInterval(() => {
      resizeCanvasToWindow();
      if (Date.now() - start > 5000) {
        clearInterval(resizeSafetyNetInterval);
        resizeSafetyNetInterval = null;
      }
    }, 250);
  };

  // --- Hide/show the rest of the app's UI while in live AR, so nothing
  // overlaps the full-screen camera feed ---
  const appUiIds = ['status-card', 'light-panel', 'canvas-container', 'ios-ar-btn', 'ios-live-ar-btn'];
  const setAppUiVisible = (visible) => {
    appUiIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    });
  };

  // --- The pipeline module that actually loads the gantry model and
  // drives it from the live MQTT-derived positions ---
  const gantryArPipelineModule = () => {
    let arGroup = null;
    let placed = false;
    const axisStateAR = {}; // { PosX: { node, axis, sign, initial }, ... } - this scene's own copy

    return {
      name: 'gantry-ar-placer',

      onStart: ({ canvas: pipelineCanvas }) => {
        try {
          resizeCanvasToWindow();

          const cfg = window.GANTRY_CONFIG;
          if (!cfg) {
            console.error('[AR] window.GANTRY_CONFIG is missing - main.js may not have run/finished.');
            setOverlayText('Error: shared config not found. Try reloading the page.');
            return;
          }

          if (!window.THREE || typeof THREE.GLTFLoader !== 'function') {
            console.error('[AR] THREE.GLTFLoader is not available - the GLTFLoader script may have failed to load.');
            setOverlayText('Error: 3D model loader not available. Check your connection and reload.');
            return;
          }

          const { scene } = XR8.Threejs.xrScene();

          // Lighting for this scene - independent of the desktop scene's
          // lights, since this is a separate THREE instance. Matches the
          // same values as main.js's current defaults; if you retune the
          // lighting there, update these to match.
          const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
          hemi.position.set(20, 20, 20);
          scene.add(hemi);

          const key = new THREE.DirectionalLight(0xffffff, 2.0);
          key.position.set(4, 6, 4);
          scene.add(key);

          const fill = new THREE.DirectionalLight(0xffffff, 2.0);
          fill.position.set(-4, 3, -3);
          scene.add(fill);

          scene.add(new THREE.AmbientLight(0xffffff, 1));

          arGroup = new THREE.Group();
          arGroup.visible = false;
          scene.add(arGroup);

          setOverlayText('Loading gantry model...');
          const gltfLoader = new THREE.GLTFLoader();
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

              model.traverse((child) => {
                Object.entries(cfg.AXIS_CONFIG).forEach(([axisKey, axisCfg]) => {
                  if (child.name === axisCfg.nodeName) {
                    axisStateAR[axisKey] = {
                      node: child,
                      axis: axisCfg.axis,
                      sign: axisCfg.sign,
                      initial: child.position[axisCfg.axis]
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
                const pct = Math.round((xhr.loaded / xhr.total) * 100);
                const mb = (xhr.total / 1024 / 1024).toFixed(1);
                setOverlayText(`Loading gantry model... ${pct}% (${mb}MB total)`);
                console.log(`[AR] Model load progress: ${pct}% (${xhr.loaded}/${xhr.total} bytes)`);
              } else {
                const mbLoaded = (xhr.loaded / 1024 / 1024).toFixed(1);
                setOverlayText(`Loading gantry model... ${mbLoaded}MB loaded`);
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
              const { position, rotation } = results[0];
              arGroup.position.set(position.x, position.y, position.z);
              arGroup.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
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
        if (!cfg) return;
        Object.entries(axisStateAR).forEach(([key, state]) => {
          const targetRaw = cfg.mqttTargets[key] || 0;
          const targetValue = state.initial + (targetRaw * cfg.SCALE_FACTOR * state.sign);
          state.node.position[state.axis] += (targetValue - state.node.position[state.axis]) * cfg.LERP_FACTOR;
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

    window.addEventListener('resize', resizeCanvasToWindow);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', resizeCanvasToWindow);
    }

    const startEngine = () => {
      if (!modulesAdded) {
        XR8.addCameraPipelineModules([
          XR8.GlTextureRenderer.pipelineModule(), // draws the camera feed
          XR8.Threejs.pipelineModule(),           // creates the AR three.js scene
          XR8.XrController.pipelineModule(),      // enables SLAM world tracking
          gantryArPipelineModule()
        ]);
        modulesAdded = true;
      }

      XR8.run({
        canvas: canvas,
        allowedDevices: XR8.XrConfig.device().ANY
      });

      resizeCanvasToWindow();
      startResizeSafetyNet();
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