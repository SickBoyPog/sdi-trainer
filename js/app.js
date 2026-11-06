import {createPresetEditor} from './preset-editor.js';
import {createSdiGuide} from './sdi-guide.js';
import {swapAnimationFrame} from './character-swap.js';
import {bufferedInputLinks,frameWaitKind} from './timeline-presentation.js';
import {createDwbDrawing} from './dwb-drawing.js';
import {createAttemptHistory,trimAttemptHistory,personalBestStorageKey,eligibleForPersonalBest,beatsPersonalBest} from './attempt-history.js';
import {createSessionControls} from './session-controls.js';
import {createTrainerAudio} from './audio.js';
import {includedHits,fullHitCoverage,moveRange} from './practice-range.js';
import {earlyStarts} from './early-starts.js';
import {OrbGame,orbStep} from "./orb-game.js";
import {physicalZone,gameToPhysical,netDirection} from "./zones.js";
import {drawZoneOverlay} from "./zone-overlay.js";
import {probeNext} from "./guidance.js";
import {AttemptReplay,recordAttempt,replayStartMs} from "./replay.js";
import { ComboVideo } from "./video.js";
import { ControllerControls } from "./controls.js";
import { GCAdapterNativeBridge } from "./adapter.js";
import {
  FRAME_MS,
  makePreset,
  possibleInputs,
  SDIAnalyzer,
  TiltStickInput,
  hasNewDirectionalComponent,
  directionVector,
  flattenTargets,
  makeDefaultDrill,
  normalizeRawStick,
  normalizeSmoothStick,
  smoothToGame,
  vectorInfo,
} from "./analyzer.js";
import {
  drillFromSequence,
  parseSequence,
  sequenceFromDrill,
} from "./sequence.js";

const $ = (selector) => document.querySelector(selector);
function applyTheme(theme){const windows=theme==='windows';$('#windowsTheme').disabled=!windows;document.body.dataset.theme=windows?'windows':'original';$('#themeSwitch').setAttribute('aria-checked',String(windows));}
applyTheme(localStorage.getItem('sdi-theme-v122')||'windows');
$('#themeSwitch').onclick=()=>{const theme=document.body.dataset.theme==='windows'?'original':'windows';applyTheme(theme);localStorage.setItem('sdi-theme-v122',theme);};

let presetEditor;
let orbLossStartedAt=null;
let bananaTimelineDrag=null,bananaTimelineViewFrame=null,bananaSeekPending=false;
let bananaSettingsLocked=true,bananaFixedDirections=false;
let bananaDirections=Array.from({length:16},(_,i)=>i);
let showBufferLines=localStorage.getItem("sdi-show-buffer-lines")==="true";
let showEarlyMarkers=localStorage.getItem("sdi-show-early-markers")!=="false";
let personalBests={},newBestPreset=null,bestReplayPreviousSpeed=null,pendingClearBestKey=null;
let practiceRange={start:0,end:null},runPracticeRange={start:0,end:null},draggingPractice=null,pendingPracticeSeek=null,practiceSeekBusy=false;
let previousVisualZone=null,visualZoneContext=null;
let visualTiltInput=new TiltStickInput();
const visualZoneFlashes=new Map();
let showActiveZones=localStorage.getItem('sdi-active-zones')!=='false';
$('#showActiveZones').checked=showActiveZones;
$('#showActiveZones').onchange=e=>{showActiveZones=e.target.checked;localStorage.setItem('sdi-active-zones',String(showActiveZones));};
const elements = {
  connectionDot: $("#connectionDot"),
  connectionText: $("#connectionText"),
  connectButton: $("#connectButton"),
  startButton: $("#startButton"),
  stopButton: $("#stopButton"),
  portSelect: $("#portSelect"),
  thresholdInput: $("#thresholdInput"),
  thresholdOutput: $("#thresholdOutput"),
  stickCanvas: $("#stickCanvas"),
  timelineCanvas: $("#timelineCanvas"),
  inputMode: $("#inputMode"),
  cueBadge: $("#cueBadge"),
  rawX: $("#rawX"),
  rawY: $("#rawY"),
  magnitude: $("#magnitude"),
  angle: $("#angle"),
  pollRate: $("#pollRate"),
  controllerState: $("#controllerState"),
  notice: $("#notice"),
  connectionLog: $("#connectionLog"),
  copyDiagnosticsButton: $("#copyDiagnosticsButton"),
  clock: $("#clock"),
  resultsPanel: $("#resultsPanel"),
  scoreValue: $("#scoreValue"),
  resultTitle: $("#resultTitle"),
  resultSummary: $("#resultSummary"),
  metrics: $("#metrics"),
  coaching: $("#coaching"),
  sdiFlash: $("#sdiFlash"),
  acceptedLiveCount: $("#acceptedLiveCount"),
  durationLabel: $("#durationLabel"),
};

const DEFAULT_CALIBRATION = {
  centerX: 128,
  centerY: 128,
  minX: 28,
  maxX: 228,
  minY: 28,
  maxY: 228,
};

let drill = makeDefaultDrill();
let targets = flattenTargets(drill);
let sequence = sequenceFromDrill(drill);
let sdiGuide=null,guideSavedInspection=null,guidePractice=null;
const adapter = new GCAdapterNativeBridge();
const controllerControls = new ControllerControls();
let analyzer = new SDIAnalyzer(drill);
const calibration = {...DEFAULT_CALIBRATION};
localStorage.removeItem("sdi-calibration");localStorage.removeItem("sdi-c-calibration");
const cCalibration = {...DEFAULT_CALIBRATION};
let hardwareConnected = false;
let rawInput = { x: 128, y: 128 };
let currentVector = { x: 0, y: 0 };
let currentCStick = {x:0,y:0};
let smoothVector={x:0,y:0},smoothCStick={x:0,y:0},replaySmoothVector={x:0,y:0},replaySmoothCStick={x:0,y:0};
let stickDisplay=localStorage.getItem("sdi-stick-display")==="ultimate-only"?"ultimate-only":"ultimate";
let cFlashUntil=0;
let sampleBuffer = [{ time: performance.now(), vector: currentVector }];
let selectedPort = 0;
let controllerNeedsRelease=true,controllerReleaseSince=null;
let controllerTraceKey='';
const controllerButtonTrace=[];
function traceControllerButtons(pad){
  const state={buttons1:pad.buttons1,buttons2:pad.buttons2,triggerL:pad.triggerL,triggerR:pad.triggerR,
    awaitingRelease:controllerNeedsRelease,settings:$('#settingsDrawer').open,
    developerMenu:$('#orbDevMenu').open,frameTest:$('#frameTest').open,
    running,starting,replaying,replayPreparing,presetLoading,characterSwap:!!orbSwapAnimation,
    hasAttempt:!!recording,preset:selectedPreset};
  const key=JSON.stringify(state);
  if(key===controllerTraceKey)return;
  controllerTraceKey=key;
  controllerButtonTrace.push({at:new Date().toISOString(),...state});
  if(controllerButtonTrace.length>30)controllerButtonTrace.shift();
  updateDiagnostics({controllerButtons:controllerButtonTrace});
}
function resetControllerActions(){controllerControls.reset();controllerNeedsRelease=true;controllerReleaseSince=null;previousY=false;previousStartMenu=false;previousDevChord=false;sampleBuffer.length=0;addSample({x:0,y:0});}

let running = false;
let starting = false;
let replaying=false,replayPreparing=false,replay=null,recording=null;

let warmup=null;

let personalBestRenderKey="",earlyStartCache=null;
let recentAttempts=[];
let inputDelayFrames=Number(localStorage.getItem("sdi-input-delay-v2")??3),runInputDelayFrames=3;
const delayedLiveSample=()=>sampleAt(performance.now()-inputDelayFrames*FRAME_MS);
let replayPlaybackSpeed=1;
let inspection=null,attemptFrames=[],replayRange={startMs:0,endMs:null},replaySpeed=Number(localStorage.getItem("sdi-replay-speed-v2")||100)/100;
let attemptSamples=[],replayVector={x:0,y:0},replayCStick={x:0,y:0};
let selectionGeneration = 0,presetLoading=false;
let sessionOperation=0,attemptRestoreOperation=0;
let pausedReplay=null;
const comboVideo = new ComboVideo($("#comboVideo"), (state, label) => {
  $("#videoStatus").textContent = label;
  const blocked = state !== "empty" && state !== "ready";
  elements.startButton.disabled = presetLoading || running || starting || replaying || blocked || (selectedPreset==="Diddy Kong Want Banana!"&&!bananaDirections.length);
  
  $("#replayButton").disabled=!recording || running || starting || (!replaying && blocked);
}, (message) => {if(replaying || replayPreparing)stopReplay(message);else stopRun(message);});

let dixieUnlocked=localStorage.getItem('sdi-dixie-unlocked')==='true';
let dkUnlocked=localStorage.getItem('sdi-dk-unlocked')==='true',orbCharacter='diddy',orbCharacterPreview=false,orbSwapAnimation=null,runOrbCharacter='diddy',previousY=false,previousStartMenu=false,previousDevChord=false,dkVoiceFrames=180,pendingOrbTest=null;
let runStart = 0;
let currentFrame = 0;
let lastProcessedFrame = -1;
let lastEventFlash = null;
let liveAcceptedCount = 0;
let hoveredHitId=null;
let inspectedHitId=null, inspectorMarkers=[], inspectorSignature="";
let connectionDiagnostics = { browser: navigator.userAgent, transport: "native libusb bridge" };
const pressedKeys = new Set();


function setNotice(title, message, type = "") {
  elements.notice.className = `notice ${type}`.trim();
  elements.notice.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
}

function setConnection(label, type = "demo") {
  if(elements.connectionText.textContent!==label) elements.connectionText.textContent = label;
  const className=`status-dot ${type}`.trim();
  if(elements.connectionDot.className!==className) elements.connectionDot.className=className;
}

function addSample(vector, time = performance.now(), cStick = {x:0,y:0}, smooth=gameToPhysical(vector), smoothC=cStick) {
  smoothVector={...smooth};smoothCStick={...smoothC};
  if(Math.hypot(cStick.x,cStick.y)>=.5 && Math.hypot(currentCStick.x,currentCStick.y)<.5)cFlashUntil=performance.now()+180;
  currentCStick=cStick;
  currentVector = vector;
  sampleBuffer.push({ time, vector: { ...vector }, cStick: {...cStick},smoothVector:{...smooth},smoothCStick:{...smoothC},physicalVector:hardwareConnected?{...smooth}:null });
  const cutoff = time - 12000;
  while (sampleBuffer.length > 2 && sampleBuffer[1].time < cutoff) sampleBuffer.shift();
}

function sampleAt(time) {
  for (let index = sampleBuffer.length - 1; index >= 0; index -= 1) {
    if (sampleBuffer[index].time <= time) return sampleBuffer[index];
  }
  return sampleBuffer[0] ?? {vector:{x:0,y:0},cStick:{x:0,y:0}};
}

adapter.addEventListener("status", (event) => {
  hardwareConnected = event.detail.connected;
  updateControllerChoice();
  resetControllerActions();
  if (hardwareConnected) {
    setConnection(event.detail.label, "");
    elements.connectButton.textContent = $("#controllerKind").value==="pro"?"Disconnect controller":"Disconnect adapter";
    elements.inputMode.textContent = $("#controllerKind").value==="pro"?"Wired Pro":"Native adapter";
    setNotice("Controller ready",$("#controllerKind").value==="pro"?"Wired Pro Controller connected. Check both sticks and buttons before playing.":"Select the occupied port, then begin the drill.", "success");
    updateDiagnostics({ result: "connected", device: event.detail.device });
  } else {
    setConnection("Disconnected · Simulation", "error");
    if(running || starting || replaying) stopRun("Controller disconnected. Run interrupted.");
    addSample({x:0,y:0});
    elements.connectButton.textContent = "Connect adapter";
    elements.inputMode.textContent = "Mouse / keys";
    elements.controllerState.textContent = "Simulated";
  }
});

adapter.addEventListener("stage", (event) => {
  updateDiagnostics({ stage: event.detail.stage, message: event.detail.message, device: event.detail.device });
  if (!hardwareConnected) setConnection(event.detail.message, "demo");
});

adapter.addEventListener("sample", (event) => {
  const pad = event.detail.ports[$("#controllerKind").value==="pro"?0:selectedPort];
  if (!pad?.connected) {
    resetControllerActions();
    elements.controllerState.textContent = "No controller";
    setConnection("No controller", "error");
    addSample({x:0,y:0});
    if(running || starting || replaying) stopRun("Controller disconnected. Run interrupted.");
    return;
  }
  setConnection("Connected", "");
  traceControllerButtons(pad);
  const controllerLabel=pad.controllerType=== "pro-usb"?"Wired Pro Controller":pad.controllerType === "wired" ? "Wired GCC" : "WaveBird";
  if(elements.controllerState.textContent!==controllerLabel) elements.controllerState.textContent=controllerLabel;
  rawInput = { x: pad.stickX, y: pad.stickY };
  if(pad.normalizedStick){
    // SDL calibrated axes; no GameCube raw-byte mapping is applied.
    const processed=v=>({x:Math.abs(v.x)<.2?0:v.x,y:Math.abs(v.y)<.2?0:v.y});
    addSample(processed(pad.normalizedStick),event.detail.timestamp,processed(pad.normalizedCStick),pad.normalizedStick,pad.normalizedCStick);
  }else addSample(normalizeRawStick(pad.stickX, pad.stickY, calibration), event.detail.timestamp, normalizeRawStick(pad.cStickX, pad.cStickY, cCalibration),normalizeSmoothStick(pad.stickX,pad.stickY,calibration),normalizeSmoothStick(pad.cStickX,pad.cStickY,cCalibration));
  if(sdiGuide?.open || presetEditor?.active){controllerControls.update(pad.buttons1);return;}
  if(controllerNeedsRelease){
    const released=pad.buttons1===0&&pad.buttons2===0&&pad.triggerL<40&&pad.triggerR<40;
    if(!released)controllerReleaseSince=null;
    else controllerReleaseSince??=performance.now();
    controllerControls.update(pad.buttons1);previousY=!!(pad.buttons1&8);previousStartMenu=!!(pad.buttons2&1);previousDevChord=(pad.buttons1&21)===21;
    if(controllerReleaseSince==null||performance.now()-controllerReleaseSince<75)return;
    controllerNeedsRelease=false;
  }
  const action=controllerControls.update(pad.buttons1);
  const menuStartHeld=!!(pad.buttons2&1),menuStartPressed=menuStartHeld&&!previousStartMenu;previousStartMenu=menuStartHeld;
  const devChord=(pad.buttons1&21)===21;if(devChord&&!previousDevChord){const menu=$("#orbDevMenu");menu.open?menu.close():menu.showModal();}previousDevChord=devChord;if(devChord||$("#orbDevMenu").open)return;
  if(selectedPreset==='Diddy Kong Want Banana!'&&!$('#settingsDrawer').open){if(menuStartPressed){$('#orbSettings').open=!$('#orbSettings').open;return;}if($('#orbSettings').open){if(action.stop)$('#orbSettings').open=false;return;}}
 const yHeld=!!(pad.buttons1&8);if(yHeld&&!previousY)swapOrbCharacter();previousY=yHeld;
  // Rest readings have a nonzero offset. Fixed hysteresis avoids a stray
  // low sample permanently shifting the release threshold downward.
  const held=controllerControls.previousShoulder??0;
  const leftPressed=(pad.buttons2&8)||pad.triggerL>=((held&8)?40:50);
  const rightPressed=(pad.buttons2&4)||pad.triggerR>=((held&4)?40:50);
  const shoulder=(leftPressed?8:0)|(rightPressed?4:0);
  const shoulderPressed=controllerControls.previousShoulder==null?0:shoulder&~controllerControls.previousShoulder;
  controllerControls.previousShoulder=shoulder;
  if(shoulderPressed && !running&&!starting&&!replaying&&!replayPreparing&&!$("#settingsDrawer").open&&!$("#frameTest").open){
    const delta=shoulderPressed===8?-1:shoulderPressed===4?1:0;
    if(delta)cyclePreset(delta);
    return;
  }
  if(document.querySelector("#frameTest").open) return;
  if(action.stop && (running||starting||replaying||replayPreparing||recording)) controllerSecondaryAction();
  else if(action.start && !running && !starting && !(pad.buttons1 & 2)) {
    if(document.querySelector("#settingsDrawer").open) return;
    controllerPrimaryAction();
  }
});

adapter.addEventListener("error", (event) => {
  hardwareConnected=false;resetControllerActions();updateControllerChoice();addSample({x:0,y:0});
  if(running || starting || replaying) stopRun("Controller changed. Run interrupted.");
  setConnection("Controller error · reconnect", "error");
  setNotice("Could not read the controller", friendlyUSBError(event.detail), "error");
  updateDiagnostics({ result: "read error", error: serializeError(event.detail) });
});

function serializeError(error) {
  return {
    name: error?.name || "Error",
    stage: error?.stage || null,
    message: error?.message || String(error),
    cause: error?.cause?.message || null,
    details: error?.details || null,
  };
}

function updateDiagnostics(update) {
  connectionDiagnostics = { ...connectionDiagnostics, ...update, updatedAt: new Date().toISOString() };
  elements.connectionLog.textContent = JSON.stringify(connectionDiagnostics, null, 2);
}

function friendlyUSBError(error) {
  const message = error?.message || String(error);
  if (error?.stage === "native bridge") {
    return "The native helper is not running. Close this page and start the trainer with Start-SDI-Trainer.cmd.";
  }
  if (/not found/i.test(message)) {
    return "The native helper cannot find WUP-028. Reconnect the Mayflash in Wii U mode and confirm Zadig shows 057E:0337 with WinUSB.";
  }
  if (error?.stage === "interface claim" || /busy|access|claim|denied/i.test(message)) {
    return `The native helper found the adapter but could not claim it. Close Dolphin, Slippi, Steam, and controller tools. Technical error: ${message}`;
  }
  return message;
}

function updateControllerChoice(){
 const pro=$('#controllerKind').value==='pro';
 elements.portSelect.disabled=pro;elements.portSelect.closest('label').hidden=pro;$('#portLabel').hidden=pro;
 elements.connectButton.textContent=hardwareConnected?(pro?'Disconnect controller':'Disconnect adapter'):(pro?'Connect controller':'Connect adapter');
 $('#controllerKind').disabled=hardwareConnected;
}
$('#controllerKind').value=localStorage.getItem('sdi-controller-kind')==='pro'?'pro':'adapter';
$('#controllerKind').onchange=()=>{localStorage.setItem('sdi-controller-kind',$('#controllerKind').value);resetControllerActions();updateControllerChoice();};
updateControllerChoice();

elements.connectButton.addEventListener("click", async () => {
  elements.connectButton.disabled = true;
  $("#controllerKind").disabled=true;
  try {
    if (hardwareConnected) {
      await adapter.disconnect();
    } else {
      await adapter.connect($("#controllerKind").value);
    }
  } catch (error) {
    setConnection("Connection failed", "error");
    setNotice("Connection failed", friendlyUSBError(error), "error");
    updateDiagnostics({ result: "connection failed", error: serializeError(error) });
  } finally {
    elements.connectButton.disabled = false;
    updateControllerChoice();
  }
});

elements.copyDiagnosticsButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.connectionLog.textContent);
    elements.copyDiagnosticsButton.textContent = "Copied";
    window.setTimeout(() => { elements.copyDiagnosticsButton.textContent = "Copy diagnostics"; }, 1200);
  } catch {
    elements.connectionLog.focus?.();
  }
});

elements.portSelect.addEventListener("change", () => {
  selectedPort = Number(elements.portSelect.value);
  resetControllerActions();
});

elements.thresholdInput.addEventListener("input", () => {
  elements.thresholdOutput.value = Number(elements.thresholdInput.value).toFixed(2);
});

function pointerVector(event) {
  const rect = elements.stickCanvas.getBoundingClientRect();
  const radius=Math.min(rect.width,rect.height)*0.39;
  const x = (event.clientX - rect.left - rect.width / 2) / radius;
  const y = -(event.clientY - rect.top - rect.height / 2) / radius;
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

function handlePointer(event) {
  if (hardwareConnected) return;
  const vector = pointerVector(event);
  rawInput = { x: Math.round(128 + vector.x * 100), y: Math.round(128 + vector.y * 100) };
  addSample(vector);
}

elements.stickCanvas.addEventListener("pointerdown", (event) => {
  elements.stickCanvas.setPointerCapture(event.pointerId);
  handlePointer(event);
});
elements.stickCanvas.addEventListener("pointermove", (event) => {
  if (elements.stickCanvas.hasPointerCapture(event.pointerId)) handlePointer(event);
});
elements.stickCanvas.addEventListener("pointerup", (event) => {
  if (hardwareConnected) return;
  elements.stickCanvas.releasePointerCapture(event.pointerId);
  rawInput = { x: 128, y: 128 };
  addSample({ x: 0, y: 0 });
});

const directionKeys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "KeyW", "KeyA", "KeyS", "KeyD", "KeyI", "KeyJ", "KeyK", "KeyL"]);
function updateKeyboardVector() {
  if (hardwareConnected) return;
  let x = 0;
  let y = 0;
  if (pressedKeys.has("ArrowLeft") || pressedKeys.has("KeyA")) x -= 1;
  if (pressedKeys.has("ArrowRight") || pressedKeys.has("KeyD")) x += 1;
  if (pressedKeys.has("ArrowUp") || pressedKeys.has("KeyW")) y += 1;
  if (pressedKeys.has("ArrowDown") || pressedKeys.has("KeyS")) y -= 1;
  const length = Math.hypot(x, y);
  const vector = length > 1 ? { x: x / length, y: y / length } : { x, y };
  rawInput = { x: Math.round(128 + vector.x * 100), y: Math.round(128 + vector.y * 100) };
  const cx=Number(pressedKeys.has("KeyL"))-Number(pressedKeys.has("KeyJ"));
  const cy=Number(pressedKeys.has("KeyI"))-Number(pressedKeys.has("KeyK"));
  const cm=Math.hypot(cx,cy)||1;
  addSample(vector,performance.now(),{x:cx/cm,y:cy/cm});
}
window.addEventListener("keydown", (event) => {
  if (presetEditor?.active || !directionKeys.has(event.code) || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  event.preventDefault();
  pressedKeys.add(event.code);
  updateKeyboardVector();
});
window.addEventListener("keyup", (event) => {
  if (!directionKeys.has(event.code) || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  pressedKeys.delete(event.code);
  updateKeyboardVector();
});

// Clears only the loaded view. Gameplay/camera and saved history are handled by callers.
function clearLoadedAttempt({clearCapture=false,clearWarmup=false}={}){
 pausedReplay=null;inspection=null;lastEventFlash=null;recording=null;
 $("#attemptHistory").value="";
 bananaTimelineDrag=null;bananaTimelineViewFrame=null;bananaSeekPending=false;
 $('#hitlagInspector').hidden=true;$('#replayButton').hidden=true;$('#replayStatus').textContent='';
 if(clearCapture){attemptFrames=[];attemptSamples=[];}
 if(clearWarmup)warmup=null;
}
function applySequence(nextSequence) {
  if(running || starting || replaying) throw new Error("Stop the drill before changing its preset.");
  if(comboVideo.url) nextSequence={...nextSequence,durationSeconds:comboVideo.video.duration};
  clearLoadedAttempt({clearCapture:true});
  sequence = nextSequence;
  drill = drillFromSequence(sequence);practiceRange={start:0,end:drill.durationFrames};runPracticeRange={...practiceRange};
  targets = flattenTargets(drill);
  analyzer = new SDIAnalyzer(drill, { threshold: Number(elements.thresholdInput.value) });
  currentFrame = 0;
  elements.durationLabel.textContent = `/ ${(drill.durationFrames / 60).toFixed(2)} s`;
  elements.startButton.textContent = "Start drill";
  elements.resultsPanel.hidden=true;document.querySelector("#sessionReady").hidden=false;
}

async function startRun(startPosition=null) {
 if(sdiGuide?.open)return;
  if(orbSwapAnimation)return;
 if(presetLoading)return;
 if(selectedPreset==="Diddy Kong Want Banana!"&&!bananaDirections.length)return;
  if(running || starting || replaying)return;
  if(comboVideo.url&&comboVideo.state!=="ready")return;
  const operation=++sessionOperation;
  runPracticeRange=selectedPreset==="Diddy Kong Want Banana!"?{start:0,end:drill.durationFrames}:{...practiceRange};
  inspection=null;attemptFrames=[];currentFrame=runPracticeRange.start;lastEventFlash=null;$("#hitlagInspector").hidden=true;
  document.querySelector("#frameTest").open=false;
  if(comboVideo.url){
    if(comboVideo.state !== "ready")return;
    starting=true;
    $("#presetControls").inert=true;  
    elements.startButton.disabled=true;
    $("#stopButton").hidden=false;
    elements.startButton.textContent="Starting…";
    await comboVideo.seek(runPracticeRange.start*FRAME_MS/1000);
    if(operation!==sessionOperation||!starting||comboVideo.state!=="ready")return;
    await comboVideo.start(origin=>{if(operation!==sessionOperation||!starting)return;starting=false;beginRun(origin);});
  }else beginRun(performance.now()-runPracticeRange.start*FRAME_MS,startPosition);
}

function beginRun(origin,startPosition=null) {
  resetAudioChain();
  clearOrbUnlockNotice();
  if(selectedPreset==="Diddy Kong Want Banana!"){bananaTimelineViewFrame=null;orbLossStartedAt=null;orbCharacterPreview=false;runOrbCharacter=orbCharacter;orbGame=new OrbGame(orbTimerSettings($("#orbMode").value).startTimerFrames,"fixed",$("#orbMode").value,Math.round(Number($("#orbBreak").value)*60),$("#orbTiming").value!=="untimed",{fixedDirections:bananaFixedDirections,directionSlices:16,directions:[...bananaDirections],startPosition,playerCharacter:orbCharacter,...orbTimerSettings($("#orbMode").value),allowUntimedEvents:$("#orbUntimedEvents").checked,seed:crypto.getRandomValues(new Uint32Array(1))[0],unlockEnabled:bananaSettingsLegal()||$("#orbUntimedEvents").checked?($("#orbMode").value==="burst"?!dkUnlocked:!dixieUnlocked):false,unlockCharacter:$("#orbMode").value==="burst"?"dk":"dixie",unlockDuration:390+($("#orbMode").value==="burst"?dkVoiceFrames:42)});orbGame.standardSettings=!pendingOrbTest;orbCamera=startPosition?.camera?{...startPosition.camera}:{x:0,y:0};}
  runInputDelayFrames=inputDelayFrames;
  analyzer = new SDIAnalyzer(selectedPreset==="Diddy Kong Want Banana!"?drill:{...drill,hits:includedHits(drill,runPracticeRange)}, { threshold: Number(elements.thresholdInput.value) });
  elements.resultsPanel.hidden = true;
  document.querySelector("#presetControls").inert=true;
  
  running = true;
  currentFrame = runPracticeRange.start;
  lastProcessedFrame = runPracticeRange.start-1;
  runStart = origin;
  clearLoadedAttempt();
  const initial=sampleAt(origin+(runPracticeRange.start-runInputDelayFrames)*FRAME_MS);
  attemptSamples=[{timeMs:runPracticeRange.start*FRAME_MS,vector:{...initial.vector},cStick:{...(initial.cStick??{x:0,y:0})},smoothVector:{...(initial.smoothVector??initial.vector)},smoothCStick:{...(initial.smoothCStick??initial.cStick??{x:0,y:0})}}];
  // Carry held inputs into hitlag; do not invent a fresh input at start.
  for(let f=selectedPreset==="Diddy Kong Want Banana!"?runPracticeRange.start:runPracticeRange.start-8;f<runPracticeRange.start;f++){const sample=sampleAt(origin+(f-runInputDelayFrames)*FRAME_MS);analyzer.processFrame(f,sample.vector,origin+f*FRAME_MS,sample.cStick,sample.physicalVector);}
  analyzer.events=[];analyzer.samples=[];
  if(selectedPreset==='Diddy Kong Want Banana!')orbSource=analyzer.events;
  $("#orbSettings").open=false; initAudio(); sound("start");
  document.querySelector("#stopButton").hidden=false;
  document.querySelector("#sessionReady").hidden=false;
  lastEventFlash = null;
  liveAcceptedCount = 0;
  elements.acceptedLiveCount.textContent = "0";
  elements.sdiFlash.classList.remove("active");
  elements.startButton.disabled = true;
  
  elements.startButton.textContent = "Drill running…";
  setNotice("Running", "Inputs are counted during the highlighted hitlag windows.");
}

elements.startButton.addEventListener("click", controllerPrimaryAction);


function attemptReachedFirstHitlag(){return selectedPreset==='Diddy Kong Want Banana!'||analyzer.drill.hits.some(hit=>lastProcessedFrame>=hit.startFrame);}
function attemptHasResult(){return selectedPreset==='Diddy Kong Want Banana!'||(attemptReachedFirstHitlag()&&analyzer.events.some(e=>e.type==='accepted'));}
function finishRun() {
  if (!running) return;
  if(!attemptHasResult()){running=false;attemptFrames=[];attemptSamples=[];stopRun();return;}
  running = false;
  if(lastProcessedFrame<drill.durationFrames-1) elements.resultTitle.textContent="Stopped early";
  elements.startButton.disabled = false;
  
  elements.startButton.textContent = "Start drill";
  document.querySelector("#stopButton").hidden=true;
  document.querySelector("#presetControls").inert=false;
  
  sound("end");
  {
    const duration=(lastProcessedFrame+1)*FRAME_MS;
    recording=recordAttempt(attemptSamples.filter(s=>s.timeMs<=duration),analyzer.events,duration,drill);recording.frames=structuredClone(attemptFrames);recording.practiceRange={...runPracticeRange};if(selectedPreset==="Diddy Kong Want Banana!"){orbSource=recording.events;recording.orbStartPosition={...orbGame.startPosition};recording.orbTimerFrames=orbGame.startTimerFrames;recording.orbMinTimerFrames=orbGame.minTimerFrames;recording.orbRampBananas=orbGame.rampBananas;recording.orbSpawnDistance=orbGame.spawnDistance;recording.orbMovement=orbGame.movement;recording.orbMode=orbGame.mode;recording.orbBreakFrames=orbGame.breakFrames;recording.orbTimed=orbGame.timed;recording.orbStandardSettings=orbGame.standardSettings;recording.orbSeed=orbGame.seed;recording.orbDirections=[...orbGame.directions];recording.orbDirectionSlices=orbGame.directionSlices;recording.orbFixedDirections=orbGame.fixedDirections;recording.orbAllowUntimedEvents=orbGame.celebrationsEnabled;recording.orbUnlockEnabled=orbGame.unlockEnabled||orbGame.unlockCompleted;recording.orbUnlockDuration=orbGame.unlockDuration;recording.orbUnlockScore=orbGame.unlockScore;recording.orbUnlockCharacter=orbGame.unlockCharacter;recording.orbCharacter=runOrbCharacter;}
    $("#replayButton").hidden=false;$("#replayButton").disabled=false;
  }
  const results=analyzer.results();

  if(selectedPreset==="Diddy Kong Want Banana!"){results.orb={timed:orbGame.timed,score:orbGame.score,survived:(orbGame.frame-orbGame.pausedFrames)/60,targetTime:orbGame.timerFrames/60,average:orbGame.reachFrames.length?orbGame.reachFrames.reduce((a,b)=>a+b,0)/orbGame.reachFrames.length/60:0,failed:orbGame.failed};const key="sdi-orb-best-"+orbGame.mode+"-"+orbGame.movement+(orbGame.timed?"":"-untimed");if(orbGame.timed){const best=Math.max(Number(localStorage.getItem(key)||0),orbGame.score);localStorage.setItem(key,best);results.orb.best=best;}}
  showResults(results);
  saveRecentAttempt(results);
  if(comboVideo.url) void comboVideo.reset();
}

function stopRun(message = "") {
 if(replaying||replayPreparing){stopReplay(message);return;}
 sessionOperation++;
 if(running&&attemptHasResult()){
  finishRun();currentFrame=Math.max(0,lastProcessedFrame);
  if(comboVideo.url)void comboVideo.seek(currentFrame/60,"Stopped");
  if(message)setNotice("Run interrupted",message,"error");
  return;
 }
 if(recording&&!running&&!starting&&!message){initAudio();sound("clear");}
 running=false;starting=false;
 clearLoadedAttempt({clearCapture:true,clearWarmup:true});
 currentFrame=0;lastProcessedFrame=-1;
 analyzer=new SDIAnalyzer(drill,{threshold:Number(elements.thresholdInput.value)});
 liveAcceptedCount=0;elements.acceptedLiveCount.textContent="0";
 elements.resultsPanel.hidden=true;$('#sessionReady').hidden=false;$('#presetControls').inert=false;
 $('#stopButton').hidden=true;elements.startButton.textContent="Start drill";
 if(comboVideo.url)void comboVideo.reset(message||"Ready");else elements.startButton.disabled=false;
 if(message)setNotice("Run interrupted",message,"error");
}

let hoveredResultMetric=null;
function timelineMetricMatch(event){return hoveredResultMetric==='Early starts'?event.type==='outside-hitlag'&&currentEarlyStarts().some(e=>e.entryFrame===event.frame):hoveredResultMetric==='C-stick generated'?event.type==='accepted'&&event.source==='c-stick':hoveredResultMetric==='First-frame starts'?event.type==='accepted'&&event.hitlagFrame===1:false;}
$('#toggleEarlyMarkers').setAttribute('aria-pressed',String(showEarlyMarkers));
$('#toggleBufferLines').setAttribute('aria-pressed',String(showBufferLines));
$('#toggleBufferLines').onclick=()=>{showBufferLines=!showBufferLines;$('#toggleBufferLines').setAttribute('aria-pressed',String(showBufferLines));localStorage.setItem('sdi-show-buffer-lines',String(showBufferLines));};
$('#toggleEarlyMarkers').onclick=()=>{showEarlyMarkers=!showEarlyMarkers;$('#toggleEarlyMarkers').setAttribute('aria-pressed',String(showEarlyMarkers));localStorage.setItem('sdi-show-early-markers',String(showEarlyMarkers));};
$('#metrics').addEventListener('mouseover',event=>{hoveredResultMetric=event.target.closest('.metric')?.dataset.metric??null;});
$('#metrics').addEventListener('mouseleave',()=>{hoveredResultMetric=null;});
$('#metrics').addEventListener('focusin',event=>{hoveredResultMetric=event.target.closest('.metric')?.dataset.metric??null;});
$('#metrics').addEventListener('focusout',()=>{hoveredResultMetric=null;});
function metric(label,value,explanation) {
 return `<div class="metric" data-metric="${label}"><span>${label}${explanation?` <button type="button" class="metric-info" aria-label="About ${label}">i</button>`:""}</span><strong>${value}</strong>${explanation?`<small>${explanation}</small>`:""}</div>`;
}
function showResults(r) {
 elements.resultsPanel.hidden=false;
 $('.result-score').hidden=false;
 $('.result-score .kicker').textContent=selectedPreset==='Diddy Kong Want Banana!'?'Bananas consumed':'Accepted / possible';
 if(selectedPreset==='Diddy Kong Want Banana!'&&r.orb){const g=r.orb;elements.scoreValue.textContent=String(g.score);elements.resultTitle.textContent='Bananas consumed';elements.resultSummary.textContent=g.failed?'':'Attempt stopped';elements.metrics.innerHTML=[metric('Average Banana Time',g.average?`${g.average.toFixed(2)} s`:'—',''),metric('Banana Timer when Diddy starved',g.timed===false?'Untimed':g.failed?`${g.targetTime.toFixed(2)} s`:'—',''),metric('Time survived',`${g.survived.toFixed(2)} s`,'')].join('');elements.coaching.innerHTML='';return;}
 elements.scoreValue.textContent=`${r.acceptedCount} / ${r.possibleCount}`;
 elements.resultTitle.textContent="Accepted SDI inputs";
 elements.resultSummary.textContent=`${r.score}% of possible inputs${analyzer.drill.hits.length<drill.hits.length?" · Partial attempt":""}`;
 elements.resultSummary.removeAttribute("title");
 elements.metrics.innerHTML=[

 
 metric("C-stick generated",r.cStickCount,"Accepted SDI from a C-stick refresh: eligibility returns on early release or three frames after activation, then follows the SDI lockout (tilt stick only).")].join("");
 elements.metrics.innerHTML+=[metric("Early starts",`${currentEarlyStarts().length} / ${analyzer.drill.hits.length}`,"Directional entry in the 3 frames before hitlag, held outside neutral into the first hitlag frame. This is a timing warning, not proof an input was lost."),metric("First-frame starts",`${r.firstFrameCount} / ${analyzer.drill.hits.length}`,"Windows with an accepted input on frame 1 under the v4 training model.")].join("");elements.coaching.innerHTML="";
}

function directionLabel(angle) {
  const labels = ["→", "↗", "↑", "↖", "←", "↙", "↓", "↘"];
  return angle==null?"○":labels[((Math.round(angle / 45) % 8)+8)%8];
}

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width, height, ratio };
}

function drawStick(guideZonePreview) {
  const canvas = elements.stickCanvas;
  const { width, height } = sizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.39;
  ctx.clearRect(0, 0, width, height);
  if(document.body.dataset.theme==="windows"){ctx.fillStyle="#172a30";ctx.fillRect(cx-radius*1.25,cy-radius*1.25,radius*2.5,radius*2.5);}
  const simulated=inspection?inspection.vector:(replaying?replayVector:delayedLiveSample().vector);
  const zone=physicalZone(gameToPhysical(simulated)),now=performance.now();
  const context=inspection?'inspection':replaying?'replay':running?'run':'live';
  const contextChanged=context!==visualZoneContext||!showActiveZones;
  if(contextChanged){previousVisualZone=zone;visualZoneFlashes.clear();visualZoneContext=context;visualTiltInput=new TiltStickInput();}
  const simulatedC=inspection?inspection.cStick:(replaying?replayCStick:delayedLiveSample().cStick??{x:0,y:0});
  const refresh=inspection?{refresh:false}:visualTiltInput.process(running||replaying?currentFrame:Math.floor(now/FRAME_MS),simulated,simulatedC);
  if(showActiveZones&&!contextChanged&&refresh.refresh&&Math.hypot(simulated.x,simulated.y)>=analyzer.rules.threshold&&hasNewDirectionalComponent(refresh.cDirection,simulated,analyzer.rules.componentEpsilon)){cZoneFlashUntil=now+400;for(const axis of ['x','y'])if(zone[axis]!==0)visualZoneFlashes.set(`${axis}:${zone[axis]}`,now+400);}
  if(showActiveZones&&previousVisualZone&&!visualTiltInput.pending){for(const axis of ['x','y']){if(zone[axis]!==0&&zone[axis]!==previousVisualZone[axis])visualZoneFlashes.set(`${axis}:${zone[axis]}`,now+400);}}
  previousVisualZone=zone;
  const flashes=[];for(const [key,until] of visualZoneFlashes){if(until<=now){visualZoneFlashes.delete(key);continue;}const [axis,value]=key.split(':');if(zone[axis]===Number(value))flashes.push({axis,value:Number(value),strength:(until-now)/400});}
  drawZoneOverlay(ctx,cx,cy,radius,true,calibration,true,showActiveZones?zone:null,guideZonePreview?.flashes??(showActiveZones?flashes:[]));
  const active=drill.hits.some(h=>currentFrame>=h.startFrame&&currentFrame<h.startFrame+h.lengthFrames)&&(running||replaying);
  if(active){ctx.save();ctx.strokeStyle="#67d7b4";ctx.lineWidth=2*(width/canvas.getBoundingClientRect().width);ctx.strokeRect(cx-radius*1.25,cy-radius*1.25,radius*2.5,radius*2.5);ctx.restore();}
  elements.cueBadge.classList.toggle("idle",!active);
  elements.cueBadge.querySelector("strong").textContent=active?"HITLAG":"—";

  const displayed=inspection?inspection.smoothVector:(replaying?replaySmoothVector:delayedLiveSample().smoothVector??smoothVector);
  if(replaying){
    const trail=replay.trail();ctx.save();ctx.strokeStyle="rgba(244,241,232,.22)";ctx.lineWidth=2;ctx.beginPath();
    trail.forEach((s,i)=>{const v=stickDisplay==="ultimate-only"?s.vector:s.smoothVector??gameToPhysical(s.vector);const x=cx+v.x*radius,y=cy-v.y*radius;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.restore();
  }
  if(guideZonePreview?.direction){
    const v=guideZonePreview.direction;
    ctx.save();ctx.globalAlpha=guideZonePreview.strength;
    drawArrow(ctx,cx,cy,cx+v.x*radius*.95,cy-v.y*radius*.95,"#67d7b4",3);
    ctx.restore();
  }else if(lastEventFlash?.type==="accepted"){
    const v=directionVector(lastEventFlash.angle);
    drawArrow(ctx,cx,cy,cx+v.x*radius*.95,cy-v.y*radius*.95,"#67d7b4",3);
    ctx.fillStyle="#67d7b4";ctx.font="bold 11px system-ui";ctx.fillText("SDI",cx+v.x*radius*.75+8,cy-v.y*radius*.75-10);
    if(lastEventFlash.source==="c-stick"){ctx.fillStyle="#f3c969";ctx.font="bold 12px system-ui";ctx.fillText("C",cx+v.x*radius*.82+8,cy-v.y*radius*.82-8);}
  }
  if(stickDisplay!=="ultimate-only"){
  const px = cx + displayed.x * radius;
  const py = cy - displayed.y * radius;
  ctx.strokeStyle = lastEventFlash?.type === "accepted" ? "#67d7b4" : "rgba(244,241,232,.55)";
  ctx.lineWidth = Math.max(3, width / 150);
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
  ctx.shadowColor = lastEventFlash?.type === "accepted" ? "#67d7b4" : "#ff7a45";
  ctx.shadowBlur = width / 28;
  ctx.fillStyle = lastEventFlash?.type === "accepted" ? "#67d7b4" : "#f4f1e8";
  ctx.beginPath(); ctx.arc(px, py, width / 52, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  }
  if(stickDisplay==="ultimate"||stickDisplay==="ultimate-only"){
    const processed=inspection?inspection.vector:(replaying?replayVector:delayedLiveSample().vector);
    drawProcessedMarker(ctx,cx,cy,radius,processed);
  }
}

function drawArrow(ctx, x1, y1, x2, y2, color, lineWidth) {
  ctx.save();
  if(document.body.dataset.theme==='windows'){ctx.shadowColor='rgba(0,0,0,.7)';ctx.shadowBlur=1;ctx.shadowOffsetX=0;ctx.shadowOffsetY=1;}
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = lineWidth * 3.1;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
  ctx.closePath();ctx.fill();
  ctx.restore();
}

function visibleTimelineEvents(){const events=replaying||inspection?recording?.events??[]:analyzer.events;return events.filter(e=>e.type!=="weak"&&(!replaying||e.timeMs<=replay.timeMs));}
function eventDetail(e){return `${directionLabel(e.angle)} · ${e.hitlagFrame?`hitlag frame ${e.hitlagFrame}`:"outside hitlag"} · total frame ${e.frame} · ${e.type}${e.reason==="c-stick-held"?" · blocked by held C-stick refresh":e.reason==="c-stick-pending"?" · C-stick refresh already pending":e.reason==="c-stick-refresh-delay"?" · waiting for C-stick release or frame "+(e.readyFrame+1):""}${e.source==="c-stick"?" · C-stick generated":""}${e.buffered?` · buffered from hitlag frame ${e.inputFrame-(drill.hits.find(h=>h.id===e.hitId)?.startFrame??0)+1}`:""}`;}
function currentEarlyStarts(){const hits=analyzer.drill.hits,events=recording&&!running?recording.events:analyzer.events,frames=running?attemptFrames:recording?.frames??[];if(earlyStartCache&&earlyStartCache.hits===hits&&earlyStartCache.events===events&&earlyStartCache.eventCount===events.length&&earlyStartCache.frames===frames&&earlyStartCache.frameCount===frames.length)return earlyStartCache.value;const value=earlyStarts(hits,events,frames);earlyStartCache={hits,events,eventCount:events.length,frames,frameCount:frames.length,value};return value;}
function diSample(frame){
 const frames=running?attemptFrames:recording?.frames;
 if(replaying&&frame*FRAME_MS>replay.timeMs)return null;
 return frames?.find(s=>s.frame===frame);
}
function diDescription(frame){const sample=diSample(frame);if(!sample)return 'DI direction: not recorded';const v=sample.vector;return `DI direction: ${Math.hypot(v.x,v.y)<.001?'Neutral':directionLabel(Math.atan2(v.y,v.x)*180/Math.PI)} · total frame ${frame}`;}
function drawWindowInspector(events){
 if($("#hitlagInspector").hidden)return;
 const hit=drill.hits.find(h=>h.id===inspectedHitId);if(!hit)return;
 $("#replayWindow").disabled=!recording||running||starting||replayPreparing||replaying;


 const canvas=$("#windowFrames"),{width:w,height:h,ratio}=sizeCanvas(canvas),ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);
 const left=12*ratio,cell=(w-24*ratio)/hit.lengthFrames,top=38*ratio,bottom=h-27*ratio;
 ctx.fillStyle=document.body.dataset.theme==='windows'?'#34383e':'#182a40';ctx.fillRect(left,top,w-24*ratio,bottom-top);
 const pointFor=e=>({x:left+(e.frame-hit.startFrame+.5)*cell,y:top+(bottom-top)*(e.type==='accepted'?.42:['buffered','buffer-replaced'].includes(e.type)?.68:.88)});
 const local=events.filter(e=>e.hitId===hit.id),frames=running?attemptFrames:recording?.frames??[];
 for(let f=0;f<hit.lengthFrames;f++){
  const frame=hit.startFrame+f,kind=frameWaitKind(frame,hit.id,local,frames.find(s=>s.frame===frame),analyzer.rules.lockoutFrames);
  if(kind){ctx.fillStyle=kind==='c-stick'?'rgba(255,95,104,.18)':'rgba(245,157,66,.22)';ctx.fillRect(left+f*cell,top,cell,bottom-top);}
 }
 if(inspection&&inspection.frame>=hit.startFrame&&inspection.frame<hit.startFrame+hit.lengthFrames){const x=left+(inspection.frame-hit.startFrame)*cell;ctx.fillStyle='rgba(103,215,180,.18)';ctx.fillRect(x,top,cell,bottom-top);ctx.strokeStyle='#67d7b4';ctx.lineWidth=2*ratio;ctx.strokeRect(x,top,cell,bottom-top);}
 ctx.strokeStyle=document.body.dataset.theme==='windows'?'#82878e':'rgba(134,157,184,.4)';ctx.lineWidth=document.body.dataset.theme==='windows'?ratio:1;ctx.font=`${11*ratio}px system-ui`;ctx.textAlign='center';inspectorMarkers=[];
 const stride=Math.max(1,Math.ceil(24*ratio/cell));
 for(let f=0;f<=hit.lengthFrames;f++){const x=left+f*cell;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();if(f<hit.lengthFrames&&(f%stride===0||f===hit.lengthFrames-1)){ctx.fillStyle='#aab6c6';ctx.fillText(String(f+1),x+cell/2,h-8*ratio);}}
 drawBufferLinks(ctx,local,pointFor,ratio);
 const consecutive=local.filter(e=>e.type==='accepted');ctx.save();ctx.strokeStyle='rgba(103,215,180,.65)';ctx.lineWidth=1.5*ratio;
 for(let i=1;i<consecutive.length;i++){const a=consecutive[i-1],b=consecutive[i];if(b.frame-a.frame!==analyzer.rules.lockoutFrames)continue;const from=pointFor(a),to=pointFor(b);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();}ctx.restore();
 for(const e of local){const {x,y}=pointFor(e);ctx.fillStyle=e.type==='accepted'?'#67d7b4':['buffered','buffer-replaced'].includes(e.type)?'#cfa4ff':e.type==='outside-hitlag'?'#8993a5':'#ff5f68';ctx.beginPath();ctx.arc(x,y,4.5*ratio,0,Math.PI*2);ctx.fill();
  if(e.type==='accepted'){const v=directionVector(e.angle);drawArrow(ctx,x-v.x*5*ratio,top-12*ratio+v.y*5*ratio,x+v.x*5*ratio,top-12*ratio-v.y*5*ratio,'#67d7b4',1.4*ratio);}
  if(e.source==='c-stick'){ctx.fillStyle='#f3c969';ctx.fillText('C',x,y-9*ratio);}inspectorMarkers.push({x,y,event:e});
 }
 const diFrame=hit.startFrame+hit.lengthFrames;
 $('#diDirection').hidden=!(drill.diFrames??[]).includes(diFrame);
 $('#diDirection').textContent=diDescription(diFrame);
 const accepted=local.filter(e=>e.type==='accepted'),angle=netDirection(accepted);
 const early=currentEarlyStarts().find(e=>e.hitId===hit.id);
 $("#windowScore").textContent=`Accepted SDI: ${accepted.length} / ${possibleInputs(hit)}`;
 if(!$("#windowDetail").dataset.hover)$("#windowDetail").textContent=`Frame 1 begins at the left edge · ${accepted.length} / ${possibleInputs(hit)} accepted${accepted.length?` · net ${angle===null?'○':directionLabel(angle)}`:''}${early?` · Early start: ${early.framesEarly} frame${early.framesEarly===1?"":"s"} before hitlag`:""}`;
}

function drawBufferLinks(ctx,events,pointFor,ratio=1){
 if(!showBufferLines)return;
 ctx.save();ctx.strokeStyle='#cfa4ff';ctx.lineWidth=1.2*ratio;ctx.globalAlpha=.75;
 for(const {buffered,accepted} of bufferedInputLinks(events)){
  const from=pointFor(buffered),to=pointFor(accepted);
  ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
 }
 ctx.restore();
}

function drawTimeline() {
  $("#resultsPlaceholder").hidden=!elements.resultsPanel.hidden;
 renderPersonalBest();
  if(presetLoading){const canvas=elements.timelineCanvas,{width,height}=sizeCanvas(canvas),ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);ctx.fillStyle=document.body.dataset.theme==='windows'?'#34404d':'#aab6c6';ctx.font='13px system-ui';ctx.textAlign='center';ctx.fillText('Loading preset…',width/2,height/2);for(const id of ['practiceStart','practiceEnd','practiceReset','practiceWarning','timelineFrameControls'])$('#'+id).hidden=true;return;}
  const available=!!recording&&!running&&!starting;
  $("#timelineFrameControls").hidden=!available;
  $("#previousFrame").disabled=!available||replaying||replayPreparing||(inspection?.frame??currentFrame)<=0;
  $("#nextFrame").disabled=!available||replaying||replayPreparing||(inspection?.frame??currentFrame)>=(recording?.frames?.at(-1)?.frame??drill.durationFrames-1);

  $("#inputDelay").disabled=running||starting||replaying||replayPreparing;
  $("#attemptHistory").disabled=running||starting||replayPreparing;
  updatePracticeControls();if(selectedPreset==="Diddy Kong Want Banana!"){drawInfiniteTimeline();return;}
  const canvas = elements.timelineCanvas;
  const { width, height } = sizeCanvas(canvas);
  const ctx = canvas.getContext("2d");
  const left = 32;
  const right = width - 18;
  const top = 36;
  const trackHeight = height * .44;
  const xFor = (frame) => left + (right - left) * frame / drill.durationFrames;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = document.body.dataset.theme==="windows"?"#4e5359":"rgba(5,11,20,.55)";
  roundRect(ctx, left, top, right - left, trackHeight, 12);
  ctx.fill();
  if(practiceRange.start>0||practiceRange.end<drill.durationFrames){ctx.save();roundRect(ctx,left,top,right-left,trackHeight,12);ctx.clip();ctx.fillStyle='rgba(0,0,0,.35)';ctx.fillRect(left,top,xFor(practiceRange.start)-left,trackHeight);ctx.fillRect(xFor(practiceRange.end),top,right-xFor(practiceRange.end),trackHeight);ctx.fillStyle='rgba(103,215,180,.035)';ctx.fillRect(xFor(practiceRange.start),top,xFor(practiceRange.end)-xFor(practiceRange.start),trackHeight);ctx.restore();}

  ctx.font = `${Math.max(9, width / 132)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillStyle = "#718196";
  ctx.strokeStyle = "rgba(134,157,184,.13)";
  ctx.lineWidth = 1;
  const durationSeconds = drill.durationFrames / 60;
  const secondStep = durationSeconds <= 15 ? 1 : durationSeconds <= 30 ? 2 : 5;
  for (let second = 0; second <= durationSeconds; second += secondStep) {
    const x = xFor(second * 60);
    ctx.beginPath(); ctx.moveTo(x, top - 8); ctx.lineTo(x, top + trackHeight + 8); ctx.stroke();
    ctx.fillText(`${second}s`, x, top + trackHeight + 27);
  }

  const timelineEvents=visibleTimelineEvents(),acceptedCounts=new Map();
  for(const event of timelineEvents){if(event.type==='accepted')acceptedCounts.set(event.hitId,(acceptedCounts.get(event.hitId)??0)+1);}
  for (const hit of drill.hits) {
    const x = xFor(hit.startFrame);
    const w = xFor(hit.startFrame + hit.lengthFrames) - x;
    ctx.fillStyle = document.body.dataset.theme==="windows"?(available&&hoveredHitId===hit.id?"#3e5978":"#2a3d58"):(available&&hoveredHitId===hit.id?"#3e5978":"#2a3d58");
    roundRect(ctx, x, top + 8, Math.max(5, w), trackHeight - 16, 5);
    ctx.fill();
    if(available||document.body.dataset.theme==="windows"){ctx.strokeStyle=inspectedHitId===hit.id&&!$("#hitlagInspector").hidden?"#67d7b4":hoveredHitId===hit.id?"#c4deff":"#6483a8";ctx.lineWidth=hoveredHitId===hit.id||inspectedHitId===hit.id?2:1;ctx.stroke();}
    const capacity=possibleInputs(hit,analyzer.rules);
    if(capacity>0&&(acceptedCounts.get(hit.id)??0)>=capacity){ctx.save();ctx.strokeStyle='#e7c66f';ctx.lineWidth=2;ctx.shadowColor='rgba(231,198,111,.7)';ctx.shadowBlur=7;ctx.stroke();ctx.restore();}

  }

  const earlyEntryFrames=new Set(currentEarlyStarts().map(e=>e.entryFrame));
  timelineMarkers=[];
  for (const hit of drill.hits) {
    const x=xFor(hit.startFrame+hit.lengthFrames/2);

    timelineMarkers.push({x,y:top+trackHeight/2,hit});
  }
  const acceptedForLinks=timelineEvents.filter(e=>e.type==='accepted');
  ctx.save();
  for(let i=1;i<acceptedForLinks.length;i++){const previous=acceptedForLinks[i-1],event=acceptedForLinks[i];if(previous.hitId!==event.hitId||event.frame-previous.frame!==4)continue;ctx.globalAlpha=hoveredResultMetric&&!timelineMetricMatch(previous)&&!timelineMetricMatch(event)?.25:1;ctx.strokeStyle='rgba(103,215,180,.65)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(xFor(previous.frame+.5),top+trackHeight*.76);ctx.lineTo(xFor(event.frame+.5),top+trackHeight*.76);ctx.stroke();}
  ctx.restore();
  drawBufferLinks(ctx,timelineEvents,e=>({x:xFor(e.frame+.5),y:top+trackHeight*(e.type==='accepted'?.76:.40)}));
  for (const event of timelineEvents) {
    if (event.type==="weak" && !event.hitId) continue;
    
    const highlighted=timelineMetricMatch(event);
    ctx.save();if(hoveredResultMetric&&!highlighted)ctx.globalAlpha=.25;
    const x=xFor(event.frame+.5);
    const lane={accepted:.76,weak:.22,buffered:.40,"buffer-replaced":.40,"buffer-full":.52,"outside-hitlag":.94};
    const y=top+trackHeight*(lane[event.type]??.22);
    ctx.fillStyle={accepted:"#67d7b4",weak:"#f3c969",buffered:"#cfa4ff","buffer-replaced":"#cfa4ff","buffer-full":"#ff5f68","outside-hitlag":"#8993a5"}[event.type]??"#ff5f68";
    if(showEarlyMarkers&&event.type==='outside-hitlag'&&earlyEntryFrames.has(event.frame)){ctx.save();ctx.fillStyle='#ff5f68';ctx.font='bold 15px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('!',x,y);ctx.restore();}else{ctx.beginPath();ctx.arc(x,y,["buffer-full","too-early","c-refresh-cancelled"].includes(event.type)?Math.max(1.8,width/650):Math.max(3,width/420),0,Math.PI*2);ctx.fill();}
    if(highlighted){ctx.globalAlpha=1;ctx.strokeStyle='#fff2b0';ctx.lineWidth=2;ctx.shadowColor='#fff2b0';ctx.shadowBlur=7;ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
    timelineMarkers.push({x,y,event});
  }

  // Draw labels after every dot so later blocked events cannot cover a C.
  for(const {x,y,event} of timelineMarkers){
    if(event?.source!=="c-stick")continue;
    ctx.save();if(hoveredResultMetric&&!timelineMetricMatch(event))ctx.globalAlpha=.25;
    ctx.fillStyle="#f3c969";ctx.font="bold 11px system-ui";ctx.fillText("C",x,y-10);ctx.restore();
  }

  const visible=timelineEvents;
  for(const event of visible.filter(e=>e.type==="accepted")){
    ctx.save();if(hoveredResultMetric&&!timelineMetricMatch(event))ctx.globalAlpha=.25;
    const v=directionVector(event.angle),x=xFor(event.frame+.5),y=top-10;
    const arrowSize=document.body.dataset.theme==='windows'?8:5,arrowWidth=document.body.dataset.theme==='windows'?1.9:1.3;
    drawArrow(ctx,x-v.x*arrowSize,y+v.y*arrowSize,x+v.x*arrowSize,y-v.y*arrowSize,"#67d7b4",arrowWidth);ctx.restore();
  }
  for(const hit of drill.hits){
    const ev=visible.filter(e=>e.hitId===hit.id&&e.type==='accepted');if(!ev.length)continue;
    const angle=netDirection(ev),x=xFor(hit.startFrame+hit.lengthFrames/2),y=top+trackHeight+10;
    if(angle===null){ctx.fillStyle='#aab6c6';ctx.font='14px system-ui';ctx.fillText('○',x,y+4);}
    else{const v=directionVector(angle);drawArrow(ctx,x-v.x*8,y+v.y*8,x+v.x*8,y-v.y*8,'#f4f1e8',2);}
  }
  for(const frame of drill.diFrames??[]){
    const x=xFor(frame+.5),sample=diSample(frame);
    ctx.strokeStyle='#ff5f68';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,top+4);ctx.lineTo(x,top+trackHeight-4);ctx.stroke();
    ctx.fillStyle='#ff5f68';ctx.font='bold 10px system-ui';ctx.textAlign='center';ctx.fillText('DI',x,top+trackHeight+14);
    if(sample){const v=sample.vector,m=Math.hypot(v.x,v.y);if(m>.001)drawArrow(ctx,x-v.x/m*7,top-10+v.y/m*7,x+v.x/m*7,top-10-v.y/m*7,'#ff5f68',2);else{ctx.fillStyle='#ff5f68';ctx.fillText('○',x,top-8);}}
  }
  drawWindowInspector(visible);
  const playhead = xFor(timelinePlaybackFrame()+.5);
  ctx.strokeStyle = "#f4f1e8";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(playhead, top - 12); ctx.lineTo(playhead, top + trackHeight + 12); ctx.stroke();
  ctx.fillStyle = "#f4f1e8";
  ctx.beginPath(); ctx.moveTo(playhead - 5, top - 13); ctx.lineTo(playhead + 5, top - 13); ctx.lineTo(playhead, top - 5); ctx.closePath(); ctx.fill();
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

let orbUnlockNoticeUntil=0;
function clearOrbUnlockNotice(){
  orbUnlockNoticeUntil=0;
  setText($('#orbUnlockNotice'),'');
}
function grantOrbUnlock(){
  const dixie=orbGame.unlockCharacter==='dixie';
  if(dixie?dixieUnlocked:dkUnlocked)return;
  if(dixie)dixieUnlocked=true;else dkUnlocked=true;
  localStorage.setItem(dixie?'sdi-dixie-unlocked':'sdi-dk-unlocked','true');
}

function updateRun(now) {
  if (!running) return;
  if(selectedPreset==="Diddy Kong Want Banana!"&&now-runStart>=(drill.durationFrames-120)*FRAME_MS){drill.durationFrames+=600;drill.hits[0].lengthFrames=drill.durationFrames;}
  const elapsed = now - runStart;
  if (elapsed < 0) return;
  const endFrame=selectedPreset==="Diddy Kong Want Banana!"?drill.durationFrames:runPracticeRange.end;
  const targetFrame = Math.min(endFrame - 1, Math.floor(elapsed / FRAME_MS));
  while (lastProcessedFrame < targetFrame) {
    lastProcessedFrame += 1;
    const sampleTime = runStart + lastProcessedFrame * FRAME_MS;
    const sample=sampleAt(sampleTime-runInputDelayFrames*FRAME_MS);
    attemptSamples.push({timeMs:lastProcessedFrame*FRAME_MS,vector:{...sample.vector},cStick:{...(sample.cStick??{x:0,y:0})},smoothVector:{...(sample.smoothVector??sample.vector)},smoothCStick:{...(sample.smoothCStick??sample.cStick??{x:0,y:0})}});
    const before=analyzer.events.length;
    if(selectedPreset!=='Diddy Kong Want Banana!'||!orbGame.celebration||lastProcessedFrame>=orbGame.celebration.end)analyzer.processFrame(lastProcessedFrame,sample.vector,sampleTime,sample.cStick,sample.physicalVector);
    attemptFrames.push({frame:lastProcessedFrame,vector:{...sample.vector},cStick:{...(sample.cStick??{x:0,y:0})},smoothVector:{...(sample.smoothVector??gameToPhysical(sample.vector))},smoothCStick:{...(sample.smoothCStick??sample.cStick??{x:0,y:0})},pending:structuredClone(analyzer.pending),lockout:analyzer.lastAcceptedFrame==null?0:Math.max(0,4-(lastProcessedFrame-analyzer.lastAcceptedFrame))});
    if(selectedPreset==='Diddy Kong Want Banana!'){
      const previousScore=orbGame.score;
      orbGame.advance(lastProcessedFrame,analyzer.events);
      if(orbGame.unlockCompleted)grantOrbUnlock();
      if(orbGame.score>previousScore&&shouldPlayBananaPickup(orbGame))sound('collect');
      if(orbGame.failed){orbLossStartedAt=performance.now();sound('starve');currentFrame=lastProcessedFrame;finishRun();return;}
    }
    for(const event of analyzer.events.slice(before)) {
    if (event) {
      if(event.type === "accepted") lastEventFlash = { ...event, until: now + (event.hitlagFrame===1?240:140) };
      if(event.type === "outside-hitlag") sound("outside");
      if (event.type === "accepted") {
        liveAcceptedCount += 1;
        sound(event.hitlagFrame===1?"first":"accepted",event);
        const hit=drill.hits.find(h=>h.id===event.hitId);
        if(selectedPreset!=="Diddy Kong Want Banana!"&&analyzer.events.filter(e=>e.type==="accepted" && e.hitId===hit.id).length===possibleInputs(hit,analyzer.rules)) sound("ding");
        elements.acceptedLiveCount.textContent = String(liveAcceptedCount);
      }
    }
    }
  }
  currentFrame = targetFrame;
  if (elapsed >= endFrame * FRAME_MS) finishRun();
}

function setText(element,value){const text=String(value);if(element.textContent!==text)element.textContent=text;}
function updateSessionButtons(){sessionControls.update();}
function render(now) {
  const loaded=!!recording&&!running;
  $('#videoPanel').classList.toggle('replay-border',loaded);
  $('#replayIndicatorBadge').hidden=!loaded;
  presetEditor?.updateAvailability();
  if(!sdiGuide?.open&&!presetEditor?.active)updateWarmup(now);
  setText($("#quickConnectButton"),elements.connectButton.textContent);
  $("#quickConnectButton").disabled=elements.connectButton.disabled;
  const age=adapter.lastSampleAt==null?0:Math.max(0,performance.now()-adapter.lastSampleAt);
  if(hardwareConnected && age>250)setConnection(`Input delayed · ${Math.round(age)} ms`,"error");
  setText(document.querySelector("#inputTiming"),hardwareConnected?`Request ${Math.round(adapter.requestMs)} ms · sample age ${Math.round(age)} ms`:"—");
  comboVideo.tick(now);
  setText($("#videoSync"),comboVideo.state==="playing"?`${(comboVideo.errorSeconds*60).toFixed(1)} frames · trainer clock`:"—");
  updateRun(now);
  updateReplay(now);
  updateGuidePractice(now);
  drawHitlagOrb(now);
  if (lastEventFlash && now > lastEventFlash.until) lastEventFlash = null;
  elements.sdiFlash.classList.toggle("active", lastEventFlash?.type === "accepted");
  const info = vectorInfo(currentVector);
  setText(elements.rawX,rawInput.x);
  setText(elements.rawY,rawInput.y);
  setText(elements.magnitude,info.magnitude.toFixed(2));
  setText(elements.angle,info.angle == null ? "—" : `${Math.round(info.angle)}°`);
  setText(elements.pollRate,hardwareConnected && adapter.pollRate ? `${Math.round(adapter.pollRate)} Hz` : "—");
  setText(elements.clock,(currentFrame / 60).toFixed(2).padStart(5, "0"));
  const guideZonePreview=sdiGuide?.zonePreview(now);
  drawStick(guideZonePreview);
  drawCStick(now,guideZonePreview);
  if(!presetEditor?.active)drawTimeline();
  updateDebugLive();
  updateSessionButtons();
  requestAnimationFrame(render);
}

let timelineMarkers=[];
const trainerAudio=createTrainerAudio({getPreset:()=>selectedPreset});
const {initialize:initAudio,play:sound,resetChain:resetAudioChain}=trainerAudio;
const videoPresets=new Map();
function cyclePreset(delta){
 if(running||starting||replaying||replayPreparing||presetLoading)return;
 const buttons=[...document.querySelectorAll('[data-preset]')].filter(b=>!b.disabled);
 const index=buttons.findIndex(b=>b.dataset.preset===selectedPreset);
 if(buttons.length)void selectPreset(buttons[(index+delta+buttons.length)%buttons.length].dataset.preset);
}
function updatePresetNavigation(){
 const row=$('#presetControls'),overflow=row.scrollWidth>row.clientWidth+1;
 for(const id of ['previousPreset','nextPreset']){$('#'+id).hidden=!overflow;$('#'+id).disabled=row.inert;}
}
function revealSelectedPreset(){
 const row=$('#presetControls'),button=[...row.querySelectorAll('[data-preset]')].find(b=>b.dataset.preset===selectedPreset);
 if(button){const x=button.offsetLeft;row.scrollLeft=Math.max(0,x-(row.clientWidth-button.offsetWidth)/2);}
 updatePresetNavigation();
}
$('#previousPreset').onclick=()=>cyclePreset(-1);
$('#nextPreset').onclick=()=>cyclePreset(1);
new ResizeObserver(()=>{updatePresetNavigation();revealSelectedPreset();}).observe($('#presetControls'));
new MutationObserver(updatePresetNavigation).observe($('#presetControls'),{attributes:true,attributeFilter:['inert']});

async function loadVideoPresets(){
 try{
  const response=await fetch("/api/presets");if(!response.ok)throw new Error("Preset catalog missing");
  updatePresetCatalog(await response.json());
 }catch{setNotice("Video presets unavailable","Could not discover combo folders. Restart the trainer and try again.","error");$("[data-preset='Luigi Combo']").disabled=true;}
}
function updatePresetCatalog(catalog){
  if(catalog.errors.length)setNotice("Some combo packages could not load",catalog.errors.join("; "),"error");
  for(const preset of catalog.presets){
   if(!preset.name || !preset.sequence || !preset.video)continue;
   videoPresets.set(preset.name,preset);
   let button=[...document.querySelectorAll("[data-preset]")].find(b=>b.dataset.preset===preset.name);
   if(!button){button=document.createElement("button");button.className="button tertiary";button.dataset.preset=preset.name;button.textContent=preset.name;$("[data-preset='Diddy Kong Want Banana!']").before(button);}
   $("[data-preset='Diddy Kong Want Banana!']").before(button);
   button.onclick=()=>selectPreset(preset.name);
  }
  $("#presetControls").append(document.querySelector('[data-preset="Diddy Kong Want Banana!"]'));
  requestAnimationFrame(revealSelectedPreset);
}
let selectedPreset="Steve Fair";
async function selectPreset(name){if(running || starting || replaying)return;document.body.classList.toggle("diddy-game",name==="Diddy Kong Want Banana!");
 clearOrbUnlockNotice();
 $("#attemptHistory").value="";$("#attemptHistory").disabled=false;
 sessionOperation++;clearLoadedAttempt({clearCapture:true,clearWarmup:true});elements.resultsPanel.hidden=true;
 const generation=++selectionGeneration;presetLoading=true;elements.startButton.disabled=true;attemptFrames=[];drill={durationFrames:Math.max(60,drill.durationFrames),hits:[],diFrames:[]};targets=[];analyzer=new SDIAnalyzer(drill,{threshold:Number(elements.thresholdInput.value)});currentFrame=0;lastProcessedFrame=-1;
 comboVideo.clear();const orbMode=name==="Diddy Kong Want Banana!";$("#videoPanel").hidden=!orbMode;$("#hitlagOrb").hidden=!orbMode;$("#orbSettings").hidden=!orbMode;$("#comboVideo").hidden=orbMode;
 orbSwapAnimation=null;selectedPreset=name;requestAnimationFrame(revealSelectedPreset);bananaTimelineViewFrame=null;newBestPreset=null;renderRecentAttempts();renderPersonalBest();
 $("#presetDescription").textContent=videoPresets.has(name)?"Ready to start · combo video included.":"Ready to start.";
 document.querySelectorAll("[data-preset]").forEach(b=>b.classList.toggle("selected",b.dataset.preset===name));
 if(videoPresets.has(name)){
   $("#videoPanel").hidden=false;elements.startButton.disabled=true;
   $("#presetName").textContent=name;
   comboVideo.setState("loading","Preparing video…");
   try{
     const response=await fetch(videoPresets.get(name).sequence);
     if(!response.ok)throw new Error("Could not load the preset sequence.");
     const next=parseSequence(await response.text());
     if(generation!==selectionGeneration)return;
     const duration=await comboVideo.load(videoPresets.get(name).video);
     if(generation!==selectionGeneration || duration===null)return;
     next.durationSeconds=duration;applySequence(next);drill.diFrames=[...(videoPresets.get(name).diFrames??[])];
   }catch(error){if(generation===selectionGeneration)comboVideo.setState("error",error.message);}finally{if(generation===selectionGeneration)presetLoading=false;}
   return;
 }
 const d=makePreset(name);applySequence(sequenceFromDrill(d));presetLoading=false;
 document.querySelector("#presetName").textContent=name;if(name==="Diddy Kong Want Banana!")$("#presetName").innerHTML='Diddy Kong <span class="banana-want">WANT</span> Banana!';elements.resultsPanel.hidden=true;document.querySelector("#sessionReady").hidden=false;
 document.querySelectorAll("[data-preset]").forEach(b=>b.classList.toggle("selected",b.dataset.preset===name));
}
document.querySelectorAll("[data-preset]").forEach(b=>{b.onclick=()=>selectPreset(b.dataset.preset);if(b.dataset.preset==="Diddy Kong Want Banana!")b.textContent="Diddy Kong Want Banana!";});
document.querySelector("#stopButton").onclick=()=>controllerSecondaryAction();
document.querySelector("#settingsButton").onclick=()=>document.querySelector("#settingsDrawer").showModal();
document.querySelector("#closeSettings").onclick=()=>document.querySelector("#settingsDrawer").close();
document.querySelector(".connection").onclick=()=>document.querySelector("#settingsDrawer").showModal();
elements.portSelect.addEventListener("change",()=>document.querySelector("#portLabel").textContent=`Port ${selectedPort+1}`);
function updatePracticeControls(){const game=selectedPreset==='Diddy Kong Want Banana!',canvas=elements.timelineCanvas,rect=canvas.getBoundingClientRect(),ratio=canvas.width/Math.max(1,rect.width);for(const [id,frame] of [['practiceStart',practiceRange.start],['practiceEnd',practiceRange.end??drill.durationFrames]]){const el=$('#'+id);el.hidden=game;el.disabled=running||starting||replaying||replayPreparing;el.style.left=`${(32+(canvas.width-50)*frame/drill.durationFrames)/ratio}px`;el.style.top=`${22/ratio}px`;el.style.height=`${(36+canvas.height*.44+8-22)/ratio}px`;el.setAttribute('aria-valuenow',frame);el.title=`${id==='practiceStart'?'Start':'End'}: ${(frame/60).toFixed(2)} s · drag to adjust`;}
 $('#practiceReset').hidden=game||(practiceRange.start===0&&practiceRange.end===drill.durationFrames);$('#practiceReset').disabled=running||starting||replaying||replayPreparing;$('#practiceWarning').hidden=game||fullHitCoverage(drill,practiceRange);}
async function previewPracticeFrame(frame){pendingPracticeSeek=frame;if(practiceSeekBusy)return;practiceSeekBusy=true;try{while(pendingPracticeSeek!==null){const next=pendingPracticeSeek;pendingPracticeSeek=null;if(comboVideo.url)await comboVideo.seek(Math.min(drill.durationFrames-1,next)*FRAME_MS/1000,'Practice section');}}finally{practiceSeekBusy=false;}}
for(const [id,side] of [['practiceStart','start'],['practiceEnd','end']]){const handle=$('#'+id);handle.addEventListener('pointerdown',e=>{if(handle.disabled)return;e.preventDefault();handle.setPointerCapture(e.pointerId);draggingPractice=side;});handle.addEventListener('pointermove',e=>{if(draggingPractice!==side)return;const rect=elements.timelineCanvas.getBoundingClientRect(),x=(e.clientX-rect.left)*elements.timelineCanvas.width/rect.width;practiceRange=moveRange(drill,practiceRange,side,(x-32)/(elements.timelineCanvas.width-50)*drill.durationFrames);currentFrame=side==='start'?practiceRange.start:Math.max(0,practiceRange.end-1);inspection=null;void previewPracticeFrame(currentFrame);});const release=()=>{draggingPractice=null;};handle.addEventListener('pointerup',release);handle.addEventListener('pointercancel',release);}
$('#practiceReset').onclick=()=>{practiceRange={start:0,end:drill.durationFrames};currentFrame=0;inspection=null;void previewPracticeFrame(0);};
elements.timelineCanvas.addEventListener("pointermove",e=>{
 if(selectedPreset==='Diddy Kong Want Banana!'){e.currentTarget.style.cursor=recording&&!running&&!starting?(bananaTimelineDrag?'grabbing':'grab'):'default';return;}
 const rect=elements.timelineCanvas.getBoundingClientRect(),ratio=elements.timelineCanvas.width/rect.width;
 const x=(e.clientX-rect.left)*ratio;
 const hit=drill.hits.find(h=>x>=32+(elements.timelineCanvas.width-50)*h.startFrame/drill.durationFrames&&x<32+(elements.timelineCanvas.width-50)*(h.startFrame+h.lengthFrames)/drill.durationFrames);
 hoveredHitId=recording&&!running&&!starting&&!replaying&&!replayPreparing?hit?.id:null;elements.timelineCanvas.style.cursor=hoveredHitId!=null?"pointer":"default";
});
elements.timelineCanvas.addEventListener("pointerleave",()=>{hoveredHitId=null;elements.timelineCanvas.style.cursor="default";});

$("#windowFrames").addEventListener('pointermove',e=>{const canvas=e.currentTarget,rect=canvas.getBoundingClientRect(),ratio=canvas.width/rect.width,x=(e.clientX-rect.left)*ratio,y=(e.clientY-rect.top)*ratio;const hit=drill.hits.find(h=>h.id===inspectedHitId);if(!hit)return;const detail=$("#windowDetail");detail.dataset.hover='true';const mark=inspectorMarkers.find(p=>Math.hypot(p.x-x,p.y-y)<14*ratio);const frame=Math.max(1,Math.min(hit.lengthFrames,Math.floor((x-12*ratio)/((canvas.width-24*ratio)/hit.lengthFrames))+1));detail.textContent=mark?eventDetail(mark.event):`Hitlag frame ${frame} · total frame ${hit.startFrame+frame-1}`;});
$("#windowFrames").addEventListener('pointerleave',()=>delete $("#windowDetail").dataset.hover);
elements.timelineCanvas.addEventListener('click',e=>{
 if(selectedPreset==="Diddy Kong Want Banana!"||!recording||running||(starting&&!replayPreparing))return;
 if(replaying||replayPreparing)stopReplay("Replay canceled",false);
 const rect=e.currentTarget.getBoundingClientRect(),x=(e.clientX-rect.left)*e.currentTarget.width/rect.width;
 const frame=(x-32)/(e.currentTarget.width-50)*drill.durationFrames;
 const diFrame=(drill.diFrames??[]).find(f=>Math.abs(frame-(f+.5))<=.8);
 if(diFrame!=null){const preceding=drill.hits.find(h=>h.startFrame+h.lengthFrames===diFrame);if(preceding){inspectedHitId=preceding.id;$('#hitlagInspector').hidden=false;}void inspectFrame(diFrame);return;}
 const snapFrames=8*e.currentTarget.width/rect.width/(e.currentTarget.width-50)*drill.durationFrames;
 const hit=drill.hits.map(h=>({hit:h,distance:frame<h.startFrame?h.startFrame-frame:frame>=h.startFrame+h.lengthFrames?frame-(h.startFrame+h.lengthFrames):0})).sort((a,b)=>a.distance-b.distance).find(h=>h.distance<=snapFrames)?.hit;
 if(hit){inspectedHitId=hit.id;$("#hitlagInspector").hidden=false;delete $("#windowDetail").dataset.hover;void inspectFrame(hit.startFrame);}
 else void inspectFrame(Math.floor(frame));
});
async function inspectFrame(frame){
 pausedReplay=null;
 if(!recording||running)return;if(replaying||replayPreparing)stopReplay("",false);
 frame=Math.max(0,Math.min((recording.frames?.at(-1)?.frame??drill.durationFrames-1),frame));
 const hit=drill.hits.find(h=>frame>=h.startFrame&&frame<h.startFrame+h.lengthFrames);
 if(hit)inspectedHitId=hit.id;
 const sample=recording.frames?.find(s=>s.frame===frame)??recording.samples.findLast(s=>s.timeMs<=frame*FRAME_MS)??recording.samples[0];
 if(!sample)return;
 inspection={...sample,frame,smoothVector:sample.smoothVector??gameToPhysical(sample.vector),smoothCStick:sample.smoothCStick??sample.cStick};currentFrame=frame;
 const events=recording.events.filter(e=>e.frame===frame&&e.type!=="weak");lastEventFlash=events.find(e=>e.type==='accepted');if(lastEventFlash)lastEventFlash={...lastEventFlash,until:Infinity};
 $("#inspectedFrame").textContent=`Frame ${frame+1} / ${drill.durationFrames}${hit?" · hitlag frame "+(frame-hit.startFrame+1):" · outside hitlag"}`;
 const pending=sample.pending;$("#inspectionState").textContent=`${events.map(eventDetail).join(' · ')||'No SDI event'} · Lockout: ${sample.lockout??0} frames · Buffered: ${pending?pending.source+' '+directionLabel(vectorInfo(pending.vector).angle):'none'}`;
 if(comboVideo.url)await comboVideo.seek(frame/60,'Frame inspection');
}
$("#windowFrames").addEventListener('click',e=>{if(!recording)return;const hit=drill.hits.find(h=>h.id===inspectedHitId);if(!hit)return;const rect=e.currentTarget.getBoundingClientRect(),ratio=e.currentTarget.width/rect.width,x=(e.clientX-rect.left)*ratio;const cell=(e.currentTarget.width-24*ratio)/hit.lengthFrames;void inspectFrame(hit.startFrame+Math.floor((x-12*ratio)/cell));});
$("#previousFrame").addEventListener('click',()=>stepRecordedFrame(-1));
$("#nextFrame").addEventListener('click',()=>stepRecordedFrame(1));
$("#closeInspector").addEventListener('click',()=>{pausedReplay=null;if(replaying||replayPreparing)stopReplay();inspection=null;lastEventFlash=null;$("#hitlagInspector").hidden=true;currentFrame=recording?drill.durationFrames-1:0;if(comboVideo.url)void comboVideo.reset();});
$("#replayWindow").addEventListener('click',()=>{const hit=drill.hits.find(h=>h.id===inspectedHitId);if(hit)void startReplay({startMs:Math.max(0,hit.startFrame*FRAME_MS-300),endMs:Math.min(recording.durationMs,(hit.startFrame+hit.lengthFrames)*FRAME_MS+300)},.1);});
replaySpeed=Math.max(.1,Math.min(1,replaySpeed||.1));
$("#replaySpeed").value=Math.round(replaySpeed*100);
function updateReplaySpeedLabel(){const pct=Math.round(replaySpeed*100);$("#replaySpeedValue").value=`${pct}%`;$("#replayButton").textContent=`Replay`;$("#replayWindow").textContent="Replay window · 10%";}
updateReplaySpeedLabel();$("#replaySpeed").addEventListener('input',e=>{replaySpeed=Number(e.target.value)/100;localStorage.setItem('sdi-replay-speed-v2',e.target.value);updateReplaySpeedLabel();});
trainerAudio.installSettings();
window.addEventListener("blur",()=>{pressedKeys.clear();if(!hardwareConnected)addSample({x:0,y:0});});
await loadVideoPresets();
selectPreset(selectedPreset);
presetEditor = createPresetEditor({
  canOpen: () => !running && !starting && !replaying && !replayPreparing && !presetLoading && !sdiGuide?.open,
  onModeChange(active) {
    $("#presetControls").inert = active;
    pressedKeys.clear();
    resetControllerActions();
  },
  onSave(catalog, name) {
    updatePresetCatalog(catalog);
    void selectPreset(name);
  },
});

requestAnimationFrame(render);

let cZoneCache=null,cZoneFlashUntil=0;
function drawCStick(now,guideZonePreview){
 const displayed=inspection?inspection.smoothCStick:(replaying?replaySmoothCStick:delayedLiveSample().smoothCStick??smoothCStick);
 const canvas=$("#cStickCanvas"),{width,height}=sizeCanvas(canvas),ctx=canvas.getContext("2d"),r=Math.min(width,height)*.48;
 ctx.clearRect(0,0,width,height);
 const demo=guideZonePreview?.direction?guideZonePreview:null;
 const main=demo?.direction??(inspection?inspection.vector:(replaying?replayVector:delayedLiveSample().vector));
 if(showActiveZones||demo){
  const epsilon=analyzer.rules.componentEpsilon,eligible=Math.hypot(main.x,main.y)>=analyzer.rules.threshold;
  const sign=v=>Math.abs(v)<=epsilon?0:Math.sign(v);
  const windows=document.body.dataset.theme==='windows';
  const key=[width,height,epsilon,eligible,sign(main.x),sign(main.y),windows].join(':');
  if(cZoneCache?.key!==key){
   const layer=document.createElement('canvas');layer.width=width;layer.height=height;
   const lc=layer.getContext('2d'),pixels=lc.createImageData(width,height);
   if(eligible)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const physical={x:(x+.5-width/2)/r,y:(height/2-y-.5)/r};
    if(Math.hypot(physical.x,physical.y)>1)continue;
    const c=smoothToGame(physical),m=Math.hypot(c.x,c.y);
    if(m<.5)continue;
    const direction={x:c.x/m*.625,y:c.y/m*.625};
    if(!hasNewDirectionalComponent(direction,main,epsilon))continue;
    const i=(y*width+x)*4;
    pixels.data[i]=windows?35:190;pixels.data[i+1]=windows?43:197;pixels.data[i+2]=windows?52:206;pixels.data[i+3]=windows?75:48;
   }
   lc.putImageData(pixels,0,0);cZoneCache={key,layer};
  }
  ctx.save();ctx.globalAlpha=demo?.cStickStrength??1;ctx.drawImage(cZoneCache.layer,0,0);ctx.restore();
 }
 const active=(!replaying && now<cFlashUntil) || Math.hypot(displayed.x,displayed.y)>.2;
 ctx.strokeStyle=active?"#f3c969":"#34445a";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(width/2,height/2,r,0,Math.PI*2);ctx.stroke();
 ctx.fillStyle=showActiveZones&&now<cZoneFlashUntil?"#67d7b4":active?"#f3c969":"#516078";ctx.beginPath();ctx.arc(width/2+displayed.x*(r-3),height/2-displayed.y*(r-3),active?4:2,0,Math.PI*2);ctx.fill();
}


function setReplayControls(active){
 $("#presetControls").inert=active;
 elements.startButton.disabled=active;$("#replayButton").disabled=active&&!replaying;$("#replayButton").textContent=active?"Pause":"Replay";$("#replaySpeed").disabled=active;
 $("#stopButton").hidden=!active;$("#stopButton").textContent=active?"Stop replay":"Stop drill";
}
function beginReplay(origin){
 resetAudioChain();
 replayPreparing=false;starting=false;replaying=true;replay=new AttemptReplay(recording,origin+replayRange.startMs/replayPlaybackSpeed,replayPlaybackSpeed,{startMs:replayRange.startMs,endMs:replayRange.endMs??recording.durationMs});
 currentFrame=Math.floor(replayRange.startMs/FRAME_MS);liveAcceptedCount=recording.events.filter(e=>e.type==="accepted"&&e.timeMs<replayRange.startMs).length;elements.acceptedLiveCount.textContent="0";lastEventFlash=null;
 $("#replayStatus").textContent=`Replay · ${Math.round(replayPlaybackSpeed*100)}% speed`;setReplayControls(true);initAudio();sound("start");
}
async function startReplay(range=null,speed=replaySpeed){
 if(sdiGuide?.open)return;
 if(orbSwapAnimation)return;
 if(!recording || running || starting || replaying)return;
 if(comboVideo.url && comboVideo.state!=="ready")return;
 // A primary resume keeps the paused segment; an explicit range starts a new replay.
 const resume=range===null?pausedReplay:null;
 pausedReplay=null;
 if(resume){range={startMs:resume.cursorMs,endMs:resume.endMs};speed=resume.speed;}
 replayPlaybackSpeed=speed;
 const operation=++sessionOperation;
 inspection=null;replayRange=range?.startMs!=null?range:{startMs:Math.max((recording.practiceRange?.start??0)*FRAME_MS,replayStartMs(selectedPreset==="Diddy Kong Want Banana!"?(bananaTimelineViewFrame??currentFrame):currentFrame,recording.durationMs)),endMs:recording.durationMs};
 replayPreparing=true;starting=true;setReplayControls(true);$("#replayStatus").textContent="Preparing replay…";
 if(comboVideo.url){await comboVideo.seek(replayRange.startMs/1000);if(operation!==sessionOperation||!replayPreparing)return;await comboVideo.start(origin=>{if(operation===sessionOperation&&replayPreparing)beginReplay(origin);},replayPlaybackSpeed,{audio:false});}else beginReplay(performance.now()-replayRange.startMs/replayPlaybackSpeed);
}
function stopReplay(message="",resetVideo=true){
 pausedReplay=null;sessionOperation++;
 restoreBestReplaySpeed();
 replaying=false;replayPreparing=false;starting=false;replay=null;lastEventFlash=null;
 currentFrame=recording?.frames?.at(-1)?.frame??Math.max(0,Math.ceil((recording?.durationMs??drill.durationFrames*FRAME_MS)/FRAME_MS)-1);if(selectedPreset==='Diddy Kong Want Banana!')bananaTimelineViewFrame=currentFrame;liveAcceptedCount=recording?.events.filter(e=>e.type==="accepted").length??0;
 elements.acceptedLiveCount.textContent=String(liveAcceptedCount);
 $("#replayStatus").textContent=message || `Replay · ${Math.round(replayPlaybackSpeed*100)}% speed`;setReplayControls(false);
 if(comboVideo.url){if(resetVideo)void comboVideo.reset();else comboVideo.cancel();}
}
function updateReplay(now){
 if(!replaying)return;
 const state=replay.tick(now);replayVector=state.vector;replayCStick=state.cStick;replaySmoothVector=state.smoothVector;replaySmoothCStick=state.smoothCStick;
 currentFrame=Math.min(recording.frames?.at(-1)?.frame??Math.ceil(recording.durationMs/FRAME_MS)-1,Math.floor(state.timeMs/FRAME_MS));
 for(const e of state.events){
  if(e.sound)sound(e.sound,e);
  if(e.ding)sound("ding");
  if(e.type==="accepted"){
   liveAcceptedCount++;elements.acceptedLiveCount.textContent=String(liveAcceptedCount);
   lastEventFlash={...e,until:now+450};
  }
 }
 if(state.done){sound("end");const end=replayRange.endMs;const partial=replayRange.startMs>0||end<recording.durationMs;stopReplay("",!partial);if(partial)void inspectFrame(Math.round(end/FRAME_MS)-1);}
}
const afterAttemptAction=$('#afterAttemptAction');
afterAttemptAction.value=localStorage.getItem('sdi-after-attempt-action')==='retry'?'retry':'replay';
afterAttemptAction.addEventListener('change',()=>{
 localStorage.setItem('sdi-after-attempt-action',afterAttemptAction.value);
 updateSessionButtons();
});
const sessionControls=createSessionControls({
 getState:()=>({running,starting,replaying,replayPreparing,replayPaused:!!pausedReplay,recorded:!!recording,afterAttemptAction:afterAttemptAction.value,isDwb:selectedPreset==='Diddy Kong Want Banana!',presetLoading,hasVideo:!!comboVideo.url,videoReady:comboVideo.state==='ready'}),
 actions:{startRun,startReplay,pauseReplay:toggleReplayPause,stopReplayAtStart,stopRun},
 buttons:{start:elements.startButton,stop:elements.stopButton,replay:$('#replayButton')},
});
function controllerPrimaryAction(){return sessionControls.primary();}
function controllerSecondaryAction(){return sessionControls.secondary();}
function stopReplayAtStart(){
 stopReplay("Replay stopped",false);
 currentFrame=0;inspection=null;bananaTimelineViewFrame=null;liveAcceptedCount=0;elements.acceptedLiveCount.textContent="0";
 if(selectedPreset==='Diddy Kong Want Banana!')showBananaTimelineStick(0);
 else if(recording)void inspectFrame(0);
}
async function toggleReplayPause(){
 if(!replaying)return;
 const descriptor={speed:replayPlaybackSpeed,endMs:replayRange.endMs,cursorMs:Math.max(replayRange.startMs,Math.min(replayRange.endMs,comboVideo.url?comboVideo.video.currentTime*1000:replay.timeMs))};
 const frame=Math.max(0,Math.min(Math.ceil(recording.durationMs/FRAME_MS)-1,Math.floor(descriptor.cursorMs/FRAME_MS)));
 stopReplay("Replay paused",false);
 const operation=sessionOperation;
 currentFrame=frame;
 if(selectedPreset==='Diddy Kong Want Banana!')showBananaTimelineStick(frame);
 else await inspectFrame(frame);
 if(operation!==sessionOperation||!recording)return;
 pausedReplay=descriptor;
 liveAcceptedCount=recording.events.filter(e=>e.type==='accepted'&&e.frame<=frame).length;
 elements.acceptedLiveCount.textContent=String(liveAcceptedCount);
}
$("#replayButton").addEventListener("click",()=>replaying?toggleReplayPause():startReplay());

const debugDrill={durationFrames:60,hits:[{id:"debug",startFrame:0,lengthFrames:60,angle:0,targets:[]}]};
let debugAnalyzer=new SDIAnalyzer(debugDrill),debugFrames=0;
let debugCaptured={left:{x:0,y:0},c:{x:0,y:0}},debugCapturedSmooth={left:{x:0,y:0},c:{x:0,y:0}},debugLastAccepted=null,debugMapKey="";
const debugMaps={};
function debugVectors(){
 if(!$("#debugManual").checked)return {left:{...currentVector},c:{...currentCStick}};
 const n=id=>Math.max(-1,Math.min(1,Number($(id).value)||0));
 return {left:smoothToGame({x:n("#debugLX"),y:n("#debugLY")},DEFAULT_CALIBRATION),c:smoothToGame({x:n("#debugCX"),y:n("#debugCY")},DEFAULT_CALIBRATION)};
}
function debugDirection(v){return `${Math.round(vectorInfo(v).angle??0)}° (${v.x.toFixed(2)}, ${v.y.toFixed(2)})`;}
function updateDebugLive(){
 if(!$("#frameTest").open)return;
 const {left,c}=debugVectors();
 $("#debugLive").textContent=`Live main ${debugDirection(left)} · C ${debugDirection(c)}`;
 $("#debugNext").disabled=running||starting||replaying||replayPreparing||debugFrames>=60;
 const pending=debugAnalyzer.pending;
 if(pending?.source==="c-stick")$("#debugBuffer").textContent=`Buffered: c-stick refresh follows main · ${debugDirection(left)} · C ${debugDirection(pending.cDirection)} · from frame ${pending.frame+1}`;
 drawDebugSticks(left,c);
}
function drawDebug(){
 const ctx=$("#debugTimeline").getContext("2d"),w=ctx.canvas.width;
 ctx.clearRect(0,0,w,130);ctx.fillStyle="#0b1220";ctx.fillRect(0,0,w,130);
 const cell=w/60;
 for(let f=0;f<60;f++){
  ctx.fillStyle=f<debugFrames?"#29405c":"#162638";ctx.fillRect(f*cell+1,20,cell-2,60);
  if(f%5===0){ctx.fillStyle="#9aa8b9";ctx.font="16px sans-serif";ctx.fillText(String(f+1),f*cell+2,105);}
 }
 for(const e of debugAnalyzer.events.filter(e=>e.type!=="weak")){
  ctx.fillStyle=e.type==="accepted"?"#51d5b1":e.type==="buffer-full"?"#ff6574":"#e7b85c";
  ctx.beginPath();ctx.arc((e.frame+.5)*cell,e.type==="accepted"?40:65,5,0,Math.PI*2);ctx.fill();
  if(e.source==="c-stick"){ctx.fillStyle="#fff";ctx.font="12px sans-serif";ctx.fillText("C",(e.frame+.5)*cell-4,15);}
 }
}
function stepDebug(){
 if(running||starting||replaying||replayPreparing||debugFrames>=60)return;
 const {left,c}=debugVectors(),f=debugFrames++,before=debugAnalyzer.events.length;
 debugCaptured={left:{...left},c:{...c}};debugCapturedSmooth=debugDisplayVectors(left,c);
 debugAnalyzer.processFrame(f,left,f*FRAME_MS,c,debugDisplayVectors(left,c).left);
 const events=debugAnalyzer.events.slice(before).filter(e=>e.type!=="weak"),accepted=events.find(e=>e.type==="accepted");
 const lock=debugAnalyzer.lastAcceptedFrame==null?0:Math.max(0,4-(f-debugAnalyzer.lastAcceptedFrame));
 const pending=debugAnalyzer.pending;
 $("#debugFrame").textContent=`${debugFrames} / 60`;
 $("#debugBuffer").textContent=pending?`Buffered: ${pending.source==="c-stick"?"refresh follows main · "+debugDirection(left):debugDirection(pending.vector)} · ${pending.source} · from frame ${pending.frame+1}`:"Buffered: none";
 $("#debugLockout").textContent=`Lockout: ${lock} frames${lock?` · available on frame ${f+lock+1}`:""}`;
 const labels={"c-refresh-cancelled":"C refresh expired without SDI",accepted:"Accepted SDI",buffered:"Input buffered",'buffer-replaced':"Buffered input replaced",'buffer-full':"Buffer full — input ignored",weak:"Below SDI strength threshold"};
 $("#debugOutcome").textContent=`Frame ${f+1}: ${events.length?events.map(e=>labels[e.type]||e.type).join(" · "):"No new qualifying direction or C-stick entry"}`;
 if(accepted){
  debugLastAccepted=accepted;
  initAudio();sound(accepted.hitlagFrame===1?"first":"accepted");
  const arrows=["→","↗","↑","↖","←","↙","↓","↘"],angle=vectorInfo(accepted.vector).angle||0;
  $("#debugArrow").textContent=`${arrows[Math.round(angle/45)%8]} SDI ${debugDirection(accepted.vector)} · ${accepted.source}`;
 }else $("#debugArrow").textContent="";
 drawDebug();updateDebugLive();
}
$("#debugNext").addEventListener("click",stepDebug);
$("#debugReset").addEventListener("click",()=>{
 debugAnalyzer=new SDIAnalyzer(debugDrill);debugFrames=0;debugCaptured={left:{x:0,y:0},c:{x:0,y:0}};debugCapturedSmooth={left:{x:0,y:0},c:{x:0,y:0}};debugLastAccepted=null;debugMapKey="";
 $("#debugFrame").textContent="0 / 60";$("#debugBuffer").textContent="Buffered: none";$("#debugLockout").textContent="Lockout: 0 frames";
 $("#debugOutcome").textContent="Ready to capture frame 1.";$("#debugArrow").textContent="";drawDebug();updateDebugLive();
});
$("#debugManual").addEventListener("change",()=>{$("#debugInputs").hidden=!$("#debugManual").checked;updateDebugLive();});
window.addEventListener("keydown",e=>{if(e.code==="KeyN"&&!e.repeat&&$("#frameTest").open&&!/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)){e.preventDefault();stepDebug();}});
drawDebug();

function drawDebugSticks(left,c){
 const physicalSmooth=true;
 const shown=debugDisplayVectors(left,c);
 $("#debugDisplayNote").textContent="Physical stick map · manual values are gate fractions · Ultimate adds a purple processed marker.";
 const key=JSON.stringify([debugFrames,left,c,debugAnalyzer.rules,physicalSmooth,calibration,cCalibration]);
 if(key!==debugMapKey){
  debugMapKey=key;
  for(const side of ["left","c"]){
   const map=document.createElement("canvas");map.width=map.height=40;const ctx=map.getContext("2d");
   for(let py=0;py<40;py++)for(let px=0;px<40;px++){
    const v={x:(px+.5)/20-1,y:1-(py+.5)/20};let color=null;
    if(debugFrames<60){
     const gameV=physicalSmooth?smoothToGame(v,$("#debugManual").checked?DEFAULT_CALIBRATION:(side==="left"?calibration:cCalibration)):v;
     const result=probeNext(debugAnalyzer,debugFrames,side==="left"?gameV:left,side==="c"?gameV:c,side==="left"?v:shown.left);
     color={accepted:"#248b70",buffered:"#a47b24","buffer-replaced":"#a47b24","buffer-full":"#933e4b"}[result.outcome];
     if(side==="c" && debugAnalyzer.tilt.active && Math.hypot(gameV.x,gameV.y)<=.2)color="#3869a2";
    }
    if(color){ctx.fillStyle=color;ctx.fillRect(px,py,1,1);}
   }
   debugMaps[side]=map;
  }
 }
 for(const [side,id,v] of [["left","#debugMainStick",left],["c","#debugCStick",c]]){
  const canvas=$(id),ctx=canvas.getContext("2d"),w=canvas.width,h=canvas.height,pad=28,r=(w-2*pad)/2,mid=w/2;
  const point=v=>({x:mid+v.x*r,y:h/2-v.y*r});
  ctx.clearRect(0,0,w,h);ctx.fillStyle="#0b1220";ctx.fillRect(0,0,w,h);
  ctx.imageSmoothingEnabled=false;ctx.globalAlpha=.65;ctx.drawImage(debugMaps[side],pad,pad,w-2*pad,h-2*pad);ctx.globalAlpha=1;
  ctx.strokeStyle="#53637b";ctx.lineWidth=1;ctx.strokeRect(pad,pad,w-2*pad,h-2*pad);
  ctx.beginPath();ctx.moveTo(pad,h/2);ctx.lineTo(w-pad,h/2);ctx.moveTo(mid,pad);ctx.lineTo(mid,h-pad);ctx.stroke();
  if(side==="left"){
   drawZoneOverlay(ctx,mid,h/2,r,physicalSmooth,calibration,false);
   if(debugLastAccepted){const mag=Math.hypot(debugLastAccepted.vector.x,debugLastAccepted.vector.y)||1,a=point({x:debugLastAccepted.vector.x/mag*.55,y:debugLastAccepted.vector.y/mag*.55});ctx.strokeStyle="#67d7b4";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(mid,h/2);ctx.lineTo(a.x,a.y);ctx.stroke();const angle=Math.atan2(a.y-h/2,a.x-mid);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(a.x-10*Math.cos(angle-.5),a.y-10*Math.sin(angle-.5));ctx.moveTo(a.x,a.y);ctx.lineTo(a.x-10*Math.cos(angle+.5),a.y-10*Math.sin(angle+.5));ctx.stroke();}
  }
  const captured=point(debugCapturedSmooth[side]),live=point(shown[side]);ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(captured.x,captured.y,9,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle=side==="left"?"#ff824a":"#cfa4ff";ctx.beginPath();ctx.arc(live.x,live.y,5,0,Math.PI*2);ctx.fill();
  if(stickDisplay==="ultimate"||stickDisplay==="ultimate-only")drawProcessedMarker(ctx,mid,h/2,r,v);
  ctx.fillStyle="#aab6c6";ctx.font="12px sans-serif";ctx.fillText("+Y",mid+4,18);ctx.fillText("+X",w-24,h/2-5);
 }
 const probe=debugFrames<60?probeNext(debugAnalyzer,debugFrames,left,c,debugDisplayVectors(left,c).left):null;
 const messages={accepted:"Holding these live positions next frame creates an accepted input.",buffered:"Holding these live positions next frame buffers a new input.","buffer-replaced":"Holding these live positions next frame replaces the C refresh with a fixed main-stick input.","buffer-full":"These positions create a candidate, but a pending input prevents a new buffer entry.",none:"Holding these positions next frame creates no new input."};
 $("#debugGuidanceStatus").textContent=probe?messages[probe.outcome]+(probe.executed?.buffered?" The waiting buffered input will execute next frame.":probe.cancelled?" The C refresh expires without SDI at these positions.":"")+(debugAnalyzer.tilt.active?" C-stick is held: return to blue, capture a frame, then flick again.":" C-stick is ready for a new flick."):"60 frames complete. Reset to test again.";
}
for(const [id,xid,yid] of [["#debugMainStick","#debugLX","#debugLY"],["#debugCStick","#debugCX","#debugCY"]]){
 $(id).addEventListener("pointerdown",e=>{
  const rect=e.currentTarget.getBoundingClientRect(),w=e.currentTarget.width,pad=28;
  const x=(e.clientX-rect.left)*w/rect.width,y=(e.clientY-rect.top)*w/rect.height;
  const physicalSmooth=true;
  if(!$("#debugManual").checked){$("#debugLX").value=smoothVector.x;$("#debugLY").value=smoothVector.y;$("#debugCX").value=smoothCStick.x;$("#debugCY").value=smoothCStick.y;}
  $("#debugManual").checked=true;$("#debugInputs").hidden=false;
  let picked={x:Math.max(-1,Math.min(1,(x-w/2)/((w-2*pad)/2))),y:Math.max(-1,Math.min(1,(w/2-y)/((w-2*pad)/2)))};

  $(xid).value=picked.x.toFixed(2);$(yid).value=picked.y.toFixed(2);updateDebugLive();
 });
}

function debugDisplayVectors(left,c){
 if(!$("#debugManual").checked)return {left:{...smoothVector},c:{...smoothCStick}};
 const n=id=>Math.max(-1,Math.min(1,Number($(id).value)||0));
 return {left:{x:n("#debugLX"),y:n("#debugLY")},c:{x:n("#debugCX"),y:n("#debugCY")}};
}
function drawProcessedMarker(ctx,cx,cy,r,v){
 const x=cx+v.x*r,y=cy-v.y*r;ctx.save();ctx.strokeStyle="#e0bdff";ctx.fillStyle="rgba(177,111,245,.4)";ctx.lineWidth=2.5;ctx.shadowColor="#cfa4ff";ctx.shadowBlur=5;
 ctx.beginPath();ctx.moveTo(x,y-8);ctx.lineTo(x+8,y);ctx.lineTo(x,y+8);ctx.lineTo(x-8,y);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
}
$("#stickDisplay").value=stickDisplay;
document.querySelector(".physical-key-dot").parentElement.hidden=stickDisplay==="ultimate-only";
$("#stickDisplay").addEventListener("change",e=>{stickDisplay=e.target.value;localStorage.setItem("sdi-stick-display",stickDisplay);debugMapKey="";document.querySelector(".physical-key-dot").parentElement.hidden=stickDisplay==="ultimate-only";updateDebugLive();});

inputDelayFrames=Math.max(0,Math.min(6,Math.round(inputDelayFrames)||0));
$("#inputDelay").value=inputDelayFrames;$("#inputDelayValue").value=`${inputDelayFrames} frames`;
$("#inputDelay").addEventListener('input',e=>{inputDelayFrames=Number(e.target.value);localStorage.setItem('sdi-input-delay-v2',inputDelayFrames);$("#inputDelayValue").value=`${inputDelayFrames} frames`;});


function personalBestKey(preset=selectedPreset,entry=null){return personalBestStorageKey(preset,entry?.recording,{mode:$('#orbMode').value,timed:$('#orbTiming').value!=='untimed'});}
function renderPersonalBest(){if(pendingClearBestKey&&pendingClearBestKey!==personalBestKey())cancelClearBest();const entry=personalBests[personalBestKey()];const renderKey=JSON.stringify([personalBestKey(),entry?.id,entry?.savedAt,newBestPreset,running,starting,replaying,replayPreparing]);if(renderKey===personalBestRenderKey)return;personalBestRenderKey=renderKey;const candidate=personalBests[personalBestKey()],a=candidate&&eligibleForPersonalBest(candidate,Infinity)?candidate:null;$('#personalBest').hidden=false;$('.session-stack').classList.add('has-personal-best');$('#bestScore').textContent=a?(a.results.orb?String(a.results.orb.score):`${a.results.acceptedCount} / ${a.results.possibleCount}`):'—';$('#bestPercent').textContent=a?(a.results.orb?`Bananas consumed · ${a.recording.orbMode} · ${a.recording.orbTimed?"Timed":"Untimed"}`:`${a.results.score}% of possible inputs`):'No completed attempt yet';$('#bestDate').textContent=a?new Date(a.savedAt).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'';$('#bestMessage').textContent=newBestPreset===selectedPreset?'New personal best!':'';$('#replayBest').disabled=!a||running||starting||replaying||replayPreparing;$('#clearPersonalBest').disabled=$('#replayBest').disabled;}
async function saveBest(entry){
 if(!eligibleForPersonalBest(entry,lastProcessedFrame)){newBestPreset=null;renderPersonalBest();return;}
 entry.earlyStartCount=currentEarlyStarts().length;
 const key=personalBestKey(entry.preset,entry),better=beatsPersonalBest(entry,personalBests[key]&&eligibleForPersonalBest(personalBests[key],Infinity)?personalBests[key]:null);
 newBestPreset=better?entry.preset:null;
 if(better){personalBests[key]=structuredClone(entry);try{await attemptHistory.saveBests(personalBests);}catch{setNotice('Personal best could not be saved','Local storage is unavailable.','error');}}
 renderPersonalBest();
}

$('#clearPersonalBest').onclick=()=>{if($('#clearPersonalBest').disabled)return;pendingClearBestKey=personalBestKey();$('#bestDetails').hidden=true;$('#clearBestInline').hidden=false;};
function cancelClearBest(){pendingClearBestKey=null;$('#bestDetails').hidden=false;$('#clearBestInline').hidden=true;}
$('#cancelClearBest').onclick=cancelClearBest;
$('#confirmClearBest').onclick=async()=>{const key=pendingClearBestKey;if(!key)return;const updated={...personalBests};delete updated[key];try{await attemptHistory.saveBests(updated);personalBests=updated;newBestPreset=null;personalBestRenderKey='';renderPersonalBest();cancelClearBest();}catch{setNotice('Personal best could not be cleared','Local storage is unavailable.','error');}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pendingClearBestKey)cancelClearBest();});
$('#replayBest').onclick=async()=>{const best=personalBests[personalBestKey()];if(!best||running||starting||replaying||replayPreparing)return;const restored=await restoreRecentAttempt(best.id,best);if(restored===false||restored!==sessionOperation)return;bestReplayPreviousSpeed=replaySpeed;replaySpeed=1;$('#replaySpeed').value=100;updateReplaySpeedLabel();await startReplay({startMs:(recording.practiceRange?.start??0)*FRAME_MS,endMs:recording.durationMs});if(!replaying&&!replayPreparing)restoreBestReplaySpeed();};
function restoreBestReplaySpeed(){if(bestReplayPreviousSpeed!==null){replaySpeed=bestReplayPreviousSpeed;bestReplayPreviousSpeed=null;$('#replaySpeed').value=Math.round(replaySpeed*100);updateReplaySpeedLabel();}}

const attemptHistory=createAttemptHistory();
function renderRecentAttempts(){const menu=$("#attemptHistory"),selected=menu.value,entries=recentAttempts.filter(a=>a.preset===selectedPreset);menu.replaceChildren(new Option(entries.length?'Recent attempts':'No recent attempts',''));for(const a of entries)menu.add(new Option(`${a.results.orb?a.results.orb.score+' bananas':a.results.acceptedCount+'/'+a.results.possibleCount} · ${new Date(a.savedAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`,a.id));menu.value=selected;}

async function persistRecentAttempts(){try{await attemptHistory.saveAttempts(recentAttempts);}catch{setNotice('History could not be saved','This browser could not save attempts locally.','error');}}
function saveRecentAttempt(results){if(!recording)return;const entry={id:crypto.randomUUID(),savedAt:Date.now(),preset:selectedPreset,drill:structuredClone(drill),sequence:structuredClone(sequence),recording:structuredClone(recording),results:structuredClone(results),delay:runInputDelayFrames};void saveBest(entry);recentAttempts.unshift(entry);recentAttempts=trimAttemptHistory(recentAttempts);renderRecentAttempts();$("#attemptHistory").value=entry.id;void persistRecentAttempts();}
async function restoreRecentAttempt(id,savedEntry=null){
 const a=savedEntry??recentAttempts.find(a=>a.id===id);
 if(!a||running||starting)return false;
 if(replaying||replayPreparing)stopReplay();
 const restoreOperation=++attemptRestoreOperation;
 const selection=selectPreset(a.preset==="Infinite Hitlag"?"Diddy Kong Want Banana!":a.preset);
 // Selection and session cancellation must also invalidate the caller awaiting restoration.
 const operation=sessionOperation;
 const current=()=>operation===sessionOperation&&restoreOperation===attemptRestoreOperation;
 $("#attemptHistory").disabled=true;
 try{
  await selection;
  if(!current()||(videoPresets.has(selectedPreset)&&comboVideo.state!=="ready"))return false;
  if(comboVideo.url){await comboVideo.seek(0,'Saved attempt');if(!current()||comboVideo.state!=="ready")return false;}
  drill=structuredClone(a.drill);sequence=structuredClone(a.sequence);recording=structuredClone(a.recording);orbCharacterPreview=false;orbSwapAnimation=null;practiceRange={...(recording.practiceRange??{start:0,end:drill.durationFrames})};runPracticeRange={...practiceRange};if(a.results.orb){$("#orbMode").value=recording.orbMode;$("#orbTiming").value=recording.orbTimed?"timed":"untimed";}analyzer=new SDIAnalyzer(a.results.orb?drill:{...drill,hits:includedHits(drill,recording.practiceRange??{start:0,end:drill.durationFrames})},{threshold:Number(elements.thresholdInput.value)});analyzer.events=structuredClone(recording.events);currentFrame=0;lastProcessedFrame=recording.frames.at(-1)?.frame??0;inputDelayFrames=a.delay;runInputDelayFrames=a.delay;$("#inputDelay").value=a.delay;$("#inputDelayValue").value=`${a.delay} frames`;inspection=null;lastEventFlash=null;liveAcceptedCount=a.results.acceptedCount;elements.acceptedLiveCount.textContent=String(liveAcceptedCount);showResults(a.results);$("#replayButton").hidden=false;$("#replayButton").disabled=false;$("#attemptHistory").value=id;
  return operation;
 }finally{if(restoreOperation===attemptRestoreOperation)$("#attemptHistory").disabled=false;}
}
$("#attemptHistory").addEventListener('change',e=>void restoreRecentAttempt(e.target.value));
attemptHistory.load().then(saved=>{personalBests=saved.bests;recentAttempts=saved.attempts;for(const entry of recentAttempts){if(entry.preset==='Steve fair')entry.preset='Steve Fair';}if(personalBests['Steve fair']){personalBests['Steve Fair']??=personalBests['Steve fair'];personalBests['Steve Fair'].preset='Steve Fair';delete personalBests['Steve fair'];}renderPersonalBest();renderRecentAttempts();}).catch(()=>{});

$("#quickConnectButton").addEventListener("click",()=>elements.connectButton.click());

function updateVideoVolume(){comboVideo.video.volume=Number($("#volume").value);}
$("#volume").addEventListener("input",updateVideoVolume);updateVideoVolume();


const dwbDrawing=createDwbDrawing();
const dkVoiceMetadata=new window.Audio('assets/dwb/audio/dk-unlock.m4a');dkVoiceMetadata.preload='metadata';dkVoiceMetadata.addEventListener('loadedmetadata',()=>{if(Number.isFinite(dkVoiceMetadata.duration))dkVoiceFrames=Math.ceil(dkVoiceMetadata.duration*60);});
function orbTimerSettings(mode){const start=Math.max(.1,Number($("#"+mode+"StartTimer").value)||1);return {startTimerFrames:start*60,minTimerFrames:Math.min(start,Math.max(.1,Number($("#"+mode+"EndTimer").value)||.75))*60,rampBananas:Math.max(1,Math.round(Number($("#"+mode+"RampBananas").value)||15))};}
function shouldPlayBananaPickup(game){return game.celebration?.kind!=='unlock'||game.frame>=game.celebration.end;}
function currentSwapFrame(now=performance.now()){
 if(!orbSwapAnimation)return null;
 const age=Math.max(0,(now-orbSwapAnimation.start)/FRAME_MS),pose=swapAnimationFrame(orbSwapAnimation.character,age,orbSwapAnimation.voiceFrames);
 if(!pose){orbSwapAnimation=null;return null;}
 if(!orbSwapAnimation.voicePlayed&&age>=pose.voiceAt){orbSwapAnimation.voicePlayed=true;sound(orbSwapAnimation.character==='diddy'?'celebrate':orbSwapAnimation.character==='dk'?'dkvoice':'dixievoice');}
 return pose;
}
function swapOrbCharacter(){if(selectedPreset==='Diddy Kong Want Banana!'&&!running&&!starting&&!replaying&&!replayPreparing&&!currentSwapFrame()){
 const characters=['diddy',...(dkUnlocked?['dk']:[]),...(dixieUnlocked?['dixie']:[])];
 if(characters.length<2)return;
 orbCharacter=characters[(characters.indexOf(orbCharacter)+1)%characters.length];orbCharacterPreview=true;
 if(warmup){warmup.key=JSON.stringify([bananaDirections,bananaFixedDirections,$('#orbMode').value,orbCharacter]);warmup.game.playerCharacter=orbCharacter;}
 initAudio();orbSwapAnimation={character:orbCharacter,start:performance.now(),voiceFrames:dkVoiceFrames,voicePlayed:false};currentSwapFrame();
}}
$('#orbCharacterHint').onclick=swapOrbCharacter;
function bananaSettingsLegal(){return $('#orbTiming').value==='timed'&&!bananaFixedDirections&&bananaDirections.length===16;}
function updateBananaSettingsLock(){const busy=running||starting||replaying||replayPreparing,locked=bananaSettingsLocked||busy;setText($('#bananaSettingsLock'),bananaSettingsLocked?'🔒':'🔓');$('#bananaSettingsLock').setAttribute('aria-label',bananaSettingsLocked?'Unlock custom settings':'Lock custom settings');$('#bananaSettingsLock').disabled=busy;$('#orbTiming').disabled=locked;$('.banana-direction-panel').classList.toggle('directions-locked',locked);$('#bananaDirectionsAll').disabled=locked;$('#bananaDirectionsClear').disabled=locked;$('#bananaDirectionMode').disabled=locked;}
$('#bananaSettingsLock').onclick=()=>{if(bananaSettingsLocked)bananaSettingsLocked=false;else{bananaFixedDirections=false;$('#bananaDirectionMode').textContent='Ranges';$('#bananaDirectionMode').setAttribute('aria-pressed','false');$('#orbTiming').value='timed';bananaDirections=Array.from({length:16},(_,i)=>i);bananaSettingsLocked=true;orbSource=null;drawBananaDirections();}updateBananaSettingsLock();};
$('#closeBananaSettings').onclick=()=>$('#orbSettings').open=false;
$('#orbSettings').addEventListener('toggle',()=>{if(!$('#orbSettings').open){if(!bananaDirections.length){bananaDirections=Array.from({length:16},(_,i)=>i);orbSource=null;drawBananaDirections();}if(bananaSettingsLegal())bananaSettingsLocked=true;}updateBananaSettingsLock();});

$('#bananaDirectionMode').onclick=()=>{if(bananaSettingsLocked||running||starting||replaying)return;bananaFixedDirections=!bananaFixedDirections;$('#bananaDirectionMode').textContent=bananaFixedDirections?'Directions':'Ranges';$('#bananaDirectionMode').setAttribute('aria-pressed',String(bananaFixedDirections));directionHover=-1;orbSource=null;drawBananaDirections();};
const directionDiddy=new Image();directionDiddy.src='assets/dwb/sprites/direction-duck.png';let directionDrag=null,directionHover=-1;
function drawBananaDirections(){const canvas=$('#bananaDirectionWheel'),ctx=canvas.getContext('2d'),mid=120,r=100;ctx.clearRect(0,0,240,240);for(let i=0;i<16;i++){const a=i*Math.PI/8,b=a+Math.PI/8;ctx.beginPath();ctx.moveTo(mid,mid);ctx.arc(mid,mid,r,a,b);ctx.closePath();ctx.fillStyle=!bananaFixedDirections&&bananaDirections.includes(i)?'rgba(248,209,67,.38)':'rgba(7,12,5,.6)';ctx.fill();ctx.strokeStyle=!bananaSettingsLocked&&!bananaFixedDirections&&directionHover===i?'#fff1a3':'#867d43';ctx.lineWidth=!bananaSettingsLocked&&!bananaFixedDirections&&directionHover===i?2:1;ctx.stroke();}
 if(bananaFixedDirections){for(let i=0;i<16;i++){const a=i*Math.PI/8,ux=Math.cos(a),uy=Math.sin(a),selected=bananaDirections.includes(i);ctx.strokeStyle=!bananaSettingsLocked&&directionHover===i?'#fff1a3':selected?'#f8d143':'#6c704f';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=selected?2:1;ctx.beginPath();ctx.moveTo(mid+ux*32,mid+uy*32);ctx.lineTo(mid+ux*109,mid+uy*109);ctx.stroke();const tipX=mid+ux*115,tipY=mid+uy*115;ctx.beginPath();ctx.moveTo(tipX,tipY);ctx.lineTo(mid+ux*103-uy*5,mid+uy*103+ux*5);ctx.lineTo(mid+ux*103+uy*5,mid+uy*103-ux*5);ctx.closePath();ctx.fill();}}
 if(directionDiddy.complete&&directionDiddy.naturalWidth){ctx.imageSmoothingEnabled=false;const scale=Math.min(54/directionDiddy.naturalWidth,44/directionDiddy.naturalHeight),sw=directionDiddy.naturalWidth*scale,sh=directionDiddy.naturalHeight*scale;ctx.drawImage(directionDiddy,mid-sw/2,mid-sh/2,sw,sh);}ctx.strokeStyle='#b5a257';ctx.lineWidth=2;ctx.beginPath();ctx.arc(mid,mid,r,0,Math.PI*2);ctx.stroke();$('#bananaDirectionHint').textContent=bananaDirections.length?'Click or drag to select directions':'Select at least one direction';}
function directionSector(e){const rect=$('#bananaDirectionWheel').getBoundingClientRect(),x=(e.clientX-rect.left)*240/rect.width-120,y=(e.clientY-rect.top)*240/rect.height-120;const radius=Math.hypot(x,y);if(bananaFixedDirections){if(radius<34||radius>122)return -1;const index=Math.round(((Math.atan2(y,x)+Math.PI*2)%(Math.PI*2))/(Math.PI/8))%16,a=index*Math.PI/8;return Math.abs(-Math.sin(a)*x+Math.cos(a)*y)<=12?index:-1;}if(radius<32||radius>103)return -1;return Math.floor(((Math.atan2(y,x)+Math.PI*2)%(Math.PI*2))/(Math.PI/8));}
function paintDirection(i){if(i<0||bananaSettingsLocked||running||starting||replaying||replayPreparing)return;if(directionDrag.enable&&!bananaDirections.includes(i))bananaDirections.push(i);if(!directionDrag.enable)bananaDirections=bananaDirections.filter(n=>n!==i);bananaDirections.sort();orbSource=null;drawBananaDirections();}
$('#bananaDirectionWheel').onpointerdown=e=>{if(bananaSettingsLocked||running||starting||replaying||replayPreparing)return;const i=directionSector(e);if(i<0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);directionDrag={enable:!bananaDirections.includes(i),x:e.clientX,y:e.clientY};directionHover=i;paintDirection(i);};
$('#bananaDirectionWheel').onpointermove=e=>{if(bananaSettingsLocked||running||starting||replaying||replayPreparing){directionHover=-1;drawBananaDirections();return;}directionHover=directionSector(e);if(directionDrag){const dx=e.clientX-directionDrag.x,dy=e.clientY-directionDrag.y,steps=Math.max(1,Math.ceil(Math.hypot(dx,dy)/3));for(let i=1;i<=steps;i++)paintDirection(directionSector({clientX:directionDrag.x+dx*i/steps,clientY:directionDrag.y+dy*i/steps}));directionDrag.x=e.clientX;directionDrag.y=e.clientY;}drawBananaDirections();};
$('#bananaDirectionWheel').onpointerup=e=>{directionDrag=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drawBananaDirections();};$('#bananaDirectionWheel').onpointercancel=()=>{directionDrag=null;drawBananaDirections();};$('#bananaDirectionWheel').onpointerleave=()=>{directionHover=-1;drawBananaDirections();};
$('#bananaDirectionsAll').onclick=()=>{if(bananaSettingsLocked||running||starting||replaying)return;bananaDirections=Array.from({length:16},(_,i)=>i);orbSource=null;drawBananaDirections();};$('#bananaDirectionsClear').onclick=()=>{if(bananaSettingsLocked||running||starting||replaying)return;bananaDirections=[];orbSource=null;drawBananaDirections();};directionDiddy.onload=drawBananaDirections;$('#orbSettings').addEventListener('toggle',drawBananaDirections);

$('#closeOrbDevMenu').onclick=()=>$('#orbDevMenu').close();
$('#resetOrbDevDefaults').onclick=()=>{if(running||starting||replaying||replayPreparing)return;for(const mode of ['burst','endurance'])for(const suffix of ['StartTimer','EndTimer','RampBananas']){const control=$('#'+mode+suffix);control.value=control.defaultValue;control.oninput();}$('#orbBreak').value='0.3';$('#orbUntimedEvents').checked=false;orbSource=null;};
for(const mode of ['burst','endurance'])for(const suffix of ['StartTimer','EndTimer','RampBananas']){const control=$('#'+mode+suffix),output=$('#'+mode+suffix+'Value');control.oninput=()=>{output.value=suffix==='RampBananas'?`${control.value} bananas`:`${Number(control.value).toFixed(2)} s`;};control.oninput();}

$("#orbArrowReach").value=localStorage.getItem("sdi-orb-arrow-reach")||"banana";
$("#orbArrowReach").onchange=()=>localStorage.setItem("sdi-orb-arrow-reach",$("#orbArrowReach").value);
async function testOrbEvent(unlock){if(running||starting||replaying||replayPreparing)return;pendingOrbTest=unlock==='dixie'?'dixie':'unlock';$('#orbDevMenu').close();initAudio();await startRun();$('#orbSettings').open=false;}
$('#testDKEvent').onclick=()=>void testOrbEvent(true);$('#testDixieEvent').onclick=()=>void testOrbEvent('dixie');
$('#resetOrbProgress').onclick=()=>{dkUnlocked=false;dixieUnlocked=false;localStorage.removeItem('sdi-dixie-unlocked');orbCharacter='diddy';orbSwapAnimation=null;localStorage.removeItem('sdi-dk-unlocked');for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key.startsWith('sdi-orb-best-'))localStorage.removeItem(key);}orbSource=null;};
let diddyFacing=1;
let orbGame=new OrbGame(),orbSource=null,orbCamera={x:0,y:0};
function warmupActive(){return selectedPreset==='Diddy Kong Want Banana!'&&!recording&&!running&&!starting&&!replaying&&!replayPreparing&&!presetLoading;}
function updateWarmup(now){
 if(!warmupActive()){warmup=null;return;}
 if(currentSwapFrame(now))return;
 const key=JSON.stringify([bananaDirections,bananaFixedDirections,$('#orbMode').value,orbCharacter]);
 if(!warmup||warmup.key!==key){resetAudioChain();const d={durationFrames:100000000,hits:[{id:'warmup',startFrame:0,lengthFrames:100000000,angle:0,targets:[]}]};warmup={key,origin:now,frame:-1,analyzer:new SDIAnalyzer(d,{threshold:Number(elements.thresholdInput.value)}),game:new OrbGame(120,'fixed',$('#orbMode').value,0,false,{directions:[...bananaDirections],directionSlices:16,fixedDirections:bananaFixedDirections,playerCharacter:orbCharacter})};}
 if($('#orbSettings').open||!bananaDirections.length)return;
 const f=Math.floor((now-warmup.origin)/FRAME_MS);if(f<=warmup.frame)return;
 const sample=sampleAt(now-inputDelayFrames*FRAME_MS),before=warmup.analyzer.events.length;
 warmup.analyzer.processFrame(f,sample.vector,now,sample.cStick,sample.physicalVector);warmup.frame=f;
 for(const e of warmup.analyzer.events.slice(before)){if(e.type!=='accepted')continue;initAudio();sound(e.hitlagFrame===1?'first':'accepted',e);const step=orbStep(e);warmup.game.x+=step.x;warmup.game.y+=step.y;lastEventFlash={...e,until:now+140};}
 warmup.game.frame=f;
 const target=warmup.game.target;
 if(target&&Math.hypot(warmup.game.x-target.x,warmup.game.y-target.y)<=target.radius){void startRun({x:warmup.game.x,y:warmup.game.y,camera:{...orbCamera}});}
}
function drawHitlagOrb(now){
 if(selectedPreset!=="Diddy Kong Want Banana!")return;
 $("#hitlagInspector").hidden=true;
 $("#orbTimer").disabled=running||starting||replaying||replayPreparing;$("#orbMode").disabled=$("#orbTimer").disabled;$("#orbBreak").disabled=$("#orbTimer").disabled;$("#orbTiming").disabled=$("#orbTimer").disabled;
 const canvas=$("#hitlagOrb"),{width:w,height:h,ratio:pixelRatio}=sizeCanvas(canvas),ctx=canvas.getContext('2d'),ratio=pixelRatio*1.5;
 const isWarmup=warmupActive()&&warmup;
 const source=isWarmup?warmup.analyzer.events:(recording&&!running?recording.events:analyzer.events);
 const frame=isWarmup?warmup.frame:(running||replaying||recording?currentFrame:0);
 if(isWarmup){orbGame=warmup.game;orbSource=source;}
 const mode=recording&&!running?(recording.orbMode??"endurance"):$("#orbMode").value;
 $("#orbBreakSetting").hidden=mode!=="burst";
 updateBananaSettingsLock();
 $("#orbModeDisplay").hidden=false;setText($("#orbModeName"),mode==="burst"?"Burst mode":"Endurance mode");
 setText($("#orbModeTip"),mode==="burst"?"Reach each banana with one quick burst of SDI. Aim for a short, consistent motion you can repeat without thinking—like fitting your inputs into a single hitlag window.":"Focus on a steady, repeatable rhythm rather than squeezing out every possible input. This mode practices sustained SDI through longer multi-hit sequences.");
 const breakFrames=recording&&!running?(recording.orbBreakFrames??18):Math.round(Number($("#orbBreak").value)*60);
 const timer=recording&&!running?(recording.orbTimerFrames??120):orbTimerSettings(mode).startTimerFrames;
 const movement="fixed";
 const timed=recording&&!running?(recording.orbTimed??true):$("#orbTiming").value!=="untimed";
 // updateRun owns live simulation, including the first frame after the flag.
 if(!running&&!isWarmup&&((!recording&&(orbTimerSettings(mode).minTimerFrames!==orbGame.minTimerFrames||orbTimerSettings(mode).rampBananas!==orbGame.rampBananas))||source!==orbSource||frame<orbGame.frame||timer!==orbGame.startTimerFrames||movement!==orbGame.movement||mode!==orbGame.mode||breakFrames!==orbGame.breakFrames||timed!==orbGame.timed)){orbGame=new OrbGame(timer,movement,mode,breakFrames,timed,{spawnDistance:recording&&!running?(recording.orbSpawnDistance??(mode==="burst"?53:120)):(mode==="burst"?53:90),fixedDirections:recording&&!running?(recording.orbFixedDirections??false):bananaFixedDirections,directionSlices:recording&&!running?(recording.orbDirectionSlices??8):16,directions:recording&&!running?(recording.orbDirections??[0,1,2,3,4,5,6,7]):[...bananaDirections],playerCharacter:recording&&!running?(recording.orbCharacter??"diddy"):runOrbCharacter,minTimerFrames:recording&&!running?(recording.orbMinTimerFrames??(mode==="burst"?45:90)):orbTimerSettings(mode).minTimerFrames,rampBananas:recording&&!running?(recording.orbRampBananas??15):orbTimerSettings(mode).rampBananas,allowUntimedEvents:recording&&!running?(recording.orbAllowUntimedEvents??false):$("#orbUntimedEvents").checked,startPosition:recording&&!running?(recording.orbStartPosition??{x:0,y:0}):orbGame.startPosition,seed:recording&&!running?(recording.orbSeed??12345):orbGame.seed,unlockEnabled:recording&&!running?(recording.orbUnlockEnabled??false):((bananaSettingsLegal()||$("#orbUntimedEvents").checked)?(mode==="burst"?!dkUnlocked:!dixieUnlocked):false),unlockCharacter:recording&&!running?(recording.orbUnlockCharacter??"dk"):(mode==="burst"?"dk":"dixie"),unlockScore:recording?(recording.orbUnlockScore??20):undefined,unlockDuration:recording&&!running?(recording.orbUnlockDuration??540):390+(mode==="burst"?dkVoiceFrames:42)});orbSource=source;orbCamera={x:0,y:0};}
 const scoreBeforeReplayStep=orbGame.score,wasStarved=orbGame.failed;
 if(!running&&!isWarmup)orbGame.advance(frame,source);
 if(running&&pendingOrbTest){orbGame.celebrationsEnabled=true;orbGame.score=orbGame.unlockScore-1;orbGame.unlockEnabled=true;orbGame.unlockCharacter=pendingOrbTest==='dixie'?'dixie':'dk';orbGame.unlockDuration=390+(pendingOrbTest==='dixie'?42:dkVoiceFrames);orbGame.spawn(frame);orbGame.target.untimed=true;pendingOrbTest=null;}
 if(replaying&&orbGame.score>scoreBeforeReplayStep&&shouldPlayBananaPickup(orbGame))sound('collect');
 if(replaying&&!wasStarved&&orbGame.failed){orbLossStartedAt=performance.now();sound('starve');}

 if((running||replaying)&&orbGame.celebration&&orbGame.celebration.kind!=='unlock'&&frame>=orbGame.celebration.start+15&&!orbGame.celebration.voicePlayed){orbGame.celebration.voicePlayed=true;sound('celebrate');}
 const unlockEvent=orbGame.celebration?.kind==='unlock'?orbGame.celebration:null,unlockAge=unlockEvent?frame-unlockEvent.start:-1;
 if((running||replaying)&&unlockEvent){
  if(unlockAge>=180&&!unlockEvent.bunchPlayed){unlockEvent.bunchPlayed=true;sound('bunch');}
  if(unlockAge>=360&&!unlockEvent.dkVoicePlayed){
   unlockEvent.dkVoicePlayed=true;
   const dixie=unlockEvent.character==='dixie';
   sound(dixie?'dixievoice':'dkvoice');
   if(running&&!(dixie?dixieUnlocked:dkUnlocked)){
    setText($('#orbUnlockNotice'),dixie?'Unlocked Dixie Kong!':'Unlocked Donkey Kong!');
    orbUnlockNoticeUntil=now+3500;
   }
  }
 }
 if(orbUnlockNoticeUntil&&(replaying||replayPreparing||now>=orbUnlockNoticeUntil))clearOrbUnlockNotice();
 $('#orbCharacterHint').hidden=(!dkUnlocked&&!dixieUnlocked)||running||starting||replaying||replayPreparing;
 for(const id of ['testDKEvent','testDixieEvent','resetOrbProgress','resetOrbDevDefaults'])$('#'+id).disabled=running||starting||replaying||replayPreparing;
 const targetX=orbGame.x*ratio,targetY=orbGame.y*ratio;
 if(bananaSeekPending&&!running&&!replaying){orbCamera={x:targetX,y:targetY};bananaSeekPending=false;}
 orbCamera.x+=(targetX-orbCamera.x)*.08;orbCamera.y+=(targetY-orbCamera.y)*.08;
 diddyFacing=dwbDrawing.drawScene(ctx,w,h,ratio,{
  orbGame,source,frame,orbCamera,isWarmup:!!isWarmup,timed,unlockEvent,unlockAge,recording,running,replaying,
  orbCharacter,runOrbCharacter,orbCharacterPreview,orbLossStartedAt,swapPose:!running&&!replaying?currentSwapFrame(now):null,
  lossAgeFrames:orbLossStartedAt===null?null:(performance.now()-orbLossStartedAt)/FRAME_MS,
  diddyFacing,arrowReach:$('#orbArrowReach').value,
 });
}

function stepRecordedFrame(delta){if(!recording||running||starting||replaying||replayPreparing)return;const frame=(inspection?.frame??currentFrame)+delta;if(selectedPreset==='Diddy Kong Want Banana!')showBananaTimelineStick(frame);else void inspectFrame(frame);}
function showBananaTimelineStick(frame,commit=true){orbCharacterPreview=false;orbSwapAnimation=null;pausedReplay=null;frame=Math.max(0,Math.min(recording?.frames?.at(-1)?.frame??0,frame));bananaTimelineViewFrame=frame;if(commit){currentFrame=frame;bananaSeekPending=true;}$("#inspectedFrame").textContent=`Frame ${frame+1} / ${(recording?.frames?.at(-1)?.frame??0)+1}`;const sample=recording?.frames?.find(s=>s.frame===frame);if(sample)inspection={...sample,frame,smoothVector:sample.smoothVector??gameToPhysical(sample.vector),smoothCStick:sample.smoothCStick??sample.cStick??{x:0,y:0}};lastEventFlash=null;}
elements.timelineCanvas.addEventListener('pointerdown',e=>{if(selectedPreset!=='Diddy Kong Want Banana!'||!recording||running||(starting&&!replayPreparing))return;const initialFrame=bananaTimelineViewFrame??currentFrame;if(replaying||replayPreparing)stopReplay('Replay canceled',false);const rect=e.currentTarget.getBoundingClientRect();bananaTimelineDrag={x:e.clientX,frame:initialFrame,framesPerPixel:240/((e.currentTarget.width-50)*rect.width/e.currentTarget.width)};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.style.cursor='grabbing';e.preventDefault();showBananaTimelineStick(initialFrame,false);});
elements.timelineCanvas.addEventListener('pointermove',e=>{if(!bananaTimelineDrag)return;const frame=Math.round(bananaTimelineDrag.frame-(e.clientX-bananaTimelineDrag.x)*bananaTimelineDrag.framesPerPixel);showBananaTimelineStick(Math.max(0,Math.min(recording.frames?.at(-1)?.frame??drill.durationFrames-1,frame)),false);});
for(const type of ['pointerup','pointercancel'])elements.timelineCanvas.addEventListener(type,e=>{if(!bananaTimelineDrag)return;bananaTimelineDrag=null;showBananaTimelineStick(bananaTimelineViewFrame??currentFrame);if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);e.currentTarget.style.cursor='grab';});
function timelinePlaybackFrame(){if(replaying&&replay)return replay.timeMs/FRAME_MS;if(running)return Math.max(currentFrame,Math.min((selectedPreset==='Diddy Kong Want Banana!'?drill.durationFrames:runPracticeRange.end)-1,(performance.now()-runStart)/FRAME_MS));return currentFrame;}
function drawInfiniteTimeline(){
 const canvas=elements.timelineCanvas,{width:w,height:h,ratio}=sizeCanvas(canvas),ctx=canvas.getContext('2d'),top=36,bottom=36+h*.44,center=w/2,scale=(w-50)/240;
 const viewFrame=recording&&!running&&!replaying?Math.max(0,Math.min(recording.frames?.at(-1)?.frame??Math.ceil(recording.durationMs/FRAME_MS)-1,bananaTimelineViewFrame??currentFrame)):timelinePlaybackFrame();
 ctx.clearRect(0,0,w,h);ctx.fillStyle=document.body.dataset.theme==='windows'?'#4e5359':'rgba(5,11,20,.55)';roundRect(ctx,32,top,w-50,bottom-top,12);ctx.fill();
 const first=Math.floor(viewFrame+(32-center)/scale-.5)-1,last=Math.ceil(viewFrame+(w-18-center)/scale-.5)+1,maxFrame=recording&&!running?(recording.frames?.at(-1)?.frame??last):last;
 ctx.font=`${9*ratio}px system-ui`;ctx.textAlign='center';
 const labels=[];ctx.save();roundRect(ctx,32,top,w-50,bottom-top,12);ctx.clip();
 for(let frame=first;frame<=last;frame++){const x=center+(frame+.5-viewFrame)*scale;if(x<32||x>w-18)continue;const major=frame%10===0;ctx.strokeStyle=major?'rgba(200,213,226,.35)':'rgba(200,213,226,.12)';ctx.lineWidth=ratio;ctx.beginPath();ctx.moveTo(x,top);ctx.lineTo(x,bottom);ctx.stroke();if(major&&frame>=0&&frame<=maxFrame)labels.push({x,frame});}
 ctx.restore();ctx.fillStyle=document.body.dataset.theme==='windows'?'#34404d':'#aab6c6';for(const {x,frame} of labels)ctx.fillText(String(frame+1),x,bottom+27);

 const events=(recording&&!running?recording.events:visibleTimelineEvents()).filter(e=>e.type!=="weak");
 const accepted=events.filter(e=>e.type==='accepted');
 ctx.save();ctx.beginPath();ctx.rect(32,top,w-50,bottom-top);ctx.clip();
 for(let i=0;i<accepted.length;i++){const event=accepted[i],x=center+(event.frame+.5-viewFrame)*scale,end=x+4*scale,y=top+(bottom-top)*.65,perfect=accepted[i+1]?.frame-event.frame===4;if(end<32||x>w-18)continue;ctx.strokeStyle=perfect?'rgba(103,215,180,.8)':'rgba(103,215,180,.28)';ctx.lineWidth=(perfect?3:1.5)*ratio;if(perfect){ctx.shadowColor='rgba(103,215,180,.35)';ctx.shadowBlur=4*ratio;}else ctx.shadowBlur=0;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(end,y);ctx.stroke();}
 ctx.restore();
 ctx.save();ctx.beginPath();ctx.rect(32,top,w-50,bottom-top);ctx.clip();drawBufferLinks(ctx,events,e=>({x:center+(e.frame+.5-viewFrame)*scale,y:top+(bottom-top)*(e.type==='accepted'?.65:.3)}),ratio);ctx.restore();
 for(const e of events){const x=center+(e.frame+.5-viewFrame)*scale;if(x<32||x>w-18)continue;const lane={accepted:.65,buffered:.3,'buffer-replaced':.3,'buffer-full':.43,'outside-hitlag':.9},y=top+(bottom-top)*(lane[e.type]??.3);ctx.fillStyle=e.type==='accepted'?'#67d7b4':['buffered','buffer-replaced'].includes(e.type)?'#cfa4ff':e.type==='outside-hitlag'?'#8993a5':'#ff5f68';ctx.beginPath();ctx.arc(x,y,["buffer-full","too-early","c-refresh-cancelled"].includes(e.type)?2*ratio:3.5*ratio,0,Math.PI*2);ctx.fill();if(e.type==='accepted'){const v=directionVector(e.angle);drawArrow(ctx,x-v.x*5*ratio,top-10*ratio+v.y*5*ratio,x+v.x*5*ratio,top-10*ratio-v.y*5*ratio,'#67d7b4',1.5*ratio);}}
 for(const e of events){if(e.source!=='c-stick')continue;const x=center+(e.frame+.5-viewFrame)*scale;if(x<32||x>w-18)continue;const lane={accepted:.65,buffered:.3,'buffer-replaced':.3,'buffer-full':.43,'outside-hitlag':.9},y=top+(bottom-top)*(lane[e.type]??.3);ctx.fillStyle='#f3c969';ctx.font=`bold ${11*ratio}px system-ui`;ctx.textAlign='center';ctx.fillText('C',x,y-9*ratio);}
 if(recording&&!running&&!replaying){ctx.save();roundRect(ctx,32,top,w-50,bottom-top,12);ctx.clip();const shadeWidth=Math.min(50*ratio,(w-50)*.08),leftShade=ctx.createLinearGradient(32,0,32+shadeWidth,0),rightShade=ctx.createLinearGradient(w-18-shadeWidth,0,w-18,0);leftShade.addColorStop(0,'rgba(0,0,0,.32)');leftShade.addColorStop(1,'rgba(0,0,0,0)');rightShade.addColorStop(0,'rgba(0,0,0,0)');rightShade.addColorStop(1,'rgba(0,0,0,.32)');ctx.fillStyle=leftShade;ctx.fillRect(32,top,shadeWidth,bottom-top);ctx.fillStyle=rightShade;ctx.fillRect(w-18-shadeWidth,top,shadeWidth,bottom-top);ctx.restore();}
 ctx.strokeStyle='#f4f1e8';ctx.lineWidth=2*ratio;ctx.beginPath();ctx.moveTo(center+.5*scale,top-8*ratio);ctx.lineTo(center+.5*scale,bottom+8*ratio);ctx.stroke();ctx.fillStyle='#aab6c6';ctx.textAlign='center';ctx.font=`${11*ratio}px system-ui`;ctx.fillStyle=document.body.dataset.theme==='windows'?'#273645':'#c3d0df';ctx.fillText(recording&&!running?'Drag timeline':'Now',center,bottom+44);timelineMarkers=[];
}















function updateGuidePractice(now){
 if(!sdiGuide?.open||!guidePractice)return;
 const practice=guidePractice,target=Math.floor((now-practice.origin)/FRAME_MS);
 while(practice.frame<target){
  const frame=++practice.frame,time=practice.origin+(frame-inputDelayFrames)*FRAME_MS,sample=sampleAt(time);
  const before=practice.analyzer.events.length;
  practice.analyzer.processFrame(frame,sample.vector,time,sample.cStick,sample.physicalVector);
  for(const event of practice.analyzer.events.slice(before)){
   if(event.type!=='accepted')continue;
   practice.count++;lastEventFlash={...event,until:now+140};sound('accepted',event);
   elements.acceptedLiveCount.textContent=String(practice.count);
  }
 }
 // This practice never creates an attempt or history entry.
 if(practice.analyzer.events.length>120)practice.analyzer.events.splice(0,practice.analyzer.events.length-120);
 if(practice.analyzer.samples.length>120)practice.analyzer.samples.splice(0,practice.analyzer.samples.length-120);
}
sdiGuide=createSdiGuide({button:$('#sdiGuideButton'),livePanel:$('.stick-panel'),host:$('#videoPanel'),
 canOpen:()=>!running&&!starting&&!replaying&&!replayPreparing&&!presetLoading&&!$('#settingsDrawer').open&&!$('#frameTest').open&&!$('#orbDevMenu').open,
 onOpen:()=>{
  guideSavedInspection=inspection;inspection=null;lastEventFlash=null;initAudio();resetAudioChain();
  const origin=performance.now(),practiceAnalyzer=new SDIAnalyzer({durationFrames:1e9,hits:[{id:'guide',startFrame:0,lengthFrames:1e9,angle:0,targets:[]}]},{threshold:Number(elements.thresholdInput.value)});
  const initial=sampleAt(origin-inputDelayFrames*FRAME_MS);practiceAnalyzer.processFrame(-1,initial.vector,origin,initial.cStick,initial.physicalVector);
  guidePractice={origin,frame:-1,analyzer:practiceAnalyzer,count:0};elements.acceptedLiveCount.textContent='0';
 },
 onClose:()=>{guidePractice=null;lastEventFlash=null;inspection=guideSavedInspection;guideSavedInspection=null;elements.acceptedLiveCount.textContent=String(liveAcceptedCount);resetControllerActions();resetAudioChain();}
});
