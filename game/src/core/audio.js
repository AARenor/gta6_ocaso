// audio.js — tiny synthesised audio for the browser game.
// Everything is generated with oscillators and gain nodes: no files, no fetch,
// no external library. When Web Audio is unavailable every call is a no-op.

export function createAudio(G) {
  let ctx = null;
  let master = null;
  let humOsc = null;
  let humGain = null;

  function available() {
    if (ctx) return true;
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webAudioAudioContext);
    return typeof AC === 'function';
  }

  function start() {
    if (ctx) {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();
      return;
    }
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webAudioAudioContext);
    if (typeof AC !== 'function') return;

    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.08; // low volume
    if (master.connect) master.connect(ctx.destination);

    // Engine hum: a single oscillator kept alive, gated by G.state.inCar.
    humOsc = ctx.createOscillator();
    humOsc.type = 'sawtooth';
    humOsc.frequency.value = 55;

    humGain = ctx.createGain();
    humGain.gain.value = 0; // silent until in the car

    humOsc.connect(humGain);
    humGain.connect(master);
    if (typeof humOsc.start === 'function') humOsc.start();
  }

  function setHum() {
    if (!ctx || !humGain) return;
    const on = !!(G && G.state && G.state.inCar) && !(G && G.muted);
    const now = ctx.currentTime;
    if (typeof humGain.gain.setTargetAtTime === 'function') {
      humGain.gain.setTargetAtTime(on ? 0.25 : 0, now, 0.05);
    } else {
      humGain.gain.value = on ? 0.25 : 0;
    }
  }

  // Short envelope: frequency and duration vary per sound name.
  const RECIPES = {
    shot:  { freq: 220,  duration: 0.12, type: 'square',   peak: 0.9 },
    siren: { freq: 740,  duration: 0.55, type: 'sine',     peak: 0.6 },
    cash:  { freq: 1320, duration: 0.20, type: 'triangle', peak: 0.7 },
    step:  { freq: 110,  duration: 0.07, type: 'sine',     peak: 0.5 },
  };

  function play(name) {
    if (G && G.muted) return;
    const spec = RECIPES[name];
    if (!spec) return;

    // Ensure a context exists (created on first user gesture); refresh the hum.
    if (!ctx) start();
    if (!ctx) return;
    setHum();
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.freq, now);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);

    osc.connect(gain);
    gain.connect(master);
    if (typeof osc.start === 'function') osc.start(now);
    if (typeof osc.stop === 'function') osc.stop(now + spec.duration + 0.02);
  }

  return { start, play };
}
