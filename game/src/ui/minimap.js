// OCASO CITY: bottom-left minimap. A 190 px canvas that redraws the city around the
// player every frame straight from G: the grid from G.world, actors from live arrays.
import * as THREE from '../../three.module.min.js';

// The only three.js use here: keeping dots and the mission diamond on canvas.
const { clamp } = THREE.MathUtils;

const SIZE = 190;      // canvas edge, CSS px
const MARGIN = 18;     // distance from the screen edges, px
const VIEW = 140;      // metres of city across the canvas
const K = SIZE / VIEW; // px per metre
const EMPTY = [];

const CREAM = '#f4e7c8';
const SEA = '#16405f';
const SAND = '#d8c08a';
const ROAD = '#6f6a60';
const BUILDING = '#4b4842';
const TRAFFIC = '#f2f2ee';
const PED = '#9a978f';
const GOLD = '#f2c14e';
const BLUE = '#3b7bff';
const RED = '#ff3b30';

// The grid city is built around the origin. A world that starts elsewhere can
// pass minX/minZ and the map follows it instead of guessing.
function boundsOf(world) {
  const list = Array.isArray(world.blocks) ? world.blocks : null;
  const blocks = typeof world.blocks === 'number' ? world.blocks
    : list ? Math.max(1, Math.round(Math.sqrt(list.length))) : 6;
  const blockSize = world.blockSize ?? list?.[0]?.w ?? 46;
  const step = list && list.length > 1 ? Math.abs(list[1].x - list[0].x) : 0;
  const roadWidth = world.roadWidth ?? (step > blockSize ? step - blockSize : 14);
  const span = blocks * blockSize + (blocks + 1) * roadWidth;
  const minX = world.minX ?? (list ? list[0].x - blockSize / 2 - roadWidth : -span / 2);
  const minZ = world.minZ ?? (list
    ? list.reduce((m, b) => Math.min(m, b.z), Infinity) - blockSize / 2 - roadWidth
    : -span / 2);
  return { blocks, blockSize, roadWidth, minX, minZ, maxZ: minZ + span, pitch: blockSize + roadWidth };
}

// Systems expose their actors either as a plain array or under a named list.
function asList(value, keys) {
  if (Array.isArray(value)) return value;
  if (!value) return EMPTY;
  for (let i = 0; i < keys.length; i++) {
    if (Array.isArray(value[keys[i]])) return value[keys[i]];
  }
  return EMPTY;
}

// Every actor carries a flat { x, z } body; some only expose a three.js object.
function xyOf(actor) {
  if (!actor) return null;
  if (typeof actor.x === 'number' && typeof actor.z === 'number') return actor;
  const p = actor.mesh?.position ?? actor.group?.position ?? actor.object?.position;
  return p && typeof p.x === 'number' && typeof p.z === 'number' ? p : null;
}

function isPolice(a) {
  return a.police === true || a.isPolice === true || a.kind === 'police' ||
    a.type === 'police' || a.role === 'police';
}

function dot(ctx, x, y, colour, radius, glow) {
  ctx.fillStyle = colour;
  if (glow > 0) {
    ctx.globalAlpha = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

// One actor dot, skipped when it falls outside the canvas.
function blip(ctx, actor, sx, sz, colour, radius, glow) {
  const p = xyOf(actor);
  if (!p) return;
  const x = sx(p.x), y = sz(p.z);
  if (x < -5 || y < -5 || x > SIZE + 5 || y > SIZE + 5) return;
  dot(ctx, x, y, colour, radius, glow);
}

function clipMap(ctx) {
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(1, 1, SIZE - 2, SIZE - 2, 4) : ctx.rect(1, 1, SIZE - 2, SIZE - 2);
  ctx.clip();
}

// Sea and beach sit outside the grid, past one edge. G.world.seaZ or
// G.world.seaEdge picks that edge; the default is the far -z side.
function drawSea(ctx, world, sz) {
  const dir = world.seaEdge === 1 ? 1 : -1;
  const shore = world.seaZ ?? (dir === 1 ? world.maxZ : world.minZ);
  const water = sz(shore + dir * 18);
  const deep = sz(shore + dir * 420);
  ctx.fillStyle = SEA;
  ctx.fillRect(-4, Math.min(water, deep), SIZE + 8, Math.abs(deep - water));
  ctx.fillStyle = SAND;
  ctx.fillRect(-4, Math.min(sz(shore), water), SIZE + 8, Math.abs(water - sz(shore)));
}

// Road centre lines: blocks + 1 of them per axis, 1.5 px wide.
function drawRoads(ctx, world, sx, sz) {
  ctx.strokeStyle = ROAD;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= world.blocks; i++) {
    const cx = sx(world.minX + world.roadWidth / 2 + i * world.pitch);
    const cy = sz(world.minZ + world.roadWidth / 2 + i * world.pitch);
    if (cx > -2 && cx < SIZE + 2) { ctx.moveTo(cx, -2); ctx.lineTo(cx, SIZE + 2); }
    if (cy > -2 && cy < SIZE + 2) { ctx.moveTo(-2, cy); ctx.lineTo(SIZE + 2, cy); }
  }
  ctx.stroke();
}

// Four lots per block, with a 2 m setback and a 2 m alley, so the map shows the
// block rhythm the streets are built on without reading the city meshes.
function drawBuildings(ctx, world, sx, sz) {
  const lot = Math.max(4, (world.blockSize - 6) / 2);
  const w = lot * K;
  ctx.fillStyle = BUILDING;
  for (let i = 0; i < world.blocks; i++) {
    for (let j = 0; j < world.blocks; j++) {
      const bx = world.minX + world.roadWidth + i * world.pitch + 2;
      const bz = world.minZ + world.roadWidth + j * world.pitch + 2;
      for (let n = 0; n < 4; n++) {
        const x = sx(bx + (n & 1) * (lot + 2));
        const y = sz(bz + (n >> 1) * (lot + 2));
        if (x > SIZE || y > SIZE || x + w < 0 || y + w < 0) continue;
        ctx.fillRect(x, y, w, w);
      }
    }
  }
}

// Cruisers flash red and blue at 3 Hz, traffic is white, the crowd grey.
function drawActors(ctx, G, sx, sz, t) {
  const light = Math.floor(t * 6) % 2 === 0 ? RED : BLUE;
  const cars = asList(G.cars, ['cars']);
  const cops = asList(G.police, ['cars', 'units', 'list']);
  const peds = asList(G.peds, ['agents', 'list', 'peds', 'people']);
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if (!car || car.driver === 'player') continue; // the player arrow covers him
    if (isPolice(car)) blip(ctx, car, sx, sz, light, 1.7, 0.5);
    else blip(ctx, car, sx, sz, TRAFFIC, 1.5, 0.3);
  }
  for (let i = 0; i < cops.length; i++) blip(ctx, cops[i], sx, sz, light, 1.7, 0.5);
  for (let i = 0; i < peds.length; i++) blip(ctx, peds[i], sx, sz, PED, 1, 0);
}

// A mission may publish its marker as a target object, a mesh or flat x/z.
function markerOf(m) {
  if (!m || m.done === true || m.active === false) return null;
  const p = xyOf(m.marker ?? m.target ?? m.point ?? m);
  return p ? { x: p.x, z: p.z } : null;
}

function nearestMarker(G, px, pz) {
  const list = asList(G.missions, ['missions', 'list', 'markers']);
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    const p = markerOf(list[i]);
    if (!p) continue;
    const d = (p.x - px) * (p.x - px) + (p.z - pz) * (p.z - pz);
    if (d < bestD) { bestD = d; best = p; }
  }
  const direct = xyOf(G.state?.missionTarget);
  return best ?? (direct ? { x: direct.x, z: direct.z } : null);
}

function drawMarker(ctx, G, sx, sz, px, pz) {
  const m = nearestMarker(G, px, pz);
  if (!m) return;
  ctx.save();
  ctx.translate(clamp(sx(m.x), 6, SIZE - 6), clamp(sz(m.z), 6, SIZE - 6));
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = GOLD;
  ctx.fillRect(-4, -4, 8, 8);
  ctx.strokeStyle = 'rgba(20,22,26,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-4, -4, 8, 8);
  ctx.restore();
}

// Player heading is (sin a, cos a) in world x/z and the map's +y is world +z.
// The view cone fades out with distance, the arrow rides on top of it.
function drawPlayer(ctx, angle) {
  const c = SIZE / 2;
  const ha = Math.atan2(Math.cos(angle), Math.sin(angle));
  const cone = ctx.createRadialGradient(c, c, 2, c, c, 34);
  cone.addColorStop(0, 'rgba(255,248,226,0.28)');
  cone.addColorStop(1, 'rgba(255,248,226,0)');
  ctx.fillStyle = cone;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.arc(c, c, 34, ha - 0.6, ha + 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(-angle); // puts the apex at +y onto the heading above
  ctx.beginPath();
  ctx.moveTo(0, 7); ctx.lineTo(-5, -5); ctx.lineTo(0, -2); ctx.lineTo(5, -5);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(16,18,22,0.85)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

export function createMinimap(G) {
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(SIZE * dpr); canvas.height = Math.round(SIZE * dpr);
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'fixed', left: `${MARGIN}px`, bottom: `${MARGIN}px`,
    width: `${SIZE}px`, height: `${SIZE}px`, borderRadius: '6px',
    border: `2px solid ${CREAM}`, background: 'rgba(13,15,19,0.72)',
    boxShadow: '0 8px 20px rgba(0,0,0,0.35)', pointerEvents: 'none', zIndex: '9',
  });
  (document.body ?? document.documentElement).append(canvas);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineJoin = 'round';
  let t = 0; // seconds, drives the cruiser flash

  function update(dt) {
    t += dt > 0 ? dt : 0;
    const world = boundsOf(G.world ?? {});
    const body = xyOf(G.player);
    const px = body ? body.x : 0;
    const pz = body ? body.z : 0;
    const angle = typeof G.player?.angle === 'number' ? G.player.angle : 0;
    // world to canvas; the player sits at the centre, so only the offset moves
    const sx = (x) => SIZE / 2 + (x - px) * K;
    const sz = (z) => SIZE / 2 + (z - pz) * K;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    clipMap(ctx);
    drawSea(ctx, world, sz);
    drawRoads(ctx, world, sx, sz);
    drawBuildings(ctx, world, sx, sz);
    drawActors(ctx, G, sx, sz, t);
    drawMarker(ctx, G, sx, sz, px, pz);
    drawPlayer(ctx, angle);
    ctx.restore();
  }

  return { canvas, update };
}
