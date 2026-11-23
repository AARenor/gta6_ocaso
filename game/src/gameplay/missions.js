// OCASO CITY — missions: campaign data, world marker and step logic.
import * as THREE from '../../three.module.min.js';

const FORWARD = new THREE.Vector3(0, 0, 1); // the arrow model points along +Z
const _dir = new THREE.Vector3();
const ORIGIN = { x: 0, z: 0 };
const HOVER = 6; // diamond height above the target, metres
const REACH = 8; // reach radius for 'goto' and 'deliver'
const HIT_RANGE = 40; // fallback range at which a fired shot counts as a hit
const EVENT_HOLD = 1.5; // seconds the chime flag stays readable in G.state

// --- Campaign: one line through Ocaso, from courier runs to the Marisma war.
const MISSIONS = [
  { id: 'first_drop', title: 'First Drop', giver: 'Rafa', reward: 60,
    brief: 'Carry a sealed parcel from the Calle Dies lockup to pier nine without opening it.',
    dialogue: ['Rafa: So you are the new legs. Ocaso eats couriers who stop to think.',
      'Rafa: Pickup is my lockup on Calle Dies. Drop is pier nine, past the fish market.',
      'Rafa: It does not rattle. If it starts to, walk faster.'],
    steps: [
      { text: 'Collect the parcel at the Calle Dies lockup', kind: 'goto', target: { x: -120, z: 40 } },
      { text: 'Carry it to pier nine', kind: 'goto', target: { x: 140, z: -120 } }] },
  { id: 'the_loaner', title: 'The Loaner', giver: 'Nela', reward: 90,
    brief: 'Lift a silver coupe off Calle Verde and park it inside Nela\'s shop on Siete.',
    dialogue: ['Nela: Bruma impounded my brother\'s coupe. I want it back before the auction.',
      'Nela: Do not scratch it. Do not bring friends. Do not get seen.',
      'Nela: The garage on Siete is open until midnight. After that I am asleep and you are on foot.'],
    steps: [
      { text: 'Take the silver coupe on Calle Verde', kind: 'steal', car: 0, target: { x: -60, z: -30 } },
      { text: 'Park it in Nela\'s garage on Siete', kind: 'deliver', car: 0, target: { x: 30, z: 92 } }] },
  { id: 'neon_debt', title: 'Neon Debt', giver: 'Tavo', reward: 120,
    brief: 'Settle a club debt in the alley behind Vidrio, then lose the badge that comes with it.',
    dialogue: ['Tavo: Neon does not run on goodwill. A man owes me four grand and thinks the alley hides him.',
      'Tavo: Not inside. Blood on the floor costs me more than the debt is worth.',
      'Tavo: When it is done, do not come back here hot. Bruma\'s cars circle the block by then.'],
    steps: [
      { text: 'Reach the alley behind Club Vidrio', kind: 'goto', target: { x: 12, z: -14 } },
      { text: 'Shoot the debtor before he runs', kind: 'kill', target: { x: 18, z: -22 } },
      { text: 'Lose the police', kind: 'escape' }] },
  { id: 'badge_number', title: 'Badge Number', giver: 'Sargento Bruma', reward: 150,
    brief: 'Move a seized car out of the north impound and leave it at the airstrip for a man who does not exist.',
    dialogue: ['Bruma: You are not stealing from me. You are stealing from the city, and the city forgives.',
      'Bruma: North impound, row four. Black sedan, no plates worth reading.',
      'Bruma: The airstrip gate is open for eleven minutes. I will be watching the clock, not you.'],
    steps: [
      { text: 'Take the black sedan from row four', kind: 'steal', car: 1, target: { x: 168, z: 64 } },
      { text: 'Leave it at the old airstrip', kind: 'deliver', car: 1, target: { x: -176, z: -140 } },
      { text: 'Get clear before Bruma\'s backup arrives', kind: 'escape' }] },
  { id: 'marisma_colors', title: 'Marisma Colors', giver: 'Marisma', reward: 110,
    brief: 'The Marisma hand you a stolen car and a warning: drive it to the docks and forget the plate.',
    dialogue: ['Marisma: Nice ride, yes? It belonged to a man who talked to Bruma.',
      'Marisma: Container yard, keys in it, mouth shut. That is the whole job.',
      'Marisma: Rafa thinks he owns this city because he owns the mail. Tell him who owns the water.'],
    steps: [
      { text: 'Take the Marisma car from the market lot', kind: 'steal', car: 2, target: { x: -20, z: -158 } },
      { text: 'Leave it in the container yard', kind: 'deliver', car: 2, target: { x: 96, z: 8 } }] },
  { id: 'chrome_funeral', title: 'Chrome Funeral', giver: 'Nela', reward: 200,
    brief: 'Find the Marisma wheelman who wrecked Nela\'s shop and finish it in the scrapyard off Ocho.',
    dialogue: ['Nela: They drove a truck through my wall for fun. He was laughing. I heard him laughing.',
      'Nela: Scrapyard off Ocho. He drinks there because he thinks chrome hides him.',
      'Nela: Do not bring the police to my door. If you get loud, get gone.'],
    steps: [
      { text: 'Drive to the scrapyard off Ocho', kind: 'goto', target: { x: -88, z: 128 } },
      { text: 'Kill the Marisma wheelman', kind: 'kill', target: { x: -96, z: 136 } },
      { text: 'Lose the police', kind: 'escape' }] },
  { id: 'quiet_money', title: 'Quiet Money', giver: 'Tavo', reward: 130,
    brief: 'Pick up a quiet envelope at the marina office and be gone before Bruma\'s patrol finds the body inside.',
    dialogue: ['Tavo: Marina office, second floor. Ask for the envelope, not for the man.',
      'Tavo: Whoever answered the phone there is not the manager anymore.',
      'Tavo: If you hear sirens before the bridge, that is not coincidence.'],
    steps: [
      { text: 'Collect the envelope at the marina office', kind: 'goto', target: { x: -44, z: 150 } },
      { text: 'Lose the police before the bridge', kind: 'escape' }] },
  { id: 'sargentos_errand', title: 'The Sargento\'s Errand', giver: 'Sargento Bruma', reward: 180,
    brief: 'Steal the evidence van before the night shift logs it and hand it to Bruma\'s lockup on the west side.',
    dialogue: ['Bruma: There is a van with four kilos of my mistakes inside it.',
      'Bruma: Take it from the courthouse lot. The cameras are off for six minutes, not seven.',
      'Bruma: West lockup, roller door. Then forget you can read a plate.'],
    steps: [
      { text: 'Take the evidence van from the courthouse lot', kind: 'steal', car: 3, target: { x: 84, z: 132 } },
      { text: 'Deliver it to the west lockup', kind: 'deliver', car: 3, target: { x: -150, z: 118 } },
      { text: 'Lose the heat before it sticks', kind: 'escape' }] },
  { id: 'long_pier', title: 'Long Pier', giver: 'Rafa', reward: 240,
    brief: 'Run a car with a false floor to the radio tower while the Marisma shoot at your tail lights.',
    dialogue: ['Rafa: This one does not go in a bag. This one is a car with a secret.',
      'Rafa: Radio tower road, north gate. Do not stop for the men on the hill.',
      'Rafa: If they take it, I lose the route and you lose the city. Simple math.'],
    steps: [
      { text: 'Take the car from the fish market lot', kind: 'steal', car: 4, target: { x: 130, z: -140 } },
      { text: 'Run it to the radio tower north gate', kind: 'deliver', car: 4, target: { x: 190, z: 150 } },
      { text: 'Lose the police escort', kind: 'escape' }] },
  { id: 'ocaso_farewell', title: 'Ocaso Farewell', giver: 'Tavo', reward: 400,
    brief: 'Walk into the Marisma compound above the water and end the argument for good.',
    dialogue: ['Tavo: They burned my club on a Tuesday because I said no.',
      'Tavo: Compound above the water, east ridge. The boss sits outside because he likes the view.',
      'Tavo: After this, Ocaso is quiet or Ocaso is not ours. Either way, do not miss.'],
    steps: [
      { text: 'Reach the Marisma compound on the east ridge', kind: 'goto', target: { x: 176, z: -60 } },
      { text: 'Kill the Marisma boss', kind: 'kill', target: { x: 182, z: -66 } },
      { text: 'Lose the police on the ridge road', kind: 'escape' }] },
];

export function createMissions(G) {
  const group = new THREE.Group();
  group.name = 'missions';
  group.visible = false;
  G.scene.add(group);

  // Rotating diamond 6 m over the target, plus the emissive ring on the road.
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffb43a, emissive: 0xff8a00, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0.2, flatShading: true });
  const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), goldMat);
  diamond.position.y = HOVER;
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x2a1800, emissive: 0xffa020, emissiveIntensity: 1.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.5, 40), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;

  // Arrow built along +Z (shaft, then tip) and aimed with a quaternion, so it
  // works from any player position without depending on Object3D.lookAt.
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc247, emissiveIntensity: 1.6, roughness: 0.4 });
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6), arrowMat);
  shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.1;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 8), arrowMat);
  tip.rotation.x = Math.PI / 2; tip.position.z = 1.35;
  arrow.add(shaft, tip);

  // The marked body for a 'kill' step.
  const npcGeo = new THREE.BoxGeometry(0.8, 1.9, 0.5);
  const npcMat = new THREE.MeshStandardMaterial({ color: 0x360c0c, emissive: 0xc41f1f, emissiveIntensity: 0.9, roughness: 0.65 });
  group.add(diamond, ring, arrow);

  const mark = { x: 0, z: 0 }; // scratch: the current marker point
  const escapeFrom = { x: 0, z: 0 };
  let current = null; // { def, index, step }
  let activeCar = null; // car the current 'steal' / 'deliver' step is about
  let npc = null; // { x, z, hp, mesh } for the current kill step
  let t = 0;
  let lastShots = 0;
  let escapeAt = 0;
  let event = null;
  let eventAt = 0;

  G.state.mission = null;

  // Transient flag for other systems: 'step' on advance, 'done' on payout.
  function chime(type, text) {
    event = { type, text };
    eventAt = t;
    G.state.missionEvent = event;
  }

  function markerPoint(step) {
    const src = step.kind === 'steal' && activeCar ? activeCar : step.target;
    mark.x = src.x; mark.z = src.z;
    return mark;
  }

  function placeNpc(step) {
    if (npc) { group.remove(npc.mesh); npc = null; }
    if (step.kind !== 'kill') return;
    const mesh = new THREE.Mesh(npcGeo, npcMat);
    mesh.position.set(step.target.x, 0.95, step.target.z);
    group.add(mesh);
    npc = { x: step.target.x, z: step.target.z, hp: 100, mesh };
  }

  function setStep(i, silent) {
    const def = current.def;
    const step = def.steps[i];
    current.step = i;
    activeCar = null;
    if (step.kind === 'steal' || step.kind === 'deliver') {
      const cars = G.cars || [];
      activeCar = cars.length ? cars[(step.car | 0) % cars.length] : null;
    }
    if (step.kind === 'kill') lastShots = G.state.shots || 0;
    if (step.kind === 'escape') {
      // The mission creates the heat to lose; the police system lowers it.
      G.state.wanted = Math.max(G.state.wanted || 0, 3);
      escapeAt = t;
      const q = G.state.inCar || G.player;
      escapeFrom.x = q ? q.x : 0;
      escapeFrom.z = q ? q.z : 0;
    }
    placeNpc(step);
    G.state.mission = { id: def.id, index: current.index, title: def.title, objective: step.text, step: i };
    if (!silent) chime('step', step.text);
  }

  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

  function stepDone(step, p) {
    switch (step.kind) {
      case 'goto':
        return dist2(p, markerPoint(step)) <= REACH * REACH;
      case 'steal':
        return !!activeCar && G.state.inCar === activeCar;
      case 'deliver':
        return !!activeCar && G.state.inCar === activeCar && dist2(activeCar, step.target) <= REACH * REACH;
      case 'kill': {
        if (!npc) return true; // nothing marked to shoot: do not block the step
        if (npc.hp <= 0) return true;
        // A shot fired near the marked body counts as a hit. Real hit detection
        // belongs to the weapon system; this range check is the mission fallback.
        const shots = G.state.shots || 0;
        if (shots > lastShots && dist2(p, npc) <= HIT_RANGE * HIT_RANGE) npc.hp -= 60;
        lastShots = shots;
        return npc.hp <= 0;
      }
      case 'escape':
        if ((G.state.wanted || 0) === 0) return true;
        // Soft-lock guard: with no police system lowering the level, getting
        // clear of the scene settles the step instead of freezing the mission.
        return t - escapeAt > 15 && dist2(p, escapeFrom) > 150 * 150;
      default:
        return false;
    }
  }

  function advance() {
    const def = current.def;
    if (current.step + 1 < def.steps.length) {
      setStep(current.step + 1, false);
      return;
    }
    // Last step: pay out, chime 'done' and clear every mission field.
    G.state.cash = (G.state.cash || 0) + def.reward;
    chime('done', `${def.title} complete. $${def.reward} paid.`);
    current = null;
    activeCar = null;
    if (npc) { group.remove(npc.mesh); npc = null; }
    group.visible = false;
    G.state.mission = null;
  }

  // Restartable from the start menu: the index is clamped and state is rebuilt.
  function start(index) {
    const i = Math.max(0, Math.min(MISSIONS.length - 1, index | 0));
    current = { def: MISSIONS[i], index: i, step: 0 };
    setStep(0, true); // the first objective is not an advance
    group.visible = true;
    return current.def;
  }

  function update(dt) {
    t += dt;
    if (event && G.state.missionEvent === event && t - eventAt > EVENT_HOLD) {
      G.state.missionEvent = null;
      event = null;
    }
    if (!current) return;

    const step = current.def.steps[current.step];
    const p = G.state.inCar || G.player || ORIGIN;
    const target = markerPoint(step);

    group.visible = true;
    group.position.set(target.x, 0, target.z);

    // Marker animation: spin, breathe, and a ring pulsing on the road.
    diamond.rotation.y += dt * 1.9;
    diamond.rotation.x = Math.sin(t * 0.9) * 0.28;
    diamond.scale.setScalar(1 + Math.sin(t * 3.1) * 0.07);
    ring.scale.setScalar(1 + Math.sin(t * 2.2) * 0.1);
    ringMat.opacity = 0.42 + 0.22 * Math.sin(t * 2.2);

    // Arrow hovers on the player's side of the marker and points at the diamond.
    let dx = p.x - target.x;
    let dz = p.z - target.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    arrow.position.set(dx * 2.4, HOVER + 2.6, dz * 2.4);
    _dir.set(-arrow.position.x, HOVER - arrow.position.y, -arrow.position.z).normalize();
    arrow.quaternion.setFromUnitVectors(FORWARD, _dir);

    if (stepDone(step, p)) advance();
  }

  return {
    group,
    update,
    missions: MISSIONS,
    start,
    get current() { return current; },
  };
}
