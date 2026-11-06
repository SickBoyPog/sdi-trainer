/** Sprite assets and drawing caches only. Never advances gameplay or changes the camera. */
export function displayedOrbCharacter({running,runOrbCharacter,recording,replaying,isWarmup,orbCharacterPreview,orbCharacter}){
 if(running)return runOrbCharacter;
 if(isWarmup)return orbCharacter;
 if(replaying)return recording?.orbCharacter??'diddy';
 if(orbCharacterPreview)return orbCharacter;
 return recording?(recording.orbCharacter??'diddy'):orbCharacter;
}
export function createDwbDrawing({document=globalThis.document,Image=globalThis.Image}={}){
const loadSprites=(prefix,count)=>Array.from({length:count},(_,i)=>{const image=new Image();image.src=`assets/dwb/sprites/${prefix}-${i}.png`;return image;});
const diddyFrames=Array.from({length:6},(_,i)=>{const image=new Image();image.src=`assets/dwb/sprites/walk-${i}.png`;return image;});
const bananaPile=new Image();bananaPile.src='assets/dwb/sprites/banana-pile.png';
const bananaFrames=loadSprites('banana',8);
const starterFlag=new Image();starterFlag.src='assets/dwb/sprites/starter-flag-small.png';
const mineFloor=new Image();mineFloor.src='assets/dwb/sprites/mine-floor.png';
const diddyFlipFrames=Array.from({length:20},(_,i)=>{const image=new Image();image.src=`assets/dwb/sprites/flip-${i}.png`;return image;});
const diddyCelebrationIdle=new Image();diddyCelebrationIdle.src='assets/dwb/sprites/celebration-idle.png';
const dixieRollFrames=loadSprites('dixie-roll',16);
const diddyFailureFrames=loadSprites('bonus-failure',24);
const dkFailureFrames=loadSprites('dk-loss',8),dixieFailureFrames=loadSprites('dixie-loss',8);
// Mask stray pixels from adjacent sprites in the original sheet crops.
for(const [index,rect] of [[0,[0,93,96,3]],[1,[0,95,96,1]],[5,[63,50,2,10]]]){
 const sprite=diddyFailureFrames[index];sprite.onload=()=>{sprite.onload=null;const canvas=document.createElement('canvas');canvas.width=sprite.naturalWidth;canvas.height=sprite.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(sprite,0,0);ctx.clearRect(...rect);sprite.src=canvas.toDataURL('image/png');};
}


const dkWalkFrames=loadSprites('dk-walk',6),dkRollFrames=loadSprites('dk-roll',13),dixieRevealFrames=loadSprites('dixie-reveal',23),dixieVoiceFrames=loadSprites('dixie-voice',27),dixieWalkFrames=loadSprites('dixie-walk',8);const dixieIdle=new Image();dixieIdle.src='assets/dwb/sprites/dixie-idle.png';const dixieHold=new Image();dixieHold.src='assets/dwb/sprites/dixie-hold.png';
const dkRevealFrames=loadSprites('dk-reveal',24),dkVoiceSprites=loadSprites('dk-voice',12),diddyUnlockIdle=new Image();diddyUnlockIdle.src='assets/dwb/sprites/idle-8.png';
function drawBananaPile(ctx,x,y,ratio){if(bananaPile.complete&&bananaPile.naturalWidth){ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(bananaPile,x-81*ratio,y-135*ratio,162*ratio,135*ratio);ctx.restore();}}
let mineFloorCache=null;
function drawCachedMineFloor(ctx,w,h,ratio,camera){
 const margin=Math.ceil(180*ratio),key=`${w}:${h}:${ratio}`;
 if(!mineFloorCache||mineFloorCache.key!==key||Math.abs(camera.x-mineFloorCache.x)>margin*.5||Math.abs(camera.y-mineFloorCache.y)>margin*.5){
  const canvas=mineFloorCache?.key===key?mineFloorCache.canvas:document.createElement('canvas');canvas.width=w+margin*2;canvas.height=h+margin*2;
  mineFloorCache={key,canvas,x:camera.x,y:camera.y};
  paintMineFloor(canvas.getContext('2d'),canvas.width,canvas.height,ratio,{x:camera.x,y:camera.y});
 }
 ctx.drawImage(mineFloorCache.canvas,-margin-(camera.x-mineFloorCache.x),-margin-(camera.y-mineFloorCache.y));
}
const mineTileCache=new Map();
function drawMineTile(ctx,x,y,ratio,hash,patch){
 const key=`${ratio}:${hash%6}:${hash%7}`;
 let tile=mineTileCache.get(key);
 const tileW=34*ratio,tileH=17*ratio,depth=3*ratio,bx=tileW/2+ratio,by=tileH/2+ratio,halfW=tileW/2-ratio,halfH=tileH/2-ratio;
 if(!tile){tile=document.createElement('canvas');tile.width=Math.ceil(tileW+2*ratio);tile.height=Math.ceil(tileH+depth+2*ratio);
 const ctx=tile.getContext('2d');ctx.imageSmoothingEnabled=false;
    // Low diamond paving, with two darker front faces and a lit back edge.
    ctx.fillStyle='#292019';ctx.beginPath();ctx.moveTo(bx-halfW,by);ctx.lineTo(bx,by+halfH);ctx.lineTo(bx,by+halfH+depth);ctx.lineTo(bx-halfW,by+depth);ctx.closePath();ctx.fill();
    ctx.fillStyle='#18130f';ctx.beginPath();ctx.moveTo(bx,by+halfH);ctx.lineTo(bx+halfW,by);ctx.lineTo(bx+halfW,by+depth);ctx.lineTo(bx,by+halfH+depth);ctx.closePath();ctx.fill();
    ctx.save();ctx.beginPath();ctx.moveTo(bx,by-halfH);ctx.lineTo(bx+halfW,by);ctx.lineTo(bx,by+halfH);ctx.lineTo(bx-halfW,by);ctx.closePath();ctx.clip();
    ctx.drawImage(mineFloor,...patch,bx-halfW,by-halfH,halfW*2,halfH*2);
    ctx.fillStyle=`rgba(12,10,8,${.05+(hash%7)*.025})`;ctx.fillRect(bx-halfW,by-halfH,halfW*2,halfH*2);ctx.restore();
    ctx.strokeStyle='rgba(153,119,76,.3)';ctx.lineWidth=ratio;ctx.beginPath();ctx.moveTo(bx-halfW,by);ctx.lineTo(bx,by-halfH);ctx.lineTo(bx+halfW,by);ctx.stroke();
 mineTileCache.set(key,tile);
 }
 ctx.drawImage(tile,x-bx,y-by);
}
function paintMineFloor(ctx,w,h,ratio,camera){
 if(mineFloor.complete&&mineFloor.naturalWidth){
  const tileW=34*ratio,tileH=17*ratio,depth=3*ratio,offsetX=w/2-camera.x,offsetY=h/2-camera.y;
  ctx.save();ctx.imageSmoothingEnabled=false;ctx.fillStyle='#191612';ctx.fillRect(0,0,w,h);
  const patches=[[80,35,130,115],[285,35,150,110],[600,45,140,110],[80,215,130,110],[430,215,140,110],[730,215,145,105]];
  const firstRow=Math.floor((-offsetY-depth)/tileH)*2-2,lastRow=Math.ceil((h-offsetY)/tileH)*2+2;
  for(let row=firstRow;row<=lastRow;row++){
   const shift=((row%2)+2)%2*tileW/2,firstCol=Math.floor((-offsetX-shift)/tileW)-1;
   for(let col=firstCol;offsetX+shift+col*tileW<w+tileW;col++){
    const hash=((Math.imul(row,73856093)^Math.imul(col,19349663))>>>0),patch=patches[hash%patches.length];
    const bx=offsetX+shift+col*tileW,by=offsetY+row*tileH/2,halfW=tileW/2-ratio,halfH=tileH/2-ratio;
    drawMineTile(ctx,bx,by,ratio,hash,patch);

   }
  }
  ctx.fillStyle='rgba(8,12,15,.38)';ctx.fillRect(0,0,w,h);ctx.restore();
 }

}
function drawStarterFlag(ctx,tx,ty,ratio,frame){if(starterFlag.complete&&starterFlag.naturalWidth){const i=Math.floor(Math.max(0,frame)/5)%16;ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(starterFlag,(i%4)*32+3,Math.floor(i/4)*64+15,26,37,tx-3.75*ratio,ty-54.75*ratio,39*ratio,55.5*ratio);ctx.restore();}}
function drawSingleBanana(ctx,tx,ty,ratio,frame){const sprite=bananaFrames[Math.floor(Math.max(0,frame)/5)%bananaFrames.length];if(sprite.complete&&sprite.naturalWidth){ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(sprite,tx-12.8*ratio,ty-16*ratio,25.6*ratio,32*ratio);ctx.restore();}}
function drawCharacterSprite(ctx,sprite,x,y,ratio,{facing,largeSprite,width,height}){if(sprite.complete&&sprite.naturalWidth){ctx.save();ctx.translate(x,y);ctx.scale(facing,1);ctx.imageSmoothingEnabled=false;if(largeSprite)ctx.drawImage(sprite,-width/2*ratio,-height*ratio,width*ratio,height*ratio);else ctx.drawImage(sprite,-24*ratio,-56*ratio,48*ratio,56*ratio);ctx.restore();}}
/** Draw a supplied view snapshot; returns facing only, without changing gameplay. */
function drawScene(ctx,w,h,ratio,{orbGame,source,frame,orbCamera,isWarmup,timed,unlockEvent,unlockAge,recording,running,replaying,orbCharacter,runOrbCharacter,orbCharacterPreview,orbLossStartedAt,swapPose,lossAgeFrames,diddyFacing,arrowReach}){
 const screen=(x,y)=>[w/2+x*ratio-orbCamera.x,h/2+y*ratio-orbCamera.y];
 ctx.fillStyle='#080f19';ctx.fillRect(0,0,w,h);
 if(mineFloor.complete&&mineFloor.naturalWidth)drawCachedMineFloor(ctx,w,h,ratio,orbCamera);

 if(orbGame.target){
 const [tx,ty]=screen(orbGame.target.x,orbGame.target.y),remaining=Math.max(0,1-(frame-orbGame.target.start)/orbGame.timerFrames);
 const targetRadius=(orbGame.target.radius??18)*ratio;
 if(!orbGame.failed&&orbGame.target.special){ctx.save();ctx.fillStyle='rgba(255,217,90,.06)';ctx.strokeStyle='rgba(255,217,90,.65)';ctx.lineWidth=2*ratio;ctx.setLineDash([6*ratio,5*ratio]);ctx.beginPath();ctx.arc(tx,ty,targetRadius,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
 const arrowAge=frame-orbGame.target.start;
 if(arrowReach!=="off"&&arrowAge>=0&&(isWarmup||orbGame.target.special||arrowAge<36)){
  const [fromX,fromY]=screen(isWarmup||orbGame.target.special?orbGame.x:orbGame.target.fromX,isWarmup||orbGame.target.special?orbGame.y:orbGame.target.fromY);
  const dx=tx-fromX,dy=ty-fromY,bananaDistance=Math.hypot(dx,dy),ux=dx/bananaDistance,uy=dy/bananaDistance;
  const margin=18*ratio,edgeDistance=Math.min(Math.abs(ux)>.0001?(ux>0?w-margin-fromX:fromX-margin)/Math.abs(ux):Infinity,Math.abs(uy)>.0001?(uy>0?h-margin-fromY:fromY-margin)/Math.abs(uy):Infinity);
  const extendedArrow=orbGame.target.special||arrowReach==="edge",distance=extendedArrow?edgeDistance:bananaDistance;
  if(distance>43*ratio){
   const alpha=isWarmup?.45:orbGame.target.special?.38:arrowAge<6?.65:.65*Math.pow(1-(arrowAge-6)/30,2);
   ctx.save();
   if(extendedArrow&&!orbGame.target.special){ctx.beginPath();ctx.rect(0,0,w,h);ctx.moveTo(tx+targetRadius+5*ratio,ty);ctx.arc(tx,ty,targetRadius+5*ratio,0,Math.PI*2);ctx.clip('evenodd');}
   ctx.translate(fromX,fromY);ctx.rotate(Math.atan2(dy,dx));
   ctx.globalAlpha=alpha;ctx.fillStyle='#e4fff0';
   const start=20*ratio,tip=distance-(extendedArrow?0:23*ratio),head=10*ratio;
   ctx.beginPath();ctx.moveTo(start,-1*ratio);ctx.lineTo(tip-head,-2*ratio);
   ctx.lineTo(tip-head,-6*ratio);ctx.lineTo(tip,0);ctx.lineTo(tip-head,6*ratio);
   ctx.lineTo(tip-head,2*ratio);ctx.lineTo(start,1*ratio);ctx.closePath();ctx.fill();ctx.restore();
  }
 }
 if(!orbGame.failed){ctx.strokeStyle='rgba(255,197,102,.22)';ctx.lineWidth=2*ratio;ctx.beginPath();ctx.arc(tx,ty,targetRadius,0,Math.PI*2);ctx.stroke();}
 // A small banana inside the original target and countdown ring.
 if(isWarmup)drawStarterFlag(ctx,tx,ty,ratio,frame);
 else if(orbGame.target.special)drawBananaPile(ctx,tx,ty,ratio);
 else drawSingleBanana(ctx,tx,ty,ratio,frame);

 if(!orbGame.failed&&!isWarmup&&timed&&!orbGame.target.untimed){ctx.strokeStyle=orbGame.failed||remaining<.25?'#ff6b77':'#ffc566';ctx.lineWidth=3*ratio;ctx.beginPath();ctx.arc(tx,ty,targetRadius,-Math.PI/2,-Math.PI/2+(orbGame.failed?1:remaining)*Math.PI*2);ctx.stroke();}
 }
 if(!orbGame.failed&&orbGame.flash&&frame-orbGame.flash.frame<18){const flash=orbGame.flash,[fx,fy]=screen(flash.x,flash.y),age=(frame-flash.frame)/18;ctx.globalAlpha=1-age;ctx.strokeStyle=flash.kind==='hit'?'#67ffd0':'#ff6b77';ctx.beginPath();ctx.arc(fx,fy,(18+age*14)*ratio,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=1;}
 if(unlockEvent&&unlockAge>=0&&unlockAge<180){const [px,py]=screen(unlockEvent.toX,unlockEvent.toY);drawBananaPile(ctx,px,py,ratio);}
 if(unlockEvent&&unlockAge>=180&&unlockAge<225){const [px,py]=screen(unlockEvent.toX,unlockEvent.toY),t=(unlockAge-180)/45;ctx.save();ctx.globalAlpha=1-t;ctx.strokeStyle='#ffe04e';ctx.lineWidth=4*ratio;for(let i=0;i<28;i++){const a=i*2.399963,reach=(25+(i%5)*12)*t*ratio;const bx=px+Math.cos(a)*reach,by=py+Math.sin(a)*reach-55*ratio*Math.sin(t*Math.PI);ctx.beginPath();ctx.arc(bx,by,6*ratio,a,a+2.2);ctx.stroke();}ctx.restore();}

 const [x,y]=screen(orbGame.x,orbGame.y);
 const lastMove=source.findLast(e=>e.type==='accepted'&&e.frame<=frame);
 const moving=lastMove&&frame-lastMove.frame<9&&!orbGame.failed;
 if(lastMove){const horizontal=Math.cos(lastMove.angle*Math.PI/180);if(Math.abs(horizontal)>.1)diddyFacing=horizontal<0?-1:1;}
 const celebrationAge=orbGame.celebration?frame-orbGame.celebration.start:-1;
 const celebrationIdle=!unlockEvent&&celebrationAge>=0&&celebrationAge<90;
 const celebrating=!unlockEvent&&celebrationAge>=90&&celebrationAge<150;
 const selectedCharacter=displayedOrbCharacter({running,runOrbCharacter,recording,replaying,isWarmup,orbCharacterPreview,orbCharacter});
 let sprite=celebrationIdle?diddyCelebrationIdle:celebrating?diddyFlipFrames[Math.min(19,Math.floor((celebrationAge-90)/3))]:diddyFrames[moving?Math.floor(frame/4)%diddyFrames.length:0];
 let largeSprite=celebrating||celebrationIdle,spriteW=64,spriteH=72;
 if(unlockEvent&&unlockAge>=0&&unlockAge<unlockEvent.end-unlockEvent.start){largeSprite=true;if(unlockAge<120){sprite=selectedCharacter==='dk'?dkVoiceSprites[0]:selectedCharacter==='dixie'?dixieIdle:diddyUnlockIdle;if(sprite===dkVoiceSprites[0]||sprite===dixieIdle){spriteW=96;spriteH=96;}}else if(unlockAge<180){if(selectedCharacter==='dk'){sprite=dkRollFrames[Math.min(12,Math.floor((unlockAge-120)*13/60))];spriteW=96;spriteH=96;}else if(selectedCharacter==='dixie'){sprite=dixieRollFrames[Math.min(dixieRollFrames.length-1,Math.floor((unlockAge-120)*dixieRollFrames.length/60))];spriteW=96;spriteH=96;}else sprite=diddyFlipFrames[Math.min(19,Math.floor((unlockAge-120)/3))];}else{sprite=diddyFrames[0];largeSprite=false;diddyFacing=-1;}}

 else if(selectedCharacter==='dk'){sprite=moving?dkWalkFrames[Math.floor(frame/4)%dkWalkFrames.length]:dkVoiceSprites[0];largeSprite=true;spriteW=96;spriteH=96;}
 if(orbCharacterPreview&&!running&&!replaying&&!isWarmup){sprite=orbCharacter==='dk'?dkVoiceSprites[0]:diddyFrames[0];largeSprite=orbCharacter==='dk';spriteW=96;spriteH=96;}
 if(selectedCharacter==='dixie'&&(!unlockEvent||unlockAge<0||unlockAge>=180)){sprite=moving?dixieWalkFrames[Math.floor(frame/4)%dixieWalkFrames.length]:dixieIdle;largeSprite=true;spriteW=96;spriteH=96;}
 if(selectedCharacter==='dk'&&unlockEvent&&unlockAge>=180&&unlockAge<unlockEvent.end-unlockEvent.start){sprite=dkVoiceSprites[0];largeSprite=true;spriteW=96;spriteH=96;}
 if(orbGame.failed&&selectedCharacter==='diddy'&&(recording?.orbCharacter??runOrbCharacter)==='diddy'&&orbLossStartedAt!==null){const age=lossAgeFrames; const introFrames=diddyFailureFrames.length*4;const wave=[2,1,0,1,2,3];const lossFrame=age<introFrames?Math.min(diddyFailureFrames.length-1,Math.floor(age/4)):Math.max(0,diddyFailureFrames.length-4)+wave[Math.floor((age-introFrames)/6)%wave.length];sprite=diddyFailureFrames[lossFrame];largeSprite=true;spriteW=96;spriteH=96;}
 if(orbGame.failed&&selectedCharacter!=='diddy'&&(recording?.orbCharacter??runOrbCharacter)===selectedCharacter&&orbLossStartedAt!==null){
  const frames=selectedCharacter==='dk'?dkFailureFrames:dixieFailureFrames;
  const tick=Math.floor(Math.max(0,lossAgeFrames)/6),step=tick%(frames.length*2-2),index=selectedCharacter==='dixie'?tick%frames.length:step<frames.length?step:frames.length*2-2-step;
  sprite=frames[index];largeSprite=true;spriteW=96;spriteH=96;
 }
 if(swapPose){
  sprite=swapPose.kind==='diddy-idle'?diddyCelebrationIdle:swapPose.kind==='diddy-flip'?diddyFlipFrames[swapPose.index]:swapPose.kind==='dk-voice'?dkVoiceSprites[swapPose.index]:dixieVoiceFrames[swapPose.index];
  largeSprite=true;spriteW=swapPose.kind.startsWith('diddy')?64:96;spriteH=swapPose.kind.startsWith('diddy')?72:96;
 }
 // A ground shadow marks the collection position without covering Diddy.
 ctx.save();ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=7*ratio;
 ctx.fillStyle='rgba(0,0,0,.55)';ctx.beginPath();ctx.ellipse(x,y,17*ratio,4*ratio,0,0,Math.PI*2);ctx.fill();ctx.restore();
 drawCharacterSprite(ctx,sprite,x,y,ratio,{facing:diddyFacing,largeSprite,width:spriteW,height:spriteH});
 if((unlockEvent&&unlockAge>=180)||orbGame.dkPosition){const [dx,dy]=screen(orbGame.dkPosition?.x??(unlockEvent.toX-45),orbGame.dkPosition?.y??unlockEvent.toY);const isDixie=(unlockEvent?.character??orbGame.unlockCharacter)==='dixie';let dkSprite=isDixie?dixieHold:dkVoiceSprites[0];if(unlockEvent&&unlockAge<270)dkSprite=isDixie?dixieRevealFrames[unlockAge<198?0:Math.min(22,1+Math.floor((unlockAge-198)*22/72))]:dkRevealFrames[Math.min(23,Math.floor((unlockAge-180)*24/90))];else if(unlockEvent&&unlockAge>=360&&unlockAge<orbGame.unlockDuration-30)dkSprite=isDixie?dixieVoiceFrames[Math.min(dixieVoiceFrames.length-1,Math.floor((unlockAge-360)*dixieVoiceFrames.length/(orbGame.unlockDuration-390)))]:dkVoiceSprites[Math.min(11,Math.floor((unlockAge-360)*12/(orbGame.unlockDuration-390)))];if(dkSprite.complete&&dkSprite.naturalWidth){ctx.save();ctx.imageSmoothingEnabled=false;ctx.drawImage(dkSprite,dx-48*ratio,dy-96*ratio,96*ratio,96*ratio);ctx.restore();}}
 ctx.fillStyle='#d9fff4';ctx.font=`${13*ratio}px Jumpman, system-ui`;ctx.letterSpacing=`${1.1*ratio}px`;ctx.textAlign='left';ctx.fillText(isWarmup?"Reach the flag to start":`Bananas consumed: ${orbGame.score}`,16*ratio,26*ratio);ctx.letterSpacing="0px";
 if(orbGame.failed){const gameOverY=h/2;ctx.save();ctx.fillStyle='rgba(0,0,0,.38)';ctx.fillRect(0,gameOverY-37*ratio,w,74*ratio);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`${32*ratio}px Jumpman, system-ui`;ctx.letterSpacing=`${2*ratio}px`;ctx.strokeStyle='#1b120c';ctx.lineWidth=4*ratio;ctx.strokeText('Game Over',w/2,gameOverY);ctx.fillStyle='#ffe282';ctx.fillText('Game Over',w/2,gameOverY);ctx.restore();}

 return diddyFacing;
}
return {sprites:{diddyFrames,bananaFrames,starterFlag,mineFloor,diddyFlipFrames,diddyCelebrationIdle,dixieRollFrames,diddyFailureFrames,dkFailureFrames,dixieFailureFrames,dkWalkFrames,dkRollFrames,dixieRevealFrames,dixieVoiceFrames,dixieWalkFrames,dixieIdle,dixieHold,dkRevealFrames,dkVoiceSprites,diddyUnlockIdle},drawScene,drawBananaPile,drawCachedMineFloor,drawCharacterSprite,drawStarterFlag,drawSingleBanana};
}
