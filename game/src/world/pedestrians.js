// OCASO CITY: 48 pedestrians on the pavement rings, drawn with four instanced
// meshes so the whole crowd costs four draw calls.
import * as THREE from '../../three.module.min.js';
import { CONFIG } from '../config.js';

const CITY = CONFIG.city || {};
const N = CITY.blocks || 6;
const BLOCK = CITY.blockSize || 46;
const ROAD = CITY.roadWidth || 14;
const WALK = CITY.pavement || 5;
const SPAN = N * BLOCK + (N + 1) * ROAD;
const PITCH = BLOCK + ROAD;
const HALF = SPAN / 2;
const ROADS = Array.from({ length: N + 1 }, (_, i) => -HALF + ROAD / 2 + i * PITCH);
const INSET = ROAD / 2 + WALK / 2;   // pavement centreline inside each block

const COUNT = 48;
const SCARE_TIME = 2.6;
const SCARE_SPEED = 3.4;
const CROSS_SPEED = 1.55;
const CROSS_CHANCE = 0.4;
const PHASE_TIME = 26;               // seconds per crossing group phase: a 19 m
                                     // crossing at 1.55 m/s needs about 12.3 s,
                                     // and a 26 s phase leaves a 12 s window to
                                     // start one that still finishes on green
                                     // (at 18 s only 2 of 48 peds crossed in 120 s)

const PAL = CONFIG.palette || {};
const SHIRT_FALLBACK = [0xd94f4f, 0x4f7fd9, 0x3fa07a, 0xf2b13c, 0x8e5bd0, 0xe8e8e8, 0x2f4858, 0xd9784f];
const SHIRTS = (Array.isArray(PAL.shirt) && PAL.shirt.length ? PAL.shirt : SHIRT_FALLBACK)
  .map((c) => new THREE.Color(c));

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (v, per) => ((v % per) + per) % per;

function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function blockRect(bi, bj) {
  return {
    x0: ROADS[bi] + INSET, x1: ROADS[bi + 1] - INSET,
    z0: ROADS[bj] + INSET, z1: ROADS[bj + 1] - INSET,
  };
}

// Perimeter parameter s runs A(x0,z0) -> B(x1,z0) -> C(x1,z1) -> D(x0,z1).
function pointAt(rect, s) {
  const w = rect.x1 - rect.x0;
  const h = rect.z1 - rect.z0;
  let t = wrap(s, 2 * (w + h));
  if (t < w) return { x: rect.x0 + t, z: rect.z0, hx: 1, hz: 0 };
  t -= w;
  if (t < h) return { x: rect.x1, z: rect.z0 + t, hx: 0, hz: 1 };
  t -= h;
  if (t < w) return { x: rect.x1 - t, z: rect.z1, hx: -1, hz: 0 };
  t -= w;
  return { x: rect.x0, z: rect.z1 - t, hx: 0, hz: -1 };
}

function paramOf(rect, x, z) {
  const w = rect.x1 - rect.x0;
  const h = rect.z1 - rect.z0;
  const options = [
    { s: clamp(x - rect.x0, 0, w), d: Math.abs(z - rect.z0) },
    { s: w + clamp(z - rect.z0, 0, h), d: Math.abs(x - rect.x1) },
    { s: w + h + clamp(rect.x1 - x, 0, w), d: Math.abs(z - rect.z1) },
    { s: 2 * w + h + clamp(rect.z1 - z, 0, h), d: Math.abs(x - rect.x0) },
  ];
  options.sort((a, b) => a.d - b.d);
  return options[0].s;
}

function nearestLoopPoint(rect, x, z) {
  return pointAt(rect, paramOf(rect, x, z));
}

function distToCorner(s, dir, corners, per) {
  let best = per;
  for (const c of corners) {
    let d = dir > 0 ? c - s : s - c;
    if (d < 0) d += per;
    if (d < best) best = d;
  }
  return best;
}

export function createPedestrians(G) {
  const rnd = mulberry32((CITY.seed ?? 7) * 104729 + 7);
  const group = new THREE.Group();
  group.name = 'peds';
  G.scene.add(group);

  // Torso colour varies per instance, everything else is one shared material.
  const torsoGeo = new THREE.BoxGeometry(0.46, 0.62, 0.26);
  const headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
  const legGeo = new THREE.BoxGeometry(0.17, 0.9, 0.19);
  legGeo.translate(0, -0.45, 0);       // pivot at the hip

  const torsoMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xdcae8a, roughness: 0.8 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x454b58, roughness: 0.9 });

  const torso = new THREE.InstancedMesh(torsoGeo, torsoMat, COUNT);
  const head = new THREE.InstancedMesh(headGeo, headMat, COUNT);
  const legL = new THREE.InstancedMesh(legGeo, legMat, COUNT);
  const legR = new THREE.InstancedMesh(legGeo, legMat, COUNT);
  const dressed = SHIRTS.length ? SHIRTS : [new THREE.Color(0xb0b6bd)];
  for (const mesh of [torso, head, legL, legR]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  torso.castShadow = true;
  legL.castShadow = true;
  legR.castShadow = true;
  for (let i = 0; i < COUNT; i++) torso.setColorAt(i, dressed[i % dressed.length]);
  torso.instanceColor.needsUpdate = true;

  const dummy = new THREE.Object3D();
  dummy.rotation.order = 'YXZ';

  const peds = [];
  for (let i = 0; i < COUNT; i++) {
    const bi = Math.floor(rnd() * N);
    const bj = Math.floor(rnd() * N);
    const rect = blockRect(bi, bj);
    const per = 2 * ((rect.x1 - rect.x0) + (rect.z1 - rect.z0));
    const ped = {
      block: [bi, bj], rect,
      s: rnd() * per,
      dir: rnd() < 0.5 ? 1 : -1,
      speed: 1.2 + rnd() * 0.4,
      phase: rnd() * Math.PI * 2,
      x: 0, z: 0, hx: 0, hz: 1,
      mode: 'walk', crossing: false, cross: null,
      scare: 0, scareX: 0, scareZ: 1, tx: 0, tz: 0, cd: 0,
    };
    const pt = pointAt(rect, ped.s);
    ped.x = pt.x;
    ped.z = pt.z;
    ped.hx = pt.hx * ped.dir;
    ped.hz = pt.hz * ped.dir;
    peds.push(ped);
  }

  // Crossing groups: only one road axis is crossable at a time.
  const green = { x: true, z: false };
  let phase = 0;
  let shots = typeof G.state?.shots === 'number' ? G.state.shots : 0;

  function playerPoint() {
    const p = G.player;
    if (p && typeof p.x === 'number') return p;
    const car = G.state?.inCar;
    if (car && typeof car.x === 'number') return car;
    return null;
  }

  function scareAt(x, z, radius) {
    const r2 = radius * radius;
    for (const ped of peds) {
      const dx = ped.x - x;
      const dz = ped.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) || 1;
      ped.scareX = dx / d;
      ped.scareZ = dz / d;
      ped.scare = SCARE_TIME;
      ped.crossing = false;
      ped.cross = null;
      ped.mode = 'flee';
    }
  }

  function fire() {
    const p = playerPoint();
    if (!p) return;
    scareAt(p.x, p.z, 22);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', fire);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' || e.key === 'f' || e.key === 'F') fire();
    });
  }

  function carNear(ax, az, bx, bz) {
    const cars = G.traffic ? G.traffic.cars : null;
    if (!cars) return false;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    for (const car of cars) {
      if (typeof car.x !== 'number') continue;
      const dx = car.x - mx;
      const dz = car.z - mz;
      if (dx * dx + dz * dz < 225) return true;
    }
    return false;
  }

  function carScare(ped) {
    const cars = G.traffic ? G.traffic.cars : null;
    if (!cars) return;
    for (const car of cars) {
      const dx = ped.x - car.x;
      const dz = ped.z - car.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 16 || d2 < 1e-4) continue;
      const d = Math.sqrt(d2);
      ped.scareX = dx / d;
      ped.scareZ = dz / d;
      ped.scare = SCARE_TIME * 0.7;
      ped.crossing = false;
      ped.cross = null;
      ped.mode = 'flee';
      return;
    }
  }

  function tryCross(ped) {
    if (ped.cd > 0) return false;
    const rect = ped.rect;
    const [bi, bj] = ped.block;
    const nearW = Math.abs(ped.x - rect.x0) < 0.6;
    const nearE = Math.abs(ped.x - rect.x1) < 0.6;
    const nearN = Math.abs(ped.z - rect.z0) < 0.6;
    const nearS = Math.abs(ped.z - rect.z1) < 0.6;
    const options = [];
    if (nearW && bi > 0) options.push({ axis: 'z', block: [bi - 1, bj], x: blockRect(bi - 1, bj).x1, z: ped.z });
    if (nearE && bi < N - 1) options.push({ axis: 'z', block: [bi + 1, bj], x: blockRect(bi + 1, bj).x0, z: ped.z });
    if (nearN && bj > 0) options.push({ axis: 'x', block: [bi, bj - 1], x: ped.x, z: blockRect(bi, bj - 1).z1 });
    if (nearS && bj < N - 1) options.push({ axis: 'x', block: [bi, bj + 1], x: ped.x, z: blockRect(bi, bj + 1).z0 });
    if (!options.length || rnd() > CROSS_CHANCE) return false;
    const opt = options[Math.floor(rnd() * options.length)];
    if (!green[opt.axis]) return false;
    if (carNear(ped.x, ped.z, opt.x, opt.z)) return false;
    const dist = Math.hypot(opt.x - ped.x, opt.z - ped.z);
    if (dist < 1) return false;
    // A crossing takes dist/CROSS_SPEED seconds, and the pavement-to-pavement
    // span is 19 m, about 12 s. Only start one that finishes inside the phase
    // still running: with a 9 s phase every crossing began on green and ended
    // on red, which is what let cars and walkers share a junction.
    const dur = dist / CROSS_SPEED;
    if (PHASE_TIME - phase < dur + 1) return false;
    ped.mode = 'cross';
    ped.crossing = true;
    ped.cross = {
      ax: ped.x, az: ped.z, bx: opt.x, bz: opt.z,
      hx: (opt.x - ped.x) / dist, hz: (opt.z - ped.z) / dist,
      t: 0, dur, block: opt.block,
    };
    return true;
  }

  function arrive(ped) {
    ped.block = ped.cross.block;
    ped.rect = blockRect(ped.block[0], ped.block[1]);
    ped.s = paramOf(ped.rect, ped.cross.bx, ped.cross.bz);
    ped.cross = null;
    ped.crossing = false;
    ped.mode = 'walk';
    ped.cd = 6;
  }

  function walk(ped, dt) {
    const rect = ped.rect;
    const w = rect.x1 - rect.x0;
    const h = rect.z1 - rect.z0;
    const per = 2 * (w + h);
    const corners = [0, w, w + h, 2 * w + h];
    let remaining = ped.speed * dt;
    let guard = 0;
    ped.s = wrap(ped.s, per);
    while (remaining > 1e-4 && guard++ < 6) {
      const dist = distToCorner(ped.s, ped.dir, corners, per);
      if (dist > remaining) {
        ped.s = wrap(ped.s + ped.dir * remaining, per);
        remaining = 0;
        break;
      }
      ped.s = wrap(ped.s + ped.dir * dist, per);
      remaining -= dist;
      if (tryCross(ped)) return;        // corner taken, the ped leaves the ring
      ped.s = wrap(ped.s + ped.dir * 0.4, per);
      remaining -= 0.4;
    }
    const pt = pointAt(rect, ped.s);
    ped.x = pt.x;
    ped.z = pt.z;
    ped.hx = pt.hx * ped.dir;
    ped.hz = pt.hz * ped.dir;
    ped.phase += dt * ped.speed * 3.4;
  }

  function step(ped, dt) {
    if (ped.cd > 0) ped.cd -= dt;

    if (ped.scare > 0) {
      ped.scare -= dt;
      ped.x = clamp(ped.x + ped.scareX * SCARE_SPEED * dt, -HALF + 4, HALF - 4);
      ped.z = clamp(ped.z + ped.scareZ * SCARE_SPEED * dt, -HALF + 4, HALF - 4);
      ped.hx = ped.scareX;
      ped.hz = ped.scareZ;
      ped.phase += dt * 11;
      if (ped.scare <= 0) {
        const home = nearestLoopPoint(ped.rect, ped.x, ped.z);
        ped.tx = home.x;
        ped.tz = home.z;
        ped.mode = 'return';
      }
      return;
    }

    if (ped.mode === 'return') {
      const dx = ped.tx - ped.x;
      const dz = ped.tz - ped.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.35) {
        ped.s = paramOf(ped.rect, ped.tx, ped.tz);
        ped.mode = 'walk';
      } else {
        const advance = Math.min(d, ped.speed * dt);
        ped.x += (dx / d) * advance;
        ped.z += (dz / d) * advance;
        ped.hx = dx / d;
        ped.hz = dz / d;
        ped.phase += dt * 7;
      }
      return;
    }

    if (ped.mode === 'cross') {
      const c = ped.cross;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      ped.x = c.ax + (c.bx - c.ax) * k;
      ped.z = c.az + (c.bz - c.az) * k;
      ped.hx = c.hx;
      ped.hz = c.hz;
      ped.phase += dt * 10;
      if (k >= 1) arrive(ped);
      return;
    }

    carScare(ped);
    if (ped.scare > 0) return;
    walk(ped, dt);
  }

  function writeInstances() {
    const hip = 0.92;
    const hipSide = 0.12;
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      const yaw = Math.atan2(ped.hx, ped.hz);
      const stride = Math.sin(ped.phase) * 0.55;
      const bob = Math.abs(Math.cos(ped.phase)) * 0.03;

      dummy.rotation.set(0, yaw, 0);
      dummy.position.set(ped.x, 1.2 + bob, ped.z);
      dummy.updateMatrix();
      torso.setMatrixAt(i, dummy.matrix);

      dummy.position.set(ped.x, 1.68 + bob, ped.z);
      dummy.updateMatrix();
      head.setMatrixAt(i, dummy.matrix);

      const ox = Math.cos(yaw) * hipSide;
      const oz = -Math.sin(yaw) * hipSide;
      for (const [mesh, side, swing] of [[legL, -1, 1], [legR, 1, -1]]) {
        dummy.position.set(ped.x + ox * side, hip + bob, ped.z + oz * side);
        dummy.rotation.set(stride * swing, yaw, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    for (const mesh of [torso, head, legL, legR]) mesh.instanceMatrix.needsUpdate = true;
  }

  function isCrossing(x, z, r) {
    const r2 = r * r;
    for (const ped of peds) {
      if (!ped.crossing) continue;
      const dx = ped.x - x;
      const dz = ped.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  function update(dt) {
    phase += dt;
    if (phase >= PHASE_TIME) {
      phase -= PHASE_TIME;
      green.x = !green.x;
      green.z = !green.z;
    }
    if (typeof G.state?.shots === 'number' && G.state.shots !== shots) {
      shots = G.state.shots;
      fire();
    }
    for (const ped of peds) step(ped, dt);
    writeInstances();
  }

  return { update, peds, isCrossing, crossingGreen: green };
}
