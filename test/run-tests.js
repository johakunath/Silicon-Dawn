'use strict';
const assert=require('node:assert/strict');
const Core=require('../src/game-core.js');

const TB={GRASS:0,WATER:4};
const DEP={NONE:0,SI:1,FE:2,RE:3};
const land={biome:TB.GRASS,dep:DEP.NONE,b:null};

assert.equal(Core.powerRatio(4,8),0.5);
assert.equal(Core.powerRatio(0,0),1);
assert.equal(Core.powerRatio(10,2),1);
assert.deepEqual(Core.batteryStep(2,8,12,60,10,1,1),{generation:8,stored:6,output:6,input:0});
assert.deepEqual(Core.batteryStep(10,4,0,60,10,1,.9),{generation:10,stored:5.4,output:0,input:5.4});
assert.equal(Core.placementReason({on:'land'},land,TB,DEP),'');
assert.equal(Core.placementReason({on:'si'},land,TB,DEP),'Needs a quartz (silicon) deposit');
assert.equal(Core.placementReason({on:'si'},{...land,dep:DEP.SI},TB,DEP),'');
assert.equal(Core.placementReason({on:'water'},land,TB,DEP),'Needs a water tile');
assert.equal(Core.starRating({powerRatio:1,utilization:.8,buildings:10,targetBuildings:12}),3);

const original={
  res:{si:12,fe:4},level:2,time:33,agi:0,battery:27,placed:3,
  work:{training:12,inference:0},metrics:{},
  b:[{t:'solar',x:2,y:3,a:1,cool:false,builtAt:2}]
};
const saved=Core.serializeState(original,{seed:20260705});
const parsed=Core.parseSave(saved);
assert.equal(parsed.version,2);
assert.equal(parsed.state.battery,27);
assert.deepEqual(parsed.buildings[0],original.b[0]);
assert.throws(()=>Core.parseSave('{"version":1}'),/Unsupported save format/);

console.log('Silicon Dawn core tests passed');
