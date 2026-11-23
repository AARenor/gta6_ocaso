import * as THREE from '../../three.module.min.js';
import { CONFIG } from '../config.js';
import { createProps } from './props.js';

// 6 blocks of 46 m with 7 roads of 14 m between them: 6*46 + 7*14 = 374 m.
const CITY = CONFIG.city || {};
const N = CITY.blocks || 6;
const BLOCK = CITY.blockSize || 46;
const ROAD = CITY.roadWidth || 14;
const SPAN = N * BLOCK + (N + 1) * ROAD;
const PITCH = BLOCK + ROAD;
const WALK = 5;   // pavement strip around each block
const GAP = 1.5;  // clearance kept between two buildings
const BEACH = 40; // sand depth past the +Z edge
const SEED = CITY.seed ?? 20261118;

const PAL = CONFIG.palette || {};
const FACADES = Array.isArray(PAL.building) ? PAL.building
  : [PAL.building ?? '#9aa0a6', '#b8ada0', '#7f868d', '#a08b78'];
const TRIM = PAL.trim ?? '#3c4046', ASPHALT = PAL.asphalt ?? '#2c2f34';
const PAVING = PAL.pavement ?? '#b9b7b0', KERB = PAL.kerb ?? '#8f8c85';
const SAND = PAL.sand ?? '#e4d6ae', STONE = PAL.stone ?? '#8b8579';
const SEA = PAL.sea ?? '#1e5f80';

// Small deterministic PRNG: one seed builds the same city every reload.
function mulberry32(a) {
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One shared canvas holds the whole façade: light wall, mortar joints, windows.
function windowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const g = canvas.getContext('2d');
  const rnd = mulberry32(SEED);
  // Light wall, then a 2 px darker mortar joint every 16 px on both axes.
  g.fillStyle = '#d9d2c4';
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = '#c6bfb0';
  for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 2, 192);
  for (let y = 0; y < 192; y += 16) g.fillRect(0, y, 128, 2);
  // 10 x 14 px windows on the 16 px grid, 70 percent dark, 30 percent lit warm,
  // each with a 2 px sill directly beneath it.
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 8; x++) {
      const lit = rnd() < 0.3;
      g.fillStyle = lit ? '#ffd79a' : '#2b3a4a';
      g.fillRect(x * 16 + 3, y * 16, 10, 14);
      g.fillStyle = '#b9b1a2';
      g.fillRect(x * 16 + 3, y * 16 + 14, 10, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Horizontal bands the sea material scrolls through to fake a slow ripple.
function rippleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = '#1d5b7a';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = y % 16 === 0 ? '#2f7a9b' : '#164a66';
    g.fillRect(0, y, 64, 4);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(20, 20);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Recursively halve a rectangle until it holds `n` plots, always leaving GAP.
function splitRect(r, n) {
  if (n <= 1) return [r];
  const n1 = Math.ceil(n / 2);
  const n2 = n - n1;
  if (r.w >= r.d) {
    const w1 = (r.w * n1) / n - GAP / 2;
    const w2 = r.w - w1 - GAP;
    return [
      ...splitRect({ x: r.x - r.w / 2 + w1 / 2, z: r.z, w: w1, d: r.d }, n1),
      ...splitRect({ x: r.x + r.w / 2 - w2 / 2, z: r.z, w: w2, d: r.d }, n2),
    ];
  }
  const d1 = (r.d * n1) / n - GAP / 2;
  const d2 = r.d - d1 - GAP;
  return [
    ...splitRect({ x: r.x, z: r.z - r.d / 2 + d1 / 2, w: r.w, d: d1 }, n1),
    ...splitRect({ x: r.x, z: r.z + r.d / 2 - d2 / 2, w: r.w, d: d2 }, n2),
  ];
}

export function createCity(G) {
  const group = new THREE.Group();
  const rnd = mulberry32(SEED);
  const dummy = new THREE.Object3D();
  const winTex = windowTexture();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 10);

  // One façade material per palette colour, all sharing the single window canvas.
  const matCache = new Map();
  const facadeMat = (col) => {
    if (!matCache.has(col)) {
      matCache.set(col, new THREE.MeshStandardMaterial({
        color: col, map: winTex, roughness: 0.85, metalness: 0.05,
      }));
    }
    return matCache.get(col);
  };
  const trimMat = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.9 });

  // Asphalt: one plane under the whole city, one draw call.
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, SPAN),
    new THREE.MeshStandardMaterial({ color: ASPHALT, roughness: 1 }));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.01;
  group.add(asphalt);

  // Pavement and its raised kerb edge: one instanced mesh each, two draw calls.
  const kerb = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK, 0.16, BLOCK),
    new THREE.MeshStandardMaterial({ color: KERB, roughness: 1 }), N * N);
  const slab = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK - 0.7, 0.12, BLOCK - 0.7),
    new THREE.MeshStandardMaterial({ color: PAVING, roughness: 1 }), N * N);
  kerb.frustumCulled = slab.frustumCulled = false;
  group.add(kerb, slab);

  // Road markings: centre dashes every 6 m plus a crosswalk on every arm.
  const marks = [];
  const west = -SPAN / 2 + ROAD / 2; // centre line of the first road
  for (let i = 0; i <= N; i++) {
    const p = west + i * PITCH;
    for (let t = -SPAN / 2 + 3; t <= SPAN / 2 - 3; t += 6) {
      marks.push([t, p, 2.4, 0.2], [p, t, 0.2, 2.4]);
    }
  }
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const cx = west + i * PITCH;
      const cz = west + j * PITCH;
      for (const s of [-1, 1]) {
        for (let k = -2; k <= 2; k++) {
          marks.push([cx + s * (ROAD / 2 + 2.5), cz + k * 2.3, 3.6, 0.9]);
          marks.push([cx + k * 2.3, cz + s * (ROAD / 2 + 2.5), 0.9, 3.6]);
        }
      }
    }
  }
  // All markings share one instanced mesh, so they cost a single draw call.
  const markMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.02, 1),
    new THREE.MeshBasicMaterial({ color: '#dedad0' }), marks.length);
  marks.forEach(([x, z, w, d], i) => {
    dummy.position.set(x, 0.03, z);
    dummy.scale.set(w, 1, d);
    dummy.updateMatrix();
    markMesh.setMatrixAt(i, dummy.matrix);
  });
  markMesh.instanceMatrix.needsUpdate = true;
  markMesh.frustumCulled = false;
  group.add(markMesh);

  // One tower: façade with scaled UVs, shopfront band, cornice, roof props.
  function buildTower(r, h, col) {
    const body = new THREE.BoxGeometry(r.w, h, r.d);
    const uv = body.attributes.uv;
    // The tile holds 8 windows across and 12 down, so one tile spans 8 * 4 = 32 m
    // and 12 * 3.6 = 43.2 m: every window comes out 4 m by 3.6 m.
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (uv.getX(i) * r.w) / 32, (uv.getY(i) * h) / 43.2);
    }
    uv.needsUpdate = true;

    const tower = new THREE.Mesh(body, facadeMat(col));
    tower.position.set(r.x, 0.12 + h / 2, r.z);
    const shop = new THREE.Mesh(unitBox, trimMat);
    shop.scale.set(r.w + 0.35, 4, r.d + 0.35);
    shop.position.set(r.x, 0.12 + 2, r.z);
    const cornice = new THREE.Mesh(unitBox, trimMat);
    cornice.scale.set(r.w + 0.8, 0.9, r.d + 0.8);
    cornice.position.set(r.x, 0.12 + h - 0.45, r.z);
    group.add(tower, shop, cornice);

    if (h <= 24) return;
    const top = 0.12 + h;
    for (let i = 0, n = 1 + Math.floor(rnd() * 2); i < n; i++) {
      const ac = new THREE.Mesh(unitBox, trimMat);
      ac.scale.set(1.4, 0.9, 1.4);
      ac.position.set(r.x + (rnd() - 0.5) * (r.w - 4), top + 0.45, r.z + (rnd() - 0.5) * (r.d - 4));
      group.add(ac);
    }
    const tank = new THREE.Mesh(tankGeo, trimMat);
    tank.scale.set(1.1, 2.4, 1.1);
    tank.position.set(r.x + (rnd() - 0.5) * (r.w - 4), top + 1.2, r.z + (rnd() - 0.5) * (r.d - 4));
    group.add(tank);
  }

  // Blocks: pavement instances plus 1 to 4 seeded towers inset by the walk.
  const blocks = [];
  let slot = 0;
  for (let bi = 0; bi < N; bi++) {
    for (let bj = 0; bj < N; bj++) {
      const cx = -SPAN / 2 + ROAD + BLOCK / 2 + bi * PITCH;
      const cz = -SPAN / 2 + ROAD + BLOCK / 2 + bj * PITCH;
      dummy.position.set(cx, 0.08, cz);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      kerb.setMatrixAt(slot, dummy.matrix);
      dummy.position.y = 0.06;
      dummy.updateMatrix();
      slab.setMatrixAt(slot, dummy.matrix);
      slot++;

      const inner = { x: cx, z: cz, w: BLOCK - 2 * WALK, d: BLOCK - 2 * WALK };
      const colours = [];
      let tallest = 0;
      for (const r of splitRect(inner, 1 + Math.floor(rnd() * 4))) {
        const h = 8 + Math.round(rnd() * 32);
        const col = FACADES[Math.floor(rnd() * FACADES.length)];
        colours.push(col);
        tallest = Math.max(tallest, h);
        buildTower(r, h, col);
      }
      blocks.push({ x: cx, z: cz, w: BLOCK, d: BLOCK, height: tallest, colours, shops: true });
    }
  }
  kerb.instanceMatrix.needsUpdate = true;
  slab.instanceMatrix.needsUpdate = true;

  // Beach along the +Z edge, open sea beyond it, stone wall at the city edge.
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, BEACH),
    new THREE.MeshStandardMaterial({ color: SAND, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.05, SPAN / 2 + BEACH / 2);
  const ripple = rippleTexture();
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 3, SPAN * 3),
    new THREE.MeshStandardMaterial({ color: SEA, map: ripple, roughness: 0.35, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, -0.02, SPAN / 2 + BEACH / 2);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 1.1, 0.6),
    new THREE.MeshStandardMaterial({ color: STONE, roughness: 1 }));
  wall.position.set(0, 0.55, SPAN / 2 + 0.3);
  group.add(sand, sea, wall);

  // Street furniture is built after the terrain, so update closes over a
  // binding that is still null on the first frame only if construction fails.
  let props = null;
  const update = (dt) => {
    ripple.offset.y = (ripple.offset.y + dt * 0.012) % 1;
    ripple.offset.x = (ripple.offset.x + dt * 0.004) % 1;
    if (props) props.update(dt);
  };

  G.world = G.world || {};
  G.world.blocks = blocks;
  G.world.size = SPAN;

  G.scene.add(group);

  // Street furniture and beach share the scene, and city.update drives them.
  const city = { group, update, blocks };
  props = createProps(G, city);
  city.props = props;

  return city;
}
