import { PROFILES, autoProfile, pointerEnv, type ProfileChoice } from '../render/quality';
import type { Game } from '../game/game';

/** Graphics rows for the menu: profile (Auto / Performance / Quality) and frame rate limit. */
export function graphicsRows(g: Game): string {
  const q = g.quality;
  const choice = q.gfx.profile;
  const auto = autoProfile(pointerEnv());
  const p = q.spec;
  const cap = q.gfx.fpsCap;
  const seg = (id: string, cur: boolean, label: string) => `<button data-gfx="${id}" class="${cur ? 'on' : ''}">${label}</button>`;
  const note = choice === 'auto'
    ? `Auto picked <b>${PROFILES[auto].label}</b> (${auto === 'performance' ? 'touch screen' : 'mouse'}).`
    : `${p.label} profile.`;
  const what = q.profile === 'performance'
    ? 'Lower resolution, light shadows, half-size glow, fewer particles, 30 fps (60 while you pan or zoom), 10 fps when paused and still. Keeps a tablet cool.'
    : 'Full resolution, 8× anti-aliasing, sharp soft shadows, full glow.';
  return `
      <div class="setrow"><label>Graphics</label><div style="display:flex;gap:6px">${seg('auto', choice === 'auto', 'AUTO')}${seg('performance', choice === 'performance', 'PERFORMANCE')}${seg('quality', choice === 'quality', 'QUALITY')}</div></div>
      <div class="setrow" style="margin-top:-6px"><label></label><span style="flex:1;font-size:14px;color:#93a4c4">${note} ${what}</span></div>
      <div class="setrow"><label>Frame rate limit</label><div style="display:flex;gap:6px">${seg('fpsauto', cap === null, q.spec.fps ? `AUTO (${q.spec.fps}${q.spec.activeFps ? `/${q.spec.activeFps}` : ''})` : 'AUTO')}${seg('fps30', cap === 30, '30 FPS')}${seg('fps60', cap === 60, '60 FPS')}${seg('fps0', cap === 0, 'NO LIMIT')}</div></div>`;
}

export function bindGraphics(root: HTMLElement, g: Game, reopen: () => void) {
  root.querySelectorAll<HTMLElement>('[data-gfx]').forEach((b) => (b.onclick = () => {
    const v = b.dataset.gfx!;
    if (v === 'fpsauto') g.quality.setFpsCap(null);
    else if (v.startsWith('fps')) g.quality.setFpsCap(Number(v.slice(3))); // an explicit cap is held exactly, also while panning
    else g.quality.setChoice(v as ProfileChoice);
    reopen();
  }));
}
