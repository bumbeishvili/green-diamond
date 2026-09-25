// Global tunables and URL flags.
const params = new URLSearchParams(location.search);

export const URLFLAGS = {
  debug: params.has('debug'),
  autostart: params.has('autostart'),
  nohud: params.has('nohud'),
  nozombies: params.has('nozombies'),
  cam: params.get('cam'),            // "x,y,z,yawDeg,pitchDeg" in three.js coords
  time: params.has('time') ? parseFloat(params.get('time')) : null, // hour of day, e.g. 18.25
  wave: params.has('wave') ? parseInt(params.get('wave'), 10) : null,
  quality: params.get('quality'),
  god: params.has('god'),
  freeze: params.has('freeze'),      // stop AI + time (for screenshots)
  // co-op testing: join a room on load (?mp=password&name=X), the host starts once N are in
  // (?mpstart=N), no pointer lock / click-to-play overlay (?nolock)
  mp: params.get('mp'),
  name: params.get('name'),
  mpstart: params.has('mpstart') ? parseInt(params.get('mpstart'), 10) || 1 : null,
  nolock: params.has('nolock'),
  mptime: params.has('mptime') ? parseFloat(params.get('mptime')) : null,   // match length (s)
  relay: params.has('relay'),   // co-op: through the server's relay from the start (Cloudflare), no direct attempt
  // (testing PvP: the host's rules, ?pvp=ffa|teams&pvpz=0&pvpkills=N)
  pvp: params.get('pvp'),
  pvpz: params.has('pvpz') ? params.get('pvpz') !== '0' : null,
  pvpkills: params.has('pvpkills') ? parseInt(params.get('pvpkills'), 10) : null,
  training: params.get('training'),   // brain training for this visit: off / light / normal / intense (test runs: off unless given)
  drill: params.get('drill'),         // (testing a puzzle: play this one as soon as the game starts, ?drill=stroop&drilllevel=5)
  drilllevel: params.has('drilllevel') ? parseInt(params.get('drilllevel'), 10) : null,
  // a phone or tablet: touch controls (?touch forces them, for testing)
  touch: params.has('touch') || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints || 0) > 0),
};

export const QUALITY = {
  // phones: a smaller picture, short soft shadows, fewer trees, fewer zombies at once
  phone: { pixelRatio: 0.75, shadowMap: 1024, shadowRange: 45, anisotropy: 1, drawTrees: 0.35, grassBlades: 0, envIntensity: 0.9, treeShadows: false, phone: true },
  low: { pixelRatio: 0.85, shadowMap: 1024, shadowRange: 70, anisotropy: 2, drawTrees: 0.6, grassBlades: 0, envIntensity: 0.9, treeShadows: false },
  medium: { pixelRatio: 1.0, shadowMap: 2048, shadowRange: 95, anisotropy: 4, drawTrees: 0.85, grassBlades: 0, envIntensity: 1.0 },
  high: { pixelRatio: 1.35, shadowMap: 4096, shadowRange: 120, anisotropy: 8, drawTrees: 1.0, grassBlades: 1, envIntensity: 1.0 },
};

export const WORLD = {
  floorH: 3.05,
  groundFloorH: 3.6,
  eyeHeight: 1.66,
  crouchEye: 1.05,
  playerRadius: 0.34,
  gravity: 22,
  jumpSpeed: 6.4,
  walkSpeed: 4.3,
  sprintSpeed: 6.9,
  crouchSpeed: 2.2,
  maxStep: 0.72, // curbs, courtyard steps
};

// Map (x=east, y=north) -> three.js (x, *, z=-y)
export const toZ = (y) => -y;

// First run: pick graphics quality from the GPU (laptops with integrated graphics get less).
function guessQuality() {
  if (URLFLAGS.touch) return 'phone';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/Apple M\d+ (Pro|Max|Ultra)|NVIDIA|GeForce|RTX|Radeon RX|Radeon Pro/i.test(r)) return 'high';
    if (/Apple M\d|Apple GPU|Iris Xe|Radeon/i.test(r)) return 'medium';
    if (/Intel|UHD|HD Graphics|Mali|Adreno|SwiftShader|llvmpipe/i.test(r)) return 'low';
  } catch (e) { /* no WebGL2 */ }
  return 'medium';
}

export const settings = (() => {
  const s = { sens: 1, vol: 0.8, quality: null };
  try {
    const saved = JSON.parse(localStorage.getItem('gd-settings') || '{}');
    Object.assign(s, saved);
  } catch (e) { /* storage unavailable */ }
  if (!s.quality) s.quality = guessQuality();
  // (a phone starts light, whatever an older version saved, until you pick one yourself on it)
  if (URLFLAGS.touch && !s.touchChosen) s.quality = 'phone';
  if (URLFLAGS.quality) s.quality = URLFLAGS.quality;
  return s;
})();

export function saveSettings() {
  try { localStorage.setItem('gd-settings', JSON.stringify(settings)); } catch (e) { /* ignore */ }
}
