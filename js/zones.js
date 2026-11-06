// Estimates traced from Azyph / IKA's physical stick diagrams, not datamined constants.
// Coordinates use the calibrated cardinal gate as 1. Keep rendering and detection shared.
export const ZONE_ESTIMATE = Object.freeze({component:.27, bend:.67, slope:.13/.59, neutralHalf:.50, neutralCorner:.32});
export function componentBoundary(other){return ZONE_ESTIMATE.component+Math.max(0,Math.abs(other)-ZONE_ESTIMATE.bend)*ZONE_ESTIMATE.slope;}
export function physicalZone(v){
 const x=Math.abs(v.x),y=Math.abs(v.y),q=ZONE_ESTIMATE;
 const neutral=x<=q.neutralHalf && y<=q.neutralHalf && Math.hypot(Math.max(0,x-(q.neutralHalf-q.neutralCorner)),Math.max(0,y-(q.neutralHalf-q.neutralCorner)))<=q.neutralCorner;
 if(neutral)return {x:0,y:0};
 return {x:x>componentBoundary(y)?Math.sign(v.x):0,y:y>componentBoundary(x)?Math.sign(v.y):0};
}
// Game coordinates cannot uniquely recover clamped physical positions. Use the
// smallest physical value represented by a game value for manual/simulation input.
export function gameToPhysical(v){const axis=n=>n===0?0:Math.sign(n)*(15+Math.abs(n)*55)/100;return {x:axis(v.x),y:axis(v.y)};}
export function addsZone(previous,current){return current.x!==0&&current.x!==previous.x||current.y!==0&&current.y!==previous.y;}
export function netDirection(events){const v=events.filter(e=>e.type==='accepted').reduce((a,e)=>({x:a.x+e.vector.x,y:a.y+e.vector.y}),{x:0,y:0});return Math.hypot(v.x,v.y)<1e-6?null:Math.atan2(v.y,v.x)*180/Math.PI;}
