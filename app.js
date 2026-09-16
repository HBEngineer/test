const setStatus = (text) => {
  const el = document.getElementById('status');
  if (el) el.innerText = text;
};

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
  // No !important - let 8th Wall's own internal resize handling own the
  // canvas after XR8.run() starts, rather than fighting it.
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
};
window.addEventListener('resize', resizeCanvasToWindow);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resizeCanvasToWindow);

const testCubePipelineModule = () => {
  let cube;
  return {
    name: 'test-cube-placer',
    onStart: ({ canvas }) => {
      const { scene } = XR8.Threejs.xrScene();
      const light = new THREE.DirectionalLight(0xffffff, 1.5);
      light.position.set(1, 2, 1);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0xffffff, 0.6));

      const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
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
          setStatus('No surface detected - try again.');
        }
      });

      setStatus('Move your phone to find a surface, then tap it.');
    },
  };
};

const onxrloaded = () => {
  resizeCanvasToWindow();

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    testCubePipelineModule(),
  ]);

  XR8.run({
    canvas: document.getElementById('camerafeed'),
    allowedDevices: XR8.XrConfig.device().ANY,
  });

  // Nudge 8th Wall's own internal resize/camera handling to run once,
  // rather than us repeatedly forcing canvas dimensions ourselves.
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 800);
};

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded);