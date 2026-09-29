import { GAME_VERSION } from '../config.js';

// How far you'd got in the missions, kept in this browser so a refresh can carry on: the mission,
// and what you went in with (points, guns, armour). Saved from a different major version it's
// dropped: a major bump is for when the missions are reshuffled and an old save means another one.
const KEY = 'gd.missions';
const major = (v) => String(v).split('.')[0];

export function loadProgress(count) {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!p) return null;
    if (major(p.v) !== major(GAME_VERSION) || !Number.isInteger(p.mission) || p.mission < 0 || p.mission >= count) { localStorage.removeItem(KEY); return null; }
    return p;
  } catch { return null; }
}

export function saveProgress(p) { try { localStorage.setItem(KEY, JSON.stringify({ v: GAME_VERSION, ...p })); } catch { /* (private window: no saving) */ } }
export function clearProgress() { try { localStorage.removeItem(KEY); } catch { /* nothing kept anyway */ } }
