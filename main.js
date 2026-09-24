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
// *** MODIFY HERE for a different broker / different controller ***
// Point these at whichever MQTT broker the new controller/PLC publishes to.
// MQTT_TOPIC must match the topic the controller publishes joint angles on.
// The JSON payload published on that topic must have one numeric property
// per AXIS_CONFIG key below (e.g. {"PosA1": 12.3, "PosA2": -4.0, ...}) -
// if you rename or add/remove axis keys in AXIS_CONFIG, the controller's
// published JSON keys need to match exactly (see section 6/7 further down).
const HIVEMQ_HOST = "0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud";
const HIVEMQ_PORT = 8884;
const HIVEMQ_USERNAME = "Robot6DOF_00";
const HIVEMQ_PASSWORD = "Robot6DOF_00";
const MQTT_TOPIC = "robot/coordinates";

// ==========================================
// 2. THREE.JS SCENE & WEBXR SETUP
// ==========================================
const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
window.scene = scene;
window.THREE = THREE;

scene.background = new THREE.Color(0x2b2b2b);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(-0.8, 1, 1.8);

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
  scene.environmentIntensity = 0; // Lowered default reflection intensity (try values like 0.5 - 1.0)
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
const cameraLight = new THREE.DirectionalLight(0xffffff, 1);
cameraLight.position.set(0, 1, 1); // Offset slightly forward from camera lens
camera.add(cameraLight);

// --- SCENE LIGHTING SETUP ---
const keyLight = new THREE.DirectionalLight(0xffffff, 0.5);
keyLight.position.set(4, 6, 4);
keyLight.castShadow = true;
keyLight.shadow.bias = -0.0005;        // CHANGED: Reduced bias to prevent shadow gap at the base
keyLight.shadow.normalBias = 0.003;     // CHANGED: Reduced from 0.02 so shadows don't detach or fade at contact points
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 10;        // CHANGED: Reduced far plane to focus shadow depth
keyLight.shadow.camera.left = -1.8;     // CHANGED: Tightened shadow bounds around the robot model size
keyLight.shadow.camera.right = 1.8;    // CHANGED: Higher resolution shadow detail inside smaller bounds
keyLight.shadow.camera.top = 1.8;      // CHANGED
keyLight.shadow.camera.bottom = -1.8;  // CHANGED
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xbbe0ff, 0.5);
fillLight.position.set(-4, 3, -3);
scene.add(fillLight);

const ambientLight = new THREE.AmbientLight(0xedf5ff, 0.5);
scene.add(ambientLight);

const hemiLight = new THREE.HemisphereLight(0xb0e0e6, 0x555555, 0.5);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const BASE_INTENSITIES = {
  key: 1.0,
  fill: 1.0,
  ambient: 0.5,
  hemi: 0.5,
  camera: 1
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
// Rotary joints. Each joint rotates its GLB node about one of the node's LOCAL axes.
//   axis   : local axis of the node ('x' | 'y' | 'z')
//   sign   : +1 / -1, flips the rotation direction
//   offset : degrees added after the sign (use it if the GLB rest pose != controller zero)
// The axis / sign values below are starting values derived from the GLB hierarchy;
// verify them with robotSet() / robotDump() in the browser console (see section 4b).
//
// ============================================================================
// *** MODIFY HERE for a different 3D model / different number of joints ***
// ============================================================================
// This object is the single source of truth for the robot's degrees of freedom.
// To adapt the twin to a different model:
//   1. Add or remove one entry per rotary joint you want driven live. The
//      NUMBER OF ENTRIES here = the number of degrees of freedom the twin
//      animates. A 4-axis SCARA needs 4 entries; a 7-axis arm needs 7.
//   2. `nodeName` MUST exactly match the name of that joint's object/node
//      inside the new GLB file (open the GLB in Blender, or console.log()
//      every child.name during model.traverse() below, to find the names).
//   3. `axis` is whichever of the node's own local x/y/z the joint actually
//      rotates about in the new model - this is very often different per
//      node and per model, so don't assume it matches the old robot.
//   4. `sign` / `offset` are calibration values - leave them at sign: 1,
//      offset: 0 initially, then use robotSet()/robotDump() (section 4b below)
//      in the browser console to dial them in against the real hardware.
//   5. The object KEY (e.g. "PosA1") is also the property name the code
//      expects in the incoming MQTT JSON payload - see section 6/7 below,
//      and keep it in sync with whatever your PLC/controller publishes.
//   6. `valueElementId` must match an element id that exists in index.html's
//      status panel (see the HTML file's own comment block) - add/remove a
//      telemetry row there to match however many entries you have here.
// ============================================================================
const AXIS_CONFIG = {
  PosA1: { nodeName: 'Degree1', axis: 'y', sign:  1, offset: 0, valueElementId: 'val-a1' },
  PosA2: { nodeName: 'Degree2', axis: 'z', sign:  1, offset: 0, valueElementId: 'val-a2' },
  PosA3: { nodeName: 'Degree3', axis: 'z', sign:  1, offset: 0, valueElementId: 'val-a3' },
  PosA4: { nodeName: 'Degree4', axis: 'x', sign:  1, offset: 0, valueElementId: 'val-a4' },
  PosA5: { nodeName: 'Degree5', axis: 'z', sign:  -1, offset: 0, valueElementId: 'val-a5' },
  PosA6: { nodeName: 'Degree6', axis: 'x', sign:  1, offset: 0, valueElementId: 'val-a6' }
  // Add/remove entries here to change the DOF count. Every entry added here
  // needs a matching HTML telemetry row (index.html) and, if you want the
  // iPhone AR view to show it too, nothing extra to do - ar-iphone.js reads
  // this same AXIS_CONFIG object automatically via window.GANTRY_CONFIG.
};

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

const axisState = {};
const LERP_FACTOR = 0.05; // smoothing factor per animation frame (0-1); lower = smoother/slower catch-up to MQTT target

// *** MODIFY HERE to swap in a different 3D model file ***
// Path/URL to the GLB (or GLTF) file to load, relative to index.html.
// Swap this to point at a different robot's model. After swapping, re-check
// every `nodeName` in AXIS_CONFIG above against the new file's actual node
// names, since they almost never match between different GLBs.
const MODEL_URL = './model/KukaR1300.glb'  //Jaka_A5.glb';

// Name kept as GANTRY_CONFIG so ar-iphone.js keeps finding it (that file still needs
// updating for rotation, see notes).
//
// *** MODIFY HERE if you changed the AXIS_CONFIG keys above *** - this
// mqttTargets object needs one `KeyName: 0` entry per key in AXIS_CONFIG
// (same names). It's just the initial/default state before any MQTT
// message arrives; updateAxisPosition() (section 6 below) writes into it.
window.GANTRY_CONFIG = {
  AXIS_CONFIG,
  LERP_FACTOR,
  MODEL_URL,
  mqttTargets: { PosA1: 0, PosA2: 0, PosA3: 0, PosA4: 0, PosA5: 0, PosA6: 0 }
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
          // *** Cosmetic - revisit per model *** these tweak how the loaded
          // GLB's own materials render (metalness/roughness are commented
          // out; envMapIntensity controls how strongly the HDR environment
          // map reflects off the model). A different model's materials may
          // look better/worse with different values here - purely visual,
          // safe to leave alone otherwise.
          //child.material.metalness = 0.90;
          //child.material.roughness = 0.18;
          child.material.envMapIntensity = 0.5; // Lowered from 3.5 to match environment settings
        }
      }
      // *** No edits usually needed here *** - this loop walks every node in
      // the loaded GLB and, for each entry in AXIS_CONFIG above whose
      // nodeName matches, wires that node up to be driven live. If a joint
      // you added to AXIS_CONFIG never shows up in axisState (check with
      // robotDump() in the console), the nodeName doesn't match anything in
      // this particular GLB - fix the nodeName in AXIS_CONFIG, not here.
      Object.entries(AXIS_CONFIG).forEach(([key, cfg]) => {
        if (child.name === cfg.nodeName) {
          axisState[key] = {
            node: child,
            axisName: cfg.axis,
            axisVec: AXIS_VECTORS[cfg.axis],
            sign: cfg.sign,
            offsetRad: THREE.MathUtils.degToRad(cfg.offset || 0),
            restQuat: child.quaternion.clone(), // orientation baked into the GLB
            current: 0, // smoothed angle, degrees
            target: 0   // latest angle from MQTT, degrees
          };
        }
      });
    });

    // *** MODIFY HERE if a different model needs scaling/repositioning ***
    // A different GLB may not be modeled at the same real-world scale/units
    // or may not be centered/oriented the way this one is. If the new model
    // appears too big/small or off-center once loaded, that's usually fixed
    // right here, e.g.: model.scale.setScalar(0.01); model.position.set(0,0,0);
    // before it's added to the group below.
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
// 4b. CALIBRATION HELPERS (browser console)
// ==========================================
// Stop MQTT from overriding a manual test:   robotIgnoreMqtt = true
// Drive one joint, optionally trying another local axis / sign / offset:
//   robotSet('PosA2', { deg: 30 })
//   robotSet('PosA2', { deg: 30, axis: 'z', sign: -1 })
// Print the current settings in AXIS_CONFIG format:   robotDump()
window.robotIgnoreMqtt = false;

window.robotSet = (key, { deg, axis, sign, offset } = {}) => {
  const st = axisState[key];
  if (!st) { console.warn('[robotSet] unknown or not loaded:', key); return; }
  if (axis !== undefined) { st.axisName = axis; st.axisVec = AXIS_VECTORS[axis]; }
  if (sign !== undefined) st.sign = sign;
  if (offset !== undefined) st.offsetRad = THREE.MathUtils.degToRad(offset);
  if (deg !== undefined) st.target = deg;
};

window.robotDump = () => {
  Object.entries(axisState).forEach(([key, st]) => {
    console.log(`${key}: axis '${st.axisName}', sign ${st.sign}, offset ${THREE.MathUtils.radToDeg(st.offsetRad)}`);
  });
};

// ==========================================
// 5. ANIMATION & RENDER LOOP
// ==========================================
const jointQuat = new THREE.Quaternion();

function animate(timestamp, frame) {
  Object.values(axisState).forEach((st) => {
    st.current += (st.target - st.current) * LERP_FACTOR;
    const angle = THREE.MathUtils.degToRad(st.current * st.sign) + st.offsetRad;
    // rest orientation * rotation about the node's local axis
    jointQuat.setFromAxisAngle(st.axisVec, angle);
    st.node.quaternion.copy(st.restQuat).multiply(jointQuat);
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
function updateAxisPosition(key, rawValue) {
  if (window.robotIgnoreMqtt) return;
  const angleDeg = Number(rawValue);
  if (!Number.isFinite(angleDeg)) return;
  window.GANTRY_CONFIG.mqttTargets[key] = angleDeg;
  if (!axisState[key]) return;
  axisState[key].target = angleDeg;
  const valElem = document.getElementById(AXIS_CONFIG[key].valueElementId);
  if (valElem) valElem.innerText = `${angleDeg.toFixed(1)} °`;
}

// ==========================================
// 7. HIVEMQ CLOUD CONNECTION
// ==========================================
const brokerUrl = `wss://${HIVEMQ_HOST}:${HIVEMQ_PORT}/mqtt`;

const client = mqtt.connect(brokerUrl, {
  clientId: 'robot_twin_' + Math.random().toString(16).substring(2, 10),
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
    // *** No edits usually needed here *** - this automatically loops over
    // whatever keys exist in AXIS_CONFIG above, so adding/removing joints
    // there is enough; nothing to change in this handler itself. It simply
    // ignores any payload property that isn't one of the AXIS_CONFIG keys.
    Object.keys(AXIS_CONFIG).forEach((key) => {
      if (payload[key] !== undefined) updateAxisPosition(key, payload[key]);
    });
  } catch (err) {
    console.error('[MQTT] Parse error:', err);
  }
});