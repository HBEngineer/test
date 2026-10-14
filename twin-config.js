// ============================================================================
//  twin-config.js   >>>  THE ONLY FILE YOU NEED TO EDIT  <<<
// ============================================================================
//  Everything that changes between projects (CAD model, MQTT broker/topic,
//  number and names of axes/variables, units, lighting...) lives here.
//
//  This is a CLASSIC script (not an ES module) on purpose: both main.js
//  (module, desktop/Android) and ar-iphone.js (classic, iPhone) read it
//  through window.TWIN_CONFIG.
//
//  QUICK START FOR A NEW CAD MODEL
//   1. Export your model as .glb and put it in ./model/
//   2. Set  model.url  (section 2)
//   3. Set  model.debugListNodes = true  and open the browser console (F12):
//      it prints every node name in the GLB, so you can copy the exact names.
//   4. Edit the  axes  list (section 4): one entry per moving part/variable.
//   5. Set the MQTT broker, credentials and topic (section 3) and make the
//      payload JSON keys match the  payloadKey  of each axis.
//  (c) Hugo Ben - 2026 
// ============================================================================

window.TWIN_CONFIG = {

  // --------------------------------------------------------------------------
  // 1. GENERAL
  // --------------------------------------------------------------------------
  appTitle: 'Gantry Digital Twin',          // browser tab title

  // --------------------------------------------------------------------------
  // 2. 3D MODEL
  // --------------------------------------------------------------------------
  model: {
    url: './model/hgosydney_Kinetic.glb',   // path to your .glb file
    scale: 1,                               // uniform scale (use 0.001 if the CAD was exported in mm and looks huge)
    debugListNodes: false                   // true = print all node names to the console (useful to find axis names)
  },

  // --------------------------------------------------------------------------
  // 3. MQTT (HiveMQ Cloud or any broker with secure WebSockets)
  // --------------------------------------------------------------------------
  mqtt: {
    host: '0bd403ef4ed0449a81d8e2de7a705113.s1.eu.hivemq.cloud',
    port: 8884,                             // WebSocket TLS port
    username: 'FestoPLC1',
    password: 'FestoPLC1',
    topics: ['festo/hgosydney/positions'],  // one or several topics; payloads are merged
    clientIdPrefix: 'gantry_web_twin_',

    // OPTIONAL: custom payload parser. Leave as null if your payload is a flat
    // JSON like {"PosX": 120, "PosY": 40} whose keys match each axis'
    // payloadKey. Otherwise return an object {axisKey: value}. Example for
    // {"joints":[10,20,30]} with axes keyed J1,J2,J3:
    //   parsePayload: (p, topic) => ({ J1: p.joints[0], J2: p.joints[1], J3: p.joints[2] })
    parsePayload: null
  },

  // --------------------------------------------------------------------------
  // 4. AXES / VARIABLES  (add, remove or rename entries freely)
  // --------------------------------------------------------------------------
  //  key         Unique id for this variable (used internally and for the panel).
  //  label       Text shown in the telemetry panel.
  //  payloadKey  (optional) Name of the field in the MQTT JSON. Defaults to key.
  //  node        EXACT name of the node/object in the GLB that moves.
  //  type        'position' (linear axis)  or  'rotation' (rotary joint).
  //  axis        Local axis the node moves/rotates on: 'x' | 'y' | 'z'.
  //  sign        1 or -1 to flip direction.
  //  scale       (optional) Converts the incoming value to scene units.
  //              Defaults: position -> 0.001 (mm to m), rotation -> PI/180 (deg to rad).
  //  unit        (optional) Text shown after the value. Defaults: 'mm' / '°'.
  //
  //  The movement is RELATIVE to the node's position/rotation in the GLB
  //  (value 0 = the pose the model was exported in).
  axes: [
    { key: 'PosX', label: 'X Axis', node: 'Slide_X', type: 'position', axis: 'z', sign:  1 },
    { key: 'PosY', label: 'Y Axis', node: 'Slide_Y', type: 'position', axis: 'z', sign:  1 },
    { key: 'PosZ', label: 'Z Axis', node: 'Slide_Z', type: 'position', axis: 'y', sign: -1 }

    // Example of a rotary joint (6-axis robot style):
    // { key: 'J1', label: 'Joint 1', node: 'Link_1', type: 'rotation', axis: 'y', sign: 1 },
  ],

  // --------------------------------------------------------------------------
  // 5. MOTION
  // --------------------------------------------------------------------------
  motion: {
    lerp: 0.05                              // smoothing 0..1 (smaller = smoother/slower, 1 = instant)
  },

  // --------------------------------------------------------------------------
  // 6. SCENE / CAMERA / RENDERER (desktop + Android WebXR)
  // --------------------------------------------------------------------------
  scene: {
    backgroundColor: 0x2b2b2b,
    fov: 45,
    cameraStart: [0.5, 1, 2.5],             // initial camera position [x, y, z]
    toneMappingExposure: 1.0,
    hdrUrl: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/textures/equirectangular/venice_sunset_1k.hdr', // null = no HDR reflections
    environmentIntensity: 0.5,
    modelEnvMapIntensity: 1.0,
    floor: { show: true, size: 10, color: 0xdcdcdc, roughness: 0.8, metalness: 0.1, gridDivisions: 10 },
    shadowBounds: 1.8                       // half-size of the shadow area; increase for bigger models
  },

  // --------------------------------------------------------------------------
  // 7. LIGHTING
  // --------------------------------------------------------------------------
  //  Fixed lighting (no on-screen controls). Tune these values directly:
  //  color / intensity / position of each light.
  lighting: {
    key:     { color: 0xffffff, intensity: 1,   position: [4, 6, 4] },
    fill:    { color: 0xbbe0ff, intensity: 0.5, position: [-4, 3, -3] },
    ambient: { color: 0xedf5ff, intensity: 0.5 },
    hemi:    { sky: 0xb0e0e6, ground: 0x555555, intensity: 0.8 },
    camera:  { color: 0xffffff, intensity: 1.5, position: [0, 1, 1] },

    // Separate intensities for the iPhone 8th Wall scene (it uses its own THREE instance)
    iosAR: {
      hemi: 2, key: 2, fill: 1.5, ambient: 1, camera: 3
    }
  }
};