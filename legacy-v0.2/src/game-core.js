(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SiliconCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}

  function powerRatio(generation,demand){
    return demand>0?clamp(generation/demand,0,1):1;
  }

  function batteryStep(generation,demand,stored,capacity,maxDischarge,dt,efficiency){
    efficiency=efficiency==null ? .9 : efficiency;dt=Math.max(.001,dt);
    stored=clamp(stored,0,Math.max(0,capacity));let output=0,input=0;
    if(capacity>0&&demand>generation&&stored>0){
      output=Math.min(demand-generation,maxDischarge,stored/dt);stored=Math.max(0,stored-output*dt);generation+=output;
    }else if(capacity>0&&generation>demand&&stored<capacity){
      const added=Math.min((generation-demand)*dt*efficiency,capacity-stored);stored+=added;input=added/dt;
    }
    return{generation,stored,output,input};
  }

  function placementReason(building,cell,biomes,deposits){
    if(!cell)return'Outside the buildable map';
    if(cell.b)return'That tile is already occupied';
    if(building.on==='water')return cell.biome===biomes.WATER?'':'Needs a water tile';
    if(cell.biome===biomes.WATER)return'Needs dry land';
    if(building.on==='si')return cell.dep===deposits.SI?'':'Needs a quartz (silicon) deposit';
    if(building.on==='fe')return cell.dep===deposits.FE?'':'Needs a grey metal deposit';
    if(building.on==='re')return cell.dep===deposits.RE?'':'Needs a purple rare-earth deposit';
    return cell.dep===deposits.NONE?'':'Keep resource deposits clear for extractors';
  }

  function starRating(metrics){
    let stars=1;
    if(metrics.powerRatio>=0.9&&metrics.utilization>=0.45)stars++;
    if(metrics.powerRatio>=0.98&&metrics.utilization>=0.7&&metrics.buildings<=metrics.targetBuildings)stars++;
    return stars;
  }

  function serializeState(state,map){
    return JSON.stringify({
      version:2,
      savedAt:new Date().toISOString(),
      state:{
        res:state.res,level:state.level,time:state.time,agi:state.agi,
        placed:state.placed,battery:state.battery||0,work:state.work,metrics:state.metrics
      },
      buildings:state.b.map(b=>({t:b.t,x:b.x,y:b.y,a:b.a||0,cool:!!b.cool,builtAt:b.builtAt||0})),
      mapSeed:map.seed
    });
  }

  function parseSave(text){
    const data=JSON.parse(text);
    if(!data||data.version!==2||!data.state||!Array.isArray(data.buildings))throw new Error('Unsupported save format');
    return data;
  }

  return{clamp,powerRatio,batteryStep,placementReason,starRating,serializeState,parseSave};
});
