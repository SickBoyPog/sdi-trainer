import {physicalZone,gameToPhysical} from './zones.js';
export function earlyStarts(hits,events,frames,lookback=3){
 const byFrame=new Map(frames.map(s=>[s.frame,s]));
 return hits.flatMap(hit=>{
  const entry=events.filter(e=>e.type==='outside-hitlag'&&e.frame>=hit.startFrame-lookback&&e.frame<hit.startFrame).at(-1);
  if(!entry)return [];
  for(let frame=entry.frame;frame<=hit.startFrame;frame++){
   const sample=byFrame.get(frame);if(!sample)return [];
   const zone=physicalZone(sample.physicalVector??sample.smoothVector??gameToPhysical(sample.vector));
   if(zone.x===0&&zone.y===0)return [];
  }
  return [{hitId:hit.id,entryFrame:entry.frame,framesEarly:hit.startFrame-entry.frame}];
 });
}
