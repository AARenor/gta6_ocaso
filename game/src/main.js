import * as THREE from '../three.module.min.js';
import { CONFIG } from './config.js';
import { createCity } from './world/city.js';

const G = {
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(55, 1280 / 720, 0.1, 2600),
  renderer: new THREE.WebGLRenderer({ antialias: true }),
  world: {},
  state: { time: 0 },
  systems: [],
};
window.G = G;

G.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
G.renderer.setSize(1280, 720);
G.renderer.shadowMap.enabled = true;
G.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
G.renderer.outputColorSpace = THREE.SRGBColorSpace;
G.renderer.toneMapping = THREE.ACESFilmicToneMapping;
G.renderer.toneMappingExposure = 1.12;
G.renderer.domElement.setAttribute('aria-label', 'OCASO CITY game view');
document.body.appendChild(G.renderer.domElement);

G.scene.fog = new THREE.Fog(CONFIG.sky.fog, 180, 900);
G.camera.position.set(0, 34, -112);
G.camera.lookAt(0, 10, 10);

const skyGeometry = new THREE.SphereGeometry(2200, 32, 20);
const skyMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    horizonColor: { value: new THREE.Color(CONFIG.sky.horizon) },
    zenithColor: { value: new THREE.Color(CONFIG.sky.zenith) },
  },
  vertexShader: `
    varying vec3 vDirection;
    void main() {
      vDirection = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 horizonColor;
    uniform vec3 zenithColor;
    varying vec3 vDirection;
    void main() {
      float height = max(vDirection.y, 0.0);
      float blend = smoothstep(0.0, 0.72, height);
      vec3 colour = mix(horizonColor, zenithColor, blend);
      colour += vec3(0.035, 0.012, 0.0) * (1.0 - blend);
      gl_FragColor = vec4(colour, 1.0);
    }
  `,
});
G.scene.add(new THREE.Mesh(skyGeometry, skyMaterial));

const sunDirection = new THREE.Vector3(
  Math.sin(CONFIG.sky.sunAzimuth) * Math.cos(CONFIG.sky.sunElevation),
  Math.sin(CONFIG.sky.sunElevation),
  Math.cos(CONFIG.sky.sunAzimuth) * Math.cos(CONFIG.sky.sunElevation),
).normalize();
const sunLight = new THREE.DirectionalLight(CONFIG.sky.sunColour, 3.2);
sunLight.position.copy(sunDirection).multiplyScalar(260);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(1024, 1024);
sunLight.shadow.camera.left = -240;
sunLight.shadow.camera.right = 240;
sunLight.shadow.camera.top = 240;
sunLight.shadow.camera.bottom = -240;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 650;
sunLight.shadow.normalBias = 0.035;
G.scene.add(sunLight);
G.scene.add(sunLight.target);
G.scene.add(new THREE.HemisphereLight(0xf7cda8, 0x5b5360, 1.15));

const sunDisc = new THREE.Mesh(
  new THREE.SphereGeometry(22, 24, 16),
  new THREE.MeshBasicMaterial({ color: CONFIG.sky.sunColour, fog: false }),
);
sunDisc.position.copy(sunDirection).multiplyScalar(1850);
G.scene.add(sunDisc);

const city = createCity(G);
G.scene.add(city.group);
G.systems.push((dt) => city.update(dt));

let previousTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = previousTime === 0 ? 0 : Math.min((now - previousTime) / 1000, 0.05);
  previousTime = now;
  G.state.time += dt;
  for (const system of G.systems) {
    if (typeof system === 'function') system(dt);
  }
  G.renderer.render(G.scene, G.camera);
}
requestAnimationFrame(frame);

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  G.camera.aspect = width / height;
  G.camera.updateProjectionMatrix();
  G.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  G.renderer.setSize(width, height);
}
window.addEventListener('resize', resize);
