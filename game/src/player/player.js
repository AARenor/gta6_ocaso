// OCASO CITY: the walking body, the orbit camera and the car the player drives.
// This module owns the player state, so the frame loop needs one update call.
import * as THREE from '../../three.module.min.js';

const WALK_SPEED = 3.2, RUN_SPEED = 6;      // m/s, Shift runs
const CAM_DIST = 6, CAM_CAR_DIST = 9;       // orbit reach on foot and driving
const CAM_FOOT = 1.6, CAM_CAR = 1.4;        // look at point above feet and road
const CAM_LOW = -0.25, CAM_HIGH = 0.9;      // pitch clamp, radians
const BLOCK_MARGIN = 0.6, ENTER_RANGE = 5;  // body radius grows every footprint
const CAR_MAX = 26, CAR_ACCEL = 9;          // m/s and m/s2
const CAR_BRAKE = 14, CAR_REVERSE = -6;     // m/s2 and m/s
const LIMB_SWING = 0.55;                    // radians at full stride

const _v = new THREE.Vector3(), _box = new THREE.Box3();
const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });

// One limb box hanging from a pivot group, so rotation.x swings it at the joint.
function limb(parent, x, y, w, h, d, mat) {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  pivot.position.set(x, y, 0);
  mesh.position.y = -h / 2;
  mesh.castShadow = true;
  parent.add(pivot.add(mesh));
  return pivot;
}

// A 1.8 m stylised person: hips at 0.86, torso 0.5 by 0.65 by 0.28, head sphere
// r 0.16, a flat cap, and two arms and two legs 0.16 wide. Faces -Z at angle 0.
function buildBody() {
  const group = new THREE.Group();
  const shirt = material(0xf2e4c9), trousers = material(0x2b2f3a);
  const skin = material(0xd8a878), cloth = material(0x3d5a80);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.28), shirt);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.07, 12), cloth);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.14), cloth);
  torso.position.y = 1.185; // hips 0.86 to shoulders 1.51
  head.position.y = 1.67;
  cap.position.y = 1.8;
  brim.position.set(0, 1.775, -0.15); // the brim points where he looks
  for (const m of [torso, head, cap, brim]) m.castShadow = true;
  group.add(torso, head, cap, brim);
  // Shoulders at 1.45, hips at 0.86, arm and leg boxes 0.16 wide.
  const armL = limb(group, -0.33, 1.45, 0.16, 0.62, 0.18, shirt);
  const armR = limb(group, 0.33, 1.45, 0.16, 0.62, 0.18, shirt);
  const legL = limb(group, -0.13, 0.86, 0.16, 0.86, 0.2, trousers);
  const legR = limb(group, 0.13, 0.86, 0.16, 0.86, 0.2, trousers);
  return { group, armL, armR, legL, legR };
}

export function createPlayer(G) {
  // Building footprints, cached because the city does not move.
  const rects = [];
  let from = null, count = -1;

  // Blocks arrive as a min/max rect, a mesh, or x/z with a width and depth.
  function toRect(b) {
    if (!b) return null;
    if (b.minX !== undefined) return { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ };
    if (b.isObject3D) {
      _box.setFromObject(b);
      if (!Number.isFinite(_box.min.x)) return null;
      return { minX: _box.min.x, maxX: _box.max.x, minZ: _box.min.z, maxZ: _box.max.z };
    }
    const w = b.w ?? b.width ?? b.sx, d = b.d ?? b.depth ?? b.sz;
    if (b.x === undefined || w === undefined || d === undefined) return null;
    return { minX: b.x - w / 2, maxX: b.x + w / 2, minZ: b.z - d / 2, maxZ: b.z + d / 2 };
  }

  function refreshBlocks() {
    const blocks = G.world.blocks || [];
    if (blocks === from && blocks.length === count) return;
    from = blocks, count = blocks.length, rects.length = 0;
    for (const b of blocks) {
      const r = toRect(b);
      if (r) rects.push(r);
    }
  }

  // Point test against every footprint grown by the body radius, so one number
  // covers the person and the wall.
  function blocked(x, z) {
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (x > r.minX - BLOCK_MARGIN && x < r.maxX + BLOCK_MARGIN
        && z > r.minZ - BLOCK_MARGIN && z < r.maxZ + BLOCK_MARGIN) return true;
    }
    return false;
  }

  refreshBlocks();
  // A start point inside a building would lock movement, so step out along +X.
  let sx = 0, sz = 0;
  while (blocked(sx, sz) && sx < 120) sx += 2;

  const body = { x: sx, z: sz, angle: 0, speed: 0, phase: 0, gait: 0 };
  G.player = body;
  G.state.inCar = null;
  const model = buildBody();
  model.group.position.set(body.x, 0, body.z);
  G.scene.add(model.group);

  let camYaw = 0, camPitch = 0.34; // yaw 0 puts the camera on +Z, behind him
  const camTarget = new THREE.Vector3(body.x, CAM_FOOT, body.z);
  G.camera.position.set(body.x, CAM_FOOT + 2.4, body.z + CAM_DIST);
  G.camera.lookAt(camTarget);

  // Drag on the canvas orbits the camera; no pointer lock, so the cursor and
  // the rest of the page keep working.
  const canvas = G.renderer ? G.renderer.domElement : null;
  let dragging = false, dragX = 0, dragY = 0;
  if (canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      dragging = true, dragX = e.clientX, dragY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      camYaw -= (e.clientX - dragX) * 0.005;
      camPitch = Math.max(CAM_LOW, Math.min(CAM_HIGH, camPitch + (e.clientY - dragY) * 0.004));
      dragX = e.clientX, dragY = e.clientY;
    });
    for (const type of ['pointerup', 'pointercancel']) {
      canvas.addEventListener(type, () => { dragging = false; });
    }
  }

  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !e.repeat) toggleCar();
    if (e.code === 'Space') e.preventDefault(); // no page scroll while driving
    keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); });

  // Shortest arc turn, so the body never spins the long way round.
  function turnToward(fromAngle, to, t) {
    const full = Math.PI * 2;
    const delta = ((to - fromAngle + Math.PI) % full + full) % full - Math.PI;
    return fromAngle + delta * t;
  }

  // Standing still: the phase resets and the limbs drift back to neutral.
  const swingers = [model.legL, model.legR, model.armL, model.armR];
  function settleLimbs(dt) {
    const k = Math.min(1, dt * 12);
    for (const p of swingers) p.rotation.x -= p.rotation.x * k;
  }

  function walk(dt) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
    // Ground basis of the orbit camera: forward is where the camera looks.
    const cy = Math.cos(camYaw), sy = Math.sin(camYaw);
    let mx = -sy * forward + cy * side, mz = -cy * forward - sy * side;
    const len = Math.hypot(mx, mz), moving = len > 1e-4;
    body.speed = moving ? (running ? RUN_SPEED : WALK_SPEED) : 0;
    body.gait += ((moving ? 1 : 0) - body.gait) * Math.min(1, dt * 12);
    if (!moving) {
      body.phase = 0; // idle: the swing phase starts over
      settleLimbs(dt);
      return;
    }
    mx /= len, mz /= len;
    body.angle = turnToward(body.angle, Math.atan2(-mx, -mz), Math.min(1, dt * 10));
    // Try the full step, else slide along one wall axis, else stand still.
    const stepX = mx * body.speed * dt, stepZ = mz * body.speed * dt;
    const fromX = body.x, fromZ = body.z;
    if (!blocked(body.x + stepX, body.z + stepZ)) { body.x += stepX; body.z += stepZ; }
    else if (!blocked(body.x + stepX, body.z)) body.x += stepX;
    else if (!blocked(body.x, body.z + stepZ)) body.z += stepZ;

    // The swing follows the distance actually walked, so a wall stops the legs.
    body.phase += Math.hypot(body.x - fromX, body.z - fromZ) * 2.6;
    const swing = Math.sin(body.phase) * LIMB_SWING * body.gait;
    model.legL.rotation.x = swing, model.legR.rotation.x = -swing;
    model.armL.rotation.x = -swing * 0.8, model.armR.rotation.x = swing * 0.8;
  }

  function enterCar(car) {
    G.state.inCar = car;
    car.driver = 'player';
    car.speed = car.speed || 0, car.slip = 0;
    model.group.visible = false;
    camYaw = car.angle + Math.PI; // behind the car, looking down the road
    camPitch = 0.25;
  }

  function leaveCar() {
    const car = G.state.inCar;
    Object.assign(car, { driver: 'npc', speed: 0, slip: 0, throttle: 0, steer: 0, vx: 0, vy: 0 });
    // Step out at the driver's door: left of the heading, first free spot wins.
    const fx = Math.sin(car.angle), fz = Math.cos(car.angle);
    let px = car.x, pz = car.z;
    for (const d of [1.6, 2.6, 3.6, -1.6, -2.6]) {
      const tx = car.x + fz * d, tz = car.z - fx * d;
      if (!blocked(tx, tz)) { px = tx; pz = tz; break; }
    }
    Object.assign(body, { x: px, z: pz, angle: car.angle, speed: 0, phase: 0 });
    G.state.inCar = null;
    model.group.visible = true;
  }

  function toggleCar() {
    if (G.state.inCar) { leaveCar(); return; }
    let best = null, bestDist = ENTER_RANGE;
    for (const car of G.cars || []) {
      if (!car) continue;
      const d = Math.hypot(car.x - body.x, car.z - body.z);
      if (d <= bestDist) { bestDist = d; best = car; }
    }
    if (best) enterCar(best);
  }

  // The player's car is integrated here: speed, heading and a handbrake slide.
  function driveCar(car, dt) {
    const drive = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const steer = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    if (drive > 0) car.speed = Math.min(CAR_MAX, car.speed + CAR_ACCEL * dt);
    else if (drive < 0) car.speed = Math.max(CAR_REVERSE, car.speed - CAR_BRAKE * dt);
    else {
      const drag = 3.5 * dt; // rolling to a stop with no pedal held
      car.speed = Math.abs(car.speed) <= drag ? 0 : car.speed - Math.sign(car.speed) * drag;
    }
    // Steering eases off as the speed rises, and inverts in reverse.
    if (car.speed !== 0) {
      const rate = 1.9 / (1 + Math.abs(car.speed) * 0.14);
      car.angle -= steer * rate * dt * Math.sign(car.speed);
    }

    const rightX = -Math.cos(car.angle), rightZ = Math.sin(car.angle);
    if (keys.has('Space')) {
      car.slip -= steer * 9 * dt;               // slide to the outside of the turn
      car.speed -= car.speed * Math.min(1, dt * 0.8);
    } else car.slip *= Math.exp(-dt * 3.5);     // grip comes back
    car.slip = Math.max(-7, Math.min(7, car.slip));

    const hx = Math.sin(car.angle), hz = Math.cos(car.angle);
    car.vx = hx * car.speed + rightX * car.slip; // world plane, for the police slice
    car.vy = hz * car.speed + rightZ * car.slip;
    car.x += car.vx * dt, car.z += car.vy * dt;
    car.throttle = drive, car.steer = steer;
    if (car.mesh) {
      car.mesh.position.set(car.x, car.mesh.position.y, car.z);
      car.mesh.rotation.y = car.angle;
    }
  }

  function placeCamera(dt, car) {
    const dist = car ? CAM_CAR_DIST : CAM_DIST;
    const height = car ? CAM_CAR : CAM_FOOT;
    const k = 1 - Math.exp(-dt * 10); // frame rate independent smoothing
    camTarget.x += ((car ? car.x : body.x) - camTarget.x) * k;
    camTarget.y += (height - camTarget.y) * k;
    camTarget.z += ((car ? car.z : body.z) - camTarget.z) * k;
    const cp = Math.cos(camPitch) * dist, sp = Math.sin(camPitch) * dist;
    _v.set(camTarget.x + Math.sin(camYaw) * cp, Math.max(0.4, camTarget.y + sp), camTarget.z + Math.cos(camYaw) * cp);
    G.camera.position.lerp(_v, 1 - Math.exp(-dt * 9));
    G.camera.lookAt(camTarget);
  }

  function update(dt) {
    refreshBlocks();
    const car = G.state.inCar;
    if (car) driveCar(car, dt);
    else {
      walk(dt);
      const bob = Math.abs(Math.sin(body.phase)) * 0.035 * body.gait;
      model.group.position.set(body.x, bob, body.z);
      model.group.rotation.y = body.angle;
    }
    placeCamera(dt, car);
  }

  return { group: model.group, update, body };
}
