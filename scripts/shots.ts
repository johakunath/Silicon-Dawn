// Screenshot + benchmark harness: drives the real game in headless Edge/Chrome via playwright-core.
// Usage: npx tsx scripts/shots.ts <scenario> [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const scenario = process.argv[2] ?? 'era1';
const url = process.argv[3] ?? 'http://localhost:5173/';
const channel = fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome';

const browser = await chromium.launch({ channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript('window.__name = (f) => f;');
await page.goto(url);
await page.waitForFunction(() => (window as any).__sd);
const out: Record<string, unknown> = {};
const shot = async (name: string) => { await page.screenshot({ path: `screenshots/${name}.png` }); console.log('saved', name); };

// helper in page: start campaign, run autoplayer for N sim seconds, set camera/time
await page.evaluate(async () => {
  const w = window as any;
  w.__h = {
    async run(targetEra: number, seconds: number) {
      const m: any = await import(/* @vite-ignore */ '/src/sim/autoplayer.ts' as string);
      const sim: any = await import(/* @vite-ignore */ '/src/sim/sim.ts' as string);
      const g = w.__sd;
      const ap = new m.AutoPlayer(g.s);
      for (let i = 0; i < seconds * 10; i++) { if (i % 20 === 0) ap.think(); sim.step(g.s); if (g.s.era > targetEra) break; }
      g.s.signals.length = 0;
      g.s.feed.length = 0;
    },
    frames(n: number, dt = 1 / 60) { for (let i = 0; i < n; i++) w.__sd.tickFrame(dt); },
  };
});
const start = async (seed = 20261119) => {
  await page.evaluate((seed) => { const g = (window as any).__sd; g.hud.closeModals(); (document.querySelector('#title') as HTMLElement).classList.remove('show'); (g.hud as any).openModal = null; g.newGame(seed, 'standard'); }, seed);
};
const setView = (o: { x?: number; z?: number; view?: number; tod?: number; overlay?: string; yaw?: number }) => page.evaluate((o) => {
  const g = (window as any).__sd;
  if (o.x !== undefined) { g.rig.target.x = o.x; g.rig.target.z = o.z; }
  if (o.view) { g.rig.view = o.view; (g as any).viewTarget = o.view; }
  if (o.yaw !== undefined) { g.rig.yaw = o.yaw; (g as any).yawTarget = o.yaw; }
  if (o.tod !== undefined) { const s = g.s; const DAY = 240; s.time = s.time - ((s.time / DAY + 0.3) % 1) * DAY + o.tod * DAY; s.tick = Math.round(s.time * 10); }
  if (o.overlay) g.setOverlay(o.overlay);
  (document.querySelector('#banner') as HTMLElement).classList.remove('show');
  g.paused = true;
}, o);

if (scenario === 'title') {
  await page.evaluate(() => (window as any).__h.frames(30));
  await shot('title');
} else {
  await start();
  const plan: Record<string, [number, number]> = { era1: [1, 200], era2: [2, 900], era3: [3, 2400], era4: [4, 5400], era5: [5, 9000] };
  const [era, secs] = plan[scenario] ?? [1, 200];
  await page.evaluate(([e, s]) => (window as any).__h.run(e, s), [era, secs]);
  await page.evaluate(() => { const g = (window as any).__sd; g.view.frontierAnim = 1; g.hud.closeModals(); g.focusCore(true); });
  await setView({ view: 12, tod: 0.45 });
  await page.evaluate(() => (window as any).__h.frames(90));
  await shot(`${scenario}_day`);
  await setView({ tod: 0.97 });
  await page.evaluate(() => (window as any).__h.frames(90));
  await shot(`${scenario}_night`);
  await setView({ view: 22, tod: 0.62 });
  await page.evaluate(() => (window as any).__h.frames(60));
  await shot(`${scenario}_wide`);
  for (const ov of ['power', 'heat', 'network', 'logistics']) {
    await setView({ view: 14, tod: 0.5, overlay: ov });
    await page.evaluate(() => (window as any).__h.frames(30));
    await shot(`${scenario}_ov_${ov}`);
    await page.evaluate((ov) => (window as any).__sd.setOverlay(ov), ov);
  }
  // benchmark: real frame timing over 3s of rendering
  out.bench = await page.evaluate(async () => {
    const g = (window as any).__sd;
    g.paused = false; g.speed = 1;
    const t: number[] = [];
    await new Promise<void>((res) => { let last = performance.now(); let n = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    t.sort((a, b) => a - b);
    return { buildings: g.s.buildings.length, links: g.s.links.length, medianMs: t[90].toFixed(2), p95Ms: t[171].toFixed(2), cpuMs: g.frameMs.toFixed(2), draws: g.rig.renderer.info.render.calls, tris: g.rig.renderer.info.render.triangles };
  });
  out.state = await page.evaluate(() => { const g = (window as any).__sd; return { era: g.s.era, time: Math.round(g.s.time) }; });
}
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
