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
// TEMPORARY - for console debugging only. Since this file loads as an ES
// module, its variables aren't normally reachable from the browser console.
// Safe to delete these two lines once the axis debugging is done.
window.scene = scene;
window.THREE = THREE;
scene.background = new THREE.Color(0xc7ccd1);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
// Rotated 90 degrees to the right from the original (-0.32, 0.83, 0.97)
// framing, orbiting around the vertical (Y) axis at the same height/distance.
camera.position.set(0, 0.7, 2.5);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

// Enable WebXR
renderer.xr.enabled = true;

container.appendChild(renderer.domElement);

// Append AR Button (WebXR — Android/Chrome only; iOS uses the separate
// Quick Look button in index.html instead, since Safari has no WebXR AR).
// We check support ourselves first, rather than letting ARButton show its
// default disabled "AR NOT SUPPORTED" button, so unsupported devices see
// no button at all.
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar')
    .then((supported) => {
      if (supported) {
        document.body.appendChild(ARButton.createButton(renderer, {
          requiredFeatures: ['hit-test'],
          // Without this, regular page DOM (our scanning overlay) is hidden
          // during the AR session - the XR compositor takes over full-screen
          // rendering by default. 'root' is the DOM subtree allowed to show.
          optionalFeatures: ['dom-overlay'],
          domOverlay: { root: document.body }
        }));
      }
    })
    .catch(() => {
      // Support check itself failed - treat as unsupported, show nothing.
    });
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
// Without bias tuning, shadow maps commonly produce "shadow acne" - fine
// self-shadowing streaks - on surfaces with tight ridges/grooves, like the
// extrusion's rail profile. These two settings fix that.
keyLight.shadow.bias = -0.0015;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.mapSize.set(2048, 2048);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 2.0);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight);

// Camera light (headlight) - follows the viewer so the side of the model
// facing the camera is always lit, regardless of orbit angle. Using a
// directional light (instead of the previous point light) avoids the
// "on-camera flash" hotspot, where a light sitting at the same position as
// the camera reflects straight back into the lens off glossy surfaces
// (this was washing out the blue actuator housings).
const cameraLight = new THREE.DirectionalLight(0xffffff, 0.8);
camera.add(cameraLight);
cameraLight.target.position.set(0, 0, -1); // points forward, in the camera's local space
camera.add(cameraLight.target);
scene.add(camera); // camera must be in the scene graph for its child light/target to update

// Group to hold model and grid
const arGroup = new THREE.Group();
scene.add(arGroup);

// --- GRID HELPER ---
const gridHelper = new THREE.GridHelper(10, 20, 0xFFFFFF, 0x444444);
gridHelper.position.y = -0.01;
arGroup.add(gridHelper);

// WebXR Session handlers
let hitTestSource = null;
let hitTestSourceRequested = false;
let modelPlaced = false;
let surfaceCurrentlyDetected = false;
let firstDetectedAt = null; // when the surface was first seen, for stabilization
const AUTO_PLACE_STABILIZE_MS = 600; // must track a surface steadily this long before auto-placing
const hitMatrix = new THREE.Matrix4(); // stores the latest detected surface pose

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
  arGroup.visible = false; // hidden until placed on a detected surface
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

// --- CONTROLLER (tap to reposition the model onto wherever you're currently
// pointing, in case the auto-detected surface wasn't the one you wanted) ---
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
const toggleIcon = document.getElementById('toggle-icon');

panelHeader.addEventListener('click', () => {
  lightPanel.classList.toggle('collapsed');
});

const LIGHTING_STORAGE_KEY = 'gantryDigitalTwin.lightingDefaults';

// The values the scene was originally authored with. "Reset to Factory"
// always returns to this configuration, regardless of what's been saved.
const FACTORY_LIGHTING_CONFIG = {
  hemi: { intensity: 0.7, position: { x: 20, y: 20, z: 20 } },
  key: { intensity: 2.0, color: '#ffffff', position: { x: 4, y: 6, z: 4 } },
  fill: { intensity: 2.0, color: '#ffffff', position: { x: -4, y: 3, z: -3 } },
  ambient: { intensity: 1, color: '#ffffff' },
  background: '#c7ccd1'
};

// Maps each slider/color input id to a (light, property) setter, and each
// value to the label element that displays it. Keeping this table-driven
// means adding another controllable light later only needs an entry here
// plus matching markup in index.html.
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

// Color pickers (separate from the table above since they read a hex string,
// not a float, and don't drive a numeric label).
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

// --- Reading / applying a full lighting configuration ---

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

// Pushes a config's values into every slider/color input and label so the
// panel reflects whatever was just applied (on load, or after a reset).
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

// --- Save / Reset buttons ---

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

// On startup, use a saved default if one exists; otherwise the scene keeps
// the factory values it was already constructed with above.
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
// Maps each MQTT payload key to the GLB node it drives and the LOCAL axis
// that node moves along. Since this model is correctly kinematized (each
// slide nested under the one it rides on), each node only ever needs to
// move along a single local axis - the parenting handles the rest.
//
// IMPORTANT: "Slide_X" moving along local X is an assumption based on the
// name, not a guarantee - glTF's Y-up export convention can remap which
// local axis corresponds to a given real-world direction. If testing shows
// a slide moving the wrong way (or not at all), just change the `axis`
// value below for that entry - nothing else needs to change.
const AXIS_CONFIG = {
  PosX: { nodeName: 'Slide_X', axis: 'x', valueElementId: 'val-x', sign: 1 },
  // Slide_X has a 90-degree rotation baked in, inherited by everything
  // nested under it (Slide_Y, Slide_Z). That rotation swaps which local
  // axis points along world X vs world Z (world Y/vertical is unaffected).
  // Slide_Y's local X is the one that actually points along world Z here.
  PosY: { nodeName: 'Slide_Y', axis: 'x', valueElementId: 'val-y', sign: -1 },
  PosZ: { nodeName: 'Slide_Z', axis: 'y', valueElementId: 'val-z', sign: -1 } // confirmed correct - vertical (world Y) is unaffected by the rotation
};

// Populated once the model loads: { PosX: { node, axis, initial, target }, ... }
const axisState = {};

// MQTT payload values are in millimeters, but glTF/GLB world units are
// meters by convention - confirmed empirically ({"PosX": 1} moved 1 full
// meter instead of 1mm). This converts mm -> m before applying as a
// position offset.
const SCALE_FACTOR = 0.001;
const LERP_FACTOR = 0.05;
const MODEL_URL = './model/hgosydney_Kinetic.glb';

// Shared with ar-iphone.js (a separate, non-module script - see that file
// for why). This is the single source of truth for axis mapping and
// scaling, and mqttTargets is the live feed of MQTT-derived positions, so
// the iPhone AR path's independent model copy stays driven by the exact
// same data as this desktop/Android scene, without duplicating the MQTT
// connection or hardcoding a second copy of these constants.
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

    // Log a warning for any configured axis whose node wasn't found in the
    // model - much easier to spot than a silently-motionless slide later.
    Object.entries(AXIS_CONFIG).forEach(([key, cfg]) => {
      if (!axisState[key]) {
        console.warn(`[MODEL] Node "${cfg.nodeName}" (for ${key}) was not found in the GLB.`);
      }
    });

    arGroup.add(model);

    const box = new THREE.Box3().setFromObject(model);
    gridHelper.position.y = box.min.y - 0.001;

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

  // --- WebXR hit-test: find real-world surfaces, auto-place on first detection ---
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
          // Don't trust the very first hit - tracking is often noisy for a
          // moment right after a surface is found. Require it to stay
          // steady for AUTO_PLACE_STABILIZE_MS before committing, which is
          // what was actually happening implicitly before (the user took a
          // moment to aim before tapping) and is why placement felt more
          // stable in the tap-to-place version.
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
          // Lost tracking before we finished stabilizing - reset the timer
          // rather than placing based on a stale/interrupted read.
          firstDetectedAt = null;
          showArScanOverlay('Move your phone to find a surface');
        }
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

// Handles both desktop and WebXR loops
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
  window.GANTRY_CONFIG.mqttTargets[key] = positionVal; // shared with ar-iphone.js regardless of this scene's own node state
  if (!axisState[key]) return; // node wasn't found in the GLB - see console warning at load time
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