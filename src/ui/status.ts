import { BUILDING } from '../sim/data/buildings';
import { ITEMS } from '../sim/data/items';
import type { GameState } from '../sim/state';
import type { Building } from '../sim/types';

export interface StatusInfo { level: 'ok' | 'warn' | 'bad' | 'info'; glyph: string; title: string; text: string }

/** Every stalled building explains why (pillar 2: readable bottlenecks). */
export function explain(s: GameState, b: Building): StatusInfo {
  const d = BUILDING[b.type];
  const item = b.statusItem ? ITEMS[b.statusItem].name.toLowerCase() : 'input';
  switch (b.status) {
    case 'broken': return { level: 'bad', glyph: '✕', title: 'Broken down', text: b.broken > 0 ? `Repairs in ${Math.ceil(b.broken)}s. Repair now for 10 metal (R), or put it in range of a Service Center or Robot Hub.` : 'Offline due to a grid fault.' };
    case 'worn': return { level: 'warn', glyph: '🔧', title: `Worn out (${Math.round(b.wear * 100)}%)`, text: 'Running, but a breakdown is likely soon. Put it in range of a Service Center (U shows coverage), or overhaul it now for 10 metal (R).' };
    case 'no_power': return { level: 'bad', glyph: '⚡', title: 'No power', text: 'Not connected to any grid. Place a Power Pole or Substation within range.' };
    case 'low_power': {
      const g = s.grids[b.grid];
      const pct = g ? Math.round(g.sat * 100) : 0;
      return { level: pct < 50 ? 'bad' : 'warn', glyph: '⚡', title: `Brownout (${pct}%)`, text: `This grid supplies ${g ? g.gen.toFixed(0) : 0} of ${g ? g.demand.toFixed(0) : 0} power needed. Add generation or batteries, or connect to a stronger grid.` };
    }
    case 'no_input': {
      const linked = s.links.some((l) => l.to === b.id && l.item === b.statusItem);
      return { level: 'warn', glyph: '▲', title: `Starved of ${item}`, text: linked ? `Its ${item} supplier can't keep up. Add producers or check the link for congestion.` : `No ${item} supply linked. Link a producer of ${item} to it (L).` };
    }
    case 'output_full': return { level: 'warn', glyph: '▲', title: 'Output backed up', text: 'Its output has nowhere to go fast enough. Add a link to another consumer or a Depot, or relieve the jam downstream.' };
    case 'no_output_link': return { level: 'warn', glyph: '➜', title: 'No output link', text: `Nothing takes its ${Object.keys(d.outputs ?? {}).map((k) => ITEMS[k as keyof typeof ITEMS].name.toLowerCase()).join('/')}. Link it to a consumer (L).` };
    case 'overheat': return { level: 'warn', glyph: '♨', title: `Overheating (${Math.round(b.heat * 100)}°)`, text: 'Throttled to protect the chips. Pipe more coolant in from a Cooling Tower or Chiller.' };
    case 'night': return { level: 'info', glyph: '☾', title: 'Night', text: 'Solar produces nothing at night. Batteries and firm power carry the load.' };
    case 'calm': return { level: 'info', glyph: '≈', title: 'Low wind', text: 'Output follows the wind. Higher ground and the tundra are windier.' };
    case 'charging': return { level: 'ok', glyph: '▲', title: 'Charging', text: 'Storing surplus energy.' };
    case 'discharging': return { level: 'warn', glyph: '▼', title: 'Discharging', text: 'Covering a supply deficit. It will run dry if the deficit lasts.' };
    case 'idle': return { level: 'info', glyph: '○', title: 'Idle', text: d.battery ? 'Empty. It needs surplus power to charge.' : 'Just built: it starts on the next tick (is time paused? press Space).' };
    default: return { level: 'ok', glyph: '✓', title: 'Running', text: d.short };
  }
}

export function badgeFor(b: Building): 'bad' | 'warn' | null {
  switch (b.status) {
    case 'broken': case 'no_power': return 'bad';
    case 'low_power': return b.powerSat < 0.5 ? 'bad' : null; // mild brownouts are shown grid-wide in the top bar
    case 'no_input': case 'output_full': case 'no_output_link': case 'overheat': case 'worn': return 'warn';
    default: return null;
  }
}
