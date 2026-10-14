// ============================================================================
//  twin-shared.js   >>>  NO MODIFICATION NEEDED  <<<
// ============================================================================
//  Generic logic shared by main.js (desktop/Android) and ar-iphone.js (iOS):
//    - builds the telemetry panel from CONFIG.axes
//    - stores the latest MQTT target value of every axis
//    - finds the axis nodes in any loaded model and animates them
//
//  Classic script. Must be loaded AFTER twin-config.js and BEFORE main.js.
//  (c) Hugo Ben - 2026 
// ============================================================================

(function () {
  const CFG = window.TWIN_CONFIG;
  if (!CFG) {
    console.error('[TWIN] twin-config.js must be loaded before twin-shared.js');
    return;
  }

  // Latest value received from MQTT for each axis key (shared by every scene)
  const targets = {};
  CFG.axes.forEach((a) => { targets[a.key] = 0; });

  // ---- helpers to apply per-type defaults ----
  const isRotation = (a) => a.type === 'rotation';
  const scaleOf = (a) => (a.scale !== undefined ? a.scale : (isRotation(a) ? Math.PI / 180 : 0.001));
  const unitOf = (a) => (a.unit !== undefined ? a.unit : (isRotation(a) ? '°' : 'mm'));
  const valueElId = (a) => `val-${a.key}`;

  // ---- Telemetry panel: one row per axis, generated from the config ----
  function buildTelemetryPanel() {
    const box = document.getElementById('telemetry-rows');
    if (!box) return;
    box.innerHTML = '';
    CFG.axes.forEach((a) => {
      const row = document.createElement('div');
      row.className = 'telemetry-row';
      row.innerHTML =
        `<span class="telemetry-label">${a.label || a.key}:</span>` +
        `<span id="${valueElId(a)}" class="telemetry-val">0 ${unitOf(a)}</span>`;
      box.appendChild(row);
    });
  }

  // ---- Store a new target value and refresh the panel ----
  function setTarget(key, value) {
    const a = CFG.axes.find((x) => x.key === key);
    if (!a || typeof value !== 'number' || isNaN(value)) return;
    targets[key] = value;
    const el = document.getElementById(valueElId(a));
    if (el) el.innerText = `${value} ${unitOf(a)}`;
  }

  // ---- Convert an incoming MQTT payload into target values ----
  function handlePayload(payload, topic) {
    if (typeof CFG.mqtt.parsePayload === 'function') {
      const values = CFG.mqtt.parsePayload(payload, topic) || {};
      Object.entries(values).forEach(([k, v]) => setTarget(k, v));
      return;
    }
    CFG.axes.forEach((a) => {
      const v = payload[a.payloadKey !== undefined ? a.payloadKey : a.key];
      if (v !== undefined) setTarget(a.key, Number(v));
    });
  }

  // ---- Find the axis nodes inside a loaded model (works with any THREE instance) ----
  function bindAxes(modelRoot) {
    const states = {};
    const allNames = [];

    modelRoot.traverse((child) => {
      allNames.push(child.name);
      CFG.axes.forEach((a) => {
        if (child.name === a.node) {
          const prop = isRotation(a) ? 'rotation' : 'position';
          states[a.key] = {
            node: child,
            prop,
            axis: a.axis,
            sign: a.sign !== undefined ? a.sign : 1,
            scale: scaleOf(a),
            initial: child[prop][a.axis]
          };
        }
      });
    });

    if (CFG.model.debugListNodes) {
      console.log('[TWIN] Nodes in model:', allNames.filter(Boolean));
    }
    CFG.axes.forEach((a) => {
      if (!states[a.key]) {
        console.warn(`[TWIN] Node "${a.node}" (axis "${a.key}") not found in the model. Set model.debugListNodes = true to list names.`);
      }
    });
    return states;
  }

  // ---- Move every bound node a step toward its target (call every frame) ----
  function stepAxes(states) {
    Object.entries(states).forEach(([key, s]) => {
      const targetValue = s.initial + targets[key] * s.scale * s.sign;
      s.node[s.prop][s.axis] += (targetValue - s.node[s.prop][s.axis]) * CFG.motion.lerp;
    });
  }

  window.TwinShared = { targets, buildTelemetryPanel, setTarget, handlePayload, bindAxes, stepAxes };
})();