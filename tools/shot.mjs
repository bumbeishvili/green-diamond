// Dev tool: render the game headlessly and save screenshots.
// Usage: node tools/shot.mjs <outDir> name="query string" [name2="query" ...]
//   e.g. node tools/shot.mjs /tmp/shots court="cam=10,2,5,90,0&time=17.5"
// Env: SHOT_W/SHOT_H (viewport), SHOT_FRAMES (frames to wait), SHOT_URL (base url),
//      SHOT_CHANNEL=chrome to use the installed Google Chrome instead of bundled Chromium.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = execSync('npm root -g').toString().trim();
const { chromium } = await import(pathToFileURL(join(root, 'playwright', 'index.mjs')).href);

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || !specs.length) {
  console.error('usage: node tools/shot.mjs <outDir> name="query" ...');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const base = process.env.SHOT_URL || 'http://127.0.0.1:8765/index.html';
const W = +(process.env.SHOT_W || 1280), H = +(process.env.SHOT_H || 720);
const frames = +(process.env.SHOT_FRAMES || 30);

const browser = await chromium.launch({
  headless: true,
  channel: process.env.SHOT_CHANNEL || undefined,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || "").split("\n").slice(0, 8).join("\n")}`));

const report = {};
for (const spec of specs) {
  const i = spec.indexOf('=');
  const name = spec.slice(0, i), query = spec.slice(i + 1);
  const url = `${base}?autostart&${query}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 180000 });
    const f0 = await page.evaluate(() => window.__game.frameCount || 0);
    await page.waitForFunction((n) => (window.__game.frameCount || 0) >= n, f0 + frames, { timeout: 180000 });
  } catch (e) {
    logs.push(`[timeout] ${name}: ${e.message}`);
  }
  const info = await page.evaluate(() => {
    const g = window.__game;
    const gl = g?.renderer?.getContext();
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      fps: g?.stats?.fps, calls: g?.renderer?.info?.render?.calls, tris: g?.renderer?.info?.render?.triangles,
      gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
      extra: g?.debugInfo ? g.debugInfo() : null,
    };
  });
  const file = join(outDir, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
  report[name] = { ...info, ms: Date.now() - t0, file };
  console.log(name, JSON.stringify(report[name]));
}
if (logs.length) console.log('--- console ---\n' + [...new Set(logs)].slice(0, 40).join('\n'));
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ report, logs }, null, 2));
await browser.close();
