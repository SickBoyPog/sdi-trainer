/** Character selection intros reuse the voice segment of each character event. */
export function swapAnimationFrame(character, age, voiceFrames=180){
 const duration=character==='diddy'?162:character==='dixie'?42:voiceFrames;
 if(age<0||age>=duration)return null;
 if(character==='diddy')return {kind:age<90?'diddy-idle':'diddy-flip',index:age<90?0:Math.min(19,Math.floor((age-90)/3)),duration,voiceAt:15};
 return {kind:character+'-voice',index:Math.min(character==='dixie'?26:11,Math.floor(age*(character==='dixie'?27:12)/duration)),duration,voiceAt:0};
}
