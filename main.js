// ==========================================
// 0. MODULE IMPORTS (three.js core + addons)
// ==========================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

// ==========================================
// 1. HIVEMQ CLOUD CREDENTIALS
// ==========================================
const HIVEMQ_HOST = "0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud";
const HIVEMQ_PORT = 8884;
const HIVEMQ_USERNAME = "JakaA5_00";
const HIVEMQ_PASSWORD = "JakaA5_00";
const MQTT_TOPIC = "jaka/coordinates";

// ==========================================
// 2. THREE.JS SCENE & WEBXR SETUP
// ==========================================
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
window.scene = scene;
window.THREE = THREE;

scene.background = new THREE.Color(0x2b2b2b);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0.5, 1, 1.5);

// Add Camera to Scene so attached lights track camera movements
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
window.renderer = renderer; // Exposed to window so console controls work live

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Fixed outputColorSpace property (replaces deprecated outputEncoding)
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0; // Lowered default tone mapping exposure

renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// --- ENVIRONMENT MAP (HDR Reflections) ---
const rgbeLoader = new RGBELoader();
// Updated to working CDN URL
rgbeLoader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/textures/equirectangular/venice_sunset_1k.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
  scene.environmentIntensity = 0.2; // Lowered default reflection intensity (try values like 0.5 - 1.0)
});

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

// --- DYNAMIC CAMERA LIGHT (Follows Viewpoint) ---
const cameraLight = new THREE.DirectionalLight(0xffffff, 2);
cameraLight.position.set(0, 1, 1); // Offset slightly forward from camera lens
camera.add(cameraLight);

// --- SCENE LIGHTING SETUP ---
const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(4, 6, 4);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0005;        // CHANGED: Reduced bias to prevent shadow gap at the base
keyLight.shadow.normalBias = 0.003;     // CHANGED: Reduced from 0.02 so shadows don't detach or fade at contact points
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 10;        // CHANGED: Reduced far plane to focus shadow depth
keyLight.shadow.camera.left = -1.8;     // CHANGED: Tightened shadow bounds around the gantry model size
keyLight.shadow.camera.right = 1.8;    // CHANGED: Higher resolution shadow detail inside smaller bounds
keyLight.shadow.camera.top = 1.8;      // CHANGED
keyLight.shadow.camera.bottom = -1.8;  // CHANGED
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xbbe0ff, 0.5);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0xedf5ff, 0.5);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xb0e0e6, 0x555555, 1);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const BASE_INTENSITIES = {
  key: 4.0,
  fill: 3.0,
  ambient: 1.8,
  hemi: 1.6,
  camera: 2.2
};

// --- AR GROUP & FLOOR MAT ---
const arGroup = new THREE.Group();
scene.add(arGroup);

const floorGeo = new THREE.PlaneGeometry(10, 10);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0xdcdcdc,
  roughness: 0.8,
  metalness: 0.1
});
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
arGroup.add(floorMesh);

const gridHelper = new THREE.GridHelper(10, 10, 0xbbbbbb, 0xcccccc);
gridHelper.position.y = 0.001;
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
  floorMesh.visible = false;
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
  scene.background = new THREE.Color(0x2b2b2b);
  floorMesh.visible = true;
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
// 3. USER LIGHT CONTROLS
// ==========================================
const lightPanel = document.getElementById('light-panel');
const panelHeader = document.getElementById('light-panel-header');

if (panelHeader && lightPanel) {
  panelHeader.addEventListener('click', () => {
    lightPanel.classList.toggle('collapsed');
  });
}

const ctrlBrightness = document.getElementById('ctrl-brightness');
const lblBrightness = document.getElementById('lbl-brightness');

if (ctrlBrightness) {
  ctrlBrightness.addEventListener('input', (e) => {
    const scale = parseFloat(e.target.value);
    keyLight.intensity = BASE_INTENSITIES.key * scale;
    fillLight.intensity = BASE_INTENSITIES.fill * scale;
    ambientLight.intensity = BASE_INTENSITIES.ambient * scale;
    hemiLight.intensity = BASE_INTENSITIES.hemi * scale;
    cameraLight.intensity = BASE_INTENSITIES.camera * scale;
    if (lblBrightness) lblBrightness.innerText = `${Math.round(scale * 100)}%`;
  });
}

const ctrlAngle = document.getElementById('ctrl-angle');
const lblAngle = document.getElementById('lbl-angle');
const LIGHT_RADIUS = 7.2;

if (ctrlAngle) {
  ctrlAngle.addEventListener('input', (e) => {
    const deg = parseFloat(e.target.value);
    const rad = (deg * Math.PI) / 180;
    keyLight.position.x = Math.cos(rad) * LIGHT_RADIUS;
    keyLight.position.z = Math.sin(rad) * LIGHT_RADIUS;
    if (lblAngle) lblAngle.innerText = `${Math.round(deg)}°`;
  });
}

// ==========================================
// 4. LOAD GLB MODEL
// ==========================================
const AXIS_CONFIG = {
  PosX: { nodeName: 'Slide_X', axis: 'z', valueElementId: 'val-x', sign: 1 },
  PosY: { nodeName: 'Slide_Y', axis: 'z', valueElementId: 'val-y', sign: 1 },
  PosZ: { nodeName: 'Slide_Z', axis: 'y', valueElementId: 'val-z', sign: -1 }
};

const axisState = {};
const SCALE_FACTOR = 0.001;
const LERP_FACTOR = 0.05;
const MODEL_URL = './model/Jaka_A5.glb';

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

        if (child.material) {
          // Polished metallic finish
          //child.material.metalness = 0.90;
          //child.material.roughness = 0.18;
          child.material.envMapIntensity = 1.0; // Lowered from 3.5 to match environment settings
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

    const box = new THREE.Box3().setFromObject(model);
    floorMesh.position.y = box.min.y;
    gridHelper.position.y = box.min.y + 0.001;

    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    controls.update();
  },
  undefined,
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
  clientId: 'Jaka_a5_twin_' + Math.random().toString(16).substring(2, 10),
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