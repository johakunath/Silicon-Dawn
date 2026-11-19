import type { EventDef } from '../types';

export const EVENTS: EventDef[] = [
  { id: 'dust', name: 'Dust Storm', era: 1, duration: 60, icon: '🌪', warn: 'A dust front is approaching. Solar output will drop.', desc: 'Solar output −60%. Batteries and firm power carry the load.' },
  { id: 'heatwave', name: 'Heatwave', era: 3, duration: 90, icon: '🔥', warn: 'Heatwave forecast. Cooling will struggle.', desc: 'Cooling effectiveness −40%. Overloaded racks will throttle.' },
  { id: 'outage', name: 'Grid Fault', era: 3, duration: 45, icon: '⚡', warn: 'Transmission instability detected. Gas turbines may trip.', desc: 'Gas turbines and the Core generator trip offline. A few buildings break down.' },
  { id: 'drought', name: 'Water Restriction', era: 3, duration: 120, icon: '💧', warn: 'The regional water authority is issuing restrictions.', desc: 'Pumps −60%. Chillers, which need no water, shine here.' },
  { id: 'shortage', name: 'Chip Shortage', era: 4, duration: 120, icon: '📦', warn: 'Supply-chain disruption ahead.', desc: 'Chip and accelerator output −50%, and chip costs +50%.' },
];

export const EVENT: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
