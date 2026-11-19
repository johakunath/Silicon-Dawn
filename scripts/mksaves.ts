// Pre-bakes autoplayer saves for quick screenshot iterations (.cache/eraN.json)
import fs from 'node:fs';
import { createState } from '../src/sim/state';
import { autoplay } from '../src/sim/autoplayer';
import { saveToString } from '../src/sim/save';
fs.mkdirSync('.cache', { recursive: true });
const plan: [number, number][] = [[1, 240], [2, 900], [3, 1800], [4, 2600], [5, 4 * 3600]];
for (const [era, secs] of plan) {
  const s = createState(20261119);
  autoplay(s, era, secs);
  fs.writeFileSync(`.cache/era${era}.json`, saveToString(s));
  console.log('era', era, '→ state era', s.era, 't', Math.round(s.time), 'done', s.flags.campaignDone);
}
