// ============================================================================
//  ar-iphone.js   >>>  NO MODIFICATION NEEDED  <<<
//  (change twin-config.js instead)
// ============================================================================
//  iPhone Live AR (8th Wall). Classic (non-module) script: 8th Wall expects a
//  global THREE, so this uses its own THREE r128 instance and its own copy of
//  the model, separate from main.js. It stays in sync with the MQTT values
//  through window.TwinShared (loaded from twin-shared.js).
//  (c) Hugo Ben - 2026 
// ============================================================================

(function () {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  const startBtn = document.getElementById('ios-live-ar-btn');
  const exitBtn = document.getElementById('ios-ar-exit-btn');
  const overlay = document.getElementById('ios-ar-scan-overlay');
  const overlayText = document.getElementById('ios-ar-scan-text');
  const canvas = document.getElementById('camerafeed');

  if (!isIOS || !startBtn) return; // only does something on iOS

  const CFG = window.TWIN_CONFIG;
  const Shared = window.TwinShared;

  let started = false;
  let modulesAdded = false;

  // THREE / GLTFLoader captured by an inline script in index.html BEFORE the
  // async 8th Wall engine can overwrite window.THREE.
  const CapturedTHREE = window.__CAPTURED_THREE__;
  const CapturedGLTFLoader = window.__CAPTURED_GLTFLOADER__;

  const setOverlayText = (text) => { if (overlayText) overlayText.innerText = text; };
  const showOverlay = () => { if (overlay) overlay.classList.add('visible'); };
  const hideOverlay = () => { if (overlay) overlay.classList.remove('visible'); };

  const getViewportSize = () => (window.visualViewport
    ? { width: window.visualViewport.width, height: window.visualViewport.height }
    : { width: window.innerWidth, height: window.innerHeight });

  // Hide/show the rest of the app UI while in live AR
  const appUiIds = ['status-panel', 'canvas-container', 'ios-ar-btn', 'ios-live-ar-btn'];
  const savedDisplayValues = {}; // remembers each element's real display value so it can be restored exactly
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

  // Pipeline module: loads the model into the 8th Wall scene and animates it
  const twinArPipelineModule = () => {
    let arGroup = null;
    let axisStateAR = {}; // this scene's own copy of the axis nodes

    return {
      name: 'twin-ar-placer',

      onStart: ({ canvas: pipelineCanvas }) => {
        try {
          if (!CFG || !Shared) {
            setOverlayText('Error: config not found. Reload the page.');
            return;
          }
          if (!CapturedTHREE || !CapturedGLTFLoader) {
            console.error('[AR] THREE/GLTFLoader reference was not captured.');
            setOverlayText('Error: 3D model loader not available. Check your connection and reload.');
            return;
          }

          const { scene, camera } = XR8.Threejs.xrScene();
          const L = CFG.lighting;
          const A = L.iosAR;

          // Lights (values from twin-config.js > lighting.iosAR)
          const hemi = new CapturedTHREE.HemisphereLight(L.hemi.sky, L.hemi.ground, A.hemi);
          hemi.position.set(0, 20, 0);
          scene.add(hemi);

          const key = new CapturedTHREE.DirectionalLight(L.key.color, A.key);
          key.position.set(...L.key.position);
          scene.add(key);

          const fill = new CapturedTHREE.DirectionalLight(L.fill.color, A.fill);
          fill.position.set(...L.fill.position);
          scene.add(fill);

          scene.add(new CapturedTHREE.AmbientLight(L.ambient.color, A.ambient));

          const camLight = new CapturedTHREE.DirectionalLight(L.camera.color, A.camera);
          camLight.position.set(...L.camera.position);
          camera.add(camLight);

          arGroup = new CapturedTHREE.Group();
          arGroup.visible = false;
          scene.add(arGroup);

          setOverlayText('Loading model...');
          const loadStartedAt = Date.now();
          let lastProgressAt = Date.now();

          // Warn the user if the download seems stalled
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
              axisStateAR = Shared.bindAxes(model); // nodes listed in twin-config.js
              arGroup.add(model);
              setOverlayText('Move your phone to find a surface, then tap it.');
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

          // Tap to place the model on a detected surface
          pipelineCanvas.addEventListener('touchstart', (e) => {
            if (!arGroup) return;
            const { width, height } = getViewportSize();
            const results = XR8.XrController.hitTest(
              e.touches[0].clientX / width,
              e.touches[0].clientY / height,
              ['FEATURE_POINT']
            );
            if (results.length > 0) {
              const { position } = results[0];
              arGroup.position.set(position.x, position.y, position.z);
              arGroup.quaternion.identity(); // single FEATURE_POINT rotation is unreliable and skews the model
              arGroup.visible = true;
              hideOverlay();
            }
          });
        } catch (err) {
          console.error('[AR] Unexpected error during AR setup:', err);
          setOverlayText(`Unexpected error: ${err && err.message ? err.message : String(err)}`);
        }
      },

      onUpdate: () => Shared.stepAxes(axisStateAR)
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
          XR8.GlTextureRenderer.pipelineModule(),       // camera feed
          XRExtras.FullWindowCanvas.pipelineModule(),   // keeps canvas full-window across rotations
          XR8.Threejs.pipelineModule(),                 // AR three.js scene
          XR8.XrController.pipelineModule(),            // SLAM world tracking
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
    hideOverlay();
    setAppUiVisible(true);
  };

  startBtn.addEventListener('click', startAR);
  exitBtn.addEventListener('click', stopAR);
})();