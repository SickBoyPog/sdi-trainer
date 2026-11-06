import {advanceChain} from './sdi-chain.js';

/** Owns sound generation and audio preferences. Session decisions remain in app.js. */
export function createTrainerAudio({getPreset, document=globalThis.document, window=globalThis.window, storage=globalThis.localStorage}) {
  const $ = selector => document.querySelector(selector);
let audio,sdiSoundChain=null;
function initAudio(){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audio??=new Audio();audio.resume()?.catch(()=>{});}catch{audio=null;}}
const diddyDeathSounds=['43-gnawty.wav', '41-diddyedge.wav', '66-mininecky.wav', '43-gnawty(1).wav', '13-dkhowl.wav', '5E-donkeybarrel.wav', '5D-diddybarrel(1).wav', '3F-donkey.wav', '01-tire.wav', '58-animalbuddy.wav', '49-kritter.wav', '48-klump.wav', '46-donkeyhurt.wav', '42-klaptrapdeath.wav'];
function sound(kind,event=null){
 try{
 if(!audio || !document.querySelector("#soundEnabled").checked) return;
 // SDI Sound controls all input feedback, including outside-hitlag ticks.
 if(['accepted','first','outside','ding'].includes(kind)&&!$('#sdiSound').checked)return;
 if(kind==='collect'||kind==='starve'||kind==='celebrate'||kind==='bunch'||kind==='dkvoice'||kind==='dixievoice'||(kind==='start'&&getPreset()==='Diddy Kong Want Banana!')){
  const file=kind==='dixievoice'?'dixie-unlock.wav':kind==='bunch'?'banana-bunch.wav':kind==='dkvoice'?'dk-unlock.m4a':kind==='celebrate'?'SE_HiImDiddy.wav':kind==='start'?'2D-off.wav':kind==='collect'?'21-banana.wav':diddyDeathSounds[Math.floor(Math.random()*diddyDeathSounds.length)];
  const clip=new window.Audio(`assets/dwb/audio/${file}`);clip.volume=Number(document.querySelector('#volume').value)*(kind==='start'?.4:kind==='dixievoice'?.3:kind==='celebrate'?.8:1);if(kind==='start'){clip.preservesPitch=false;clip.playbackRate=.75;}void clip.play().catch(()=>{});return;
 }

 if(kind==='clear'){
  if(!$('#sessionSound').checked)return;
  for(const [offset,freq] of [[0,660],[.065,440]]){const t=audio.currentTime+offset,o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.09*Number($('#volume').value)+.0001,t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+.09);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.095);}return;
 }
 const group=kind==="outside"?"outsideSound":kind==="ding"?"dingSound":["start","end"].includes(kind)?"sessionSound":"sdiSound";
 if(!document.querySelector("#"+group).checked)return;
 const t=audio.currentTime, o=audio.createOscillator(),g=audio.createGain(),filter=audio.createBiquadFilter();
 const settings={accepted:[900,.045,.15],first:[1400,.055,.18],outside:[360,.04,.045],ding:[1200,.16,.11],start:[600,.1,.1],end:[480,.14,.1]};
 let [freq,duration,volume]=settings[kind];if($('#risingSdiSound').checked&&event?.type==='accepted'&&(kind==='accepted'||kind==='first')){sdiSoundChain=advanceChain(sdiSoundChain,event);freq=sdiSoundChain.baseFrequency*[1,1.12246,1.25992,1.41421,1.58740][sdiSoundChain.level-1];}o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(freq*.65,t+duration);
 filter.type="lowpass";filter.frequency.value=kind==="outside"?450:kind==="ding"?1800:6000;
 g.gain.setValueAtTime(volume*Number(document.querySelector("#volume").value),t);g.gain.exponentialRampToValueAtTime(.0001,t+duration);
 o.connect(filter);filter.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+duration);
 }catch{/* Audio failure must never interrupt controls or the render loop. */}
}

function installSettings(){
$('#risingSdiSound').addEventListener('change',()=>{sdiSoundChain=null;});
const settingsIds=["risingSdiSound","soundEnabled","volume","sdiSound","outsideSound","dingSound","sessionSound"];
try{const saved=JSON.parse(storage.getItem("sdi-audio-v4")||"{}");for(const id of settingsIds){const el=document.querySelector("#"+id);if(id in saved){if(el.type==="checkbox")el.checked=saved[id];else el.value=saved[id];}}}catch{}
for(const id of settingsIds)document.querySelector("#"+id).addEventListener("change",()=>storage.setItem("sdi-audio-v4",JSON.stringify(Object.fromEntries(settingsIds.map(id=>{const e=document.querySelector("#"+id);return[id,e.type==="checkbox"?e.checked:e.value];})))));
function updateVolumeLabel(){$("#volumeValue").value=`${Math.round(Number($("#volume").value)*100)}%`;}
$("#volume").addEventListener("input",updateVolumeLabel);updateVolumeLabel();

}
return {initialize:initAudio,play:sound,resetChain:()=>{sdiSoundChain=null;},installSettings};
}
