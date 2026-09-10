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
      const { scene } = XR8.Threejs.xrScene();

      // Basic lighting so the cube is actually visible against the camera feed
      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(1, 2, 1);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1); // 10cm cube
      const material = new THREE.MeshStandardMaterial({ color: 0x0091ff });
      cube = new THREE.Mesh(geometry, material);
      cube.visible = false;
      scene.add(cube);

      canvas.addEventListener('touchstart', (e) => {
        const x = e.touches[0].clientX / window.innerWidth;
        const y = e.touches[0].clientY / window.innerHeight;
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
// ==========================================
const resizeCanvasToWindow = () => {
  const canvas = document.getElementById('camerafeed');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
};
window.addEventListener('resize', resizeCanvasToWindow);

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

  resizeCanvasToWindow(); // safety net in case XR8.run() reset canvas dimensions
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);
