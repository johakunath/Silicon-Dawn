// "Hand" playtest through the real UI: real mouse clicks & key presses in headless Edge.
// It plays early Era 1 like a new player would, logging toasts, statuses and timings.
import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript('window.__name = (f) => f;');
await page.goto(process.argv[2] ?? 'http://localhost:5173/');
await page.waitForFunction(() => (window as any).__sd);
const log = (...a: unknown[]) => console.log(...a);

// advance real frames quickly (headless rAF may be throttled) – sim at 4x
const frames = (n: number, dt = 1 / 30) => page.evaluate(([n, dt]) => { const g = (window as any).__sd; for (let i = 0; i < n; i++) g.tickFrame(dt); }, [n, dt]);
const simSeconds = async (sec: number) => { const g = 4; for (let i = 0; i < Math.ceil(sec / (g * 0.1 * 3)); i++) await frames(3, 0.1); };
const tileToScreen = (x: number, y: number) => page.evaluate(([x, y]) => {
  const g = (window as any).__sd; const THREE = g.rig.camera.position.constructor;
  const h = g.s.world.level[y * g.s.world.size + x] * 0.55;
  return g.rig.worldToScreen(new THREE(x + 0.5, h, y + 0.5));
}, [x, y]);
const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
const state = () => page.evaluate(() => { const g = (window as any).__sd; const s = g.s; return { t: Math.round(s.time), metal: Math.round(s.stock.metal ?? 0), si: Math.round(s.stock.silicon ?? 0), done: Object.keys(s.done), buildings: s.buildings.map((b: any) => `${b.type}:${b.status}`).join(' '), links: s.links.length }; });

await page.click('#t-new');
await frames(10);
log('started', await state());
const hq = await page.evaluate(() => { const g = (window as any).__sd; const h = g.s.buildings[0]; return { x: h.x, y: h.y }; });

// 1. place solar 3 tiles east of HQ
await page.keyboard.press('1');
let p = await tileToScreen(hq.x + 4, hq.y);
await page.mouse.move(p.x, p.y); await frames(3);
await page.mouse.click(p.x, p.y); await frames(5);
log('after solar', await toasts());
await page.keyboard.press('Escape');

// 2. find nearest quartz tile and place extractor via Industry tab
const dep = await page.evaluate(() => {
  const g = (window as any).__sd; const w = g.s.world; const h = g.s.buildings[0];
  const find = (kind: number) => { let best: any = null, bd = 1e9; for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++) if (w.deposit[y * w.size + x] === kind) { const d = Math.hypot(x - h.x, y - h.y); if (d < bd) { bd = d; best = { x, y, d }; } } return best; };
  return { q: find(1), o: find(2) };
});
log('nearest deposits', dep);
await page.click('button[data-tab="prod"]'); await frames(2);
const clickBuild = async (type: string) => { await page.click(`.bitem[data-type="${type}"]`); await frames(2); };
const placeAt = async (x: number, y: number) => {
  const p = await tileToScreen(x, y);
  await page.mouse.move(p.x, p.y); await frames(3);
  const tip = await page.evaluate(() => (document.querySelector('#tip') as HTMLElement).innerText);
  await page.mouse.click(p.x, p.y); await frames(4);
  return tip.replace(/\n/g, ' | ');
};
await clickBuild('quarry');
log('quarry tip', await placeAt(dep.q.x, dep.q.y));
await clickBuild('furnace');
log('furnace tip', await placeAt(Math.round((dep.q.x + hq.x) / 2), Math.round((dep.q.y + hq.y) / 2) + 2));
await clickBuild('drill');
log('drill tip', await placeAt(dep.o.x, dep.o.y));
await clickBuild('smelter');
log('smelter tip', await placeAt(Math.round((dep.o.x + hq.x) / 2) + 2, Math.round((dep.o.y + hq.y) / 2)));
await page.keyboard.press('Escape');
log('toasts', await toasts());
log('state t0', await state());
await page.screenshot({ path: 'screenshots/playtest_01_first_chain.png' });
await simSeconds(60);
log('state +60s', await state());
// try "Z" next problem
await page.keyboard.press('z'); await frames(10);
const insp = await page.evaluate(() => (document.querySelector('#insp') as HTMLElement).innerText.replace(/\n+/g, ' | '));
log('Z → inspector:', insp.slice(0, 300));
await page.screenshot({ path: 'screenshots/playtest_02_problem.png' });
await simSeconds(120);
log('state +180s', await state());
await page.screenshot({ path: 'screenshots/playtest_03_later.png' });
log('errors', errors);
await browser.close();
