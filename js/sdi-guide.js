const guideLink=(page,label)=>`<button type="button" class="guide-inline guide-link" data-guide-link="${page}">${label}</button>`;
const timingInfo=(row,label)=>` <button type="button" class="guide-timing-info" data-guide-row="${row}" aria-label="Highlight the ${label} timing example">i</button>`;
const previewTerm=word=>`<button type="button" class="guide-inline guide-preview-term">${word}</button>`;
const zoneTerms=html=>html.replace(/\bzones?\b/gi,previewTerm);
const zoneCycle=[{axis:'x',value:-1},{axis:'y',value:1},{axis:'x',value:1},{axis:'y',value:-1}];
const diagonal=Math.SQRT1_2;
const directionCycle=[{x:-1,y:0},{x:-diagonal,y:diagonal},{x:0,y:1},{x:diagonal,y:diagonal},{x:1,y:0},{x:diagonal,y:-diagonal},{x:0,y:-1},{x:-diagonal,y:-diagonal}];
const pages=[
 {id:'basics',title:'Normal SDI',html:`<p>An SDI input is generated when the main stick enters a zone it wasn’t already in. The main stick’s position on that frame determines the input’s direction.</p><p>The game checks once per frame at 60 FPS, so the input doesn’t have to happen exactly at the zone’s edge.</p><p>The game can accept one SDI input every 4 frames. See ${guideLink('buffer','buffering')}.</p>`,note:'Activating a zone makes it flash green and stay highlighted until you leave it. Each green SDI flash marks one registered SDI input.'},
 {id:'buffer',title:'SDI lockout and buffering',html:`<p>After an SDI input, another can be accepted four frames later.</p><p>During the SDI lockout, entering a new zone with the main stick buffers one input. It triggers as soon as the SDI lockout ends. The first buffered input is kept; further zone entries won’t replace it.${timingInfo('main','main stick')}</p><p>You can also buffer an input with the ${guideLink('c-stick','C-Stick')}, but both the SDI lockout and the ${guideLink('c-stick','C-Stick reactivation delay')} must end before it triggers.</p><p>For the earliest possible follow-up, flick the C-Stick one frame after the accepted SDI input. Its three-frame reactivation delay then ends exactly when the SDI lockout ends.${timingInfo('early','early C-Stick')}</p><p>If you flick the C-Stick too late, its reactivation delay can outlast the SDI lockout, delaying your next SDI input, effectively extending the lockout. Returning to neutral sooner can also shorten the reactivation delay.${timingInfo('late','late C-Stick')}</p>`},
 {id:'c-stick',title:'C-Stick reactivation',html:`<p>To generate another SDI input in a particular zone, you normally leave that zone and re-enter it. The C-Stick can also reactivate that zone.</p><p>Flick the C-Stick into a zone that doesn’t include the direction you want to reactivate. When the main stick is diagonal, two zones are active. Reactivating either one is enough, so more C-Stick directions work.</p><ul><li>Reactivation happens three frames after the C-Stick input, or sooner if it returns to neutral. In practice, even a quick flick usually takes 2–3 frames to return.</li><li>While C-Stick reactivation is pending, no new SDI input can be buffered. An input buffered before the C-Stick input keeps its timing.</li><li>If the main stick enters a new zone on the same frame as an eligible C-Stick input, the C-Stick takes priority: the input waits for reactivation.</li></ul><p>C-Stick SDI can be powerful, but time your flicks deliberately to avoid delaying other SDI inputs.</p>`,note:'Activating a zone with the main stick highlights the C-Stick positions that can reactivate it.'}
];

export function createSdiGuide({button,livePanel,host,canOpen,onOpen,onClose}){
 let open=false,page=0,hostWasHidden=false;
 let blocked=[],hoveredZone=null,focusedZone=null,zoneSince=0;
 const shade=document.createElement('div');shade.className='sdi-guide-shade';shade.hidden=true;
 const panel=document.createElement('section');panel.className='sdi-guide-panel';panel.hidden=true;
 panel.setAttribute('role','region');panel.setAttribute('aria-label','How to SDI');
 panel.innerHTML=`<header class="guide-heading"><div class="guide-pages" aria-label="Guide pages">${pages.map((p,i)=>`<button type="button" class="guide-dot" aria-label="Page ${i+1}: ${p.title}" data-page="${i}"></button>`).join('')}</div><button type="button" class="text-button guide-close" aria-label="Close SDI guide">×</button></header><div class="guide-body"><div class="guide-title-row"><h2 id="sdiGuideTitle" tabindex="-1"></h2></div><div class="guide-copy"></div><p class="guide-input-note" hidden></p><div class="guide-timing-grid" aria-label="SDI timing examples" hidden></div></div><button type="button" class="guide-arrow guide-prev" aria-label="Previous guide page">‹</button><button type="button" class="guide-arrow guide-next" aria-label="Next guide page">›</button>`;
 document.body.append(shade);host.append(panel);
 const grid=panel.querySelector('.guide-timing-grid');
 const tip=document.createElement('div');tip.className='guide-frame-tip';tip.setAttribute('role','tooltip');tip.hidden=true;document.body.append(tip);
 function select(index){
  page=(index+pages.length)%pages.length;
  const current=pages[page],timing=current.id==='buffer';
  hoveredZone=focusedZone=null;
  delete grid.dataset.highlightRow;
  panel.querySelector('h2').textContent=current.title;
  const decorate=current.id==='basics'?zoneTerms:html=>html;
  panel.querySelector('.guide-copy').innerHTML=decorate(current.id==='c-stick'?current.html.replace('doesn’t include the direction',`doesn’t include the ${previewTerm('direction')}`):current.html);
  const note=panel.querySelector('.guide-input-note');
  note.innerHTML=current.note?decorate(`<strong>Try it in Live Input on the left:</strong> ${current.note[0].toLowerCase()+current.note.slice(1)}`):'';
  note.hidden=!current.note;
  panel.classList.toggle('guide-panel-timing',timing);
  grid.hidden=!timing;tip.hidden=true;
  panel.querySelectorAll('.guide-preview-term').forEach(term=>{
   term.setAttribute('aria-label',`${term.textContent}: ${current.id==='c-stick'?'preview eligible C-Stick areas':'preview the main stick zones'}`);
   term.onpointerenter=()=>{hoveredZone=term;zoneSince=performance.now();};
   term.onpointerleave=()=>{if(hoveredZone===term)hoveredZone=null;};
   term.onfocus=()=>{if(term.matches(':focus-visible')){focusedZone=term;zoneSince=performance.now();}};
   term.onblur=()=>{if(focusedZone===term)focusedZone=null;};
  });
  panel.querySelectorAll('[data-guide-link]').forEach(link=>link.onclick=()=>{
   select(pages.findIndex(p=>p.id===link.dataset.guideLink));
   panel.querySelector('h2').focus({preventScroll:true});
  });
  const timingIcons=[...panel.querySelectorAll('.guide-timing-info')];
  const updateRow=()=>{
   const active=timingIcons.find(icon=>icon.matches(':hover'))??timingIcons.find(icon=>icon.matches(':focus-visible'));
   if(active)grid.dataset.highlightRow=active.dataset.guideRow;else delete grid.dataset.highlightRow;
  };
  for(const icon of timingIcons){
   icon.onpointerenter=icon.onpointerleave=updateRow;
   icon.onfocus=icon.onblur=()=>queueMicrotask(updateRow);
  }
  panel.querySelectorAll('.guide-dot').forEach((dot,i)=>{dot.classList.toggle('current',i===page);dot.setAttribute('aria-current',i===page?'step':'false');});
  
 }
 function close(){
  if(!open)return;open=false;shade.hidden=panel.hidden=tip.hidden=true;
  hoveredZone=focusedZone=null;delete grid.dataset.highlightRow;
  livePanel.classList.remove('sdi-guide-live');host.classList.remove('sdi-guide-host');host.hidden=hostWasHidden;
  document.body.classList.remove('sdi-guide-open');button.setAttribute('aria-expanded','false');onClose?.();button.focus();
  blocked.forEach(([element,inert])=>element.inert=inert);blocked=[];
 }
 button.setAttribute('aria-expanded','false');
 button.addEventListener('click',()=>{
  if(open){close();return;}if(!canOpen())return;
  open=true;hostWasHidden=host.hidden;host.hidden=false;shade.hidden=panel.hidden=false;
  document.body.classList.add('sdi-guide-open');livePanel.classList.add('sdi-guide-live');host.classList.add('sdi-guide-host');
  button.setAttribute('aria-expanded','true');onOpen?.();select(0);
  blocked=[...document.querySelectorAll('main .page-title, main .session-stack, main .timeline-panel')].map(element=>[element,element.inert]);
  blocked.forEach(([element])=>element.inert=true);
  panel.querySelector('.guide-close').focus();
 });
 panel.querySelector('.guide-close').onclick=close;shade.onclick=close;
 panel.querySelector('.guide-prev').onclick=()=>select(page-1);panel.querySelector('.guide-next').onclick=()=>select(page+1);
 panel.querySelectorAll('.guide-dot').forEach(dot=>dot.onclick=()=>select(Number(dot.dataset.page)));
 document.addEventListener('keydown',event=>{if(open&&event.key==='Escape'){event.preventDefault();close();}});
 function showTip(target){
  if(!target?.dataset.tip)return;
  tip.textContent=target.dataset.tip;tip.hidden=false;
  const box=target.closest('.guide-frame-cell').getBoundingClientRect();
  const width=Math.min(280,innerWidth-24);tip.style.width='max-content';tip.style.maxWidth=width+'px';
  tip.style.left=Math.max(12,Math.min(innerWidth-tip.offsetWidth-12,box.left+(box.width-tip.offsetWidth)/2))+'px';
  tip.style.top=Math.max(12,box.top-tip.offsetHeight-7)+'px';
 }
 grid.addEventListener('pointerover',event=>showTip(event.target.closest('[data-tip]')));
 grid.addEventListener('pointerleave',()=>tip.hidden=true);
 grid.addEventListener('focusin',event=>showTip(event.target.closest('[data-tip]')));
 grid.addEventListener('focusout',event=>{if(!grid.contains(event.relatedTarget))tip.hidden=true;});
 function makeTimeline(){
  const headings=document.createElement('div');headings.className='guide-frame-headings';
  headings.innerHTML='<span></span>'+Array.from({length:9},(_,f)=>'<span>'+(f+1)+'</span>').join('');grid.append(headings);
  const rows=[{id:'main',label:'Main stick',input:1,period:4,c:false},{id:'early',label:'C-Stick early',input:1,period:4,c:true},{id:'late',label:'C-Stick late',input:3,period:6,c:true}];
  const inputOffset=(row,acceptedFrame)=>row.id==='main'&&acceptedFrame===4?3:row.input;
  for(const row of rows){
   const container=document.createElement('div');container.className='guide-timing-row';container.dataset.row=row.id;
   const label=document.createElement('span');label.className='guide-row-label';label.textContent=row.label;container.append(label);
   const track=document.createElement('div');track.className='guide-frame-track';container.append(track);
   for(let f=0;f<9;f++){
    const since=f%row.period,input=inputOffset(row,f-since),pendingC=row.c&&since>=input,lockout=since>0&&since<4;
    const cell=document.createElement('div');cell.className='guide-frame-cell'+(pendingC?' c-delay':lockout?' sdi-delay':'');cell.tabIndex=0;
    cell.dataset.tip=pendingC?'C-Stick reactivation delay':lockout?'SDI Lockout':'No SDI input';
    const accepted=since===0,buffered=since===input;
    if(accepted||buffered){
     const dot=document.createElement('span');dot.className='guide-event '+(accepted?'guide-accepted-dot':'guide-buffer-dot')+(buffered&&row.c?' guide-c-dot':'');dot.tabIndex=0;
     dot.dataset.tip=accepted?(f===0?'SDI Input by main stick':row.c?'SDI Input by C-Stick':'SDI Input buffered by main stick'):(row.c?'Eligible C-Stick input':'Buffered SDI Input by main stick');
     cell.dataset.tip=dot.dataset.tip;dot.setAttribute('aria-label',dot.dataset.tip);cell.append(dot);
    }
    cell.setAttribute('aria-label','Frame '+(f+1)+': '+cell.dataset.tip);track.append(cell);
   }
   const paths=[];
   for(let accepted=0;accepted<9;accepted+=row.period){
    const input=accepted+inputOffset(row,accepted),next=accepted+row.period;if(input>=9)continue;
    paths.push(`<line x1="${(input+.5)*100}" y1="23.4" x2="${Math.min(900,(next+.5)*100)}" y2="9.3"/>`);
   }
   const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 900 30');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');svg.classList.add('guide-buffer-connections');svg.innerHTML=paths.join('');track.append(svg);
   grid.append(container);
  }
 }
 makeTimeline();
 return {get open(){return open;},zonePreview(now){
  if(!open||!(hoveredZone||focusedZone))return null;
  const basics=pages[page].id==='basics',interval=basics?500:1000;
  const elapsed=Math.max(0,now-zoneSince),step=Math.floor(elapsed/interval),phase=elapsed%interval;
  const strength=Math.max(0,1-phase/(basics?430:650));
  if(basics)return {flashes:[{...zoneCycle[step%zoneCycle.length],strength}]};
  const direction=directionCycle[step%directionCycle.length];
  const cStickStrength=Math.max(0,Math.min(1,(900-phase)/220));
  return {direction,strength,cStickStrength,flashes:['x','y'].filter(axis=>direction[axis]).map(axis=>({axis,value:Math.sign(direction[axis]),strength}))};
 },close};
}
