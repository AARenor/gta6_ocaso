import * as THREE from '../../three.module.min.js';

// combat.js: weapons, pickups, damage and respawn.
// Reads G.scene, G.camera, G.player, G.renderer.domElement (else the page canvas),
// G.peds or G.pedestrians.peds, G.police.cruisers and G.police.addWanted; all of
// them optional except the scene. Owns G.state.health (0..100), G.state.armour
// (0..100), G.state.ammo = { pistol, shotgun }, G.state.weapon, G.state.damageFlash
// and G.state.wasted. Aim is the camera centre, so no crosshair node exists.
const PISTOL = { damage: 34, rate: 0.18, pellets: 1, spread: 0, range: 90, kick: 0.05 };
const SHOTGUN = { damage: 13, rate: 0.8, pellets: 6, spread: 0.055, range: 34, kick: 0.11 };
const WEAPONS = { pistol: PISTOL, shotgun: SHOTGUN };
const AMMO_FULL = { pistol: 24, shotgun: 8 };
const LOW_HEALTH = 25, RESPAWN_SECONDS = 3, DEATH_COST = 50;
const BODY_HOLD = 4, BODY_FADE = 0.9; // seconds down before the fade starts
const DECAL_MAX = 24, PICKUP_RADIUS = 1.7;
const BEACH = { x: 0, z: 0 }; // beach spawn when the game publishes none
// Ammo and health respawns per the brief; armour reuses the health delay.
const PICKUPS = {
  ammo: { count: 6, respawn: 30, ring: 22 },
  health: { count: 3, respawn: 45, ring: 34 },
  armour: { count: 2, respawn: 50, ring: 15 },
};

export function createCombat(G) {
  const state = (G.state = G.state || {});
  const scene = G.scene, camera = G.camera;
  const player = G.player || (G.player = { x: 0, z: 0, angle: 0, speed: 0 });
  const canvas = G.renderer?.domElement || (typeof document !== 'undefined' ? document.querySelector('canvas') : null);
  Object.assign(state, {
    health: 100, armour: 0, ammo: { pistol: AMMO_FULL.pistol, shotgun: AMMO_FULL.shotgun },
    weapon: 'pistol', damageFlash: 0, cameraRecoil: 0, wasted: false });
  const group = new THREE.Group(); // everything this module owns lives under one node
  group.name = 'combat'; scene?.add(group);
  const raycaster = new THREE.Raycaster();
  const camPos = new THREE.Vector3(), camDir = new THREE.Vector3(), side = new THREE.Vector3();
  const tmp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let time = 0, cooldown = 0, respawnTimer = 0, recoil = 0, flashTimer = 0, destroyed = false;

  // Muzzle flash: one small plane in front of the camera.
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, depthWrite: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), flashMat);
  flash.position.set(0.18, -0.14, -0.55); flash.visible = false;
  if (camera) {
    if (!camera.parent) scene?.add(camera); // a camera off the graph draws no children
    camera.add(flash);
  }
  const basic = (color) => new THREE.MeshBasicMaterial({ color });
  const sparkGeo = new THREE.SphereGeometry(0.045, 4, 3);
  const sparkMats = { wall: basic(0xd8cbb0), metal: basic(0xffd05a), blood: basic(0x8d1b1b) };
  const decalGeo = new THREE.PlaneGeometry(0.3, 0.3);
  const decalMat = new THREE.MeshBasicMaterial({ color: 0x14100c, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
  const effects = [], decals = [], bodies = []; // effects {mesh,vel,age,life}, bodies {ped,age}

  const matWood = new THREE.MeshStandardMaterial({ color: 0x6d4a2a, roughness: 0.85 });
  const matLid = new THREE.MeshStandardMaterial({ color: 0xb9924a, roughness: 0.6, metalness: 0.3 });
  const matHealth = new THREE.MeshStandardMaterial({ color: 0x35d43a, emissive: 0x0f5a12, emissiveIntensity: 0.8 });
  const matArmour = new THREE.MeshStandardMaterial({ color: 0x2f7bff, emissive: 0x0a2c66, emissiveIntensity: 0.8 });
  const pickupMats = [matWood, matLid, matHealth, matArmour];
  const crates = [];
  const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);

  function makePickupMesh(kind) {
    const holder = new THREE.Group();
    if (kind === 'health') holder.add(box(0.52, 0.16, 0.16, matHealth), box(0.16, 0.52, 0.16, matHealth));
    else if (kind === 'armour') {
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.24, 4), matArmour);
      tip.position.y = -0.33; tip.rotation.set(Math.PI, Math.PI / 4, 0);
      holder.add(box(0.52, 0.44, 0.1, matArmour), tip);
    } else {
      const strip = box(0.62, 0.1, 0.62, matLid);
      strip.position.y = 0.12; holder.add(box(0.6, 0.42, 0.6, matWood), strip);
    }
    return holder;
  }

  for (const kind of ['ammo', 'health', 'armour']) {
    const cfg = PICKUPS[kind];
    for (let i = 0; i < cfg.count; i++) {
      let spot = G.city?.pickupPoints?.[kind]?.[i];
      if (!spot) { // fall back to a ring around the spawn point
        const a = (i / cfg.count) * Math.PI * 2 + 0.9;
        spot = { x: Math.cos(a) * cfg.ring, z: Math.sin(a) * cfg.ring };
      }
      const mesh = makePickupMesh(kind);
      mesh.position.set(spot.x, 1, spot.z);
      group.add(mesh);
      crates.push({ kind, mesh, x: spot.x, z: spot.z, phase: i * 1.7, active: true, timer: 0 });
    }
  }

  function collect(crate) {
    if (crate.kind === 'ammo') state.ammo = { pistol: AMMO_FULL.pistol, shotgun: AMMO_FULL.shotgun };
    else if (crate.kind === 'health') state.health = Math.min(100, state.health + 35);
    else state.armour = Math.min(100, state.armour + 50);
    crate.active = false; crate.mesh.visible = false; crate.timer = PICKUPS[crate.kind].respawn;
  }

  // Optional neighbours, every one of them guarded.
  const livePeds = () => { const src = G.peds || G.pedestrians?.peds; return Array.isArray(src) ? src : []; };
  const liveCruisers = () => { const src = G.police?.cruisers || G.police?.cars; return Array.isArray(src) ? src : []; };
  function descendsFrom(obj, ancestor) {
    for (let node = obj; node; node = node.parent) if (node === ancestor) return true;
    return false;
  }

  function shoot() { // one click, one shot, one cooldown
    if (destroyed || state.wasted) return false;
    const weapon = WEAPONS[state.weapon] || PISTOL;
    if (cooldown > 0 || !(state.ammo[state.weapon] > 0)) return false;
    state.ammo[state.weapon] -= 1; cooldown = weapon.rate; state.shots = (state.shots || 0) + 1;
    G.police?.addWanted?.(18);
    flash.visible = true; flashTimer = 0.06;
    recoil += weapon.kick; state.cameraRecoil = recoil;
    // One direct kick on the current orientation; anything that integrates its
    // own look angles can fold G.state.cameraRecoil in instead.
    if (camera) camera.rotation.x += weapon.kick;
    for (let i = 0; i < weapon.pellets; i++) firePellet(weapon);
    return true;
  }

  function firePellet(weapon) {
    if (camera) { camera.getWorldPosition(camPos); camera.getWorldDirection(camDir); }
    else { camPos.set(player.x, 1.6, player.z); camDir.set(Math.sin(player.angle || 0), 0, Math.cos(player.angle || 0)); }
    camDir.normalize(); side.crossVectors(camDir, up).normalize();
    const dir = camDir.clone();
    if (weapon.spread > 0) { // shotgun: six pellets through a narrow cone
      dir.addScaledVector(side, (Math.random() - 0.5) * weapon.spread * 2);
      dir.y += (Math.random() - 0.5) * weapon.spread * 2;
      dir.normalize();
    }
    raycaster.set(camPos, dir); raycaster.far = weapon.range;
    for (const hit of raycaster.intersectObjects(scene ? scene.children : [], true)) {
      if (descendsFrom(hit.object, group)) continue; // our own pickups and puffs
      if (camera && descendsFrom(hit.object, camera)) continue; // the muzzle flash
      resolveHit(hit, weapon);
      return;
    }
  }

  function resolveHit(hit, weapon) {
    for (let node = hit.object; node; node = node.parent) {
      for (const ped of livePeds()) if (ped.mesh === node || ped.root === node) return killPed(ped, hit.point);
      for (const car of liveCruisers()) if (car.mesh === node) return damageCar(car, hit.point, weapon);
    }
    puff(hit.point, sparkMats.wall, 5); // a wall, the road or a prop
    addDecal(hit.point, hit.face ? hit.face.normal : null);
  }

  function killPed(ped, point) { // the body stays in place to fall over and fade
    puff(point, sparkMats.blood, 6);
    if (ped.dead) return;
    ped.dead = true; ped.hp = 0;
    if (ped.speed !== undefined) ped.speed = 0;
    if (ped.speedTarget !== undefined) ped.speedTarget = 0;
    bodies.push({ ped, age: 0 });
  }

  function damageCar(car, point, weapon) {
    puff(point, sparkMats.metal, 7);
    car.hp = (typeof car.hp === 'number' ? car.hp : 100) - weapon.damage;
    if (car.hp > 0 || car.dead) return;
    car.dead = true; car.hp = 0;
    puff(point, sparkMats.metal, 14);
  }

  function puff(point, mat, count) {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(sparkGeo, mat.clone()); // cloned so it fades alone
      mesh.material.transparent = true; mesh.position.copy(point); group.add(mesh);
      effects.push({
        mesh, age: 0, life: 0.25 + Math.random() * 0.35,
        vel: new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 2.2, (Math.random() - 0.5) * 2.4),
      });
    }
  }

  function addDecal(point, normal) {
    const mesh = new THREE.Mesh(decalGeo, decalMat);
    mesh.position.copy(point);
    if (normal) { // sit just off the surface, facing away from it
      tmp.copy(normal).normalize(); mesh.position.addScaledVector(tmp, 0.02);
      mesh.lookAt(point.x + tmp.x, point.y + tmp.y, point.z + tmp.z);
    } else mesh.position.y += 0.02;
    group.add(mesh); decals.push(mesh);
    while (decals.length > DECAL_MAX) group.remove(decals.shift());
  }

  function hurt(n) {
    if (destroyed || state.wasted || !(n > 0)) return;
    let left = n;
    if (state.armour > 0) { // armour absorbs first, then health
      const absorbed = Math.min(state.armour, left);
      state.armour -= absorbed; left -= absorbed;
    }
    if (left > 0) state.health = Math.max(0, state.health - left);
    state.damageFlash = Math.min(1, state.damageFlash + 0.45);
    if (state.health <= 0) waste();
  }

  function waste() { // 3 s down, 50 cash gone, then back on the beach
    if (state.wasted) return;
    state.wasted = true; state.health = 0; state.armour = 0; state.damageFlash = 1;
    respawnTimer = RESPAWN_SECONDS;
    state.cash = Math.max(0, (state.cash || 0) - DEATH_COST); state.cashLost = DEATH_COST;
    if (state.inCar) state.inCar = null; // never respawn inside a wreck
    G.onWasted?.();
  }

  function respawn() {
    const spawn = state.beachSpawn || G.beachSpawn || BEACH;
    player.x = spawn.x; player.z = spawn.z; player.speed = 0;
    state.health = 60; state.armour = 0; state.damageFlash = 0; state.cashLost = 0;
    state.wasted = false; respawnTimer = 0;
    G.onRespawn?.();
  }

  // Input on the renderer canvas; the crosshair is implicit in the camera centre.
  const selectWeapon = (name) => { if (WEAPONS[name] && !state.wasted) state.weapon = name; };
  const onPointerDown = (event) => { if (event.button === 0) shoot(); };
  const onKeyDown = (event) => {
    if (event.code === 'Digit1' || event.code === 'Numpad1') selectWeapon('pistol');
    else if (event.code === 'Digit2' || event.code === 'Numpad2') selectWeapon('shotgun');
  };
  const previousCursor = canvas ? canvas.style.cursor : '';
  if (canvas) { canvas.style.cursor = 'crosshair'; canvas.addEventListener('pointerdown', onPointerDown); }
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);

  function updatePickups(dt) {
    for (const crate of crates) {
      if (!crate.active) {
        crate.timer -= dt;
        if (crate.timer > 0) continue;
        crate.active = true; crate.mesh.visible = true;
      }
      crate.mesh.position.y = 0.9 + Math.sin(time * 2 + crate.phase) * 0.12; // float
      crate.mesh.rotation.y += dt * 1.2;
      const dx = player.x - crate.x, dz = player.z - crate.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) collect(crate);
    }
  }

  function updateEffects(dt) {
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i];
      e.age += dt;
      if (e.age >= e.life) { group.remove(e.mesh); e.mesh.material.dispose(); effects.splice(i, 1); continue; }
      e.vel.y -= 9 * dt; e.mesh.position.addScaledVector(e.vel, dt);
      e.mesh.material.opacity = 1 - e.age / e.life;
    }
  }

  function updateBodies(dt) { // fall over, hold, then fade out and hide
    for (let i = bodies.length - 1; i >= 0; i--) {
      const body = bodies[i], mesh = body.ped.mesh;
      if (!mesh) { bodies.splice(i, 1); continue; }
      body.age += dt;
      if (body.age < 0.4) mesh.rotation.z = (body.age / 0.4) * (Math.PI / 2);
      const fade = (body.age - BODY_HOLD) / BODY_FADE;
      if (fade > 0) mesh.traverse((node) => {
        if (!node.material) return;
        node.material.transparent = true;
        node.material.opacity = Math.max(0, 1 - fade);
      });
      if (fade >= 1) { mesh.visible = false; bodies.splice(i, 1); }
    }
  }

  function update(dt) {
    if (destroyed || !(dt > 0)) return;
    const step = dt > 1 ? 1 : dt; // one long frame must not skip a whole timer
    time += step;
    if (cooldown > 0) cooldown = Math.max(0, cooldown - step);
    if (flashTimer > 0 && (flashTimer -= step) <= 0) flash.visible = false;
    recoil = Math.max(0, recoil - step * 0.55); state.cameraRecoil = recoil;
    if (state.wasted && (respawnTimer -= step) <= 0) respawn();
    updatePickups(step); updateEffects(step); updateBodies(step);
    // Red edge vignette: the hurt flash decays, low health holds a floor.
    state.damageFlash = Math.max(0, state.damageFlash - step * 0.9);
    if (!state.wasted && state.health > 0 && state.health < LOW_HEALTH) {
      state.damageFlash = Math.max(state.damageFlash, 0.3 + (1 - state.health / LOW_HEALTH) * 0.7);
    }
    state.health = Math.max(0, Math.min(100, state.health));
    state.armour = Math.max(0, Math.min(100, state.armour));
  }

  function destroy() { // listeners, scene nodes, own GPU memory
    if (destroyed) return;
    destroyed = true;
    if (canvas) { canvas.removeEventListener('pointerdown', onPointerDown); canvas.style.cursor = previousCursor; }
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown);
    for (const e of effects) { group.remove(e.mesh); e.mesh.material.dispose(); }
    effects.length = decals.length = bodies.length = 0;
    flash.parent?.remove(flash); scene?.remove(group);
    for (const geo of [flash.geometry, decalGeo, sparkGeo]) geo.dispose();
    for (const mat of [flashMat, decalMat, ...Object.values(sparkMats), ...pickupMats]) mat.dispose();
  }

  return { group, update, shoot, hurt, selectWeapon, destroy, crates, effects, bodies };
}
