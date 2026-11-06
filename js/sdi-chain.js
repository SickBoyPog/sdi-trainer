export function advanceChain(previous,event){
 const connected=previous&&event.frame-previous.frame===4&&event.hitId===previous.hitId;
 return {frame:event.frame,hitId:event.hitId,level:connected?Math.min(5,previous.level+1):1,baseFrequency:connected?previous.baseFrequency:(event.hitlagFrame===1?1400:900)};
}

