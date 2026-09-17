// ==========================================
// 0. MODULE IMPORTS (three.js core + addons)
// ==========================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// ==========================================
// 1. HIVEMQ CLOUD CREDENTIALS
// ==========================================
const HIVEMQ_HOST = "0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud";
const HIVEMQ_PORT = 8884;
const HIVEMQ_USERNAME = "FestoPLC1";
const HIVEMQ_PASSWORD = "FestoPLC1";
const MQTT_TOPIC = "festo/hgosydney/positions";

// ==========================================
// 2. THREE.JS SCENE & WEBXR SETUP
// ==========================================
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
window.scene = scene;
window.THREE = THREE;
scene.background = new THREE.Color(0xc7ccd1);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0.7, 2.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Enable WebXR
renderer.xr.enabled = true;

container.appendChild(renderer.domElement);

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar')
    .then((supported) => {
      if (supported) {
        document.body.appendChild(ARButton.createButton(renderer, {
          requiredFeatures: ['hit-test'],
          optionalFeatures: ['dom-overlay'],
          domOverlay: { root: document.body }
        }));
      }
    })
    .catch(() => {});
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- LIGHTING SETUP ---
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
hemiLight.position.set(20, 20, 20);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(4, 6, 4);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0015;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 2.0);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

const cameraLight = new THREE.DirectionalLight(0xffffff, 1.5);
camera.add(cameraLight);
cameraLight.target.position.set(0, 0, -1);
camera.add(cameraLight.target);
scene.add(camera);

// Group to hold model and grid
const arGroup = new THREE.Group();
scene.add(arGroup);

// --- GRID HELPER & SHADOW FLOOR ---
const gridHelper = new THREE.GridHelper(10, 20, 0xFFFFFF, 0x444444);
gridHelper.position.y = -0.01;

const shadowCatcher = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.ShadowMaterial({ opacity: 0.35 })
);
shadowCatcher.rotation.x = -Math.PI / 2;
shadowCatcher.receiveShadow = true;
arGroup.add(shadowCatcher);
arGroup.add(gridHelper);

// WebXR Session handlers
let hitTestSource = null;
let hitTestSourceRequested = false;
let modelPlaced = false;
let surfaceCurrentlyDetected = false;
let firstDetectedAt = null;
const AUTO_PLACE_STABILIZE_MS = 600;
const hitMatrix = new THREE.Matrix4();

const arScanOverlay = document.getElementById('ar-scan-overlay');
const arScanText = document.getElementById('ar-scan-text');

function showArScanOverlay(text) {
  if (arScanText) arScanText.innerText = text;
  if (arScanOverlay) arScanOverlay.classList.add('visible');
}

function hideArScanOverlay() {
  if (arScanOverlay) arScanOverlay.classList.remove('visible');
}

function placeModelAt(matrix) {
  arGroup.position.setFromMatrixPosition(matrix);
  arGroup.quaternion.setFromRotationMatrix(matrix);
  arGroup.visible = true;
}

renderer.xr.addEventListener('sessionstart', () => {
  scene.background = null;
  gridHelper.visible = false;
  arGroup.visible = false;
  modelPlaced = false;
  surfaceCurrentlyDetected = false;
  firstDetectedAt = null;
  hitTestSourceRequested = false;
  hitTestSource = null;
  showArScanOverlay('Starting AR...');
});

renderer.xr.addEventListener('sessionend', () => {
  scene.background = new THREE.Color(document.getElementById('ctrl-bg-color').value);
  gridHelper.visible = true;
  arGroup.visible = true;
  hideArScanOverlay();
});

const controller = renderer.xr.getController(0);
controller.addEventListener('select', () => {
  if (surfaceCurrentlyDetected) {
    placeModelAt(hitMatrix);
    modelPlaced = true;
    hideArScanOverlay();
  }
});
scene.add(controller);

// ==========================================
// 3. RETRACTABLE UI & LIGHT CONTROL BINDINGS
// ==========================================
const lightPanel = document.getElementById('light-panel');
const panelHeader = document.getElementById('light-panel-header');

panelHeader.addEventListener('click', () => {
  lightPanel.classList.toggle('collapsed');
});

const LIGHTING_STORAGE_KEY = 'gantryDigitalTwin.lightingDefaults';

const FACTORY_LIGHTING_CONFIG = {
  hemi: { intensity: 0.7, position: { x: 20, y: 20, z: 20 } },
  key: { intensity: 2.0, color: '#ffffff', position: { x: 4, y: 6, z: 4 } },
  fill: { intensity: 2.0, color: '#ffffff', position: { x: -4, y: 3, z: -3 } },
  ambient: { intensity: 1.0, color: '#ffffff' },
  background: '#c7ccd1'
};

const lightControlBindings = [
  { id: 'ctrl-hemi', labelId: 'lbl-hemi', decimals: 1, apply: (v) => { hemiLight.intensity = v; } },
  { id: 'ctrl-hemi-x', labelId: 'lbl-hemi-x', decimals: 1, apply: (v) => { hemiLight.position.x = v; } },
  { id: 'ctrl-hemi-y', labelId: 'lbl-hemi-y', decimals: 1, apply: (v) => { hemiLight.position.y = v; } },
  { id: 'ctrl-hemi-z', labelId: 'lbl-hemi-z', decimals: 1, apply: (v) => { hemiLight.position.z = v; } },

  { id: 'ctrl-key', labelId: 'lbl-key', decimals: 1, apply: (v) => { keyLight.intensity = v; } },
  { id: 'ctrl-key-x', labelId: 'lbl-key-x', decimals: 1, apply: (v) => { keyLight.position.x = v; } },
  { id: 'ctrl-key-y', labelId: 'lbl-key-y', decimals: 1, apply: (v) => { keyLight.position.y = v; } },
  { id: 'ctrl-key-z', labelId: 'lbl-key-z', decimals: 1, apply: (v) => { keyLight.position.z = v; } },

  { id: 'ctrl-fill', labelId: 'lbl-fill', decimals: 1, apply: (v) => { fillLight.intensity = v; } },
  { id: 'ctrl-fill-x', labelId: 'lbl-fill-x', decimals: 1, apply: (v) => { fillLight.position.x = v; } },
  { id: 'ctrl-fill-y', labelId: 'lbl-fill-y', decimals: 1, apply: (v) => { fillLight.position.y = v; } },
  { id: 'ctrl-fill-z', labelId: 'lbl-fill-z', decimals: 1, apply: (v) => { fillLight.position.z = v; } },

  { id: 'ctrl-ambient', labelId: 'lbl-ambient', decimals: 1, apply: (v) => { ambientLight.intensity = v; } }
];

lightControlBindings.forEach(({ id, labelId, decimals, apply }) => {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    apply(val);
    if (labelId) {
      const label = document.getElementById(labelId);
      if (label) label.innerText = val.toFixed(decimals);
    }
  });
});

document.getElementById('ctrl-key-color').addEventListener('input', (e) => {
  keyLight.color.set(e.target.value);
});

document.getElementById('ctrl-fill-color').addEventListener('input', (e) => {
  fillLight.color.set(e.target.value);
});

document.getElementById('ctrl-ambient-color').addEventListener('input', (e) => {
  ambientLight.color.set(e.target.value);
});

document.getElementById('ctrl-bg-color').addEventListener('input', (e) => {
  if (!renderer.xr.isPresenting) {
    scene.background.set(e.target.value);
  }
});

function readCurrentLightingConfig() {
  return {
    hemi: {
      intensity: hemiLight.intensity,
      position: { x: hemiLight.position.x, y: hemiLight.position.y, z: hemiLight.position.z }
    },
    key: {
      intensity: keyLight.intensity,
      color: '#' + keyLight.color.getHexString(),
      position: { x: keyLight.position.x, y: keyLight.position.y, z: keyLight.position.z }
    },
    fill: {
      intensity: fillLight.intensity,
      color: '#' + fillLight.color.getHexString(),
      position: { x: fillLight.position.x, y: fillLight.position.y, z: fillLight.position.z }
    },
    ambient: {
      intensity: ambientLight.intensity,
      color: '#' + ambientLight.color.getHexString()
    },
    background: '#' + scene.background.getHexString()
  };
}

function applyLightingConfig(config) {
  hemiLight.intensity = config.hemi.intensity;
  hemiLight.position.set(config.hemi.position.x, config.hemi.position.y, config.hemi.position.z);

  keyLight.intensity = config.key.intensity;
  keyLight.color.set(config.key.color);
  keyLight.position.set(config.key.position.x, config.key.position.y, config.key.position.z);

  fillLight.intensity = config.fill.intensity;
  fillLight.color.set(config.fill.color);
  fillLight.position.set(config.fill.position.x, config.fill.position.y, config.fill.position.z);

  ambientLight.intensity = config.ambient.intensity;
  ambientLight.color.set(config.ambient.color);

  if (!renderer.xr.isPresenting) {
    scene.background.set(config.background);
  }

  syncLightingUI(config);
}

function syncLightingUI(config) {
  const setRange = (id, labelId, value, decimals) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
    const label = document.getElementById(labelId);
    if (label) label.innerText = value.toFixed(decimals);
  };
  const setColor = (id, value) => {
    const input = document.getElementById(id);
    if (input) input.value = value;
  };

  setRange('ctrl-hemi', 'lbl-hemi', config.hemi.intensity, 1);
  setRange('ctrl-hemi-x', 'lbl-hemi-x', config.hemi.position.x, 1);
  setRange('ctrl-hemi-y', 'lbl-hemi-y', config.hemi.position.y, 1);
  setRange('ctrl-hemi-z', 'lbl-hemi-z', config.hemi.position.z, 1);

  setRange('ctrl-key', 'lbl-key', config.key.intensity, 1);
  setColor('ctrl-key-color', config.key.color);
  setRange('ctrl-key-x', 'lbl-key-x', config.key.position.x, 1);
  setRange('ctrl-key-y', 'lbl-key-y', config.key.position.y, 1);
  setRange('ctrl-key-z', 'lbl-key-z', config.key.position.z, 1);

  setRange('ctrl-fill', 'lbl-fill', config.fill.intensity, 1);
  setColor('ctrl-fill-color', config.fill.color);
  setRange('ctrl-fill-x', 'lbl-fill-x', config.fill.position.x, 1);
  setRange('ctrl-fill-y', 'lbl-fill-y', config.fill.position.y, 1);
  setRange('ctrl-fill-z', 'lbl-fill-z', config.fill.position.z, 1);

  setRange('ctrl-ambient', 'lbl-ambient', config.ambient.intensity, 1);
  setColor('ctrl-ambient-color', config.ambient.color);

  setColor('ctrl-bg-color', config.background);
}

function showSaveStatus(message) {
  const statusElem = document.getElementById('save-status');
  if (!statusElem) return;
  statusElem.innerText = message;
  clearTimeout(showSaveStatus._timer);
  showSaveStatus._timer = setTimeout(() => { statusElem.innerText = ''; }, 2500);
}

document.getElementById('btn-save-default').addEventListener('click', () => {
  const config = readCurrentLightingConfig();
  try {
    localStorage.setItem(LIGHTING_STORAGE_KEY, JSON.stringify(config));
    showSaveStatus('Saved as default \u2713');
  } catch (err) {
    console.error('[LIGHTING] Failed to save default config:', err);
    showSaveStatus('Save failed');
  }
});

document.getElementById('btn-load-default').addEventListener('click', () => {
  const saved = localStorage.getItem(LIGHTING_STORAGE_KEY);
  if (!saved) {
    showSaveStatus('No saved default yet');
    return;
  }
  try {
    applyLightingConfig(JSON.parse(saved));
    showSaveStatus('Default loaded');
  } catch (err) {
    console.error('[LIGHTING] Failed to load saved config:', err);
    showSaveStatus('Load failed');
  }
});

document.getElementById('btn-load-factory').addEventListener('click', () => {
  applyLightingConfig(FACTORY_LIGHTING_CONFIG);
  showSaveStatus('Factory defaults restored');
});

(function initLightingFromSavedDefault() {
  const saved = localStorage.getItem(LIGHTING_STORAGE_KEY);
  if (saved) {
    try {
      applyLightingConfig(JSON.parse(saved));
      return;
    } catch (err) {
      console.warn('[LIGHTING] Saved config was invalid, using factory defaults:', err);
    }
  }
  syncLightingUI(FACTORY_LIGHTING_CONFIG);
})();

// ==========================================
// 4. LOAD GLB MODEL
// ==========================================
const AXIS_CONFIG = {
  PosX: { nodeName: 'Slide_X', axis: 'z', valueElementId: 'val-x', sign: 1 },
  PosY: { nodeName: 'Slide_Y', axis: 'x', valueElementId: 'val-y', sign: -1 },
  PosZ: { nodeName: 'Slide_Z', axis: 'y', valueElementId: 'val-z', sign: -1 }
};

const axisState = {};
const SCALE_FACTOR = 0.001;
const LERP_FACTOR = 0.05;
const MODEL_URL = './model/hgosydney_Kinetic.glb';

window.GANTRY_CONFIG = {
  AXIS_CONFIG,
  SCALE_FACTOR,
  LERP_FACTOR,
  MODEL_URL,
  mqttTargets: { PosX: 0, PosY: 0, PosZ: 0 }
};

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

    Object.entries(AXIS_CONFIG).forEach(([key, cfg]) => {
      if (!axisState[key]) {
        console.warn(`[MODEL] Node "${cfg.nodeName}" (for ${key}) was not found in the GLB.`);
      }
    });

    arGroup.add(model);

    const box = new THREE.Box3().setFromObject(model);
    gridHelper.position.y = box.min.y - 0.001;
    shadowCatcher.position.y = box.min.y - 0.001;

    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    controls.update();
  },
  (xhr) => {
    if (xhr.total > 0) {
      console.log(`[MODEL] ${(xhr.loaded / xhr.total * 100).toFixed(0)}% loaded`);
    }
  },
  (error) => {
    console.error('[ERROR] Failed to load GLB model:', error);
  }
);

// ==========================================
// 5. ANIMATION & RENDER LOOP
// ==========================================
function animate(timestamp, frame) {
  Object.values(axisState).forEach(({ node, axis, sign, initial, target }) => {
    const targetValue = initial + (target * SCALE_FACTOR * sign);
    node.position[axis] += (targetValue - node.position[axis]) * LERP_FACTOR;
  });

  if (renderer.xr.isPresenting && frame) {
    const session = renderer.xr.getSession();
    const referenceSpace = renderer.xr.getReferenceSpace();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
          if (!modelPlaced) {
            showArScanOverlay('Move your phone to find a surface');
          }
        });
      });
      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);
        hitMatrix.fromArray(pose.transform.matrix);
        surfaceCurrentlyDetected = true;

        if (!modelPlaced) {
          if (firstDetectedAt === null) {
            firstDetectedAt = timestamp;
            showArScanOverlay('Hold steady...');
          } else if (timestamp - firstDetectedAt > AUTO_PLACE_STABILIZE_MS) {
            placeModelAt(hitMatrix);
            modelPlaced = true;
            hideArScanOverlay();
          }
        }
      } else {
        surfaceCurrentlyDetected = false;
        if (!modelPlaced) {
          firstDetectedAt = null;
          showArScanOverlay('Move your phone to find a surface');
        }
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ==========================================
// 6. UPDATE TARGET VALUES FROM MQTT
// ==========================================
function updateAxisPosition(key, positionVal) {
  window.GANTRY_CONFIG.mqttTargets[key] = positionVal;
  if (!axisState[key]) return;
  axisState[key].target = positionVal;
  const valElem = document.getElementById(AXIS_CONFIG[key].valueElementId);
  if (valElem) valElem.innerText = `${positionVal} mm`;
}

// ==========================================
// 7. HIVEMQ CLOUD CONNECTION
// ==========================================
const brokerUrl = `wss://${HIVEMQ_HOST}:${HIVEMQ_PORT}/mqtt`;

const client = mqtt.connect(brokerUrl, {
  clientId: 'gantry_web_twin_' + Math.random().toString(16).substring(2, 10),
  username: HIVEMQ_USERNAME,
  password: HIVEMQ_PASSWORD,
  clean: true
});

client.on('connect', () => {
  console.log('[MQTT] Connected to HiveMQ Cloud');
  const statusElem = document.getElementById('status');
  const dotElem = document.getElementById('dot');

  if (statusElem) {
    statusElem.innerText = 'Connected';
    statusElem.style.color = '#2e7d32';
  }
  if (dotElem) {
    dotElem.style.backgroundColor = '#4caf50';
    dotElem.style.boxShadow = '0 0 10px #4caf50';
  }

  client.subscribe(MQTT_TOPIC);
});

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    if (payload.PosX !== undefined) updateAxisPosition('PosX', payload.PosX);
    if (payload.PosY !== undefined) updateAxisPosition('PosY', payload.PosY);
    if (payload.PosZ !== undefined) updateAxisPosition('PosZ', payload.PosZ);
  } catch (err) {
    console.error('[MQTT] Parse error:', err);
  }
});