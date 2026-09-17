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

// Dark background matching reference image
scene.background = new THREE.Color(0x2b2b2b);

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

renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// --- ENVIRONMENT MAP ---
const rgbeLoader = new RGBELoader();
rgbeLoader.load('https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
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

// --- LIGHTING SETUP ---
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(4, 6, 4);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0015;
keyLight.shadow.normalBias = 0.02;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 15;
keyLight.shadow.camera.left = -3;
keyLight.shadow.camera.right = 3;
keyLight.shadow.camera.top = 3;
keyLight.shadow.camera.bottom = -3;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);

// Base intensity multipliers for master brightness scaling
const BASE_INTENSITIES = {
  key: 2.0,
  fill: 1.2,
  ambient: 0.8
};

// --- AR GROUP & FLOOR MAT ---
const arGroup = new THREE.Group();
scene.add(arGroup);

// Clear light floor mesh matching reference picture
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

// Light grid overlay over floor plane
const gridHelper = new THREE.GridHelper(10, 10, 0xbbbbbb, 0xcccccc);
gridHelper.position.y = 0.001; // Slightly above floor mesh to prevent z-fighting
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
// 3. SIMPLIFIED USER LIGHT CONTROLS
// ==========================================
const lightPanel = document.getElementById('light-panel');
const panelHeader = document.getElementById('light-panel-header');

if (panelHeader && lightPanel) {
  panelHeader.addEventListener('click', () => {
    lightPanel.classList.toggle('collapsed');
  });
}

// Master Brightness Control (0.1 to 2.0x multiplier)
const ctrlBrightness = document.getElementById('ctrl-brightness');
const lblBrightness = document.getElementById('lbl-brightness');

if (ctrlBrightness) {
  ctrlBrightness.addEventListener('input', (e) => {
    const scale = parseFloat(e.target.value);
    keyLight.intensity = BASE_INTENSITIES.key * scale;
    fillLight.intensity = BASE_INTENSITIES.fill * scale;
    ambientLight.intensity = BASE_INTENSITIES.ambient * scale;
    if (lblBrightness) lblBrightness.innerText = `${Math.round(scale * 100)}%`;
  });
}

// Light Angle Control (Rotate key light position around Y axis in degrees)
const ctrlAngle = document.getElementById('ctrl-angle');
const lblAngle = document.getElementById('lbl-angle');
const LIGHT_RADIUS = 7.2; // Original light radial distance

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

        if (child.material) {
          child.material.metalness = 0.85;
          child.material.roughness = 0.25;
          child.material.envMapIntensity = 1.2;
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