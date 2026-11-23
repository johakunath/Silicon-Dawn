// Diagnostic: print the market once a minute during a headless campaign run.
import { createState } from '../src/sim/state';
import { AutoPlayer } from '../src/sim/autoplayer';
import { step } from '../src/sim/sim';
import { deployedModel, share } from '../src/sim/market';
const seed = Number(process.argv[2] ?? 20261119);
const maxMin = Number(process.argv[3] ?? 140);
const s = createState(seed, 'standard');
const ap = new AutoPlayer(s);
for (let i = 0; i < maxMin * 600; i++) {
  if (i % 20 === 0) ap.think();
  step(s);
  if (s.flags.campaignDone) break;
  if (i % 600 === 0 && s.market.open) {
    const m = s.market, d = deployedModel(s);
    const segs = Object.entries(m.seg).map(([k, v]) => `${k.slice(0, 3)} ${v.served.toFixed(0)}/${v.demand.toFixed(0)}${v.reason ? ' ' + v.reason.slice(0, 3) : ''}`).join(' | ');
    const gws = s.buildings.filter((b) => b.type === 'gateway').length;
    console.log(`t${Math.round(s.time / 60)} era${s.era} rev ${(m.revRate * 60).toFixed(0)}/min lost ${(m.lostRate * 60).toFixed(0)} sup ${s.stats.inferenceRate.toFixed(0)} gw${gws} rep ${m.rep.toFixed(2)} up ${m.uptime.toFixed(2)} load ${m.load.toFixed(2)} fr ${m.frontier.toFixed(2)} model ${d?.name} ${(share(s, d!) * 100).toFixed(0)}% run ${m.run?.name} ${Math.round(m.run!.progress)}/${m.run!.target} trainRate ${s.stats.trainRate.toFixed(0)} cr ${Math.round(s.econ.credits)} | ${segs}`);
  }
}
console.log('done', s.flags.campaignDone, Object.keys(s.done).filter((k) => k.startsWith('e3') || k.startsWith('e4') || k.startsWith('e5')).join(','));
