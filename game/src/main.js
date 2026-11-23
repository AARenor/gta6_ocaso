// OCASO CITY: renderer, sun, sky, camera and the frame loop.
import * as THREE from '../three.module.min.js';
import { CONFIG } from './config.js';
import { createCity } from './world/city.js';
import { createTraffic } from './world/traffic.js';
import { createPedestrians } from './world/pedestrians.js';
import { createVehicles } from './player/vehicles.js';
import { createPlayer } from './player/player.js';
import { createPolice } from './gameplay/police.js';
import { createMissions } from './gameplay/missions.js';
import { createCombat } from './gameplay/combat.js';
import { createHud } from './ui/hud.js';
import { createMinimap } from './ui/minimap.js';
import { applyPose } from './core/poses.js';
import { createAudio } from './core/audio.js';
import { createSaves } from './gameplay/save.js';
import { createMenu } from './ui/menu.js';

const { city, sky, palette } = CONFIG;

// City centre, the point the camera and the sun frame.
const centre = new THREE.Vector3(0, 0, 0);

const G = {
  scene: new THREE.Scene(), camera: null, renderer: null,
  world: {}, state: { time: 0 }, systems: [],
};
window.G = G;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(1280, 720);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);
G.renderer = renderer;

G.scene.background = new THREE.Color(sky.horizon);
G.scene.fog = new THREE.Fog(sky.fog, sky.fogNear, sky.fogFar);

// Three-quarter aerial: beach (+Z), city and the sun all inside one frame.
const camera = new THREE.PerspectiveCamera(50, 1280 / 720, 0.5, 900);
camera.position.set(centre.x - 120, 95, centre.z + 150);
camera.lookAt(centre.x, 10, centre.z);
G.camera = camera;

// Sun raised to 0.62 rad so it lights the façades, not only the sky.
const SUN_ELEVATION = 0.62;
const sunDir = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(sky.sunAzimuth),
  Math.sin(SUN_ELEVATION),
  Math.cos(SUN_ELEVATION) * Math.cos(sky.sunAzimuth),
).normalize();

const sun = new THREE.DirectionalLight(sky.sunColour, 3.1);
sun.position.copy(sunDir).multiplyScalar(260);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 700 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0006;
G.scene.add(sun, sun.target);
G.scene.add(new THREE.HemisphereLight(sky.zenith, 0x6b5a44, 1.55));
// Cool fill from the side away from the sun, so shadowed façades keep their shape.
const fill = new THREE.DirectionalLight(0x8fb6ff, 0.55);
fill.position.set(-220, 120, -180);
G.scene.add(fill);

// Sky dome: horizon mixed into zenith by the view direction's y.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: {
    horizon: { value: new THREE.Color(sky.horizon) },
    zenith: { value: new THREE.Color(sky.zenith) },
    sunDir: { value: sunDir.clone() },
    sunColour: { value: new THREE.Color(sky.sunColour) },
  },
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 horizon;
    uniform vec3 zenith;
    uniform vec3 sunDir;
    uniform vec3 sunColour;
    varying vec3 vDir;
    void main() {
      vec3 dir = normalize(vDir);
      vec3 col = mix(horizon, zenith, pow(clamp(dir.y, 0.0, 1.0), 0.32));
      col += sunColour * pow(max(dot(dir, normalize(sunDir)), 0.0), 24.0) * 0.6;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat);
skyDome.renderOrder = -1;
skyDome.frustumCulled = false;
G.scene.add(skyDome);
G.world.sky = skyDome;

// Sun disc, hung inside the dome so the far plane never clips it.
const sunDisc = new THREE.Mesh(
  new THREE.SphereGeometry(9, 24, 12),
  new THREE.MeshBasicMaterial({ color: sky.sunColour, fog: false, depthWrite: false }),
);
sunDisc.position.copy(sunDir).multiplyScalar(370);
G.scene.add(sunDisc);
G.world.sunDisc = sunDisc;

createCity(G);

// Parked cars and the player body first: the player picks a car from G.cars.
const vehicles = createVehicles(G);
const player = createPlayer(G);

// AI traffic and the crowd walk the same grid the city was built on. Both
// look each other up through G at update time, so the order here is free.
const traffic = createTraffic(G);
const peds = createPedestrians(G);
G.traffic = traffic;
G.peds = peds;

G.systems.push(vehicles.update, player.update, traffic.update, peds.update);

// Police, missions and combat read the player, the cars and the traffic state
// the systems above already wrote this frame, so they run after them.
const police = createPolice(G);
const missions = createMissions(G);
const combat = createCombat(G);
G.police = police;
G.missions = missions;
G.combat = combat;
G.systems.push(police.update, missions.update, combat.update);

// Screen layer last: the HUD and the minimap only read what the systems above
// have already written this frame, so they run after them in G.systems.
const hud = createHud(G);
const minimap = createMinimap(G);
G.ui = { hud, minimap };
G.systems.push(hud.update, minimap.update);

// Career layer: a start screen, a pause screen, autosave and synthesised sound.
// The screen is built after the HUD so it sits above every other element.
const audio = createAudio(G);
const saves = createSaves(G);
G.audio = audio;
G.saves = saves;

let mode = 'playing';
let lastShots = 0;
let lastCash = 0;
let lastSiren = 0;

function begin() {
  if (saves.has() && saves.load()) {
    try { missions.start(G.state.missionDone || 0); } catch (error) { /* saved index may be stale */ }
  }
  audio.start();
  mode = 'playing';
  menu.show('playing');
}

const menu = createMenu(G, {
  onStart: begin,
  onResume() { mode = 'playing'; menu.show('playing'); },
  onRestart() { location.reload(); },
});
G.menu = menu;

if (G.state.autoStart) {
  menu.show('playing');
} else {
  mode = 'title';
  menu.show('title');
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && !G.state.autoStart) {
    mode = mode === 'playing' ? 'paused' : 'playing';
    menu.show(mode === 'playing' ? 'playing' : 'paused');
  }
  if (event.code === 'KeyR' && (mode === 'paused' || mode === 'gameover')) location.reload();
  if (event.code === 'KeyM') G.muted = !G.muted;
});

// Screenshot poses read the URL and move what is already built, so they run
// once here, after every system exists and before the first frame.
const pose = applyPose(G);
if (G.state.autoStart) {
  mode = 'playing';
  menu.show('playing');
}
if (pose === 'night') {
  G.scene.fog?.color?.setHex?.(0x2a2a55);
  renderer.setClearColor(0x0b1030);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
onResize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  G.state.time += dt;
  if (mode === 'playing') {
    for (const system of G.systems) system(dt);
  }
  const shots = G.state.shots || 0;
  if (shots > lastShots && mode === 'playing') audio.play('shot');
  lastShots = shots;
  const cash = G.state.cash || 0;
  if (cash > lastCash && mode === 'playing') audio.play('cash');
  lastCash = cash;
  if ((G.state.wanted || 0) > 0 && G.state.time - lastSiren > 1.3 && mode === 'playing') {
    audio.play('siren');
    lastSiren = G.state.time;
  }
  if (mode === 'playing' && G.state.health <= 0 && G.state.wasted) {
    mode = 'gameover';
    menu.show('gameover');
  }
  saves.autosave();
  renderer.render(G.scene, G.camera);
}
requestAnimationFrame(frame);
