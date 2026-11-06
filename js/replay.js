export const REPLAY_SPEED=.30;
const clone=value=>JSON.parse(JSON.stringify(value));

export function recordAttempt(samples,events,durationMs,drill) {
  const counts=new Map();
  const recordedEvents=events.map(event=>{
    const e=clone(event);e.timeMs=event.frame*1000/60;
    e.sound=e.type==='outside-hitlag'?'outside':e.type==='accepted'?(e.hitlagFrame===1?'first':'accepted'):null;
    if(e.type==='accepted'){
      const count=(counts.get(e.hitId)||0)+1;counts.set(e.hitId,count);
      const hit=drill.hits.find(h=>h.id===e.hitId);
      e.ding=!!hit && count===Math.max(0,1+Math.floor((hit.lengthFrames-1)/4));
    }
    return e;
  });
  return {samples:clone(samples).sort((a,b)=>a.timeMs-b.timeMs),events:recordedEvents,durationMs};
}

export class AttemptReplay {
  constructor(recording,start,speed=REPLAY_SPEED,range={}){this.recording=recording;this.start=start;this.speed=speed;this.rangeStart=Math.max(0,range.startMs??0);this.rangeEnd=Math.min(recording.durationMs,range.endMs??recording.durationMs);this.eventIndex=recording.events.findIndex(e=>e.timeMs>=this.rangeStart);if(this.eventIndex<0)this.eventIndex=recording.events.length;this.sampleIndex=0;this.timeMs=this.rangeStart;}
  tick(now){
    this.timeMs=Math.max(this.rangeStart,Math.min(this.rangeEnd,this.rangeStart+(now-this.start)*this.speed));
    const due=[];
    while(this.eventIndex<this.recording.events.length && this.recording.events[this.eventIndex].timeMs<=this.timeMs && this.recording.events[this.eventIndex].timeMs<this.rangeEnd)due.push(this.recording.events[this.eventIndex++]);
    const samples=this.recording.samples;
    while(this.sampleIndex+1<samples.length && samples[this.sampleIndex+1].timeMs<=this.timeMs)this.sampleIndex++;
    const a=samples[this.sampleIndex]??{timeMs:0,vector:{x:0,y:0},cStick:{x:0,y:0}};
    const b=samples[this.sampleIndex+1]??a;
    const t=b.timeMs>a.timeMs?Math.max(0,Math.min(1,(this.timeMs-a.timeMs)/(b.timeMs-a.timeMs))):0;
    const interpolate=key=>{const fallback=key==='smoothVector'?'vector':'cStick',av=a[key]??a[fallback],bv=b[key]??b[fallback];return {x:av.x+(bv.x-av.x)*t,y:av.y+(bv.y-av.y)*t};};
    return {timeMs:this.timeMs,vector:interpolate('vector'),cStick:interpolate('cStick'),smoothVector:interpolate('smoothVector'),smoothCStick:interpolate('smoothCStick'),events:due,done:this.timeMs>=this.rangeEnd};
  }
  trail(durationMs=180){
    let first=this.sampleIndex;
    while(first>0 && this.recording.samples[first-1].timeMs>=this.timeMs-durationMs)first--;
    return this.recording.samples.slice(first,this.sampleIndex+1);
  }
}

export function replayStartMs(frame,durationMs){const cursor=Math.max(0,frame*1000/60);return durationMs-cursor<=200?0:Math.min(cursor,Math.max(0,durationMs-1000/60));}
