export function bufferedInputLinks(events){
  return events.filter(e=>e.type==='accepted'&&e.buffered).flatMap(accepted=>{
    const frame=accepted.source==='c-stick'?(accepted.cActivationFrame??accepted.inputFrame):accepted.inputFrame;
    const buffered=events.find(e=>['buffered','buffer-replaced'].includes(e.type)&&
      e.hitId===accepted.hitId&&e.frame===frame&&e.source===accepted.source);
    return buffered?[{buffered,accepted}]:[];
  });
}

export function frameWaitKind(frame,hitId,events,sample,lockoutFrames=4){
  const local=events.filter(e=>e.hitId===hitId);
  const cWaiting=sample?.pending?.source==='c-stick'&&frame<sample.pending.readyFrame;
  // Event fallback also supports recordings without per-frame pending snapshots.
  const cEventWaiting=local.some(e=>e.type==='buffered'&&e.source==='c-stick'&&e.frame<=frame&&
    frame<(local.find(end=>['accepted','c-refresh-cancelled'].includes(end.type)&&
      end.cActivationFrame===e.cActivationFrame)?.inputFrame??e.readyFrame));
  if(cWaiting||cEventWaiting)return 'c-stick';
  if(local.some(e=>e.type==='accepted'&&frame>e.frame&&frame-e.frame<lockoutFrames))return 'lockout';
  return null;
}
