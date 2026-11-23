// Screenshot + benchmark harness: drives the real game in headless Edge/Chrome via playwright-core.
// Usage: npx tsx scripts/shots.ts <scenario> [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const scenario = process.argv[2] ?? 'era1';
const url = process.argv[3] ?? 'http://localhost:5173/';
const channel = fs.existsSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe') ? 'msedge' : 'chrome';
// Linux cloud containers: bundled Chromium with software WebGL (slow, but fine for relative profile comparisons)
const linuxChromium = '/opt/pw-browsers/chromium';
const local = process.platform === 'linux' && fs.existsSync(linuxChromium);
// GFX=performance|quality picks the graphics profile; TABLET=1 emulates an 11-inch tablet (1280×800, DPR 2, touch)
const gfx = process.env.GFX;
const tablet = !!process.env.TABLET;

const browser = await chromium.launch(local
  ? { executablePath: linuxChromium, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] }
  : { channel, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(tablet ? { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript('window.__name = (f) => f;');
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => (window as any).__sd, null, { timeout: 120000 });
// benchmarks measure the cost of every frame, so the profile's frame cap is lifted (fpsCap 0)
if (gfx) await page.evaluate((gfx) => { const g = (window as any).__sd; g.quality.setChoice(gfx); g.quality.setFpsCap(0); }, gfx);
const out: Record<string, unknown> = {};
const shotDir = process.env.SHOTDIR ?? 'screenshots';
const shot = async (name: string) => { if (process.env.NOSHOT) return; await page.screenshot({ path: `${shotDir}/${name}.png`, timeout: 180000 }); console.log('saved', name); };

// helper in page: start campaign, run autoplayer for N sim seconds, set camera/time
await page.evaluate(async () => {
  const w = window as any;
  w.__h = {
    async run(targetEra: number, seconds: number) {
      const m: any = await import(/* @vite-ignore */ '/src/sim/autoplayer.ts' as string);
      const sim: any = await import(/* @vite-ignore */ '/src/sim/sim.ts' as string);
      const g = w.__sd;
      const ap = new m.AutoPlayer(g.s);
      for (let i = 0; i < seconds * 10; i++) { if (i % 20 === 0) ap.think(); sim.step(g.s); if (g.s.era > targetEra || g.s.flags.campaignDone) break; }
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

if (scenario === 'stress') {
  // sandbox with 600+ buildings and active flow; then measure real frame times
  await page.evaluate(async () => {
    const g = (window as any).__sd;
    g.hud.closeModals(); (document.querySelector('#title') as HTMLElement).classList.remove('show'); (g.hud as any).openModal = null;
    g.newGame(20261119, 'standard', 'sandbox');
    const A: any = await import(/* @vite-ignore */ '/src/sim/actions.ts' as string);
    const sim: any = await import(/* @vite-ignore */ '/src/sim/sim.ts' as string);
    const s = g.s;
    s.stock = { metal: 1e7, silicon: 1e7, chips: 1e7, accel: 1e6 };
    const h = s.buildings[0];
    const cx = h.x + 1, cy = h.y + 1;
    const mix = ['solar', 'pole', 'rack', 'rack', 'cooler', 'pump', 'quarry', 'drill', 'furnace', 'smelter', 'battery', 'hall', 'pod', 'wind', 'lab', 'gas', 'chiller', 'substation', 'switch', 'fab', 'depot', 'gateway'];
    let k = 0;
    for (let r = 2; r < 60 && s.buildings.length < 650; r++) {
      for (let a = 0; a < r * 6; a++) {
        const ang = (a / (r * 6)) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
        const type = mix[k++ % mix.length];
        if (A.checkPlace(s, type, x, y).ok) A.place(s, type, x, y);
      }
    }
    for (let i = 0; i < 300; i++) sim.step(s);
    s.signals.length = 0; s.feed.length = 0;
  });
  await setView({ view: 40, tod: 0.95 });
  await page.evaluate(() => { const g = (window as any).__sd; g.paused = false; g.speed = 1; });
  await page.evaluate(() => (window as any).__h.frames(30));
  await shot('stress_night');
  out.bench = await page.evaluate(async (N) => {
    const g = (window as any).__sd;
    g.paused = false; g.speed = 1; g.settings.showFps = true; g.applySettings();
    const t: number[] = [];
    const cpu: number[] = [];
    await new Promise<void>((res) => { let n = 0; const w = () => { if (++n < Math.min(90, N / 3)) requestAnimationFrame(w); else res(); }; requestAnimationFrame(w); }); // warm-up (shader compiles)
    await new Promise<void>((res) => { let last = performance.now(); let n = 0; const f = () => { const now = performance.now(); t.push(now - last); cpu.push(g.frameMs); last = now; if (++n < N) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    t.sort((a, b) => a - b);
    const at = (q: number) => t[Math.floor(t.length * q)];
    return { profile: g.quality.profile, dpr: g.rig.renderer.getPixelRatio(), msaa: g.rig.composer.renderTarget1.samples, shadow: g.rig.sun.shadow.mapSize.x, buildings: g.s.buildings.length, links: g.s.links.length, medianMs: at(0.5).toFixed(2), p95Ms: at(0.95).toFixed(2), fpsMedian: (1000 / at(0.5)).toFixed(0), cpuMs: g.frameMs.toFixed(2) };
  }, Number(process.env.FRAMES ?? 300));
  if (process.env.PROFILE) {
    out.profile = await page.evaluate(async () => {
      const g = (window as any).__sd;
      const sim: any = await import(/* @vite-ignore */ '/src/sim/sim.ts' as string);
      const stats: Record<string, number[]> = {};
      const wrap = (obj: any, key: string, name: string) => { const o = obj[key].bind(obj); obj[key] = (...a: any[]) => { const t = performance.now(); const r = o(...a); (stats[name] ??= []).push(performance.now() - t); return r; }; };
      wrap(g.view, 'update', 'view');
      wrap(g.hud, 'update', 'hud');
      wrap(g.rig, 'render', 'render');
      wrap(g.view.buildings, 'update', 'buildings');
      wrap(g.view.links, 'update', 'links');
      wrap(g.view, 'refreshOverlay', 'overlay');
      wrap(g.view.particles, 'update', 'particles');
      const so = g.s; let steps: number[] = []; const st0 = sim.step;
      const frameT: number[] = [];
      for (let i = 0; i < 400; i++) { const t = performance.now(); const a = performance.now(); g.tickFrame(1 / 60); frameT.push(performance.now() - t); void a; }
      void so; void steps; void st0;
      const summ = (arr: number[]) => { const s2 = [...arr].sort((a, b) => a - b); return `n${arr.length} med ${s2[Math.floor(s2.length / 2)].toFixed(2)} max ${s2[s2.length - 1].toFixed(1)} sum ${arr.reduce((a, b) => a + b, 0).toFixed(0)}`; };
      const o: Record<string, string> = { frame: summ(frameT) };
      for (const [k, v] of Object.entries(stats)) o[k] = summ(v);
      return o;
    });
  }
  if (process.env.PERFBISECT) {
    const measure = () => page.evaluate(async () => { const t: number[] = []; await new Promise<void>((res) => { let last = performance.now(); let n = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++n < 120) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); t.sort((a, b) => a - b); return t[60].toFixed(1) + " / p95 " + t[114].toFixed(1); });
    const v: Record<string, string> = { base: await measure() };
    await page.evaluate(() => { (document.querySelector('#badges') as HTMLElement).style.display = 'none'; });
    v.noBadges = await measure();
    await page.evaluate(() => { (document.querySelector('#ui') as HTMLElement).style.display = 'none'; });
    v.noUi = await measure();
    await page.evaluate(() => { const g = (window as any).__sd; g.rig.renderer.shadowMap.enabled = false; g.rig.sun.castShadow = false; g.rig.scene.traverse((o: any) => { if (o.material) o.material.needsUpdate = true; }); });
    v.noShadow = await measure();
    await page.evaluate(() => { const g = (window as any).__sd; g.rig.bloom.enabled = false; });
    v.noShadowNoBloom = await measure();
    await page.evaluate(() => { const g = (window as any).__sd; g.view.particles.points.visible = false; });
    v.noParticles = await measure();
    await page.evaluate(() => { const g = (window as any).__sd; g.view.water.mesh.visible = false; });
    v.noWater = await measure();
    await page.evaluate(() => { const g = (window as any).__sd; g.view.props.group.visible = false; });
    v.noProps = await measure();
    out.perf = v;
  }
  await setView({ view: 18, tod: 0.5 });
  await page.evaluate(() => (window as any).__h.frames(30));
  await shot('stress_day_close');
} else if (scenario === 'title') {
  await page.evaluate(() => (window as any).__h.frames(30));
  await shot('title');
} else {
  await start();
  const cache = `.cache/${scenario}.json`;
  if (fs.existsSync(cache)) {
    const json = fs.readFileSync(cache, 'utf8');
    await page.evaluate((j) => { const g = (window as any).__sd; g.loadJson(j); g.s.feed.length = 0; g.s.signals.length = 0; document.querySelectorAll('.toast').forEach((t) => t.remove()); }, json);
    if (process.env.DBG) await page.evaluate((code) => eval(code), process.env.DBG);
  } else {
    const plan: Record<string, [number, number]> = { era1: [1, 200], era2: [2, 900], era3: [3, 2400], era4: [4, 5400], era5: [5, 9000] };
    const [era, secs] = plan[scenario] ?? [1, 200];
    await page.evaluate(([e, s]) => (window as any).__h.run(e, s), [era, secs]);
  }
  await page.evaluate(() => { const g = (window as any).__sd; g.view.frontierAnim = 1; g.hud.closeModals(); g.focusCore(true); });
  await setView({ view: 12, tod: 0.45 });
  await page.evaluate(() => (window as any).__h.frames(90));
  await shot(`${scenario}_day`);
  await setView({ view: 6.5, tod: 0.4 });
  await page.evaluate(() => (window as any).__h.frames(60));
  await shot(`${scenario}_closeup`);
  await setView({ view: 12, tod: 0.45 });
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
  if (scenario === 'era5') {
    // finale: focus the engine, ignite, night
    await page.evaluate(() => { const g = (window as any).__sd; const e = g.s.buildings.find((b: any) => b.type === 'engine'); if (e) { g.rig.target.x = e.x + 2; g.rig.target.z = e.y + 2; } g.finale = 0.12; });
    await setView({ view: 20, tod: 0.95 });
    await page.evaluate(() => (window as any).__h.frames(60));
    await shot('era5_finale_wave');
    await page.evaluate(() => { (window as any).__sd.finale = 0.6; });
    await setView({ view: 30, tod: 0.97 });
    await page.evaluate(() => (window as any).__h.frames(60));
    await shot('era5_finale_aurora');
  }
  // benchmark: real frame timing over 3s of rendering
  out.bench = await page.evaluate(async (N) => {
    const g = (window as any).__sd;
    g.paused = false; g.speed = 1;
    const t: number[] = [];
    await new Promise<void>((res) => { let last = performance.now(); let n = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++n < 180) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    t.sort((a, b) => a - b);
    return { profile: g.quality.profile, dpr: g.rig.renderer.getPixelRatio(), msaa: g.rig.composer.renderTarget1.samples, shadow: g.rig.sun.shadow.mapSize.x, buildings: g.s.buildings.length, links: g.s.links.length, medianMs: t[90].toFixed(2), p95Ms: t[171].toFixed(2), cpuMs: g.frameMs.toFixed(2), draws: g.rig.renderer.info.render.calls, tris: g.rig.renderer.info.render.triangles };
  });
  out.state = await page.evaluate(() => { const g = (window as any).__sd; return { era: g.s.era, time: Math.round(g.s.time) }; });
}
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
