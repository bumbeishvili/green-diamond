// The maps' icons: a badge with a symbol for each kind of thing (the big map draws them as SVG, the
// minimap as small images made from the same SVG). Symbols are drawn in a 24x24 box.

const G = {
  ammo: '<path d="M5 10.2C5 7.4 6 5.6 7 4.6c1 1 2 2.8 2 5.6z M10 10.2c0-2.8 1-4.6 2-5.6 1 1 2 2.8 2 5.6z M15 10.2c0-2.8 1-4.6 2-5.6 1 1 2 2.8 2 5.6z"/><rect x="5" y="10.8" width="4" height="8.6" rx=".6"/><rect x="10" y="10.8" width="4" height="8.6" rx=".6"/><rect x="15" y="10.8" width="4" height="8.6" rx=".6"/>',
  health: '<path d="M9.4 4h5.2v5.4H20v5.2h-5.4V20H9.4v-5.4H4V9.4h5.4z"/>',
  cash: '<path fill-rule="evenodd" d="M3 7h18v10H3z M12 9.3a2.7 2.7 0 1 0 0 5.4 2.7 2.7 0 0 0 0-5.4z M5 9v6h1.6V9z M17.4 9v6H19V9z"/>',
  gun: '<path d="M2.5 7.2h16.2l.8-1.2h2v4.8h-2.3l-.6.9h-6.1l-1.3 5.6c-.1.5-.6.9-1.1.9H6.4l1.5-6.5H2.5z"/>',
  word: '<text x="12" y="16.6" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12.5" font-weight="900" fill="#fff">Aa</text>',
  powerup: '<path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.6L12 17.5l-5.9 3.2 1.2-6.6-4.8-4.6 6.6-.9z"/>',
  stairs: '<path d="M3 20v-4h4.5v-4H12V8h4.5V4H21v16z"/>',
  armour: '<path d="M12 3l8 3v6c0 4.6-3.4 7.8-8 9-4.6-1.2-8-4.4-8-9V6z"/>',
  upgrade: '<path d="M15 3.2a5 5 0 0 0-4.6 6.7L3.6 16.7a1.6 1.6 0 0 0 0 2.3l1.4 1.4a1.6 1.6 0 0 0 2.3 0l6.8-6.8A5 5 0 0 0 20.8 9l-3 3-2.8-.6-.6-2.8 3-3A5 5 0 0 0 15 3.2z"/>',
  speed: '<path d="M13.5 2L4.8 13.4H11L9.8 22l9.1-12.1h-6.3z"/>',
  double: '<text x="12" y="16.8" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="12" font-weight="900" fill="#fff">2×</text>',
  skull: '<path fill-rule="evenodd" d="M12 3C7.2 3 4 6.4 4 10.4c0 2.4 1 4.3 2.7 5.5V19h2.4v-1.8h1.7V19h2.4v-1.8h1.7V19h2.4v-3.1C19 14.7 20 12.8 20 10.4 20 6.4 16.8 3 12 3z M8.8 9.3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M15.2 9.3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
};

// kind -> [badge colour, symbol, shape]: pickups in colour, shops dark with a gold symbol
export const ICONS = {
  ammo: ['#4f9d2f', 'ammo', 'round'], health: ['#d93b3f', 'health', 'round'], cash: ['#c8940f', 'cash', 'round'],
  gun: ['#e0701f', 'gun', 'round'], word: ['#7d52e8', 'word', 'round'], powerup: ['#3d8fd6', 'powerup', 'round'],
  stairs: ['#eef2f5', 'stairs', 'square'], giant: ['#b3121a', 'skull', 'round'],
  'shop-gun': ['#23272e', 'gun', 'shop'], 'shop-ammo': ['#23272e', 'ammo', 'shop'], 'shop-armour': ['#23272e', 'armour', 'shop'],
  'shop-upgrade': ['#23272e', 'upgrade', 'shop'], 'shop-speed': ['#23272e', 'speed', 'shop'], 'shop-double': ['#23272e', 'double', 'shop'],
};

// what a station's badge shows
export function stationIcon(item) {
  return { ammo: 'shop-ammo', armour: 'shop-armour', upgrade: 'shop-upgrade', stamina: 'shop-speed', double: 'shop-double' }[item] || 'shop-gun';
}

// a badge as SVG markup in a 24x24 box
export function badge(kind) {
  const [bg, sym, shape] = ICONS[kind] || ICONS.gun;
  const glyphFill = shape === 'shop' ? '#ffc861' : shape === 'square' ? '#1c1f24' : '#ffffff';
  const back = shape === 'square'
    ? `<rect x="1" y="1" width="22" height="22" rx="4" fill="${bg}" stroke="rgba(0,0,0,.65)" stroke-width="1.2"/>`
    : `<circle cx="12" cy="12" r="11" fill="${bg}" stroke="${shape === 'shop' ? '#ffc861' : 'rgba(0,0,0,.6)'}" stroke-width="${shape === 'shop' ? 1.4 : 1.2}"/>`;
  const glyph = G[sym].replace(/fill="#fff"/g, `fill="${glyphFill}"`);
  return `${back}<g transform="translate(12 12) scale(.72) translate(-12 -12)" fill="${glyphFill}">${glyph}</g>`;
}

// the badges as images for the minimap's canvas (made once, at the size they're drawn)
export function badgeImages(px) {
  const out = {};
  for (const kind of Object.keys(ICONS)) {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24">${badge(kind)}</svg>`)}`;
    out[kind] = img;
  }
  return out;
}
