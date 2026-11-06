import {SDIAnalyzer,FRAME_MS} from './analyzer.js';

// Fork only detector state. Probe histories must never alter the live attempt.
export function probeNext(analyzer,frame,left,c,physical=null) {
 const fork=new SDIAnalyzer(analyzer.drill,analyzer.rules);
 for(const key of ['lastAcceptedFrame','lastHitId','previous','qualified','pending'])
  fork[key]=structuredClone(analyzer[key]);
 Object.assign(fork.tilt,structuredClone(analyzer.tilt));
 fork.processFrame(frame,left,frame*FRAME_MS,c,physical);
 const candidate=fork.samples.at(-1).candidate;
 const generated=fork.events.find(e=>!e.buffered && ['accepted','buffered','buffer-replaced','buffer-full'].includes(e.type));
 const executed=fork.events.find(e=>e.type==='accepted');
 return {candidate,outcome:candidate?(generated?.type??'none'):'none',executed:executed?structuredClone(executed):null,cancelled:fork.events.some(e=>e.type==='c-refresh-cancelled')};
}
