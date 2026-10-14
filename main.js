// ============================================================================
//  main.js   >>>  NO MODIFICATION NEEDED  <<<
//  (change twin-config.js instead)
// ============================================================================
//  Desktop + Android WebXR viewer: three.js scene, lights, model loading,
//  MQTT connection and AR placement. All project-specific values come from
//  window.TWIN_CONFIG and window.TwinShared.
//  (c) Hugo Ben - 2026 
// ============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const CFG = window.TWIN_CONFIG;
const Shared = window.TwinShared;
const S = CFG.scene;
const L = CFG.lighting;

document.title = CFG.appTitle;
Shared.buildTelemetryPanel();

// ==========================================
// 1. SCENE, CAMERA, RENDERER
// ==========================================
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
window.scene = scene;   // exposed for console debugging
window.THREE = THREE;
scene.background = new THREE.Color(S.backgroundColor);

const camera = new THREE.PerspectiveCamera(S.fov, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(...S.cameraStart);
scene.add(camera); // so lights attached to the camera are rendered

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
window.renderer = renderer;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = S.toneMappingExposure;
renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// HDR reflections (optional)
if (S.hdrUrl) {
  new RGBELoader().load(S.hdrUrl, (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = texture;
    scene.environmentIntensity = S.environmentIntensity;
  });
}

// Android / WebXR AR button
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

// ==========================================
// 2. LIGHTS
// ==========================================
const cameraLight = new THREE.DirectionalLight(L.camera.color, L.camera.intensity);
cameraLight.position.set(...L.camera.position);
camera.add(cameraLight);

const keyLight = new THREE.DirectionalLight(L.key.color, L.key.intensity);
keyLight.position.set(...L.key.position);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0005;
keyLight.shadow.normalBias = 0.003;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 10;
keyLight.shadow.camera.left = -S.shadowBounds;
keyLight.shadow.camera.right = S.shadowBounds;
keyLight.shadow.camera.top = S.shadowBounds;
keyLight.shadow.camera.bottom = -S.shadowBounds;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
fillLight.position.set(...L.fill.position);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(L.ambient.color, L.ambient.intensity);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

// ==========================================
// 3. AR GROUP + FLOOR
// ==========================================
const arGroup = new THREE.Group();
scene.add(arGroup);

const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(S.floor.size, S.floor.size),
  new THREE.MeshStandardMaterial({ color: S.floor.color, roughness: S.floor.roughness, metalness: S.floor.metalness })
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
floorMesh.visible = S.floor.show;
arGroup.add(floorMesh);

const gridHelper = new THREE.GridHelper(S.floor.size, S.floor.gridDivisions, 0xbbbbbb, 0xcccccc);
gridHelper.position.y = 0.001;
gridHelper.visible = S.floor.show;
arGroup.add(gridHelper);

// ==========================================
// 4. WEBXR AR SESSION (Android / WebXR browsers)
// ==========================================
let hitTestSource = null;
let hitTestSourceRequested = false;
let modelPlaced = false;
let surfaceCurrentlyDetected = false;
let firstDetectedAt = null;
const AUTO_PLACE_STABILIZE_MS = 600;
const hitMatrix = new THREE.Matrix4();

const arScanOverlay = document.getElementById('ar-scan-overlay');
const arScanText = document.getElementById('ar-scan-text');
const showArScanOverlay = (text) => {
  if (arScanText) arScanText.innerText = text;
  if (arScanOverlay) arScanOverlay.classList.add('visible');
};
const hideArScanOverlay = () => { if (arScanOverlay) arScanOverlay.classList.remove('visible'); };

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
  scene.background = new THREE.Color(S.backgroundColor);
  floorMesh.visible = S.floor.show;
  gridHelper.visible = S.floor.show;
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
// 5. LOAD GLB MODEL
// ==========================================
let axisState = {}; // filled once the model is loaded

new GLTFLoader().load(
  CFG.model.url,
  (gltf) => {
    console.log('[MODEL] Loaded successfully!');
    const model = gltf.scene;
    model.scale.setScalar(CFG.model.scale);

    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) child.material.envMapIntensity = S.modelEnvMapIntensity;
      }
    });

    axisState = Shared.bindAxes(model); // finds the nodes listed in twin-config.js
    arGroup.add(model);

    // Put the floor under the model and aim the camera at its center
    const box = new THREE.Box3().setFromObject(model);
    floorMesh.position.y = box.min.y;
    gridHelper.position.y = box.min.y + 0.001;
    controls.target.copy(box.getCenter(new THREE.Vector3()));
    controls.update();
  },
  undefined,
  (error) => console.error('[ERROR] Failed to load GLB model:', error)
);

// ==========================================
// 6. RENDER LOOP
// ==========================================
function animate(timestamp, frame) {
  Shared.stepAxes(axisState);

  if (renderer.xr.isPresenting && frame) {
    const session = renderer.xr.getSession();
    const referenceSpace = renderer.xr.getReferenceSpace();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
          if (!modelPlaced) showArScanOverlay('Move your phone to find a surface');
        });
      });
      session.addEventListener('end', () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const results = frame.getHitTestResults(hitTestSource);
      if (results.length > 0) {
        const pose = results[0].getPose(referenceSpace);
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
// 7. MQTT CONNECTION
// ==========================================
const M = CFG.mqtt;
const client = mqtt.connect(`wss://${M.host}:${M.port}/mqtt`, {
  clientId: M.clientIdPrefix + Math.random().toString(16).substring(2, 10),
  username: M.username,
  password: M.password,
  clean: true
});

client.on('connect', () => {
  console.log('[MQTT] Connected');
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
  M.topics.forEach((t) => client.subscribe(t));
});

client.on('message', (topic, message) => {
  try {
    Shared.handlePayload(JSON.parse(message.toString()), topic);
  } catch (err) {
    console.error('[MQTT] Parse error:', err);
  }
});