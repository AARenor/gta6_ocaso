// Poses: a named opening state for screenshots, picked from the URL.
//   ?scene=chase|street|mission|night|beach   ?shot=1
// applyPose runs once from main.js, after every system exists, and only moves
// systems that are already built, so a missing one skips, not throws. Each pose
// ends by pushing its own camera into G.systems, so it is applied after the
// player's follow camera every frame and the framing holds for the screenshot.
const NAMES = new Set(['chase', 'street', 'mission', 'night', 'beach']);

export function applyPose(G) {
  if (!G || !G.state) return null;
  const query = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  if (query.get('shot') === '1') {
    G.state.autoStart = true;
    try { G.menu?.hide?.(); } catch { /* no start menu in this build */ }
  }
  const name = query.get('scene');
  if (!NAMES.has(name)) return null;
  const g = grid(G);
  const cam = { pos: [0, 10, 20], look: [0, 2, 0], hold: null };
  if (name === 'chase') chase(G, g, cam);
  else if (name === 'street') street(G, g, cam);
  else if (name === 'mission') mission(G, g, cam);
  else if (name === 'night') night(G, g, cam);
  else beach(G, g, cam);
  G.state.pose = name;
  const place = () => {
    if (cam.hold) cam.hold();
    const [x, y, z] = cam.pos;
    const [lx, ly, lz] = cam.look;
    G.camera.position.set(x, y, z);
    G.camera.lookAt(lx, ly, lz);
  };
  place();
  G.systems.push(place);
  return name;
}

// Grid: the span the city and the minimap use. Roads sit on the grid lines,
// so axis(i) is road i's centre and the middle index is the boulevard.
function grid(G) {
  const w = G.world || {};
  const roadWidth = num(w.roadWidth, 14), blockSize = num(w.blockSize, 46);
  const blocks = num(w.blocks, 6);
  const span = num(w.size, blocks * blockSize + (blocks + 1) * roadWidth);
  const axis = (i) => -span / 2 + roadWidth / 2 + i * (blockSize + roadWidth);
  return { blocks, roadWidth, blockSize, span, axis, mid: Math.floor(blocks / 2) };
}

function num(v, d) { return Number.isFinite(v) && v > 0 ? v : d; }

// Police derives the star count from its own heat, so a pose has to feed heat
// before police.update runs; setting G.state.wanted alone is overwritten.
function holdWanted(G, heat) {
  const police = G.police;
  if (!police || typeof police.addWanted !== 'function') return;
  const keep = () => police.addWanted(heat);
  const at = G.systems.indexOf(police.update);
  G.systems.splice(at < 0 ? G.systems.length : at, 0, keep);
}

// Street: frame the busiest crowd of pedestrians, put the player in front of it
// on the road side, and shoot from the road so the pavement fills the frame.
function street(G, g, cam) {
  // A junction on the main boulevard: the player on the pavement, a crowd
  // crossing ahead, cars in both lanes and the avenue running to the sea.
  const cx = g.axis(g.mid), cz = g.axis(g.mid + 2);
  const p = G.player;
  const px = cx + 1.8, pz = cz + 4;
  if (p) { p.x = px; p.z = pz; p.angle = Math.PI; }
  const peds = (G.peds?.peds || []);
  for (let i = 0; i < Math.min(8, peds.length); i++) {
    const ped = peds[i];
    ped.x = ped.tx = cx - 3.5 + (i % 4) * 2.3;
    ped.z = ped.tz = cz - 5 - Math.floor(i / 4) * 2.4;
    ped.mode = 'return'; ped.scare = 0; ped.crossing = false; ped.cross = null;
    ped.hx = 0; ped.hz = 1;
  }
  const cars = G.traffic?.cars || [];
  cars.slice(0, 8).forEach((c, i) => {
    const lane = (i % 2 === 0 ? -1 : 1) * g.roadWidth * 0.27;
    const z = cz - 18 - Math.floor(i / 2) * 11;
    if (c.mesh) c.mesh.position.set(cx + lane, 0, z);
    c.x = cx + lane; c.z = z; c.speed = 0;
  });
  if (G.state) { G.state.wanted = 0; G.state.cash = 1240; G.state.health = 86; G.state.ammo = 17; }
  cam.pos = [cx - 1, 3.6, cz + 10];
  cam.look = [cx, 1.4, cz - 5];
  // peds and the player are moved by their own systems each frame; re-apply
  // the tableau after them so the screenshot holds still.
  cam.hold = () => {
    const p2 = G.player;
    if (p2) { p2.x = px; p2.z = pz; p2.angle = Math.PI; }
    peds.forEach((ped, i) => {
      ped.x = ped.tx = cx - 3.5 + (i % 4) * 2.3;
      ped.z = ped.tz = cz - 5 - Math.floor(i / 4) * 2.4;
      ped.mode = 'return'; ped.scare = 0; ped.crossing = false; ped.cross = null;
      ped.hx = 0; ped.hz = 1;
    });
  };
}

// Chase: the player drives up the boulevard with three cruisers behind him.
function chase(G, g, cam) {
  const car = (G.cars || []).find((c) => c.driver === 'npc') || (G.cars || [])[0];
  const x = g.axis(g.mid) - 3.5, z = g.axis(g.mid + 2);
  if (car) {
    car.x = x; car.z = z; car.angle = Math.PI; car.speed = 19; car.driver = 'player';
    if (car.mesh) { car.mesh.position.set(x, 0, z); car.mesh.rotation.y = car.angle; }
    if (G.state) G.state.inCar = car;
    if (G.player) { G.player.body?.position.set(x, 0.9, z); }
  }
  const cops = G.police?.cruisers || [];
  cops.slice(0, 3).forEach((c, i) => {
    const m = c.mesh || c.group;
    const cz = z + 8 + i * 4.5;
    const cx = x + (i === 1 ? 0 : (i === 0 ? -3.2 : 3.2));
    if (m?.position) m.position.set(cx, 0, cz);
    c.x = cx; c.z = cz; c.chasing = true; c.active = true;
  });
  if (G.state) { G.state.wanted = 3; G.state.cash = 860; G.state.ammo = 24; }
  holdWanted(G, 55);
  // Hold the tableau: the police AI would drive away from a posed screenshot.
  cam.hold = () => {
    if (car) {
      car.x = x; car.z = z; car.angle = Math.PI; car.speed = 19;
      if (car.mesh) { car.mesh.position.set(x, 0, z); car.mesh.rotation.y = Math.PI; }
    }
    cops.slice(0, 3).forEach((c, i) => {
      const m = c.mesh || c.group;
      const cx = x + (i === 1 ? 0 : (i === 0 ? -3.2 : 3.2));
      const cz = z + 8 + i * 4.5;
      if (m) { m.visible = true; m.position.set(cx, 0, cz); if (m.rotation) m.rotation.y = Math.PI; }
      c.x = cx; c.z = cz; c.active = true; c.chasing = true; c.leaving = false; c.fade = 1;
      for (const mt of (c.mats || [])) mt.opacity = 1;
      if (c.mesh) c.mesh.scale.setScalar(1);
    });
    if (G.state) G.state.wanted = 3;
  };
  cam.pos = [x, 5.2, z + 24];
  cam.look = [x, 1.3, z - 10];
}

// Mission: the brief on screen and the marker down the road.
function mission(G, g, cam) {
  G.missions?.start?.(0);
  const p = G.player?.body;
  const x = g.axis(g.mid + 3) + 8, z = g.axis(g.mid + 1) + 12;
  if (p) p.position.set(x, 0.9, z);
  if (G.state) {
    G.state.dialog = { speaker: 'RAFA', line: 'Take the Chevelle to the pier. Lose the cops.' };
    G.state.cash = 2400; G.state.health = 92; G.state.ammo = 30; G.state.wanted = 0;
  }
  const target = (G.cars || []).find((c) => c.driver === 'npc') || (G.cars || [])[0];
  (G.cars || []).forEach((c, i) => {
    if (c === target) return;
    c.x = 140; c.z = -150 + (i % 5) * 9; c.speed = 0;
    if (c.mesh) c.mesh.position.set(c.x, 0, c.z);
  });
  (G.traffic?.cars || []).forEach((c, i) => {
    c.x = 150; c.z = -150 + (i % 5) * 9; c.speed = 0;
    if (c.mesh) c.mesh.position.set(c.x, 0, c.z);
  });
  if (target) {
    target.x = x + 3; target.z = z + 1; target.angle = Math.PI / 2; target.speed = 0;
    if (target.mesh) { target.mesh.position.set(target.x, 0, target.z); target.mesh.rotation.y = target.angle; }
  }
  cam.pos = [x + 10, 4.6, z + 11];
  cam.look = [x, 1.4, z + 1];
}

// Night: the same boulevard after dark, neon on, cruisers on the prowl.
function night(G, g, cam) {
  const car = (G.cars || []).find((c) => c.driver === 'npc') || (G.cars || [])[0];
  const x = g.axis(g.mid) + 3.5, z = g.axis(g.mid + 2);
  if (car) {
    car.x = x; car.z = z; car.angle = 0; car.speed = 0; car.driver = 'player';
    if (car.mesh) { car.mesh.position.set(x, 0, z); car.mesh.rotation.y = 0; }
    if (G.state) G.state.inCar = car;
  }
  if (G.player?.body) G.player.body.position.set(x, 0.9, z);
  const cops = G.police?.cruisers || [];
  cops.slice(0, 2).forEach((c, i) => {
    const m = c.mesh || c.group;
    if (m?.position) m.position.set(x - 4 + i * 8, 0, z - 18 - i * 6);
    c.x = x - 4 + i * 8; c.z = z - 18 - i * 6; c.chasing = true; c.active = true;
  });
  if (G.state) { G.state.wanted = 4; G.state.cash = 5120; G.state.ammo = 12; }
  holdWanted(G, 80);
  cam.pos = [x + 2.5, 6.4, z + 16];
  cam.look = [x, 2.4, z - 30];
}

// Beach: the coastal road, sea on one side, the last of the sun on the other.
function beach(G, g, cam) {
  const car = (G.cars || []).find((c) => c.driver === 'npc') || (G.cars || [])[0];
  const z = g.span / 2 - 18, x = -10;
  if (car) {
    car.x = x; car.z = z; car.angle = Math.PI / 2; car.speed = 12; car.driver = 'player';
    if (car.mesh) { car.mesh.position.set(x, 0, z); car.mesh.rotation.y = car.angle; }
    if (G.state) G.state.inCar = car;
  }
  if (G.player?.body) G.player.body.position.set(x, 0.9, z);
  if (G.state) { G.state.wanted = 2; G.state.cash = 3300; }
  holdWanted(G, 32);
  cam.pos = [x - 16, 7.5, z + 6];
  cam.look = [x + 30, 3.5, z + 30];
}
