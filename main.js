// ==========================================
// 0. MODULE IMPORTS
// ==========================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

window.THREE = THREE; // Expose globally for 8th Wall Three.js pipeline module

// ==========================================
// 1. HIVEMQ CLOUD CREDENTIALS
// ==========================================
const HIVEMQ_HOST = "0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud";
const HIVEMQ_PORT = 8884;
const HIVEMQ_USERNAME = "FestoPLC1";
const HIVEMQ_PASSWORD = "FestoPLC1";
const MQTT_TOPIC = "festo/hgosydney/positions";

// ==========================================
// 2. CONFIG & GANTRY STATE
// ==========================================
const AXIS_CONFIG = {
  PosX: { nodeName: 'Slide_X', axis: 'z', sign: 1 },
  PosY: { nodeName: 'Slide_Y', axis: 'x', sign: -1 },
  PosZ: { nodeName: 'Slide_Z', axis: 'y', sign: -1 }
};

const axisState = {};
const SCALE_FACTOR = 0.001;
const LERP_FACTOR = 0.05;
const MODEL_URL = './model/hgosydney_Kinetic.glb';

let arGroup = new THREE.Group();
let modelPlaced = false;

// ==========================================
// 3. 8TH WALL PIPELINE MODULE
// ==========================================
const initXREngine = () => {
  return {
    name: 'gantry-ar-pipeline',

    onStart: ({ canvas }) => {
      const { scene, camera, renderer } = XR8.Threejs.xrScene();

      // Color & Exposure Settings (v1.0 Baseline)
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.65;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      // Dynamic Camera Light (Attached to Camera)
      const cameraLight = new THREE.DirectionalLight(0xffffff, 2.2);
      cameraLight.position.set(0, 0, 1);
      camera.add(cameraLight);
      scene.add(camera);

      // Environment Reflection Map
      const rgbeLoader = new RGBELoader();
      rgbeLoader.load('https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = texture;
        scene.environmentIntensity = 3.5;
      });

      // Key, Fill, Ambient & Hemisphere Studio Lights
      const keyLight = new THREE.DirectionalLight(0xffffff, 4.0);
      keyLight.position.set(4, 6, 4);
      keyLight.castShadow = true;
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xbbe0ff, 3.0);
      fillLight.position.set(-4, 3, -3);
      scene.add(fillLight);

      const ambientLight = new THREE.AmbientLight(0xedf5ff, 1.8);
      scene.add(ambientLight);

      const hemiLight = new THREE.HemisphereLight(0xb0e0e6, 0x555555, 1.6);
      hemiLight.position.set(0, 20, 0);
      scene.add(hemiLight);

      // Add AR Group to Scene
      scene.add(arGroup);
      arGroup.visible = false;

      // Load Gantry GLB Model
      const loader = new GLTFLoader();
      loader.load(
        MODEL_URL,
        (gltf) => {
          console.log('[MODEL] Loaded successfully!');
          const model = gltf.scene;

          model.traverse((child) => {
            if (child.isMesh) {
              child.castShadow = true;
              child.receiveShadow = true;
              if (child.material) {
                child.material.metalness = 0.90;
                child.material.roughness = 0.18;
                child.material.envMapIntensity = 3.5;
              }
            }

            Object.entries(AXIS_CONFIG).forEach(([key, cfg]) => {
              if (child.name === cfg.nodeName) {
                axisState[key] = {
                  node: child,
                  axis: cfg.axis,
                  sign: cfg.sign,
                  initial: child.position[cfg.axis],
                  target: 0
                };
              }
            });
          });

          arGroup.add(model);
        },
        undefined,
        (err) => console.error('[ERROR] GLB load error:', err)
      );

      // Tap-to-Place Model in World Space
      canvas.addEventListener('click', () => {
        if (!modelPlaced) {
          const { camera } = XR8.Threejs.xrScene();
          
          // Place 1.5m in front of the camera looking slightly down
          const forward = new THREE.Vector3(0, -0.2, -1.5).applyQuaternion(camera.quaternion);
          arGroup.position.copy(camera.position).add(forward);
          arGroup.rotation.y = camera.rotation.y;
          
          arGroup.visible = true;
          modelPlaced = true;

          const instruction = document.getElementById('ar-instruction');
          if (instruction) instruction.innerText = 'Gantry Placed';
        }
      });
    },

    // Smooth Lerp Animation Engine Frame Callback
    onUpdate: () => {
      Object.values(axisState).forEach(({ node, axis, sign, initial, target }) => {
        const targetValue = initial + (target * SCALE_FACTOR * sign);
        node.position[axis] += (targetValue - node.position[axis]) * LERP_FACTOR;
      });
    }
  };
};

// ==========================================
// 4. HIVEMQ CLOUD CONNECTION
// ==========================================
const brokerUrl = `wss://${HIVEMQ_HOST}:${HIVEMQ_PORT}/mqtt`;
const client = mqtt.connect(brokerUrl, {
  clientId: 'gantry_web_twin_8w_' + Math.random().toString(16).substring(2, 10),
  username: HIVEMQ_USERNAME,
  password: HIVEMQ_PASSWORD,
  clean: true
});

client.on('connect', () => {
  console.log('[MQTT] Connected to HiveMQ Cloud');
  const statusElem = document.getElementById('status');
  const dotElem = document.getElementById('dot');

  if (statusElem) statusElem.innerText = 'Connected';
  if (dotElem) {
    dotElem.style.backgroundColor = '#4caf50';
    dotElem.style.boxShadow = '0 0 10px #4caf50';
  }

  client.subscribe(MQTT_TOPIC);
});

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    Object.keys(AXIS_CONFIG).forEach((key) => {
      if (payload[key] !== undefined && axisState[key]) {
        axisState[key].target = payload[key];
      }
    });
  } catch (err) {
    console.error('[MQTT] Parse error:', err);
  }
});

// ==========================================
// 5. INITIALIZE 8TH WALL ENGINE
// ==========================================
window.addEventListener('load', () => {
  const container = document.getElementById('canvas-container');
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    XR8.CameraPixelArray.pipelineModule(),
    initXREngine()
  ]);

  XR8.run({ canvas });
});