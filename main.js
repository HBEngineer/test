import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const HIVEMQ_HOST = "0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud";
const HIVEMQ_PORT = 8884;
const HIVEMQ_USERNAME = "FestoPLC1";
const HIVEMQ_PASSWORD = "FestoPLC1";
const MQTT_TOPIC = "festo/hgosydney/positions";

const container = document.getElementById('canvas-container');

const scene = new THREE.Scene();
window.scene = scene;
window.THREE = THREE;

scene.background = new THREE.Color(0x2b2b2b);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0.7, 2.5);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.65;

renderer.xr.enabled = true;
container.appendChild(renderer.domElement);

// Environment Map Reflections
const rgbeLoader = new RGBELoader();
rgbeLoader.load('https://threejs.org/examples/textures/equirectangular/royal_esplanade_1k.hdr', (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = texture;
  scene.environmentIntensity = 3.5;
});

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
    if (supported) {
      document.body.appendChild(ARButton.createButton(renderer));
    }
  }).catch(() => {});
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Camera Light
const cameraLight = new THREE.DirectionalLight(0xffffff, 2.2);
cameraLight.position.set(0, 0, 1);
camera.add(cameraLight);

// Key/Fill/Ambient
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

const BASE_INTENSITIES = { key: 4.0, fill: 3.0, ambient: 1.8, hemi: 1.6, camera: 2.2 };

const arGroup = new THREE.Group();
scene.add(arGroup);

const floorGeo = new THREE.PlaneGeometry(10, 10);
const floorMat = new THREE.MeshStandardMaterial({ color: 0xdcdcdc, roughness: 0.8, metalness: 0.1 });
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
arGroup.add(floorMesh);

const gridHelper = new THREE.GridHelper(10, 10, 0xbbbbbb, 0xcccccc);
gridHelper.position.y = 0.001;
arGroup.add(gridHelper);

const AXIS_CONFIG = {
  PosX: { nodeName: 'Slide_X', axis: 'z', sign: 1 },
  PosY: { nodeName: 'Slide_Y', axis: 'x', sign: -1 },
  PosZ: { nodeName: 'Slide_Z', axis: 'y', sign: -1 }
};

const axisState = {};
const SCALE_FACTOR = 0.001;
const LERP_FACTOR = 0.05;
const MODEL_URL = './model/hgosydney_Kinetic.glb';

const loader = new GLTFLoader();
loader.load(MODEL_URL, (gltf) => {
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
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  controls.update();
});

// UI Control Handlers
const lightPanel = document.getElementById('light-panel');
const panelHeader = document.getElementById('light-panel-header');
if (panelHeader && lightPanel) {
  panelHeader.addEventListener('click', () => lightPanel.classList.toggle('collapsed'));
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
if (ctrlAngle) {
  ctrlAngle.addEventListener('input', (e) => {
    const deg = parseFloat(e.target.value);
    const rad = (deg * Math.PI) / 180;
    keyLight.position.x = Math.cos(rad) * 7.2;
    keyLight.position.z = Math.sin(rad) * 7.2;
    if (lblAngle) lblAngle.innerText = `${Math.round(deg)}°`;
  });
}

function animate() {
  Object.values(axisState).forEach(({ node, axis, sign, initial, target }) => {
    const targetValue = initial + (target * SCALE_FACTOR * sign);
    node.position[axis] += (targetValue - node.position[axis]) * LERP_FACTOR;
  });

  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// MQTT Setup
const client = mqtt.connect(`wss://${HIVEMQ_HOST}:${HIVEMQ_PORT}/mqtt`, {
  clientId: 'gantry_v1_' + Math.random().toString(16).substring(2, 10),
  username: HIVEMQ_USERNAME,
  password: HIVEMQ_PASSWORD,
  clean: true
});

client.on('connect', () => {
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
  } catch (err) {}
});