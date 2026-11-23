// OCASO CITY street vehicles: reusable car builder, kerbside parking and the
// player driven physics. The police slice reads car.vx / car.vy each frame.
import * as THREE from '../../three.module.min.js';
import * as CONFIG_MODULE from '../config.js';

// config.js may export the tuning object as a named or default export.
const CONFIG = CONFIG_MODULE.CONFIG ?? CONFIG_MODULE.default ?? {};

const COLORS = [0xff4d3d, 0xf7d046, 0x2f6fd0, 0x2fa87a, 0xe8e3d8, 0x23252b, 0x8a3fd0];

const CAR_LENGTH = 4.4; // along local +Z, the nose
const CAR_WIDTH = 1.9; // along local X
const BODY_HEIGHT = 0.7;
const BODY_Y = 0.55; // 0.2 m ground clearance plus half the lower box
const CABIN_Y = 1.21;
const CABIN_Z = -0.18;
const WHEEL_RADIUS = 0.36;
const WHEEL_BASE = 1.42;
const WHEEL_TRACK = 0.88;

const PARK_COUNT = 14;
const PARK_SPACING = 6.6;

const ROAD_HALF = (CONFIG?.city?.roadWidth ?? 12) / 2;
// Perpendicular parking: the car noses up to the kerb, so its centre sits half a
// body length plus the kerb clearance away from the road centreline.
const KERB_DEPTH = ROAD_HALF + CAR_LENGTH / 2 + 0.15;

const MAX_SPEED = 34; // m/s, about 122 km/h
const MAX_REVERSE = 9;
const ACCEL = 9;
const REVERSE_ACCEL = 5;
const BRAKE = 16;
const ROLL = 3.2;
const AIR_DRAG = 0.012;
const STEER_RATE = 1.9;
const SLIP_GAIN = 0.55;
const SLIP_DECAY = 3.4;
const SLIP_LIMIT = 3;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

let ASSETS = null;

function assets() {
  if (ASSETS) return ASSETS;

  const wheel = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.26, 14);
  wheel.rotateZ(Math.PI / 2); // axle along local X

  const geo = {
    body: new THREE.BoxGeometry(CAR_WIDTH, BODY_HEIGHT, CAR_LENGTH),
    cabin: new THREE.BoxGeometry(1.74, 0.62, 2.06),
    // 1 cm wider than the cabin so the glass band reads on both flanks,
    // inset 6 cm front and rear so it stops short of the pillars.
    glass: new THREE.BoxGeometry(1.76, 0.3, 1.94),
    wheel,
    headlight: new THREE.BoxGeometry(0.42, 0.16, 0.1),
    taillight: new THREE.BoxGeometry(0.44, 0.14, 0.1),
    spoiler: new THREE.BoxGeometry(1.5, 0.06, 0.34),
    spoilerPost: new THREE.BoxGeometry(0.08, 0.2, 0.12),
  };

  const mat = {
    body: new Map(),
    glass: new THREE.MeshStandardMaterial({
      color: 0x0a1017,
      roughness: 0.16,
      metalness: 0.6,
      emissive: 0x0a141c,
      emissiveIntensity: 0.4,
    }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.92 }),
    headlight: new THREE.MeshStandardMaterial({
      color: 0xfff4d6,
      emissive: 0xffcf8a,
      emissiveIntensity: 1.6,
      roughness: 0.25,
    }),
    taillight: new THREE.MeshStandardMaterial({
      color: 0x3a0505,
      emissive: 0xff1f1f,
      emissiveIntensity: 0.9,
      roughness: 0.35,
    }),
    spoiler: new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.55, metalness: 0.3 }),
  };

  ASSETS = { geo, mat };
  return ASSETS;
}

function bodyMaterial(color) {
  const cache = assets().mat.body;
  let material = cache.get(color);
  if (!material) {
    material = new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.45 });
    cache.set(color, material);
  }
  return material;
}

// One car as a Group: lower box, cabin, inset glass band, four spinning wheels,
// two warm headlights, two red tails and a spoiler on the sporty ones.
function buildCar({ color = COLORS[0], sporty = false } = {}) {
  const { geo, mat } = assets();
  const group = new THREE.Group();
  const paint = bodyMaterial(color);

  const body = new THREE.Mesh(geo.body, paint);
  body.position.y = BODY_Y;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(geo.cabin, paint);
  cabin.position.set(0, CABIN_Y, CABIN_Z);
  cabin.castShadow = true;
  group.add(cabin);

  const glass = new THREE.Mesh(geo.glass, mat.glass);
  glass.position.set(0, 1.16, CABIN_Z);
  group.add(glass);

  const wheels = [];
  const frontWheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(geo.wheel, mat.tyre);
      wheel.rotation.order = 'YXZ'; // steer about Y first, then spin about the axle
      wheel.position.set(sx * WHEEL_TRACK, WHEEL_RADIUS, sz * WHEEL_BASE);
      wheel.castShadow = true;
      group.add(wheel);
      wheels.push(wheel);
      if (sz > 0) frontWheels.push(wheel);
    }
  }

  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(geo.headlight, mat.headlight);
    head.position.set(sx * 0.62, 0.78, CAR_LENGTH / 2 - 0.02);
    group.add(head);

    const tail = new THREE.Mesh(geo.taillight, mat.taillight);
    tail.position.set(sx * 0.62, 0.8, -CAR_LENGTH / 2 + 0.02);
    group.add(tail);
  }

  if (sporty) {
    const wing = new THREE.Mesh(geo.spoiler, mat.spoiler);
    wing.position.set(0, 1.1, -1.98);
    group.add(wing);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(geo.spoilerPost, mat.spoiler);
      post.position.set(sx * 0.55, 0.99, -1.98);
      group.add(post);
    }
  }

  return { mesh: group, wheels, frontWheels };
}

// Kerb slot: cars sit on the x = 0 and z = 0 grid roads near the origin, nose
// toward the road centre line.
function parkPose(index) {
  const side = index % 2 === 0 ? 1 : -1;
  const slot = (index % 7) - 3;
  const along = slot * PARK_SPACING;
  const onZRoad = index < 7;

  if (onZRoad) {
    return { x: side * KERB_DEPTH, z: along, angle: side > 0 ? -Math.PI / 2 : Math.PI / 2 };
  }
  return { x: along, z: side * KERB_DEPTH, angle: side > 0 ? Math.PI : 0 };
}

export function createVehicles(G) {
  const group = new THREE.Group();
  group.name = 'vehicles';

  const cars = [];
  let nextId = 1;

  function spawnCar(options = {}) {
    const {
      x = 0,
      z = 0,
      angle = 0,
      driver = 'npc',
      color = COLORS[(nextId - 1) % COLORS.length],
      sporty = false,
      speed = 0,
      hp = 100,
    } = options;

    const built = buildCar({ color, sporty });
    built.mesh.position.set(x, 0, z);
    built.mesh.rotation.y = angle;
    group.add(built.mesh);

    const car = {
      id: nextId++,
      mesh: built.mesh,
      x,
      z,
      angle,
      speed,
      hp,
      driver,
      vx: 0,
      vy: 0,
      slip: 0,
      throttle: 0,
      steer: 0,
      color,
      sporty,
      wheels: built.wheels,
      frontWheels: built.frontWheels,
    };
    cars.push(car);
    return car;
  }

  for (let i = 0; i < PARK_COUNT; i += 1) {
    const pose = parkPose(i);
    spawnCar({
      ...pose,
      driver: 'npc',
      color: COLORS[i % COLORS.length],
      sporty: i % 4 === 1,
    });
  }

  function drivePlayer(car, dt) {
    const throttle = car.throttle ?? 0;
    const steer = car.steer ?? 0;

    if (throttle > 0) {
      car.speed += ACCEL * throttle * dt;
    } else if (throttle < 0) {
      if (car.speed > 0.3) car.speed -= BRAKE * dt;
      else car.speed += REVERSE_ACCEL * throttle * dt;
    } else {
      const drop = ROLL * dt;
      car.speed = Math.abs(car.speed) <= drop ? 0 : car.speed - Math.sign(car.speed) * drop;
    }
    car.speed -= car.speed * Math.abs(car.speed) * AIR_DRAG * dt;
    car.speed = clamp(car.speed, -MAX_REVERSE, MAX_SPEED);

    // Grip falls away at both ends: the car barely turns when stopped and
    // understeers near top speed.
    const grip =
      Math.min(1, Math.abs(car.speed) / 5) * (1 - 0.4 * Math.min(1, Math.abs(car.speed) / MAX_SPEED));
    car.angle += steer * STEER_RATE * grip * Math.sign(car.speed) * dt;
    car.steerVisual = steer;
  }

  function integrate(car, dt) {
    const steer = car.driver === 'player' ? (car.steer ?? 0) : 0;
    const push = steer * Math.abs(car.speed) * SLIP_GAIN;
    car.slip = clamp(car.slip + (push - car.slip * SLIP_DECAY) * dt, -SLIP_LIMIT, SLIP_LIMIT);

    const fx = Math.sin(car.angle);
    const fz = Math.cos(car.angle);
    const rx = Math.cos(car.angle);
    const rz = -Math.sin(car.angle);

    // vx / vy are world velocities on the ground plane; the police slice reads them.
    car.vx = fx * car.speed + rx * car.slip;
    car.vy = fz * car.speed + rz * car.slip;

    car.x += car.vx * dt;
    car.z += car.vy * dt;

    if (car.driver !== 'player' && car.speed !== 0) {
      const drop = ROLL * 2 * dt;
      car.speed = Math.abs(car.speed) <= drop ? 0 : car.speed - Math.sign(car.speed) * drop;
    }
  }

  function syncMesh(car, dt) {
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.angle;

    const spin = (car.speed / WHEEL_RADIUS) * dt;
    for (const wheel of car.wheels) wheel.rotation.x += spin;
    for (const wheel of car.frontWheels) wheel.rotation.y = (car.steerVisual ?? 0) * 0.4;
  }

  function update(dt) {
    const step = Math.min(Number.isFinite(dt) ? dt : 0, 0.05);
    if (step <= 0) return;
    for (const car of cars) {
      if (car.driver === 'player') drivePlayer(car, step);
      integrate(car, step);
      syncMesh(car, step);
    }
  }

  if (G?.scene) G.scene.add(group);

  const api = { group, cars, spawnCar, update };

  // window-visible handle for the police and debug slices
  if (G) {
    G.cars = cars;
    G.vehicles = api;
  }

  return api;
}

export { buildCar, parkPose, COLORS, MAX_SPEED };
