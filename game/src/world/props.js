import * as THREE from '../../three.module.min.js';
import { CONFIG } from '../config.js';

// Street furniture, neon and beach. Everything here is instanced or shares one
// geometry and material, so the whole layer costs a handful of draw calls.
// Layout constants are the same ones city.js builds the grid from.
const CITY = CONFIG.city || {};
const N = CITY.blocks || 6;
const BLOCK = CITY.blockSize || 46;
const ROAD = CITY.roadWidth || 14;
const SPAN = N * BLOCK + (N + 1) * ROAD;
const PITCH = BLOCK + ROAD;
const WALK = 5;
const BEACH = 40;
const SEED = CITY.seed ?? 20261118;
const FACADE_R = BLOCK / 2 - WALK; // 18 m: a block's shopfront face
const EDGE = SPAN / 2;             // 187 m: city edge, start of the sand

const PAL = CONFIG.palette || {};
const PALM = PAL.palm ?? '#3f7d43';
const STONE = PAL.stone ?? '#8b8579';
const SEA = PAL.sea ?? '#1e5f80';
const TRIM = PAL.trim ?? '#3c4046';
const NEON = Array.isArray(PAL.neon) ? PAL.neon
  : [PAL.neon ?? '#ff4fa3', '#4fe3ff', '#ffd34a'];
const AWNING = Array.isArray(PAL.awning) ? PAL.awning
  : [PAL.awningA ?? '#8c3b2b', PAL.awningB ?? '#ded3bd'];

const FACES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NAMES = ['CASA LUZ', 'MUELLE 9', 'SOL Y SAL', 'BAR OCASO', 'HOTEL MAREA',
  'TALLER RIO', 'LUNAS', 'PUERTO VIEJO', 'EL FARO', 'DORADA', 'SIRENA', 'NORTE'];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A unit box pinched at +Y and grown from the origin, tinted palm at the base
// and dark at the tip: one geometry, no second material for the tip.
function taperedFrond(base, tip) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c0 = new THREE.Color(base);
  const c1 = new THREE.Color(tip);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0) {
      pos.setX(i, pos.getX(i) * 0.18);
      pos.setZ(i, pos.getZ(i) * 0.4);
    }
    c.copy(c0).lerp(c1, y + 0.5);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  pos.needsUpdate = true;
  geo.translate(0, 0.5, 0);
  geo.computeVertexNormals();
  return geo;
}

function neonTexture(name, ink) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = '#120a18';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = ink;
  g.lineWidth = 3;
  g.strokeRect(5, 5, 246, 86);
  let px = 40;
  g.font = `bold ${px}px sans-serif`;
  while (px > 16 && g.measureText(name).width > 224) {
    px -= 2;
    g.font = `bold ${px}px sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = ink;
  g.shadowBlur = 20;
  g.fillStyle = ink;
  g.fillText(name, 128, 50);
  g.shadowBlur = 0;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createProps(G, city) {
  const group = new THREE.Group();
  group.name = 'props';
  const rnd = mulberry32(SEED + 7);
  const dummy = new THREE.Object3D();

  // Block centres, taken from the city when it reports them.
  const blocks = city && Array.isArray(city.blocks) && city.blocks.length
    ? city.blocks
    : (() => {
      const out = [];
      for (let bi = 0; bi < N; bi++) {
        for (let bj = 0; bj < N; bj++) {
          out.push({
            x: -SPAN / 2 + ROAD + BLOCK / 2 + bi * PITCH,
            z: -SPAN / 2 + ROAD + BLOCK / 2 + bj * PITCH, w: BLOCK, d: BLOCK,
          });
        }
      }
      return out;
    })();

  // ---- 1. Palms: 2 per boulevard segment, one on each road edge -------------
  // Every other segment of each of the 7 + 7 grid roads: 14 * 3 * 2 = 84 palms.
  const palms = [];
  const west = -SPAN / 2 + ROAD / 2;
  const eul = new THREE.Euler();
  for (let axis = 0; axis < 2; axis++) {
    for (let i = 0; i <= N; i++) {
      const line = west + i * PITCH;
      for (let s = 0; s < N; s += 2) {
        for (const side of [-1, 1]) {
          const u = west + s * PITCH + PITCH / 2 + (rnd() - 0.5) * 5;
          const off = side * (ROAD / 2 + 1.7);
          const rot = rnd() * Math.PI * 2;
          const q = new THREE.Quaternion().setFromEuler(eul.set(
            (rnd() - 0.5) * 0.12, rot, (rnd() - 0.5) * 0.12,
          ));
          palms.push({
            x: axis === 0 ? line + off : u,
            z: axis === 0 ? u : line + off,
            h: 7 + rnd() * 4,
            rot,
            q,
          });
        }
      }
    }
  }

  const barkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALM).multiplyScalar(0.55), roughness: 0.95,
  });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.35, 1, 7, 1);
  trunkGeo.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, palms.length);
  palms.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z);
    dummy.quaternion.copy(p.q);
    dummy.scale.set(1, p.h, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
  });
  trunks.frustumCulled = false;
  group.add(trunks);

  const frondMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
  });
  const FRONDS = 8;
  const fronds = new THREE.InstancedMesh(
    taperedFrond(PALM, '#1d3d22'), frondMat, palms.length * FRONDS,
  );
  const AXIS_Y = new THREE.Vector3(0, 1, 0);
  const AXIS_Z = new THREE.Vector3(0, 0, 1);
  const crown = new THREE.Vector3();
  const qy = new THREE.Quaternion();
  const qz = new THREE.Quaternion();
  const fq = new THREE.Quaternion();
  let fi = 0;
  for (const p of palms) {
    crown.set(0, p.h * 0.97, 0).applyQuaternion(p.q);
    crown.x += p.x; crown.z += p.z;
    for (let k = 0; k < FRONDS; k++) {
      qy.setFromAxisAngle(AXIS_Y, p.rot + k * (Math.PI / 4) + (rnd() - 0.5) * 0.3);
      qz.setFromAxisAngle(AXIS_Z, 2.05 + (rnd() - 0.5) * 0.25);
      fq.copy(p.q).multiply(qy).multiply(qz);
      dummy.position.copy(crown);
      dummy.quaternion.copy(fq);
      dummy.scale.set(0.55, 3.1 + rnd() * 0.5, 0.13);
      dummy.updateMatrix();
      fronds.setMatrixAt(fi++, dummy.matrix);
    }
  }
  fronds.frustumCulled = false;
  group.add(fronds);

  // ---- 2. Street lamps every 24 m on the pavement ---------------------------
  const lamps = [];
  for (const b of blocks) {
    for (const [nx, nz] of FACES) {
      const tx = -nz, tz = nx;
      for (const u of [-12, 12]) {
        const r = BLOCK / 2 - 1.3;
        lamps.push({
          x: b.x + nx * r + tx * u,
          z: b.z + nz * r + tz * u,
          nx, nz,
          yaw: Math.atan2(-nz, nx),
        });
      }
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.12, 6, 6);
  poleGeo.translate(0, 3, 0);
  const armGeo = new THREE.BoxGeometry(1.2, 0.1, 0.1);
  armGeo.translate(0.6, 0, 0);
  const headGeo = new THREE.BoxGeometry(0.36, 0.16, 0.6);
  const poleMat = new THREE.MeshStandardMaterial({ color: TRIM, roughness: 0.7, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({
    color: '#3a3630', emissive: '#ffd9a0', emissiveIntensity: 1.4, roughness: 0.5,
  });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length);
  const arms = new THREE.InstancedMesh(armGeo, poleMat, lamps.length);
  const heads = new THREE.InstancedMesh(headGeo, headMat, lamps.length);
  lamps.forEach((l, i) => {
    qy.setFromAxisAngle(AXIS_Y, l.yaw);
    dummy.quaternion.copy(qy);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(l.x, 0, l.z);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, 6, l.z);
    dummy.updateMatrix();
    arms.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x + l.nx * 1.2, 5.92, l.z + l.nz * 1.2);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [poles, arms, heads]) {
    m.frustumCulled = false;
    m.instanceMatrix.needsUpdate = true;
    group.add(m);
  }

  // ---- 3. Striped awnings over every block's four street faces --------------
  const stripes = [];
  for (const b of blocks) {
    for (const [nx, nz] of FACES) {
      const tx = -nz, tz = nx;
      const yaw = Math.atan2(nx, nz);
      const n = Math.floor((BLOCK - 4) / 9);
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * 3;
        stripes.push({
          x: b.x + nx * FACADE_R + tx * u,
          z: b.z + nz * FACADE_R + tz * u,
          yaw,
          even: k % 2 === 0,
        });
      }
    }
  }
  const stripeGeo = new THREE.BoxGeometry(1, 1, 1);
  stripeGeo.translate(0, 0, 0.5); // grows outward from the façade
  const qTilt = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0), 0.262,
  );
  const awningMeshes = [0, 1].map((c) => new THREE.InstancedMesh(stripeGeo,
    new THREE.MeshStandardMaterial({ color: AWNING[c % AWNING.length], roughness: 0.85 }),
    stripes.filter((s) => s.even === (c === 0)).length));
  const slot = [0, 0];
  for (const s of stripes) {
    qy.setFromAxisAngle(AXIS_Y, s.yaw);
    dummy.position.set(s.x, 3.4, s.z);
    dummy.quaternion.copy(qy).multiply(qTilt);
    dummy.scale.set(3, 0.07, 1.2);
    dummy.updateMatrix();
    const c = s.even ? 0 : 1;
    awningMeshes[c].setMatrixAt(slot[c]++, dummy.matrix);
  }
  for (const m of awningMeshes) {
    m.frustumCulled = false;
    m.instanceMatrix.needsUpdate = true;
    group.add(m);
  }

  // ---- 4. Neon signs, one block in three, 6 m up on a street face -----------
  const plateGeo = new THREE.PlaneGeometry(4, 1.4);
  blocks.filter((_, i) => i % 3 === 1).forEach((b, i) => {
    const [nx, nz] = FACES[Math.floor(rnd() * 4)];
    const ink = NEON[i % NEON.length];
    const tex = neonTexture(NAMES[i % NAMES.length], ink);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.35,
      roughness: 0.6, metalness: 0.1, toneMapped: false,
    });
    const m = new THREE.Mesh(plateGeo, mat);
    m.position.set(b.x + nx * (FACADE_R + 0.1), 6, b.z + nz * (FACADE_R + 0.1));
    m.rotation.y = Math.atan2(nx, nz);
    group.add(m);
  });

  // ---- 5. Beach: umbrellas, towels, lifeguard towers, jetty, boats ----------
  const woodMat = new THREE.MeshStandardMaterial({ color: STONE, roughness: 0.9 });
  const clothMat = new THREE.MeshStandardMaterial({
    color: AWNING[1 % AWNING.length], roughness: 0.95, side: THREE.DoubleSide,
  });
  const poleMatLight = new THREE.MeshStandardMaterial({
    color: '#f4efe2', roughness: 0.8, metalness: 0.1,
  });
  const hutMat = new THREE.MeshStandardMaterial({ color: '#f6f1e3', roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#c9452f', roughness: 0.9 });
  const towelA = new THREE.MeshStandardMaterial({ color: '#e2574c', roughness: 1 });
  const towelB = new THREE.MeshStandardMaterial({ color: '#3f8fd0', roughness: 1 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#a08b6c', roughness: 0.95 });

  const umbrellaGeo = new THREE.ConeGeometry(1.7, 0.7, 10, 1, true);
  const mPoleGeo = new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6);
  const towelGeo = new THREE.BoxGeometry(1.8, 0.04, 0.95);

  for (let i = 0; i < 8; i++) {
    const x = -150 + i * 42 + (rnd() - 0.5) * 12;
    const z = EDGE + 11 + (i % 2) * 9;
    const canopy = new THREE.Mesh(umbrellaGeo, clothMat);
    canopy.position.set(x, 2.5, z);
    canopy.rotation.y = rnd() * Math.PI;
    const pole = new THREE.Mesh(mPoleGeo, poleMatLight);
    pole.position.set(x, 1.3, z);
    group.add(canopy, pole);
    for (let k = 0; k < 2; k++) {
      const t = new THREE.Mesh(towelGeo, k ? towelA : towelB);
      t.position.set(x + (k ? 1.9 : -1.9) + (rnd() - 0.5), 0.08, z + (rnd() - 0.5) * 1.6);
      t.rotation.y = rnd() * Math.PI;
      group.add(t);
    }
  }

  const stiltGeo = new THREE.BoxGeometry(0.22, 2.2, 0.22);
  const hutGeo = new THREE.BoxGeometry(3, 2.4, 3);
  const roofGeo = new THREE.ConeGeometry(2.5, 1.1, 4);
  const rampGeo = new THREE.BoxGeometry(1.8, 0.16, 4.2);
  for (let i = 0; i < 3; i++) {
    const x = -100 + i * 100;
    const z = EDGE + 27;
    for (const sx of [-1.2, 1.2]) {
      for (const sz of [-1.2, 1.2]) {
        const st = new THREE.Mesh(stiltGeo, woodMat);
        st.position.set(x + sx, 1.1, z + sz);
        group.add(st);
      }
    }
    const hut = new THREE.Mesh(hutGeo, hutMat);
    hut.position.set(x, 3.4, z);
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, 5.2, z);
    roof.rotation.y = Math.PI / 4;
    const ramp = new THREE.Mesh(rampGeo, woodMat);
    ramp.position.set(x, 1.35, z - 3.4);
    ramp.rotation.x = -0.49;
    group.add(hut, roof, ramp);
  }

  // The sand strip is 40 m deep, so the waterline is at EDGE + BEACH.
  const jettyX = 55;
  const SHORE = EDGE + BEACH;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 30), deckMat);
  deck.position.set(jettyX, 1.05, SHORE + 14);
  group.add(deck);
  const postGeo = new THREE.CylinderGeometry(0.13, 0.13, 2.6, 6);
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, woodMat);
      post.position.set(jettyX + side * 1.1, -0.25, SHORE + 2 + i * 5.2);
      group.add(post);
    }
  }

  const boats = [];
  const hullGeo = new THREE.BoxGeometry(1.5, 0.5, 3.4);
  const wellGeo = new THREE.BoxGeometry(1.1, 0.3, 2.6);
  const wellMat = new THREE.MeshStandardMaterial({ color: SEA, roughness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(hullGeo, woodMat);
    hull.position.y = 0;
    const well = new THREE.Mesh(wellGeo, wellMat);
    well.position.y = 0.16;
    boat.add(hull, well);
    const y = 0.2;
    boat.position.set(jettyX - 14 + i * 5.6, y, SHORE + 32 + (i % 3) * 4);
    boat.rotation.y = (rnd() - 0.5) * 0.9;
    group.add(boat);
    boats.push({ mesh: boat, y, phase: rnd() * Math.PI * 2 });
  }

  // Moored boats ride the swell; the sea itself ripples in city.js.
  let t = 0;
  const update = (dt) => {
    t += dt;
    for (const b of boats) {
      b.mesh.position.y = b.y + Math.sin(t * 0.9 + b.phase) * 0.05;
      b.mesh.rotation.z = Math.sin(t * 0.7 + b.phase) * 0.04;
    }
  };

  G.scene.add(group);
  return { group, update, count: palms.length, beach: BEACH };
}
