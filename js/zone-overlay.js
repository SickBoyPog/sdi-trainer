import {physicalZone,componentBoundary} from './zones.js';
const cache=new Map();
export function drawZoneOverlay(ctx,cx,cy,r,smooth,calibration={},fill=true,activeZone=null,flashes=[]){
 const map=v=>v;
 const point=v=>{const p=map(v);return {x:cx+p.x*r,y:cy-p.y*r};};
 ctx.save();
 if(fill){
  const key="physical";let tile=cache.get(key);
  if(!tile){tile=document.createElement('canvas');tile.width=tile.height=100;const c=tile.getContext('2d');
   for(let y=0;y<100;y++)for(let x=0;x<100;x++){
    const shown={x:(x+.5)/40-1.25,y:1.25-(y+.5)/40},v=shown,z=physicalZone(v);
    if(!z.x&&!z.y)continue;c.fillStyle=z.x&&z.y?'rgba(243,201,105,.12)':'rgba(103,215,180,.10)';c.fillRect(x,y,1,1);
   }cache.set(key,tile);if(cache.size>8)cache.delete(cache.keys().next().value);
  }ctx.drawImage(tile,cx-1.25*r,cy-1.25*r,2.5*r,2.5*r);
 }
 if(activeZone&&(activeZone.x||activeZone.y)){
  const key=`active:${activeZone.x}:${activeZone.y}`;let tile=cache.get(key);
  if(!tile){tile=document.createElement('canvas');tile.width=tile.height=100;const c=tile.getContext('2d');c.fillStyle='rgba(220,226,235,.18)';
   for(let y=0;y<100;y++)for(let x=0;x<100;x++){const z=physicalZone({x:(x+.5)/40-1.25,y:1.25-(y+.5)/40});if((z.x!==0&&z.x===activeZone.x)||(z.y!==0&&z.y===activeZone.y))c.fillRect(x,y,1,1);}cache.set(key,tile);
  }ctx.drawImage(tile,cx-1.25*r,cy-1.25*r,2.5*r,2.5*r);
 }
 for(const flash of flashes){
  const key=`flash:${flash.axis}:${flash.value}`;let tile=cache.get(key);
  if(!tile){tile=document.createElement('canvas');tile.width=tile.height=100;const c=tile.getContext('2d');c.fillStyle='rgba(103,215,180,.28)';
   for(let y=0;y<100;y++)for(let x=0;x<100;x++){const z=physicalZone({x:(x+.5)/40-1.25,y:1.25-(y+.5)/40});if(z[flash.axis]===flash.value)c.fillRect(x,y,1,1);}cache.set(key,tile);
  }ctx.save();ctx.globalAlpha=flash.strength;ctx.drawImage(tile,cx-1.25*r,cy-1.25*r,2.5*r,2.5*r);ctx.restore();
 }
 const line=values=>{ctx.beginPath();values.forEach((v,i)=>{const p=point(v);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);});ctx.stroke();};
 ctx.lineWidth=1;ctx.strokeStyle='rgba(244,241,232,.36)';ctx.setLineDash([4,4]);
 for(const sx of [-1,1])for(const sy of [-1,1]){
  const values=Array.from({length:51},(_,i)=>{const x=.5+i*.75/50;return {x:sx*x,y:sy*componentBoundary(x)};});line(values);line(values.map(v=>({x:v.y,y:v.x})));
 }
 ctx.setLineDash([]);ctx.strokeStyle='rgba(244,241,232,.5)';
 const neutral=[];for(let corner=0;corner<4;corner++)for(let i=0;i<=24;i++){const a=(corner*90+i*90/24)*Math.PI/180,mid=(corner*90+45)*Math.PI/180;neutral.push({x:Math.sign(Math.cos(mid))*.18+Math.cos(a)*.32,y:Math.sign(Math.sin(mid))*.18+Math.sin(a)*.32});}neutral.push(neutral[0]);line(neutral);
 line([{x:-.27,y:-.27},{x:.27,y:-.27},{x:.27,y:.27},{x:-.27,y:.27},{x:-.27,y:-.27}]);
 const gate=Array.from({length:9},(_,i)=>({x:Math.cos(i*Math.PI/4),y:Math.sin(i*Math.PI/4)}));ctx.strokeStyle='rgba(244,241,232,.7)';line(gate);
 ctx.fillStyle='#aab6c6';ctx.font='14px system-ui';ctx.textAlign='center';
 for(const [x,y,label] of [[.77,0,'→'],[-.77,0,'←'],[0,.77,'↑'],[0,-.77,'↓'],[.57,.57,'↗'],[-.57,.57,'↖'],[.57,-.57,'↘'],[-.57,-.57,'↙']]){const p=point({x,y}),lit=activeZone&&((y===0&&Math.sign(x)===activeZone.x)||(x===0&&Math.sign(y)===activeZone.y));ctx.fillStyle=lit?'#edf0f4':'#aab6c6';ctx.font=lit?'bold 17px system-ui':'14px system-ui';ctx.fillText(label,p.x,p.y+4);}
 ctx.restore();
}





