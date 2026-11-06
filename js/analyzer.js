import {physicalZone,gameToPhysical,addsZone,netDirection} from "./zones.js";
export const FRAME_MS = 1000 / 60;

export const DEFAULT_RULES = Object.freeze({
  threshold: 0.70,
  attemptFloor: 0.38,
  componentEpsilon: 0.20,
  firstLegalHitlagFrame: 1,
  lockoutFrames: 4,
  targetToleranceFrames: 1,
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeRawStick(rawX, rawY, calibration) {
  const centerX = calibration.centerX ?? 128;
  const centerY = calibration.centerY ?? 128;
  // Vanilla Switch GCC HID mapping, then Ultimate's axis deadzones.
  // Gate calibration is for display; it must not change game thresholds.
  return {x: gameAxis(rawX-centerX), y: gameAxis(rawY-centerY)};

}

// Smooth calibrated physical coordinates are for visualization only.
export function normalizeSmoothStick(rawX,rawY,calibration={}){
 const cx=calibration.centerX??128,cy=calibration.centerY??128;
 const axis=(v,c,min,max)=>clamp((v-c)/Math.max(1,v>=c?max-c:c-min),-1.25,1.25);
 return {x:axis(rawX,cx,calibration.minX??28,calibration.maxX??228),y:axis(rawY,cy,calibration.minY??28,calibration.maxY??228)};
}
export function smoothToGame(v,calibration={}){
 const cx=calibration.centerX??128,cy=calibration.centerY??128;
 return normalizeRawStick(cx+v.x*(v.x>=0?(calibration.maxX??228)-cx:cx-(calibration.minX??28)),cy+v.y*(v.y>=0?(calibration.maxY??228)-cy:cy-(calibration.minY??28)),calibration);
}

export function gameAxis(rawOffset) {
  const hid=Math.trunc(clamp((Math.abs(rawOffset)-15)/55,0,1)*127)/127;
  return hid < .2 ? 0 : Math.sign(rawOffset)*(hid > .944 ? 1 : hid);
}

export function vectorInfo(vector) {
  const magnitude = Math.hypot(vector.x, vector.y);
  const angle = magnitude > 0.001
    ? (Math.atan2(vector.y, vector.x) * 180 / Math.PI + 360) % 360
    : null;
  return { magnitude, angle };
}

function componentSign(value, epsilon) {
  if (value > epsilon) return 1;
  if (value < -epsilon) return -1;
  return 0;
}

export function hasNewDirectionalComponent(previous, current, epsilon = DEFAULT_RULES.componentEpsilon) {
  const previousX = componentSign(previous.x, epsilon);
  const previousY = componentSign(previous.y, epsilon);
  const currentX = componentSign(current.x, epsilon);
  const currentY = componentSign(current.y, epsilon);
  return (currentX !== 0 && currentX !== previousX) || (currentY !== 0 && currentY !== previousY);
}

export function angularDistance(a, b) {
  if (a == null || b == null) return null;
  const difference = Math.abs(a - b) % 360;
  return Math.min(difference, 360 - difference);
}

export function directionVector(angleDegrees) {
  const radians = angleDegrees * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians) };
}

export function makePreset(name = "Meta Knight Up-Airs", angle = 180) {
  if(name==="Diddy Kong Want Banana!")return {name,durationFrames:600,hits:[{id:"infinite-hitlag",startFrame:0,lengthFrames:600,angle,targets:[]}]};
  const settings = {"Meta Knight Up-Airs": [7,33,7], "Steve Fair": [23,90,6], "SDI Endurance": [60,72,7]};
  const [length, spacing, count] = settings[name] ?? settings["Meta Knight Up-Airs"];
  return {name, durationFrames:name === "Meta Knight Up-Airs" ? 300 : 600, hits:Array.from({length:count}, (_,i)=>({id:`hit-${i+1}`,startFrame:60+i*spacing,lengthFrames:length,angle,targets:[]}))};
}
export function makeDefaultDrill() { return makePreset(); }
export function possibleInputs(hit, rules = DEFAULT_RULES) {
  return Math.max(0, 1 + Math.floor((hit.lengthFrames-rules.firstLegalHitlagFrame)/rules.lockoutFrames));
}

export function flattenTargets(drill) {
  return drill.hits.flatMap((hit) => hit.targets.map((target) => ({ ...target, hitId: hit.id })));
}

export function hitAtFrame(drill, frame) {
  return drill.hits.find((hit) => frame >= hit.startFrame && frame < hit.startFrame + hit.lengthFrames) ?? null;
}

export class SDIAnalyzer {
  constructor(drill = makeDefaultDrill(), rules = {}) {
    this.drill = drill;
    this.rules = { ...DEFAULT_RULES, ...rules };
    this.reset();
  }

  reset() {
    this.samples = [];
    this.events = [];
    this.lastAcceptedFrame = null;
    this.lastHitId = null;
    this.previous = { x: 0, y: 0 };
    this.qualified = {x:0,y:0};
    this.pending = null;
    this.tilt = new TiltStickInput();
  }

  processFrame(frame, left, timestamp = frame * FRAME_MS, cStick = {x:0,y:0}, physical = null) {
    const input = this.tilt.process(frame, left, cStick);
    const vector = input.vector;
    const info = vectorInfo(vector);
    const zone = physicalZone(physical ?? gameToPhysical(vector));
    const newComponent = addsZone(this.qualified, zone);
    const hit = hitAtFrame(this.drill, frame);
    if (hit?.id !== this.lastHitId) { this.lastAcceptedFrame = null; this.pending = null; }
    this.lastHitId = hit?.id ?? null;
    const hitlagFrame = hit ? frame - hit.startFrame + 1 : null;
    const inLegalWindow = hit && hitlagFrame >= this.rules.firstLegalHitlagFrame;
    const enoughMagnitude = info.magnitude >= this.rules.threshold;
    const mainCandidate = (zone.x !== 0 || zone.y !== 0) && newComponent;
    const restricted = this.lastAcceptedFrame != null && frame-this.lastAcceptedFrame < this.rules.lockoutFrames;
    const refreshQualifies = enoughMagnitude && hasNewDirectionalComponent(input.cDirection,vector,this.rules.componentEpsilon);
    const candidate = mainCandidate || (input.engage && (restricted || refreshQualifies));
    const nearAttempt = !input.overridden && info.magnitude >= this.rules.attemptFloor && hasNewDirectionalComponent(this.previous,vector,this.rules.componentEpsilon);

    let event = null;
    const source = input.engage&&(restricted||refreshQualifies)?"c-stick":mainCandidate?"left-stick":"c-stick";
    if(inLegalWindow&&input.engage&&source==='c-stick'&&mainCandidate&&!this.pending){
      this.events.push({type:'buffer-full',frame,timestamp,hitlagFrame,hitId:hit.id,source:'left-stick',...info,vector:{...vector},reason:'c-stick-held'});
    }
    // A C refresh reserves its timing. Main entries cannot replace it.
    let consumedCurrent=false;
    if(inLegalWindow && this.pending?.source==='c-stick'){
      if(input.refresh&&this.pending.cActivationFrame===input.activationFrame)this.pending.readyFrame=frame;
      if(mainCandidate){
        this.events.push({type:'buffer-full',frame,timestamp,hitlagFrame,hitId:hit.id,source:'left-stick',...info,vector:{...vector},framesSinceAccepted:this.lastAcceptedFrame==null?null:frame-this.lastAcceptedFrame,reason:input.waiting?'c-stick-held':'c-stick-pending'});
        consumedCurrent=true;
      }
    }
    if(inLegalWindow && this.pending && (this.lastAcceptedFrame==null || frame-this.lastAcceptedFrame>=this.rules.lockoutFrames) && frame>=(this.pending.readyFrame??-Infinity)){
      const stored=this.pending;this.pending=null;
      const isRefresh=stored.source==='c-stick';
      const valid=!isRefresh || (enoughMagnitude&&hasNewDirectionalComponent(stored.cDirection,vector,this.rules.componentEpsilon));
      if(valid){
        event={...stored,...(isRefresh?{...info,vector:{...vector}}:{}),type:'accepted',frame,timestamp,hitlagFrame,buffered:true,inputFrame:isRefresh?stored.readyFrame:stored.frame};
        this.lastAcceptedFrame=frame;this.events.push(event);
      }else{
        event={...stored,...info,vector:{...vector},type:'c-refresh-cancelled',frame,timestamp,hitlagFrame,inputFrame:stored.readyFrame,reason:enoughMagnitude?'same-direction':'neutral-or-below-threshold'};
        this.events.push(event);
      }
    }
    const releasedEvent=event;
    if (candidate && !consumedCurrent) {
      if (!hit) {
        event = { type: "outside-hitlag", frame, timestamp, hitlagFrame, ...info, vector: { ...vector } };
      } else if (!inLegalWindow) {
        event = { type: "too-early", frame, timestamp, hitlagFrame, hitId: hit.id, ...info, vector: { ...vector } };
      } else if (source==="c-stick" || (this.lastAcceptedFrame != null && frame - this.lastAcceptedFrame < this.rules.lockoutFrames)) {
        event = {
          type: this.pending ? "buffer-full" : "buffered",
          frame,
          timestamp,
          hitlagFrame,
          hitId: hit.id,
          framesSinceAccepted: this.lastAcceptedFrame==null?null:frame - this.lastAcceptedFrame,
          ...info,
          vector: { ...vector },
        };
        event.source=source;
        if(source === "c-stick"){event.cDirection={...input.cDirection};event.cActivationFrame=frame;event.readyFrame=input.readyFrame;event.reason="c-stick-refresh-delay";}
        if (!this.pending) this.pending={...event};
      } else {
        event = { type: "accepted", frame, timestamp, hitlagFrame, hitId: hit.id, ...info, vector: { ...vector } };
        this.lastAcceptedFrame = frame;
      }
    } else if (nearAttempt && !mainCandidate && zone.x===0 && zone.y===0) {
      event = { type: "weak", frame, timestamp, hitlagFrame, hitId: hit?.id ?? null, ...info, vector: { ...vector } };
    }

    if (event && event !== releasedEvent) {
      event.source ??= source;
      this.events.push(event);
    }
    this.samples.push({ frame, timestamp, ...vector, ...info, hitId: hit?.id ?? null, hitlagFrame, candidate });
    this.previous = { ...vector };
    this.qualified={...zone};
    return releasedEvent ?? event;
  }

  results() {
    const accepted=this.events.filter(e=>e.type==="accepted");
    const windows=this.drill.hits.map(hit=>{
      const events=accepted.filter(e=>e.hitId===hit.id);
      // Accepted stick directions represent modeled SDI displacement, not thumb-path deltas.
      const net=events.reduce((v,e)=>({x:v.x+e.vector.x,y:v.y+e.vector.y}),{x:0,y:0});
      const angle=vectorInfo(net).angle;
      return {hit, count:events.length, possible:possibleInputs(hit,this.rules), angle,
        error:null};
    });
    const errors=windows.map(w=>w.error).filter(e=>e!=null);
    const possible=windows.reduce((n,w)=>n+w.possible,0);
    return {acceptedCount:accepted.length, possibleCount:possible, score:possible?Math.round(100*accepted.length/possible):0,
      weakCount:this.events.filter(e=>e.type==="weak" && e.hitId).length,
      cStickCount:accepted.filter(e=>e.source==="c-stick").length,
      bufferedCount:this.events.filter(e=>["buffered","buffer-replaced"].includes(e.type)).length,
      bufferReplacedCount:this.events.filter(e=>e.type==="buffer-replaced").length,
      bufferFullCount:this.events.filter(e=>e.type==="buffer-full").length,
      
      firstFrameCount:accepted.filter(e=>e.hitlagFrame===1).length,
      directionError:null,
      windows, events:[...this.events]};
  }
}

// User-observed Ultimate timing: release restores eligibility early; otherwise
// a held C activation restores it three frames later. Exact thresholds remain assumed.
export class TiltStickInput {
  constructor(){this.active=false;this.pending=null;}
  process(frame,left,c){
    const magnitude=Math.hypot(c.x,c.y),engage=!this.active&&magnitude>=.5;
    const virtual=magnitude?{x:c.x/magnitude*.625,y:c.y/magnitude*.625}:{x:0,y:0};
    if(engage){this.active=true;this.pending={frame,dueFrame:frame+3,cDirection:{...virtual}};}
    else if(this.active&&magnitude<=.2){this.active=false;if(this.pending)this.pending.dueFrame=Math.min(this.pending.dueFrame,frame);}
    const pending=this.pending,refresh=!!pending&&frame>=pending.dueFrame;
    if(refresh)this.pending=null;
    return {vector:left,engage,refresh,activationFrame:pending?.frame??null,readyFrame:pending?.dueFrame??frame,cDirection:pending?.cDirection??virtual,waiting:!!this.pending,overridden:false};
  }
}
