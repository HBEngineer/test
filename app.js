// ==========================================
// Minimal 8th Wall test: tap a real-world surface to place a cube there.
// Tests the core building blocks - engine loading, camera access, and
// markerless SLAM hit-testing - before integrating into the real gantry
// project.
// ==========================================

const setStatus = (text) => {
  const el = document.getElementById('status');
  if (el) el.innerText = text;
};

const testCubePipelineModule = () => {
  let cube;

  return {
    name: 'test-cube-placer',

    onStart: ({ canvas }) => {
      resizeCanvasToWindow(); // canvas/camera confirmed ready at this point

      const { scene } = XR8.Threejs.xrScene();

      // Basic lighting so the cube is actually visible against the camera feed
      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(1, 2, 1);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5); // 10cm cube
      const material = new THREE.MeshStandardMaterial({ color: 0x0091ff });
      cube = new THREE.Mesh(geometry, material);
      cube.visible = false;
      scene.add(cube);

      canvas.addEventListener('touchstart', (e) => {
        const { width, height } = getViewportSize();
        const x = e.touches[0].clientX / width;
        const y = e.touches[0].clientY / height;
        const results = XR8.XrController.hitTest(x, y, ['FEATURE_POINT']);

        if (results.length > 0) {
          const { position, rotation } = results[0];
          cube.position.set(position.x, position.y, position.z);
          cube.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
          cube.visible = true;
          setStatus('Placed! Tap another surface to move it.');
        } else {
          setStatus('No surface detected there - try pointing at a textured floor/table.');
        }
      });

      setStatus('Move your phone to find a surface, then tap it.');
    },
  };
};

// ==========================================
// Ensure the canvas's actual WebGL drawing buffer matches the full screen
// resolution, not just its CSS display size. Without this, the rendered
// camera feed/3D content only occupies a small native-resolution area
// while the rest of the (CSS-stretched) canvas stays blank.
//
// Uses the Visual Viewport API rather than window.innerWidth/innerHeight -
// this reports the actual visible rendering area more consistently across
// mobile browsers (window.inner* behaved differently in Chrome on iOS vs
// Safari/Edge in testing, even though all three run on the same underlying
// WebKit engine on iOS).
//
// The CSS width/height are set with !important so nothing 8th Wall does
// internally can silently override them afterward (an inline !important
// style always wins over a later inline style without one). The numeric
// canvas.width/height (the actual drawing buffer, not a CSS property) has
// no such protection, so this gets re-applied repeatedly for a few seconds
// after startup too, since 8th Wall's own camera/canvas setup finishes
// asynchronously (after camera permission is granted) and may resize the
// canvas again after our first pass already ran.
// ==========================================

(*
const getViewportSize = () => {
  if (window.visualViewport) {
    return { width: window.visualViewport.width, height: window.visualViewport.height };
  }
  return { width: window.innerWidth, height: window.innerHeight };
};

const resizeCanvasToWindow = () => {
  const canvas = document.getElementById('camerafeed');
  if (!canvas) return;
  const { width, height } = getViewportSize();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.setProperty('width', width + 'px', 'important');
  canvas.style.setProperty('height', height + 'px', 'important');
  canvas.style.setProperty('position', 'absolute', 'important');
  canvas.style.setProperty('top', '0', 'important');
  canvas.style.setProperty('left', '0', 'important');
};
window.addEventListener('resize', resizeCanvasToWindow);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeCanvasToWindow);
}

const startResizeSafetyNet = () => {
  const start = Date.now();
  const interval = setInterval(() => {
    resizeCanvasToWindow();
    if (Date.now() - start > 5000) clearInterval(interval); // stop after 5s
  }, 250);
};

const onxrloaded = () => {
  resizeCanvasToWindow(); // set correct resolution before the engine starts

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(), // draws the camera feed
    XR8.Threejs.pipelineModule(),           // creates the AR three.js scene
    XR8.XrController.pipelineModule(),      // enables SLAM world tracking
    testCubePipelineModule(),               // our test content
  ]);

  XR8.run({
    canvas: document.getElementById('camerafeed'),
    allowedDevices: XR8.XrConfig.device().ANY,
  });

  resizeCanvasToWindow();   // immediate safety net
  startResizeSafetyNet();   // repeated safety net while camera/canvas finish async setup
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);

*)
