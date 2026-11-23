// OCASO CITY: 32 AI cars on the road grid. Self contained: the cars only need
// simple shared boxes and cylinders, nothing from vehicles.js.
import * as THREE from '../../three.module.min.js';
import { CONFIG } from '../config.js';

const CITY = CONFIG.city || {};
const N = CITY.blocks || 6;
const BLOCK = CITY.blockSize || 46;
const ROAD = CITY.roadWidth || 14;
const SPAN = N * BLOCK + (N + 1) * ROAD;
const PITCH = BLOCK + ROAD;
const HALF = SPAN / 2;

// 7 road centrelines, 60 m apart: -180, -120, ... , 180.
const ROADS = Array.from({ length: N + 1 }, (_, i) => -HALF + ROAD / 2 + i * PITCH);

const COUNT = 32;
const LANE = 3.5;      // metres from the centreline
const MIN_SPEED = 8;
const MAX_SPEED = 14;
const GAP = 8;         // stop this far behind the car ahead
const ACCEL = 4.5;
const BRAKE = 12;
const CAR_LENGTH = 4.3;

const PAL = CONFIG.palette || {};
const HEADLIGHT = PAL.line ?? 0xfff0c4;
const CAR_COLOURS = [0xd94f4f, 0x2f6fb5, 0xe8e4dc, 0x33383f, 0xd8a13c, 0x3f8f6f, 0x7a4fa8, 0x9aa4ad];

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Right hand traffic: heading +z keeps x below the centreline, heading +x
// keeps z above it.
function laneOff(axis, dir) {
  return axis === 'z' ? -dir * LANE : dir * LANE;
}

export function createTraffic(G) {
  const rnd = mulberry32((CITY.seed ?? 7) * 7919 + 13);
  const group = new THREE.Group();
  group.name = 'traffic';
  G.scene.add(group);

  // Shared geometry and materials: 8 body colours reused by 32 cars.
  const bodyGeo = new THREE.BoxGeometry(1.92, 0.62, CAR_LENGTH);
  const cabinGeo = new THREE.BoxGeometry(1.72, 0.56, 2.0);
  const glassGeo = new THREE.BoxGeometry(1.76, 0.34, 1.9);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 10);
  // Bake the axle onto local X so a wheel rolls about its own axis: rotating
  // the mesh on Z first and spinning on X tipped the wheel plane every frame.
  wheelGeo.rotateZ(Math.PI / 2);
  const lampGeo = new THREE.BoxGeometry(0.28, 0.16, 0.1);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0d151d, roughness: 0.2, metalness: 0.55 });
  const bodyMats = CAR_COLOURS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.25 }));
  const cabinMat = new THREE.MeshStandardMaterial({ color: PAL.glass ?? 0x8fb6c9, roughness: 0.2, metalness: 0.1 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.9 });
  const lampMat = new THREE.MeshBasicMaterial({ color: HEADLIGHT });

  const cars = [];

  // A lane is clear when no other car sits within `back` metres behind and
  // `ahead` metres in front of the given point. Turns and respawns use it so a
  // car never materialises inside another one: measured before this guard, a
  // turning car landed 3.8 m inside the car ahead of it.
  function laneClear(axis, road, dir, pos, ahead, back, self) {
    for (const other of cars) {
      if (other === self || other.axis !== axis || other.road !== road || other.dir !== dir) continue;
      const d = (other.pos - pos) * dir;
      if (d > -back && d < ahead) return false;
    }
    return true;
  }

  function spawn(car) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const axis = rnd() < 0.5 ? 'z' : 'x';
      const road = Math.floor(rnd() * ROADS.length);
      const dir = rnd() < 0.5 ? 1 : -1;
      const pos = (rnd() * 2 - 1) * (HALF - 6);
      if (attempt < 15 && !laneClear(axis, road, dir, pos, 18, 18, car)) continue;
      car.axis = axis;
      car.road = road;
      car.dir = dir;
      car.pos = pos;
      break;
    }
    car.maxSpeed = MIN_SPEED + rnd() * (MAX_SPEED - MIN_SPEED);
    car.speed = car.maxSpeed;
    car.off = car.targetOff = laneOff(car.axis, car.dir);
    car.gap = null;
    car.stuck = 0;
  }

  function place(car) {
    if (car.axis === 'z') {
      car.x = ROADS[car.road] + car.off;
      car.z = car.pos;
      car.yaw = car.dir > 0 ? 0 : Math.PI;
    } else {
      car.x = car.pos;
      car.z = ROADS[car.road] + car.off;
      car.yaw = car.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.yaw;
  }

  // Junction the car is about to cross, or -1.
  function junctionAhead(car, from) {
    let idx = -1;
    if (car.dir > 0) {
      for (let i = 0; i < ROADS.length; i++) if (ROADS[i] > from + 0.5) { idx = i; break; }
    } else {
      for (let i = ROADS.length - 1; i >= 0; i--) if (ROADS[i] < from - 0.5) { idx = i; break; }
    }
    if (idx < 0) return -1;
    const r = ROADS[idx];
    return car.dir > 0 ? (car.pos >= r ? idx : -1) : (car.pos <= r ? idx : -1);
  }

  // Random turn: left, right or straight, always into a lane of the new road.
  function turn(car, j) {
    const roll = rnd();
    if (roll < 0.34) {                 // straight on
      car.pos = ROADS[j] + car.dir * 0.05;
      return;
    }
    const right = roll < 0.67;
    const newDir = car.axis === 'z'
      ? (right ? -car.dir : car.dir)
      : (right ? car.dir : -car.dir);
    const nextPos = ROADS[car.road] + car.off;
    const nextAxis = car.axis === 'z' ? 'x' : 'z';
    // The turn is refused when the lane it would enter is occupied: the car
    // carries straight on instead of landing on top of someone.
    if (!laneClear(nextAxis, j, newDir, nextPos, 14, 14, car)) {
      car.pos = ROADS[j] + car.dir * 0.05;
      return;
    }
    // Same for a pedestrian already on the crossing this turn would sweep.
    const peds = G.peds;
    if (peds && Array.isArray(peds.peds)) {
      const ex = nextAxis === 'x' ? nextPos : ROADS[j];
      const ez = nextAxis === 'x' ? ROADS[j] : nextPos;
      for (const ped of peds.peds) {
        if (!ped.crossing) continue;
        if (Math.abs(ped.x - ex) < 9 && Math.abs(ped.z - ez) < 9) {
          car.pos = ROADS[j] + car.dir * 0.05;
          return;
        }
      }
    }
    car.axis = nextAxis;
    car.road = j;
    car.pos = nextPos;
    car.dir = newDir;
    car.off = 0;                       // leaving the junction on its centreline
    car.targetOff = laneOff(car.axis, newDir);
  }

  for (let i = 0; i < COUNT; i++) {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, bodyMats[i % bodyMats.length]);
    body.position.y = 0.62;
    body.castShadow = true;
    const cabin = new THREE.Mesh(cabinGeo, cabinMat);
    cabin.position.set(0, 1.16, -0.25);
    cabin.castShadow = true;
    mesh.add(body, cabin);

    const wheels = [];
    for (const [wx, wz] of [[-0.94, 1.4], [0.94, 1.4], [-0.94, -1.4], [0.94, -1.4]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, 0.34, wz);
      mesh.add(wheel);
      wheels.push(wheel);
    }
    for (const lx of [-0.62, 0.62]) {
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(lx, 0.68, CAR_LENGTH / 2 - 0.02);
      mesh.add(lamp);
    }
    group.add(mesh);

    const car = {
      mesh, wheels, axis: 'z', road: 0, dir: 1, pos: 0, off: -LANE, targetOff: -LANE,
      speed: MIN_SPEED, maxSpeed: MIN_SPEED, gap: null, stuck: 0, x: 0, z: 0, yaw: 0,
    };
    spawn(car);
    place(car);
    cars.push(car);
  }

  function update(dt) {
    // Car ahead in the same lane: sort each lane once per frame.
    const lanes = new Map();
    for (const car of cars) {
      car.gap = null;
      const key = car.axis + car.road + (car.dir > 0 ? '+' : '-');
      let bucket = lanes.get(key);
      if (!bucket) {
        bucket = [];
        lanes.set(key, bucket);
      }
      bucket.push(car);
    }
    for (const bucket of lanes.values()) {
      if (bucket.length < 2) continue;
      bucket.sort((a, b) => (a.pos - b.pos) * a.dir);
      for (let i = 0; i < bucket.length - 1; i++) {
        bucket[i].gap = (bucket[i + 1].pos - bucket[i].pos) * bucket[i].dir - CAR_LENGTH;
      }
    }

    const peds = G.peds;
    for (const car of cars) {
      let target = car.maxSpeed;
      if (car.gap !== null) {
        if (car.gap < GAP) target = 0;
        else if (car.gap < 22) target = Math.min(target, 2 + (car.gap - GAP) * 1.1);
      }
      // Stop for a pedestrian on the crosswalk this car is about to reach: on
      // this lane (not the far side of the junction) and inside braking range.
      // The lane window covers both kerbs of the crossing (7 m half road plus
      // 3.5 m of pavement); at 9 m a car clipped a ped standing on the far kerb.
      if (peds && Array.isArray(peds.peds)) {
        const look = 5 + car.speed * 1.7;
        const lane = ROAD / 2 + 3.5;
        for (const ped of peds.peds) {
          if (!ped.crossing) continue;
          const fwd = car.axis === 'z' ? (ped.z - car.pos) * car.dir : (ped.x - car.pos) * car.dir;
          if (fwd < -2 || fwd > look) continue;
          const lat = car.axis === 'z' ? ped.x - car.x : ped.z - car.z;
          if (Math.abs(lat) > lane) continue;
          target = 0;
          break;
        }
      }

      const delta = target - car.speed;
      const limit = (delta > 0 ? ACCEL : BRAKE) * dt;
      car.speed = Math.max(0, car.speed + Math.max(-limit, Math.min(limit, delta)));
      // Only a car that is genuinely held up counts as stuck: a stopped car
      // accelerating from zero must keep its first 0.075 m/s step.
      if (car.speed === 0 && target === 0) car.stuck += dt;
      else car.stuck = 0;
      if (car.stuck > 22) {           // deadlock guard
        spawn(car);
        place(car);
        continue;
      }

      if (car.off !== car.targetOff) {
        const diff = car.targetOff - car.off;
        car.off += Math.sign(diff) * Math.min(Math.abs(diff), 9 * dt);
      }

      const before = car.pos;
      car.pos += car.dir * car.speed * dt;
      const junction = junctionAhead(car, before);
      if (junction >= 0) turn(car, junction);

      if (car.pos > HALF + 3 || car.pos < -HALF - 3) spawn(car);

      place(car);
      const spin = (car.dir * car.speed * dt) / 0.34;
      for (const wheel of car.wheels) wheel.rotation.x += spin;
    }
  }

  return { update, cars };
}
