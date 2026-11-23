const KEY = 'ocaso.save.v1';
const AUTOSAVE_MS = 30000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function firstDefined(...values) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== undefined && values[i] !== null) return values[i];
  }
  return undefined;
}

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createSaves(G) {
  let lastAutosave = 0;

  function refs() {
    if (!isObject(G)) return null;
    if (!isObject(G.state)) G.state = {};
    if (!isObject(G.player)) G.player = {};
    return { state: G.state, player: G.player };
  }

  function buildSnapshot() {
    const r = refs();
    const state = r ? r.state : {};
    const player = r ? r.player : {};
    const completed = firstDefined(
      state.completedMissions, state.completed, state.missionsCompleted,
      player.completedMissions
    );
    return {
      x: toNumber(firstDefined(player.x, state.x, state.playerX), 0),
      z: toNumber(firstDefined(player.z, state.z, state.playerZ), 0),
      health: toNumber(firstDefined(player.health, state.health), 100),
      money: toNumber(firstDefined(state.cash, state.money, player.money), 0),
      wanted: toNumber(firstDefined(state.wanted, state.wantedStars, player.wanted), 0),
      vehicleType: firstDefined(
        state.vehicleType, state.vehicle, player.vehicleType, player.vehicle
      ) ?? null,
      missionIndex: toNumber(firstDefined(state.missionIndex, state.missionDone, player.missionIndex), 0),
      completedMissions: Array.isArray(completed) ? completed.slice() : [],
      timestamp: Date.now()
    };
  }

  function isValid(data) {
    return isObject(data)
      && Number.isFinite(Number(data.x))
      && Number.isFinite(Number(data.z))
      && Number.isFinite(Number(data.health))
      && Number.isFinite(Number(data.money))
      && Number.isFinite(Number(data.wanted))
      && Number.isFinite(Number(data.missionIndex))
      && Number.isFinite(Number(data.timestamp))
      && Array.isArray(data.completedMissions);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(buildSnapshot()));
      return true;
    } catch (error) {
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (typeof raw !== 'string' || raw.length === 0) return false;
      let data;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        return false;
      }
      if (!isValid(data)) return false;
      const r = refs();
      if (!r) return false;
      const { state, player } = r;
      player.x = Number(data.x);
      player.z = Number(data.z);
      player.health = Number(data.health);
      state.cash = Number(data.money);
      state.money = Number(data.money);
      state.wanted = Number(data.wanted);
      if ('wantedStars' in state) state.wantedStars = Number(data.wanted);
      state.vehicleType = data.vehicleType;
      if ('vehicle' in state) state.vehicle = data.vehicleType;
      state.missionDone = Number(data.missionIndex);
      state.missionIndex = Number(data.missionIndex);
      state.completedMissions = data.completedMissions.slice();
      return true;
    } catch (error) {
      return false;
    }
  }

  function has() {
    try {
      const raw = localStorage.getItem(KEY);
      return typeof raw === 'string' && raw.length > 0;
    } catch (error) {
      return false;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  function autosave() {
    const now = Date.now();
    if (now - lastAutosave < AUTOSAVE_MS) return false;
    lastAutosave = now;
    return save();
  }

  return { save, load, has, clear, autosave };
}
