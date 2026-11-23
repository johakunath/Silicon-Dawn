import { audio } from '../audio/audio';
import { BUILDING } from '../sim/data/buildings';
import type { Game } from '../game/game';

/** What the Cancel pill says for the current tool and selection (null = hidden). Mirrors right-click and Esc. */
export function cancelLabel(tool: Game['tool'], selectedName: string | null, linkSelected: boolean): string | null {
  switch (tool.kind) {
    case 'build': return `CANCEL · ${BUILDING[tool.type]?.name ?? 'build'}`;
    case 'link': return tool.from === null ? 'CANCEL · Link' : 'CANCEL · Link start';
    case 'demolish': return 'CANCEL · Demolish';
    case 'move': return 'CANCEL · Move';
    default: return selectedName ? `DESELECT · ${selectedName}` : linkSelected ? 'DESELECT · Link' : null;
  }
}

/**
 * Touch rail on the right edge (rotate, zoom, copy, next problem, Core) and a red Cancel pill above the hotbar.
 * Visible only in touch mode (body.touch). Tools, pause and speed already have on-screen buttons.
 */
export class TouchBar {
  private rail: HTMLElement;
  private pill: HTMLButtonElement;
  private copyBtn!: HTMLButtonElement;
  private lastPill = '';

  constructor(private g: Game, root: HTMLElement) {
    this.rail = document.createElement('div');
    this.rail.id = 'touchrail';
    this.rail.className = 'panel';
    const btn = (icon: string, label: string, tip: string, fn: () => void) => {
      const b = document.createElement('button');
      b.innerHTML = `<span class="ti">${icon}</span><span class="tl">${label}</span>`;
      b.dataset.tip = tip;
      b.onclick = () => { fn(); audio.play('click'); };
      this.rail.appendChild(b);
      return b;
    };
    btn('⟲', 'ROTATE', '<b>Rotate left</b> (Q)<br>Or twist two fingers.', () => g.rotateStep(1));
    btn('⟳', 'ROTATE', '<b>Rotate right</b> (E)<br>Or twist two fingers.', () => g.rotateStep(-1));
    btn('＋', 'ZOOM', '<b>Zoom in</b><br>Or pinch outwards.', () => g.zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.35));
    btn('－', 'ZOOM', '<b>Zoom out</b><br>Or pinch inwards.', () => g.zoomAt(innerWidth / 2, innerHeight / 2, 1.35));
    this.copyBtn = btn('⧉', 'COPY', '<b>Build another</b> (G)<br>Starts building the same type as the selected building.', () => g.pipette());
    btn('⚠', 'PROBLEM', '<b>Next problem</b> (Z)<br>Jumps to the next building that needs attention.', () => g.nextProblem());
    btn('◎', 'CORE', '<b>Back to the Core</b> (C)', () => g.focusCore());
    root.appendChild(this.rail);

    this.pill = document.createElement('button');
    this.pill.id = 'cancelpill';
    this.pill.onclick = () => g.onSecondary();
    root.appendChild(this.pill);
    window.setInterval(() => this.refresh(), 150);
  }

  refresh() {
    const g = this.g;
    const sel = g.view.selected;
    const label = cancelLabel(g.tool, sel ? BUILDING[sel.type].name : null, !!g.selectedLink);
    const key = label ?? '';
    if (key !== this.lastPill) {
      this.lastPill = key;
      this.pill.textContent = label ? `✕  ${label}` : '';
      this.pill.classList.toggle('show', !!label);
    }
    this.copyBtn.disabled = !sel || sel.type === 'hq';
  }
}
