// ==========================================
// app.js - A-Frame Digital Twin
// ==========================================
// This file replaces main.js + ar-iphone.js's combined logic with A-Frame
// components. Three components, registered once each, attached to entities
// declaratively in index.html:
//   joint-driver   - rotates the 6 robot joints (was: AXIS_CONFIG/axisState/
//                    animate() in main.js, and the near-identical copy in
//                    ar-iphone.js)
//   place-on-tap   - tap-to-place via XR8 hit-testing (was: the touchstart
//                    handler in ar-iphone.js)
// Plus plain (non-component) code at the bottom for MQTT and the lighting
// slider, since those don't need to be attached to a specific 3D entity.
// ==========================================

// ==========================================
// 1. HIVEMQ CLOUD CREDENTIALS
// ==========================================
// *** MODIFY HERE for a different broker / controller - identical role to
// main.js section 1 ***
const HIVEMQ_HOST = "0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud";
const HIVEMQ_PORT = 8884;
const HIVEMQ_USERNAME = "Robot6DOF_00";
const HIVEMQ_PASSWORD = "Robot6DOF_00";
const MQTT_TOPIC = "robot/coordinates";

// ==========================================
// 2. JOINT-DRIVER COMPONENT
// ==========================================
// Same component from Lesson 2, unchanged in structure. window.jointTargets
// is now written by real MQTT messages (section 4 below) instead of sliders.
AFRAME.registerComponent('joint-driver', {

  schema: {
    lerpFactor: { type: 'number', default: 0.05 }
  },

  init: function () {
    // *** MODIFY HERE for a different model/DOF count - same structure as
    // main.js's AXIS_CONFIG ***
    this.axisConfig = {
      PosA1: { nodeName: 'Degree1', axis: 'y', sign:  1, offset: 0, valueElementId: 'val-a1' },
      PosA2: { nodeName: 'Degree2', axis: 'z', sign:  1, offset: 0, valueElementId: 'val-a2' },
      PosA3: { nodeName: 'Degree3', axis: 'z', sign:  1, offset: 0, valueElementId: 'val-a3' },
      PosA4: { nodeName: 'Degree4', axis: 'x', sign:  1, offset: 0, valueElementId: 'val-a4' },
      PosA5: { nodeName: 'Degree5', axis: 'z', sign: -1, offset: 0, valueElementId: 'val-a5' },
      PosA6: { nodeName: 'Degree6', axis: 'x', sign:  1, offset: 0, valueElementId: 'val-a6' }
    };

    this.axisVectors = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1)
    };

    this.axisState = {};
    this.jointQuat = new THREE.Quaternion();

    window.jointTargets = window.jointTargets || {
      PosA1: 0, PosA2: 0, PosA3: 0, PosA4: 0, PosA5: 0, PosA6: 0
    };

    this.el.addEventListener('model-loaded', () => {
      const mesh = this.el.getObject3D('mesh');
      mesh.traverse((child) => {
        Object.entries(this.axisConfig).forEach(([key, cfg]) => {
          if (child.name === cfg.nodeName) {
            this.axisState[key] = {
              node: child,
              axisVec: this.axisVectors[cfg.axis],
              sign: cfg.sign,
              offsetRad: THREE.MathUtils.degToRad(cfg.offset || 0),
              restQuat: child.quaternion.clone(),
              current: 0
            };
          }
        });
      });
      console.log('[joint-driver] wired axes:', Object.keys(this.axisState));
    });
  },

  tick: function () {
    Object.entries(this.axisState).forEach(([key, st]) => {
      const target = window.jointTargets[key] || 0;
      st.current += (target - st.current) * this.data.lerpFactor;
      const angle = THREE.MathUtils.degToRad(st.current * st.sign) + st.offsetRad;
      this.jointQuat.setFromAxisAngle(st.axisVec, angle);
      st.node.quaternion.copy(st.restQuat).multiply(this.jointQuat);
    });
  }
});

// ==========================================
// 3. PLACE-ON-TAP COMPONENT
// ==========================================
// Ports the exact tap-to-place logic you already validated working in
// ar-iphone.js (hit-test at the tap point, place immediately if it hits) -
// same approach, just reached through A-Frame's component lifecycle instead
// of a manually-added canvas listener. We deliberately did NOT bring back
// the continuous-scan/auto-place logic from the "Option A" conversation -
// this is the known-working tap-only version.
AFRAME.registerComponent('place-on-tap', {

  init: function () {
    this.placed = false;

    // Runs once the scene's renderer/canvas actually exists - xrweb's
    // canvas isn't guaranteed ready the instant this component initializes,
    // so we wait for the scene's own 'renderstart' event, same reasoning as
    // ar-iphone.js's onStart pattern (don't touch the canvas before it exists).
    this.el.sceneEl.addEventListener('renderstart', () => {
      console.log('[place-on-tap] canvas ready, listening for clicks/taps');
      const canvas = this.el.sceneEl.canvas;

      // Handles both a real device (touchstart) and 8th Wall's desktop
      // simulator (mousedown, since there's no touchscreen on desktop) -
      // touch events carry coordinates in e.touches[0], mouse events carry
      // them directly on the event.
      const handlePlacementInput = (e) => {
        console.log('[place-on-tap] input received. placed:', this.placed, 'window.XR8:', !!window.XR8);
        if (this.placed || !window.XR8) return;

        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const x = clientX / canvas.clientWidth;
        const y = clientY / canvas.clientHeight;
        const results = XR8.XrController.hitTest(x, y, ['FEATURE_POINT']);
        console.log('[place-on-tap] hitTest at', x.toFixed(2), y.toFixed(2), '-> results:', results.length, results);

        if (results.length > 0) {
          const { position } = results[0];
          this.el.setAttribute('position', position);
          this.el.setAttribute('visible', true);
          this.placed = true;
          console.log('[place-on-tap] PLACED at', position);

          // NOT revealing #ground here (unlike an earlier version of this
          // file) - it's a big opaque plane meant only as a visual floor
          // reference for desktop preview, where there's no real camera
          // feed. On a real device it just covers the actual floor under
          // the camera passthrough, which is exactly the "white floor"
          // problem - so it stays invisible in real AR.

          const overlay = document.getElementById('ar-scan-overlay');
          if (overlay) overlay.style.display = 'none';
        }
      };

      canvas.addEventListener('touchstart', handlePlacementInput);
      canvas.addEventListener('mousedown', handlePlacementInput);
    });
  }
});

// ==========================================
// 4. MQTT CONNECTION
// ==========================================
// Same broker/topic/message-handling role as main.js section 7, but writes
// into window.jointTargets (read by joint-driver's tick()) instead of
// directly touching THREE objects - the component doesn't know or care
// where its target angles come from.
const brokerUrl = `wss://${HIVEMQ_HOST}:${HIVEMQ_PORT}/mqtt`;

const client = mqtt.connect(brokerUrl, {
  clientId: 'robot_twin_aframe_' + Math.random().toString(16).substring(2, 10),
  username: HIVEMQ_USERNAME,
  password: HIVEMQ_PASSWORD,
  clean: true
});

client.on('connect', () => {
  console.log('[MQTT] Connected to HiveMQ Cloud');
  const statusElem = document.getElementById('status');
  const dotElem = document.getElementById('dot');
  if (statusElem) { statusElem.innerText = 'Connected'; statusElem.style.color = '#2e7d32'; }
  if (dotElem) { dotElem.style.backgroundColor = '#4caf50'; dotElem.style.boxShadow = '0 0 10px #4caf50'; }
  client.subscribe(MQTT_TOPIC);
});

// *** MODIFY HERE if you change the AXIS_CONFIG keys in joint-driver above -
// this valueElementIds map needs to match ***
const VALUE_ELEMENT_IDS = {
  PosA1: 'val-a1', PosA2: 'val-a2', PosA3: 'val-a3',
  PosA4: 'val-a4', PosA5: 'val-a5', PosA6: 'val-a6'
};

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    window.jointTargets = window.jointTargets || {};
    Object.entries(VALUE_ELEMENT_IDS).forEach(([key, elId]) => {
      if (payload[key] === undefined) return;
      const angleDeg = Number(payload[key]);
      if (!Number.isFinite(angleDeg)) return;
      window.jointTargets[key] = angleDeg;
      const valElem = document.getElementById(elId);
      if (valElem) valElem.innerText = `${angleDeg.toFixed(1)} °`;
    });
  } catch (err) {
    console.error('[MQTT] Parse error:', err);
  }
});

// ==========================================
// 5. LIGHTING PANEL
// ==========================================
// Same role as main.js's BASE_INTENSITIES + brightness slider, but sets
// A-Frame light entities' attributes via setAttribute instead of THREE
// light.intensity directly.
document.addEventListener('DOMContentLoaded', () => {
  const panelHeader = document.getElementById('light-panel-header');
  const lightPanel = document.getElementById('light-panel');
  if (panelHeader && lightPanel) {
    panelHeader.addEventListener('click', () => lightPanel.classList.toggle('collapsed'));
  }

  const BASE_INTENSITIES = { key: 1.0, fill: 0.5, ambient: 0.5 };

  const ctrlBrightness = document.getElementById('ctrl-brightness');
  const lblBrightness = document.getElementById('lbl-brightness');
  if (ctrlBrightness) {
    ctrlBrightness.addEventListener('input', (e) => {
      const scale = parseFloat(e.target.value);
      document.getElementById('keyLight').setAttribute('light', 'intensity', BASE_INTENSITIES.key * scale);
      document.getElementById('fillLight').setAttribute('light', 'intensity', BASE_INTENSITIES.fill * scale);
      document.getElementById('ambientLight').setAttribute('light', 'intensity', BASE_INTENSITIES.ambient * scale);
      if (lblBrightness) lblBrightness.innerText = `${Math.round(scale * 100)}%`;
    });
  }
});