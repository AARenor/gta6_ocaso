import * as THREE from '../../three.module.min.js';
import { CONFIG } from '../config.js';

export function createCity(G) {
  const { blocks: count, blockSize, roadWidth, pavement, seed } = CONFIG.city;
  const { palette } = CONFIG;
  const total = count * blockSize + (count - 1) * roadWidth;
  const half = total / 2;
  const start = -half;
  const group = new THREE.Group();
  const blocks = [];
  const paletteColours = palette.building;
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (randomState + 0x6d2b79f5) | 0;
    let value = randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const asphalt = new THREE.MeshStandardMaterial({ color: palette.asphalt, roughness: 0.96 });
  const pavementMaterial = new THREE.MeshStandardMaterial({ color: palette.pavement, roughness: 0.92 });
  const lineMaterial = new THREE.MeshStandardMaterial({ color: palette.line, roughness: 0.7 });
  const sandMaterial = new THREE.MeshStandardMaterial({ color: palette.sand, roughness: 1 });
  const seaMaterial = new THREE.MeshStandardMaterial({ color: palette.sea, roughness: 0.36, metalness: 0.08 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: palette.trim, roughness: 0.82 });
  const shopMaterial = new THREE.MeshStandardMaterial({
    color: palette.glass,
    roughness: 0.28,
    metalness: 0.08,
    emissive: palette.glass,
    emissiveIntensity: 0.08,
  });
  const plane = (width, depth, material, x, z, y = -0.12) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const box = (width, height, depth, material, x, y, z, castShadow = false) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };

  plane(total, total, asphalt, 0, 0);
  const beachDepth = 100;
  plane(total + 2, beachDepth, sandMaterial, 0, half + beachDepth / 2, -0.14);
  plane(3000, 2000, seaMaterial, 0, half + beachDepth + 1000, -0.22);

  for (let i = 0; i < count - 1; i++) {
    const roadCenter = start + blockSize + i * (blockSize + roadWidth) + roadWidth / 2;
    plane(total, roadWidth, asphalt, 0, roadCenter, -0.08);
    plane(roadWidth, total, asphalt, roadCenter, 0, -0.08);
    for (let p = -half + 4; p < half - 2; p += 8) {
      box(3.2, 0.035, 0.18, lineMaterial, p, -0.015, roadCenter);
      box(0.18, 0.035, 3.2, lineMaterial, roadCenter, -0.015, p);
    }
  }

  const stripeWidth = roadWidth / 8;
  const stripeLength = 0.48;
  for (let row = 0; row < count; row++) {
    const zCenter = start + row * (blockSize + roadWidth) + blockSize / 2;
    for (let road = 0; road < count - 1; road++) {
      const x = start + blockSize + road * (blockSize + roadWidth) + roadWidth / 2;
      for (let edge = -1; edge <= 1; edge += 2) {
        const z = zCenter + edge * (blockSize / 2 - 2.2);
        for (let stripe = 0; stripe < 6; stripe++) {
          const sx = x - roadWidth / 2 + (stripe + 0.5) * stripeWidth;
          box(stripeWidth * 0.62, 0.04, stripeLength, lineMaterial, sx, -0.005, z);
        }
      }
    }
  }
  for (let column = 0; column < count; column++) {
    const xCenter = start + column * (blockSize + roadWidth) + blockSize / 2;
    for (let road = 0; road < count - 1; road++) {
      const z = start + blockSize + road * (blockSize + roadWidth) + roadWidth / 2;
      for (let edge = -1; edge <= 1; edge += 2) {
        const x = xCenter + edge * (blockSize / 2 - 2.2);
        for (let stripe = 0; stripe < 6; stripe++) {
          const sz = z - roadWidth / 2 + (stripe + 0.5) * stripeWidth;
          box(stripeLength, 0.04, stripeWidth * 0.62, lineMaterial, x, -0.005, sz);
        }
      }
    }
  }

  const windowMatrices = [];
  const windowDummy = new THREE.Object3D();
  const addWindow = (x, y, z, width, height, depth) => {
    windowDummy.position.set(x, y, z);
    windowDummy.scale.set(width, height, depth);
    windowDummy.updateMatrix();
    windowMatrices.push(windowDummy.matrix.clone());
  };
  const buildingMaterial = (colour) => new THREE.MeshStandardMaterial({
    color: colour,
    roughness: 0.88,
    metalness: 0.02,
  });

  for (let row = 0; row < count; row++) {
    const centerZ = start + row * (blockSize + roadWidth) + blockSize / 2;
    for (let column = 0; column < count; column++) {
      const centerX = start + column * (blockSize + roadWidth) + blockSize / 2;
      plane(blockSize, blockSize, pavementMaterial, centerX, centerZ, -0.055);
      const edgeInset = blockSize / 2 - pavement / 2;
      box(blockSize, 0.12, pavement, pavementMaterial, centerX, -0.02, centerZ - edgeInset);
      box(blockSize, 0.12, pavement, pavementMaterial, centerX, -0.02, centerZ + edgeInset);
      box(pavement, 0.12, blockSize - pavement * 2, pavementMaterial, centerX - edgeInset, -0.02, centerZ);
      box(pavement, 0.12, blockSize - pavement * 2, pavementMaterial, centerX + edgeInset, -0.02, centerZ);

      const buildingCount = 1 + Math.floor(random() * 4);
      const columns = buildingCount > 2 ? 2 : 1;
      const rows = Math.ceil(buildingCount / columns);
      const slotWidth = (blockSize - pavement * 2) / columns;
      const slotDepth = (blockSize - pavement * 2) / rows;
      for (let index = 0; index < buildingCount; index++) {
        const slotColumn = index % columns;
        const slotRow = Math.floor(index / columns);
        const maxWidth = Math.min(40, slotWidth - 1.5);
        const maxDepth = Math.min(40, slotDepth - 1.5);
        const width = 8 + random() * (maxWidth - 8);
        const depth = 8 + random() * (maxDepth - 8);
        const x = centerX - (blockSize / 2 - pavement) + slotWidth * (slotColumn + 0.5);
        const z = centerZ - (blockSize / 2 - pavement) + slotDepth * (slotRow + 0.5);
        const height = 8 + random() * 32;
        const colour = paletteColours[Math.floor(random() * paletteColours.length)];
        const shops = random() > 0.42;
        const data = { x, z, w: width, d: depth, height, colours: [colour, palette.trim], shops };
        blocks.push(data);
        box(width, height, depth, buildingMaterial(colour), x, height / 2, z, true);
        box(width + 0.45, 0.48, depth + 0.45, trimMaterial, x, height - 0.24, z);

        if (shops) {
          const frontZ = z + depth / 2 + 0.11;
          box(width * 0.88, 1.75, 0.12, shopMaterial, x, 1.15, frontZ);
        }

        const floors = Math.max(2, Math.floor(height / 3.1));
        const frontWindowCount = Math.max(2, Math.floor(width / 3.4));
        const sideWindowCount = Math.max(2, Math.floor(depth / 3.4));
        for (let floor = 0; floor < floors; floor++) {
          const y = 2.15 + floor * 3.05;
          if (y > height - 1.2) break;
          for (let window = 0; window < frontWindowCount; window++) {
            const wx = x - width / 2 + (window + 0.5) * width / frontWindowCount;
            addWindow(wx, y, z + depth / 2 + 0.075, 1.25, 1.05, 0.12);
            addWindow(wx, y, z - depth / 2 - 0.075, 1.25, 1.05, 0.12);
          }
          for (let window = 0; window < sideWindowCount; window++) {
            const wz = z - depth / 2 + (window + 0.5) * depth / sideWindowCount;
            addWindow(x + width / 2 + 0.075, y, wz, 0.12, 1.05, 1.25);
            addWindow(x - width / 2 - 0.075, y, wz, 0.12, 1.05, 1.25);
          }
        }
      }
    }
  }

  const windowMaterial = new THREE.MeshStandardMaterial({
    color: palette.glass,
    roughness: 0.3,
    emissive: palette.glass,
    emissiveIntensity: 0.22,
  });
  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), windowMaterial, windowMatrices.length);
  windowMatrices.forEach((matrix, index) => windows.setMatrixAt(index, matrix));
  windows.instanceMatrix.needsUpdate = true;
  group.add(windows);

  G.world.blocks = blocks;
  G.world.size = total;
  return { group, update() {}, blocks };
}
