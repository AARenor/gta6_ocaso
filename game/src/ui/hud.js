// OCASO CITY: heads-up display. One markup block and one <style> element are
// injected on the first call; update() then only writes text, classes and
// opacity, and never touches layout. The whole layer is pointer-events: none.

const CREAM = '#f4e7c8';
const GOLD = '#f2c14e';
const STAR_COUNT = 5;
const TYPE_SECONDS = 0.5; // full reveal time of a dialog line

const STYLE = `
#hud { position: fixed; inset: 0; z-index: 8; pointer-events: none;
  font-family: Arial, Helvetica, sans-serif; color: ${CREAM};
  text-shadow: 0 2px 6px rgba(0,0,0,0.85); user-select: none; }
#hud * { box-sizing: border-box; }
#hud .panel { position: absolute; background: rgba(13,15,19,0.60);
  border: 1px solid rgba(244,231,200,0.26); border-radius: 6px; padding: 10px 14px; }
#hud .tl { top: 18px; left: 18px; min-width: 170px; }
#hud .tr { top: 18px; right: 18px; min-width: 190px; text-align: right; }
#hud .tc { top: 18px; left: 50%; transform: translateX(-50%); text-align: center;
  max-width: 520px; padding: 8px 18px; display: none; }
#hud .tc.on { display: block; }
#hud .bc { bottom: 96px; left: 50%; transform: translateX(-50%); width: 640px;
  max-width: calc(100vw - 48px); display: none; }
#hud .bc.on { display: block; }
#hud .br { bottom: 18px; right: 18px; display: none; align-items: baseline; gap: 7px;
  padding: 8px 14px; }
#hud .br.on { display: flex; }
#hud .city { font-family: "Arial Black", "Arial Bold", Arial, sans-serif;
  font-weight: 900; font-size: 26px; letter-spacing: 4px; line-height: 1; }
#hud .stars { margin-top: 7px; font-size: 18px; letter-spacing: 3px; line-height: 1; }
#hud .stars span { display: inline-block; color: transparent;
  -webkit-text-stroke: 1px rgba(244,231,200,0.70); }
#hud .stars span.on { color: ${GOLD}; -webkit-text-stroke: 1px ${GOLD}; }
#hud .stars.hot span.on { animation: hud-pulse 780ms ease-in-out infinite; }
@keyframes hud-pulse { 0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(0.82); opacity: 0.5; } }
#hud .cash { margin-top: 7px; font-size: 20px; font-weight: 700; letter-spacing: 1px; }
#hud .weapon { font-size: 14px; letter-spacing: 2px; text-transform: uppercase; }
#hud .ammo { font-size: 26px; font-weight: 700; color: ${GOLD}; line-height: 1.1; }
#hud .meter { position: relative; height: 7px; margin-top: 8px; border-radius: 4px;
  background: rgba(244,231,200,0.18); overflow: hidden; }
#hud .meter i { position: absolute; top: 0; bottom: 0; left: 0; width: 100%;
  border-radius: 4px; background: ${CREAM}; transition: width 140ms linear; }
#hud .meter.armour i { background: #7fa7c9; }
#hud .speaker { font-family: Georgia, "Times New Roman", serif; font-size: 17px;
  font-weight: 700; letter-spacing: 1px; color: ${GOLD}; margin-bottom: 6px; }
#hud .line { font-family: Georgia, "Times New Roman", serif; font-size: 16px;
  line-height: 1.45; min-height: 2.9em; white-space: pre-wrap; }
#hud .mission-title { font-size: 15px; letter-spacing: 3px; text-transform: uppercase;
  color: ${GOLD}; }
#hud .mission-step { font-size: 13px; margin-top: 4px; color: #e8dfc8; }
#hud .speed b { font-size: 30px; font-weight: 900; line-height: 1; }
#hud .speed span { font-size: 12px; letter-spacing: 2px; color: ${GOLD}; }
#hud .vignette { position: absolute; inset: 0; opacity: 0;
  transition: opacity 90ms linear;
  background: radial-gradient(ellipse at center, rgba(140,0,0,0) 42%,
    rgba(160,12,12,0.92) 100%); }
`;

function starsMarkup() {
  let out = '';
  for (let i = 0; i < STAR_COUNT; i++) out += '<span>&#9733;</span>';
  return out;
}

const MARKUP = `
<div id="hud">
  <div class="vignette" id="hud-vignette"></div>
  <div class="panel tl">
    <div class="city">OCASO</div>
    <div class="stars" id="hud-stars">${starsMarkup()}</div>
    <div class="cash" id="hud-cash">$0</div>
  </div>
  <div class="panel tr">
    <div class="weapon" id="hud-weapon">Unarmed</div>
    <div class="ammo" id="hud-ammo">--</div>
    <div class="meter"><i id="hud-health"></i></div>
    <div class="meter armour"><i id="hud-armour"></i></div>
  </div>
  <div class="panel tc" id="hud-mission">
    <div class="mission-title" id="hud-mission-title"></div>
    <div class="mission-step" id="hud-mission-step"></div>
  </div>
  <div class="panel bc" id="hud-dialog">
    <div class="speaker" id="hud-speaker"></div>
    <div class="line" id="hud-line"></div>
  </div>
  <div class="panel br speed" id="hud-speed">
    <b id="hud-speed-value">0</b><span>km/h</span>
  </div>
</div>
`;

// Injected once: a rebuilt scene reuses the existing markup instead of
// stacking a second HUD on top of the first.
function injectHud() {
  if (document.getElementById('hud')) return;
  const style = document.createElement('style');
  style.id = 'hud-style';
  style.textContent = STYLE;
  (document.head ?? document.documentElement).append(style);
  const host = document.createElement('div');
  host.innerHTML = MARKUP.trim();
  (document.body ?? document.documentElement).append(host.firstElementChild);
}

function clamp01(value) {
  const n = Number(value);
  if (!(n > 0)) return 0;
  return n < 1 ? n : 1;
}

// "$1,250" for 1250 and "$-40" for a debt.
function formatCash(value) {
  const n = Math.floor(Number(value) || 0);
  return '$' + n.toLocaleString('en-US');
}

export function createHud(G) {
  injectHud();

  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('hud'),
    stars: $('hud-stars'),
    cash: $('hud-cash'),
    weapon: $('hud-weapon'),
    ammo: $('hud-ammo'),
    health: $('hud-health'),
    armour: $('hud-armour'),
    speed: $('hud-speed'),
    speedValue: $('hud-speed-value'),
    dialog: $('hud-dialog'),
    speaker: $('hud-speaker'),
    line: $('hud-line'),
    mission: $('hud-mission'),
    missionTitle: $('hud-mission-title'),
    missionStep: $('hud-mission-step'),
    vignette: $('hud-vignette'),
  };
  const stars = el.stars ? Array.from(el.stars.children) : [];

  let dialogKey = '';   // identifies the current line, so the reveal restarts
  let dialogTime = 0;   // seconds the current line has been on screen

  // The DOM is touched only when a value actually changes: no per-frame reflow.
  function text(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function fill(node, fraction) {
    const value = `${Math.round(clamp01(fraction) * 100)}%`;
    if (node && node.style.width !== value) node.style.width = value;
  }

  function updateStars(wanted) {
    for (let i = 0; i < stars.length; i++) {
      const on = i < wanted;
      if (stars[i].classList.contains('on') !== on) stars[i].classList.toggle('on', on);
    }
    el.stars?.classList.toggle('hot', wanted >= 4);
  }

  // Dialog: 0.5 s typewriter computed from elapsed time, so a dropped frame
  // never stalls the line. A string dialog is treated as a line with no name.
  function updateDialog(state, step) {
    const d = state.dialog;
    if (!d) {
      if (dialogKey) {
        dialogKey = '';
        el.dialog?.classList.remove('on');
      }
      return;
    }
    const speaker = typeof d === 'string' ? '' : String(d.speaker ?? d.name ?? '');
    const line = typeof d === 'string' ? d : String(d.line ?? d.text ?? '');
    const key = speaker + '\u0000' + line;
    if (key !== dialogKey) {
      dialogKey = key;
      dialogTime = 0;
      text(el.speaker, speaker);
      if (el.speaker) el.speaker.style.display = speaker ? 'block' : 'none';
    }
    dialogTime += step;
    const reveal = Math.min(1, dialogTime / TYPE_SECONDS);
    text(el.line, line.slice(0, Math.ceil(line.length * reveal)));
    el.dialog?.classList.add('on');
  }

  function updateMission(state) {
    const m = state.mission;
    if (!m) {
      el.mission?.classList.remove('on');
      return;
    }
    text(el.missionTitle, String(m.title ?? m.name ?? 'Mission'));
    text(el.missionStep, typeof m.step === 'string' ? m.step : String(m.objective ?? ''));
    el.mission?.classList.add('on');
  }

  function update(dt) {
    const step = dt > 0 ? Math.min(dt, 0.1) : 0;
    const state = G.state ?? {};

    const wanted = Math.max(0, Math.min(stars.length, Math.round(state.wanted ?? 0)));
    updateStars(wanted);
    text(el.cash, formatCash(state.cash));

    text(el.weapon, String(state.weapon ?? 'Unarmed'));
    const ammo = state.ammo;
    text(el.ammo, typeof ammo === 'number' ? String(ammo) : '--');

    fill(el.health, (state.health ?? 100) / 100);
    fill(el.armour, (state.armour ?? 0) / 100);

    // Speedometer: only while the player sits in a car, km/h rounded.
    const car = state.inCar;
    el.speed?.classList.toggle('on', Boolean(car));
    if (car) {
      const speed = typeof car.speed === 'number' ? car.speed : (G.player?.speed ?? 0);
      text(el.speedValue, String(Math.round(Math.abs(speed) * 3.6)));
    }

    updateDialog(state, step);
    updateMission(state);

    const flash = clamp01(state.damageFlash) * 0.8;
    const opacity = String(flash);
    if (el.vignette && el.vignette.style.opacity !== opacity) el.vignette.style.opacity = opacity;
  }

  return { update };
}
