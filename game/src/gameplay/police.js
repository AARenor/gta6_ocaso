// OCASO CITY - police pursuit.
// Owns the 0..5 star wanted level, the heat behind it, the 8 cruiser pool and
// the junction roadblock. Nothing else writes G.state.wanted,
// G.state.wantedHeat or G.police.
import * as THREE from '../../three.module.min.js';

// Tuning -----------------------------------------------------------------
const POOL = 8;                 // cruisers kept alive for reuse
const MAX_HEAT = 100;
const QUIET = 8;                // seconds without a crime before heat decays
const DECAY = 6;                // heat per second once quiet
const STAR_HEAT = [0, 10, 28, 48, 70, 90]; // heat needed for 1..5 stars
const STAR_KEEP = 5;            // a held star survives until heat is 5 lower
const CHASE_SPEED = [0, 22, 22, 22, 22, 26]; // metres per second
const TURN_RATE = [0, 1.4, 1.5, 1.7, 1.9, 2.2]; // radians per second
const RAM_RANGE = 2.5; const RAM_COOLDOWN = 0.7;
const STANDOFF = 6;             // metres kept off the player's bumper
const SPAWN_RANGE = 90; const FADE = 0.45; const FLASH = 0.25;
const GRID = 40;                // assumed junction spacing for the roadblock
const TAU = Math.PI * 2;
const UNIT = new THREE.BoxGeometry(1, 1, 1);
const wrap = (a) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// Paint, doors and headlights are cloned per cruiser so each one fades alone;
// the two bars are shared, so every cruiser flashes from one red/blue phase.
const mat = (o) => new THREE.MeshStandardMaterial({ transparent: true, ...o });
const paintBase = mat({ color: 0xf4f6f8, roughness: 0.55, metalness: 0.15 });
const doorBase = mat({ color: 0x1b4fd8, roughness: 0.6 });
const headBase = mat({ color: 0xfff6da, emissive: 0xfff0b8, emissiveIntensity: 1.1 });
const lampRed = mat({ color: 0xff2b2b, emissive: 0xff1414, emissiveIntensity: 0.22 });
const lampBlue = mat({ color: 0x2b6bff, emissive: 0x1440ff, emissiveIntensity: 0.22 });

// One car: white body, cabin, two blue front door panels, two headlights and a
// roof bar of two emissive boxes. Local +z is forward.
function buildCruiser() {
  const mesh = new THREE.Group();
  const paint = paintBase.clone();
  const door = doorBase.clone();
  const head = headBase.clone();
  // sx, sy, sz, x, y, z, material
  const parts = [
    [2.0, 0.85, 4.4, 0, 0.75, 0, paint],           // body
    [1.7, 0.7, 2.1, 0, 1.5, -0.1, paint],          // cabin
    [0.05, 0.42, 1.25, 1.02, 0.8, 0.95, door],     // front door panels
    [0.05, 0.42, 1.25, -1.02, 0.8, 0.95, door],
    [0.34, 0.16, 0.1, 0.62, 0.72, 2.16, head],     // headlights
    [0.34, 0.16, 0.1, -0.62, 0.72, 2.16, head],
    [0.34, 0.14, 0.16, -0.22, 1.92, -0.1, lampRed], // roof light bar
    [0.34, 0.14, 0.16, 0.22, 1.92, -0.1, lampBlue],
  ];
  for (const [sx, sy, sz, x, y, z, m] of parts) {
    const box = new THREE.Mesh(UNIT, m);
    box.scale.set(sx, sy, sz);
    box.position.set(x, y, z);
    mesh.add(box);
  }
  mesh.visible = false;
  return { mesh, mats: [paint, door, head] };
}

export function createPolice(G) {
  const state = G.state || (G.state = {});
  const group = new THREE.Group();
  if (G.scene) G.scene.add(group);
  let heat = 0;
  let wanted = 0;
  let quiet = QUIET; // time since the last crime, starts quiet
  let clock = 0;
  let blockAnchor = null;
  const cruisers = [];
  for (let i = 0; i < POOL; i += 1) {
    const { mesh, mats } = buildCruiser();
    group.add(mesh);
    cruisers.push({ mesh, mats, mode: 'chase', active: false, leaving: false, fade: 0, x: 0, z: 0, angle: 0, speed: 0, ram: 0 });
  }

  // Stars are derived from heat, never set from outside. A star already held
  // only drops once heat falls STAR_KEEP below its threshold, so a crime on a
  // boundary cannot flicker the siren.
  function derive() {
    let stars = 0;
    for (let i = 1; i <= 5; i += 1) if (heat >= STAR_HEAT[i] - (wanted >= i ? STAR_KEEP : 0)) stars = i;
    wanted = stars;
    state.wanted = wanted;
    state.wantedHeat = heat;
  }

  function playerInfo() {
    const car = state.inCar;
    if (car && typeof car.x === 'number') {
      return { x: car.x, z: car.z, a: car.angle || 0, v: Math.hypot(car.vx || 0, car.vy || 0), car };
    }
    const p = G.player || {};
    return { x: p.x || 0, z: p.z || 0, a: p.angle || 0, v: Math.abs(p.speed || 0), car: null };
  }

  function place(c, mode, x, z, angle) {
    Object.assign(c, { active: true, leaving: false, mode, fade: 0, x, z, angle, speed: 0, ram: 0 });
    c.mesh.visible = true;
    c.mesh.position.set(x, 0, z);
    c.mesh.rotation.y = angle;
    c.mesh.scale.setScalar(0.85);
  }

  const retire = (c) => { c.leaving = true; };

  // Two cruisers across the junction ahead. This module has no road graph, so
  // the point 45 m ahead is snapped to the GRID lattice and each car sits 5 m
  // either side of it, broadside to the player.
  function roadblock(p) {
    const jx = Math.round((p.x + Math.sin(p.a) * 45) / GRID) * GRID;
    const jz = Math.round((p.z + Math.cos(p.a) * 45) / GRID) * GRID;
    const rx = Math.cos(p.a);
    const rz = -Math.sin(p.a);
    return { angle: p.a + Math.PI / 2,
      points: [[jx + rx * 5, jz + rz * 5], [jx - rx * 5, jz - rz * 5]] };
  }

  // A shot fired is 18, a pedestrian hit 26, a car stolen 12, a cruiser rammed
  // 30. Callers pass those numbers straight through.
  function addWanted(points) {
    heat = Math.min(MAX_HEAT, heat + Math.max(0, points || 0));
    quiet = 0;
    derive();
  }

  function clearWanted() {
    heat = 0; wanted = 0;
    quiet = QUIET;
    blockAnchor = null;
    derive();
  }

  function update(dt) {
    dt = Math.min(dt || 0, 0.05); // one long frame must not teleport a car
    clock += dt;
    if (quiet >= QUIET) heat = Math.max(0, heat - DECAY * dt); else quiet += dt;
    derive();

    const p = playerInfo();
    const wantChase = wanted === 5 ? 6 : wanted;
    const wantBlock = wanted >= 4 ? 2 : 0;
    if (!wantBlock) blockAnchor = null;

    // Live counts only: a fading car is neither chasing nor blocking yet.
    let chase = 0; let block = 0;
    for (const c of cruisers) {
      if (!c.active || c.leaving) continue;
      if (c.mode === 'chase') chase += 1; else block += 1;
    }

    // The farthest surplus retires first: a car 90 m out is worth less than the
    // one already on his bumper.
    while (chase > wantChase) {
      const live = cruisers.filter((c) => c.active && !c.leaving && c.mode === 'chase');
      if (!live.length) break;
      retire(live.reduce((a, b) => (Math.hypot(b.x - p.x, b.z - p.z) >
        Math.hypot(a.x - p.x, a.z - p.z) ? b : a)));
      chase -= 1;
    }
    while (block > wantBlock) {
      const c = cruisers.find((k) => k.active && !k.leaving && k.mode === 'block');
      if (!c) break;
      retire(c);
      block -= 1;
    }

    // One cruiser at one star up to six at five, arriving 90 m out and already
    // facing him. Fading slots are skipped so a car is never reused early.
    for (const c of cruisers) {
      if (chase >= wantChase) break;
      if (c.active || c.fade > 0) continue;
      const a = Math.random() * TAU;
      place(c, 'chase', p.x + Math.sin(a) * SPAWN_RANGE, p.z + Math.cos(a) * SPAWN_RANGE, a + Math.PI);
      chase += 1;
    }
    if (block < wantBlock) {
      if (!blockAnchor) blockAnchor = roadblock(p);
      for (const c of cruisers) {
        if (block >= wantBlock) break;
        if (c.active || c.fade > 0) continue;
        const [bx, bz] = blockAnchor.points[block % 2];
        place(c, 'block', bx, bz, blockAnchor.angle);
        block += 1;
      }
    }

    // Shared bar phase: red on for one half period, blue for the next.
    const phase = Math.floor(clock / FLASH) % 2;
    lampRed.emissiveIntensity = chase > 0 && phase === 0 ? 2.6 : 0.22;
    lampBlue.emissiveIntensity = chase > 0 && phase === 1 ? 2.6 : 0.22;

    const cap = CHASE_SPEED[wanted] || 0;
    for (let i = 0; i < cruisers.length; i += 1) {
      const c = cruisers[i];
      if (!c.active) continue;

      // Fade in on spawn, out on retire, then park the mesh for reuse.
      const step = dt / FADE;
      c.fade = Math.min(1, Math.max(0, c.fade + (c.leaving ? -step : step)));
      c.mesh.scale.setScalar(0.85 + 0.15 * c.fade);
      for (const m of c.mats) m.opacity = c.fade;
      if (c.leaving && c.fade <= 0) {
        c.active = false;
        c.leaving = false;
        c.mesh.visible = false;
        continue;
      }
      if (c.mode === 'block' || c.fade < 1) continue; // parked or appearing

      const d = Math.hypot(p.x - c.x, p.z - c.z) || 0.001;

      // 1 to 2 stars aim straight at him. From 3 stars each cruiser owns a lane
      // 6 m behind him, offset sideways, so two never share one approach.
      let tx = p.x; let tz = p.z;
      if (wanted >= 3) {
        const side = (i % 2 ? 1 : -1) * (2.5 + Math.floor(i / 2) * 3);
        const fx = Math.sin(p.a);
        const fz = Math.cos(p.a);
        tx = p.x - fx * STANDOFF + fz * side;
        tz = p.z - fz * STANDOFF - fx * side;
        if (d < 4) { tx = p.x; tz = p.z; } // close enough to bump him
      }

      // Turn toward the target with a rate limit, so a corner is swept rather
      // than snapped to.
      const turn = wrap(Math.atan2(tx - c.x, tz - c.z) - c.angle);
      const maxTurn = TURN_RATE[wanted] * dt;
      c.angle += Math.abs(turn) > maxTurn ? Math.sign(turn) * maxTurn : turn;

      // Accelerate to the star's cap, but hold 6 m off his bumper up close.
      let target = cap;
      if (d < STANDOFF + 2 && (wanted < 3 || d >= 4)) target = Math.max(0, p.v - 1);
      if (Math.abs(turn) > 0.9) target *= 0.55; // slow into a hard turn
      c.speed += Math.max(-14 * dt, Math.min(7 * dt, target - c.speed));
      c.ram = Math.max(0, c.ram - dt);
      c.x += Math.sin(c.angle) * c.speed * dt;
      c.z += Math.cos(c.angle) * c.speed * dt;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.angle;

      // Ram damage hits the player's car only. The reverse case, him ramming a
      // cruiser, is reported by the caller as addWanted(30).
      if (d < RAM_RANGE && p.car && c.ram <= 0 && typeof p.car.hp === 'number') {
        const hit = 5 + Math.min(6, Math.max(0, c.speed - p.v)) + (wanted >= 3 ? 3 : 0);
        p.car.hp = Math.max(0, p.car.hp - hit);
        c.ram = RAM_COOLDOWN;
        c.speed *= 0.55;
      }
    }
  }

  derive();
  G.police = { cruisers, addWanted, clearWanted };
  return { group, update, cruisers, addWanted, clearWanted };
}
