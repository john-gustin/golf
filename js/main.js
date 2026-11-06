import * as THREE from '../lib/three.module.min.js';
import {makeCourse,height,surface,surfaceInfo,pathDist,pointAt,greenE,slope} from './course.js';
import {shoot,CLUBS,PUTT_CAPS,lieFactor,previewFlight,LIE_NAME} from './physics.js';
import {Net} from './net.js';

const APP_VERSION=1;
const MAX_STROKES=10;
const SLOT_COL=['#f4f4f4','#ffd23f','#59c3ff','#ff8a7a'];
const $=s=>document.querySelector(s);
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rid=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a,b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join('');};
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
let PID=store.get('golf-pid');if(!PID){PID=rid(12);store.set('golf-pid',PID);}
let myName=store.get('golf-name')||'';
let toastT;function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2800);}
const yds=v=>Math.round(v)+' yds';
const ft=v=>Math.round(v*3)+' ft';
const distTxt=(v,onGreen)=>onGreen||v<20?ft(v):yds(v);

/* ======================= game state ======================= */
let gid=null,cfg=null,course=null,net=null;
let recs={};            // pid -> record
let online={};          // pid -> last seen
let chat=[];
let spectator=false;
let viewHole=0;
let readyOverride=false;
const me=()=>recs[PID];
const nHoles=()=>course.holes.length;

/* ======================= sound ======================= */
let soundOn=store.get('golf-sound')!=='0',actx=null;
function snd(type,vol=1){
  if(!soundOn)return;
  try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime;
    if(type==='hit'||type==='putt'){const len=type==='hit'?0.09:0.05;const b=actx.createBuffer(1,actx.sampleRate*len,actx.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,type==='hit'?4:8);
      const s=actx.createBufferSource();s.buffer=b;const f=actx.createBiquadFilter();f.type='bandpass';f.frequency.value=type==='hit'?2500:1400;const g=actx.createGain();g.gain.value=(type==='hit'?0.9:0.5)*vol;s.connect(f).connect(g).connect(actx.destination);s.start(t);}
    else if(type==='cup'){[0,0.12,0.2].forEach((dt,i)=>{const o=actx.createOscillator(),g=actx.createGain();o.type='triangle';o.frequency.value=[900,700,1100][i];g.gain.setValueAtTime(.12,t+dt);g.gain.exponentialRampToValueAtTime(.0001,t+dt+.12);o.connect(g).connect(actx.destination);o.start(t+dt);o.stop(t+dt+.15);});}
    else if(type==='splash'){const b=actx.createBuffer(1,actx.sampleRate*0.5,actx.sampleRate);const d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);const s=actx.createBufferSource();s.buffer=b;const f=actx.createBiquadFilter();f.type='lowpass';f.frequency.value=900;const g=actx.createGain();g.gain.value=0.5;s.connect(f).connect(g).connect(actx.destination);s.start(t);}
    else if(type==='chat'){const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=880;g.gain.setValueAtTime(.08,t);g.gain.exponentialRampToValueAtTime(.0001,t+.2);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+.25);}
  }catch(e){}
}
$('#soundBtn').textContent=soundOn?'🔊':'🔇';
$('#soundBtn').onclick=()=>{soundOn=!soundOn;store.set('golf-sound',soundOn?'1':'0');$('#soundBtn').textContent=soundOn?'🔊':'🔇';};

/* ======================= three.js scene ======================= */
const canvas=$('#view');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});
renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));
renderer.setSize(window.innerWidth,window.innerHeight,false);
const scene=new THREE.Scene();
scene.background=new THREE.Color('#9fd0ee');
scene.fog=new THREE.Fog('#bfe0f2',180,720);
const camera=new THREE.PerspectiveCamera(52,window.innerWidth/window.innerHeight,0.05,3000);
scene.add(new THREE.HemisphereLight('#e6f4ff','#3d5a2a',1.05));
const sun=new THREE.DirectionalLight('#fff4dc',1.6);sun.position.set(-150,260,120);scene.add(sun);
{ // sky dome
  const g=new THREE.SphereGeometry(1500,24,12);const cols=[];const p=g.attributes.position;
  for(let i=0;i<p.count;i++){const y=p.getY(i)/1500;const c=new THREE.Color().lerpColors(new THREE.Color('#d9eef8'),new THREE.Color('#4f9ad8'),clamp(y*1.6,0,1));cols.push(c.r,c.g,c.b);}
  g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));
  const sky=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide,fog:false}));scene.add(sky);
}
window.addEventListener('resize',()=>{renderer.setSize(window.innerWidth,window.innerHeight,false);camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();});

let holeGroup=null,H=null; // current hole object
const balls={};            // pid -> mesh
let aimLine=null,landRing=null,greenGrid=null,flagGroup=null;
const SURF_COL={tee:'#5aa646',fairway:'#61b04a',fairway2:'#57a443',green:'#74c656',green2:'#6cbd4f',fringe:'#5fae49',rough:'#3f8b36',deep:'#2f6e2b',sand:'#e6d6a1',water:'#2b5d86',ob:'#2a5a27'};

function buildTerrainMesh(h,b,cell,core){
  const nx=Math.ceil((b.maxX-b.minX)/cell)+1,nz=Math.ceil((b.maxZ-b.minZ)/cell)+1;
  const pos=new Float32Array(nx*nz*3),col=new Float32Array(nx*nz*3);
  const tmp=new THREE.Color();const ca=Math.cos(h.green.ang),sa=Math.sin(h.green.ang);
  const cb=h.bounds;
  for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
    const x=b.minX+i*cell,z=b.minZ+j*cell,k=(j*nx+i)*3;
    let y=height(h,x,z);
    let s;
    if(core){const inf=surfaceInfo(h,x,z);s=inf.surf;
      if(s==='fairway'&&Math.floor(inf.s/9)%2)s='fairway2';
      if(s==='green'&&Math.floor((x*ca+z*sa)/2.2)%2)s='green2';
    } else {
      s=(x>cb.minX&&x<cb.maxX&&z>cb.minZ&&z<cb.maxZ)?'deep':'ob';
      if(x>cb.minX+2&&x<cb.maxX-2&&z>cb.minZ+2&&z<cb.maxZ-2)y-=0.6;
    }
    pos[k]=x;pos[k+1]=y;pos[k+2]=z;
    tmp.set(SURF_COL[s]);
    const n=((Math.sin(x*12.9898+z*78.233)*43758.5453)%1+1)%1;
    const v=s.startsWith('green')?0.02:s==='sand'?0.04:0.07;
    tmp.offsetHSL(0,0,(n-0.5)*v);
    col[k]=tmp.r;col[k+1]=tmp.g;col[k+2]=tmp.b;
  }
  const idx=new Uint32Array((nx-1)*(nz-1)*6);let q=0;
  for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,b2=a+1,c=a+nx,d=c+1;idx[q++]=a;idx[q++]=c;idx[q++]=b2;idx[q++]=b2;idx[q++]=c;idx[q++]=d;}
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeVertexNormals();
  return new THREE.Mesh(g,new THREE.MeshLambertMaterial({vertexColors:true}));
}

function buildHole(idx){
  if(holeGroup){scene.remove(holeGroup);holeGroup.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});}
  H=course.holes[idx];viewHole=idx;
  holeGroup=new THREE.Group();scene.add(holeGroup);
  holeGroup.add(buildTerrainMesh(H,H.bounds,1.6,true));
  const b=H.bounds,M=320;
  holeGroup.add(buildTerrainMesh(H,{minX:b.minX-M,maxX:b.maxX+M,minZ:b.minZ-M,maxZ:b.maxZ+M},9,false));
  // water
  for(const p of H.ponds){
    const sh=new THREE.Shape();sh.absellipse(0,0,p.rx,p.rz,0,Math.PI*2,false,0);
    const m=new THREE.Mesh(new THREE.ShapeGeometry(sh,48),new THREE.MeshLambertMaterial({color:'#3f86c0',transparent:true,opacity:0.88}));
    m.rotation.x=-Math.PI/2;m.rotation.z=-p.ang;m.position.set(p.x,p.level,p.z);holeGroup.add(m);
  }
  // trees
  const n=H.trees.length;
  const crown=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7),new THREE.MeshLambertMaterial(),n);
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22,0.32,1,5),new THREE.MeshLambertMaterial({color:'#5b4030'}),n);
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),ps=new THREE.Vector3(),cc=new THREE.Color();
  H.trees.forEach((t,i)=>{
    const y=height(H,t.x,t.z);
    ps.set(t.x,y+t.h*0.6,t.z);sc.set(t.r,t.h*0.8,t.r);m4.compose(ps,q,sc);crown.setMatrixAt(i,m4);
    cc.setHSL(0.27+((i*37)%10)/100,0.45,0.18+((i*13)%10)/100);crown.setColorAt(i,cc);
    ps.set(t.x,y+t.h*0.15,t.z);sc.set(1,t.h*0.3,1);m4.compose(ps,q,sc);trunk.setMatrixAt(i,m4);
  });
  holeGroup.add(crown,trunk);
  // tee markers
  for(const s of [-3.5,3.5]){const c=Math.cos(H.tee.ang),sn=Math.sin(H.tee.ang);const x=c*s,z=sn*s;const mk=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),new THREE.MeshLambertMaterial({color:'#e53935'}));mk.position.set(x,height(H,x,z)+0.18,z);holeGroup.add(mk);}
  // cup + flag
  flagGroup=new THREE.Group();
  const py=height(H,H.pin.x,H.pin.z);
  const cup=new THREE.Mesh(new THREE.CircleGeometry(0.075,20),new THREE.MeshBasicMaterial({color:'#111'}));cup.rotation.x=-Math.PI/2;cup.position.set(H.pin.x,py+0.012,H.pin.z);holeGroup.add(cup);
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,2.4,6),new THREE.MeshLambertMaterial({color:'#f5f5f5'}));pole.position.set(0,1.2,0);flagGroup.add(pole);
  const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute([0,2.4,0, 0.9,2.17,0, 0,1.94,0],3));fg.computeVertexNormals();
  const flag=new THREE.Mesh(fg,new THREE.MeshLambertMaterial({color:'#e53935',side:THREE.DoubleSide}));flagGroup.add(flag);
  flagGroup.position.set(H.pin.x,py,H.pin.z);flagGroup.rotation.y=-H.wind.ang+Math.PI/2;holeGroup.add(flagGroup);
  // green grid
  greenGrid=buildGreenGrid(H);greenGrid.visible=false;holeGroup.add(greenGrid);
  // aim visuals
  aimLine=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineDashedMaterial({color:'#ffffff',dashSize:1.2,gapSize:0.8,transparent:true,opacity:0.85}));
  aimLine.frustumCulled=false;holeGroup.add(aimLine);
  landRing=new THREE.Mesh(new THREE.RingGeometry(1.6,2.2,40),new THREE.MeshBasicMaterial({color:'#ffffff',transparent:true,opacity:0.8,side:THREE.DoubleSide,depthTest:false}));
  landRing.rotation.x=-Math.PI/2;landRing.renderOrder=5;holeGroup.add(landRing);
  for(const k in balls){scene.remove(balls[k]);delete balls[k];}
  drawMiniBase();
}
function buildGreenGrid(h){
  const grp=new THREE.Group();const g=h.green,R=Math.max(g.rx,g.rz)+3;
  const pts=[];
  const inside=(x,z)=>greenE(h,x,z)<1.25;
  for(let k=-R;k<=R;k+=1){
    for(let t=-R;t<R;t+=0.5){
      const segs=[[g.x+k,g.z+t,g.x+k,g.z+t+0.5],[g.x+t,g.z+k,g.x+t+0.5,g.z+k]];
      for(const [x1,z1,x2,z2] of segs){if(!inside(x1,z1)||!inside(x2,z2))continue;pts.push(x1,height(h,x1,z1)+0.025,z1,x2,height(h,x2,z2)+0.025,z2);}
    }
  }
  const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  grp.add(new THREE.LineSegments(lg,new THREE.LineBasicMaterial({color:'#ffffff',transparent:true,opacity:0.22})));
  // slope arrows
  const spots=[];for(let x=-R;x<=R;x+=1.5)for(let z=-R;z<=R;z+=1.5){const px=g.x+x+0.75,pz=g.z+z+0.75;if(greenE(h,px,pz)<1.1)spots.push([px,pz]);}
  const cone=new THREE.ConeGeometry(0.055,0.28,5);cone.rotateX(Math.PI/2);
  const im=new THREE.InstancedMesh(cone,new THREE.MeshBasicMaterial({transparent:true,opacity:0.7}),spots.length);
  const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),cc=new THREE.Color(),e=new THREE.Euler();
  spots.forEach(([x,z],i)=>{const s=slope(h,x,z),mag=Math.hypot(s[0],s[1]);const ang=Math.atan2(-s[0],-s[1]);e.set(0,ang,0);q.setFromEuler(e);const sz=0.55+Math.min(mag/0.03,1)*0.65;
    m4.compose(new THREE.Vector3(x,height(h,x,z)+0.1,z),q,new THREE.Vector3(sz,sz,sz));im.setMatrixAt(i,m4);
    cc.setHSL(0.6-Math.min(mag/0.04,1)*0.6,0.9,0.55);im.setColorAt(i,cc);});
  grp.add(im);
  return grp;
}
function ballMesh(pid){
  if(balls[pid])return balls[pid];
  const r=recs[pid];const col=SLOT_COL[(r&&r.slot)||0];
  const g=new THREE.Group();
  const s=new THREE.Mesh(new THREE.SphereGeometry(0.06,16,12),new THREE.MeshLambertMaterial({color:col,emissive:col,emissiveIntensity:0.25}));
  const sh=new THREE.Mesh(new THREE.CircleGeometry(0.07,16),new THREE.MeshBasicMaterial({color:'#000',transparent:true,opacity:0.35,depthWrite:false}));
  sh.rotation.x=-Math.PI/2;g.add(s);g.userData.shadow=sh;scene.add(sh);
  scene.add(g);balls[pid]=g;g.userData.ball=s;return g;
}

/* ======================= shot setup / aiming ======================= */
let aim=0,clubIdx=0,capIdx=1,shape=0,spin=0;
function ballOf(r){return r.b;}
function distToPin(b){return Math.hypot(H.pin.x-b.x,H.pin.z-b.z);}
const isPutter=()=>CLUBS[clubIdx].id==='PT';
function setupShot(){
  const r=me();if(!r||r.done||r.hole!==viewHole)return;
  const b=r.b;const d=distToPin(b);
  if(b.lie==='green'||(b.lie==='fringe'&&d<12)){
    clubIdx=CLUBS.length-1;capIdx=PUTT_CAPS.findIndex(c=>c>=d*1.15);if(capIdx<0)capIdx=PUTT_CAPS.length-1;
    aim=Math.atan2(H.pin.x-b.x,-(H.pin.z-b.z));
  } else {
    let pick=-1;
    for(let i=CLUBS.length-2;i>=0;i--){const c=CLUBS[i];if(c.id==='DR'&&b.lie!=='tee')continue;const [lf]=lieFactor(c,b.lie);if(c.carry*lf+c.roll*0.6>=d){pick=i;break;}}
    if(pick<0)pick=b.lie==='tee'?0:1;
    clubIdx=pick;
    const c=CLUBS[pick],[lf]=lieFactor(c,b.lie);
    if(c.carry*lf+c.roll>=d*0.97)aim=Math.atan2(H.pin.x-b.x,-(H.pin.z-b.z));
    else{const {s}=pathDist(H,b.x,b.z);const p=pointAt(H,s+c.carry*lf);aim=Math.atan2(p.x-b.x,-(p.z-b.z));}
  }
  shape=0;spin=0;drawShape();updateAimVisuals();updateHUD();
}
function updateAimVisuals(){
  const r=me();
  const show=canPlay()&&swing.state!=='flight';
  aimLine.visible=landRing.visible=show;
  if(!show)return;
  const b=r.b;const c=CLUBS[clubIdx];
  let pts=[];
  if(c.id==='PT'){
    const L=PUTT_CAPS[capIdx],dx=Math.sin(aim),dz=-Math.cos(aim);
    for(let t=0;t<=L;t+=0.25){const x=b.x+dx*t,z=b.z+dz*t;pts.push(new THREE.Vector3(x,height(H,x,z)+0.03,z));}
    const e=pts[pts.length-1];landRing.position.set(e.x,e.y+0.02,e.z);landRing.scale.setScalar(0.25);
  } else {
    const pf=previewFlight(H,b,c,aim,spin);
    pts=pf.pts.map(p=>new THREE.Vector3(p[0],p[1],p[2]));
    landRing.position.set(pf.land.x,pf.land.y+0.08,pf.land.z);landRing.scale.setScalar(1);
  }
  aimLine.geometry.dispose();aimLine.geometry=new THREE.BufferGeometry().setFromPoints(pts);aimLine.computeLineDistances();
}

/* ======================= turn logic ======================= */
const isOnline=pid=>pid===PID||(Date.now()-(online[pid]||0)<16000);
function playersOnHole(h){return Object.values(recs).filter(r=>r.hole===h&&!r.done&&!r.b.holed);}
function turnQueue(h){
  const hole=course.holes[h];
  const list=playersOnHole(h).filter(r=>isOnline(r.pid));
  const prevScore=r=>h>0&&r.sc[h-1]!=null?r.sc[h-1]:99;
  list.sort((a,b)=>{
    const da=Math.hypot(hole.pin.x-a.b.x,hole.pin.z-a.b.z),db=Math.hypot(hole.pin.x-b.b.x,hole.pin.z-b.b.z);
    if(a.b.n===0&&b.b.n===0)return (prevScore(a)-prevScore(b))||(a.joined-b.joined);
    return (db-da)||(a.joined-b.joined);
  });
  return list;
}
function canPlay(){
  const r=me();
  if(!r||spectator||r.done||r.b.holed||r.hole!==viewHole||anims.length||replaying||flyover)return false;
  if(swing.state==='flight')return false;
  return myTurn()||readyOverride;
}
function myTurn(){const q=turnQueue(me().hole);return !q.length||q[0].pid===PID;}

/* ======================= swing input ======================= */
const swing={mode:store.get('golf-swing')==='meter'?'meter':'drag',state:'idle',pos:0,power:0,err:0};
const meterC=$('#meter'),mctx=meterC.getContext('2d');
function drawMeter(){
  const W=meterC.width,Hh=meterC.height;mctx.clearRect(0,0,W,Hh);
  const x0=40,span=W-60,X=v=>x0+v*span/1.1;
  mctx.fillStyle='rgba(0,0,0,.45)';mctx.fillRect(0,4,W,Hh-8);
  const pw=swing.state==='idle'?0:swing.state==='up'||swing.state==='back'?swing.pos:swing.power;
  const g=mctx.createLinearGradient(X(0),0,X(1.1),0);g.addColorStop(0,'#3ccf7a');g.addColorStop(0.75,'#f2c14e');g.addColorStop(0.92,'#f2c14e');g.addColorStop(1,'#ff6b5e');
  mctx.fillStyle=g;mctx.fillRect(X(0),8,Math.max(0,X(pw)-X(0)),Hh-16);
  mctx.fillStyle='rgba(255,255,255,.85)';for(const v of [0.25,0.5,0.75,1]){mctx.fillRect(X(v)-1,4,2,Hh-8);}
  mctx.fillStyle='#ff6b5e';mctx.fillRect(X(1)+1,4,X(1.1)-X(1)-1,3);
  // accuracy zone
  mctx.fillStyle='rgba(255,255,255,.25)';mctx.fillRect(X(-0.03),4,X(0.03)-X(-0.03),Hh-8);
  mctx.fillStyle='#fff';mctx.fillRect(X(0)-1,2,2,Hh-4);
  if(swing.state==='up'||swing.state==='down'){mctx.fillStyle='#fff';const x=X(swing.pos);mctx.beginPath();mctx.moveTo(x,0);mctx.lineTo(x-5,-1);mctx.lineTo(x+5,-1);mctx.fill();mctx.fillRect(x-1.5,0,3,Hh);}
  mctx.fillStyle='#fff';mctx.font='bold 12px system-ui';mctx.textBaseline='middle';
  const c=CLUBS[clubIdx];
  const val=c.id==='PT'?ft(PUTT_CAPS[capIdx]*Math.min(pw||0,1.1)):Math.round((pw||0)*100)+'%';
  mctx.textAlign='left';mctx.fillText(val,4,Hh/2);
}
function setHint(){
  let t='';
  if(!canPlay())t='';
  else if(swing.mode==='meter')t=swing.state==='idle'?'Space or click: start · click to set power · click on the white line for accuracy':swing.state==='up'?'Click to set power':'Click on the white line!';
  else t=swing.state==='idle'?'Drag the mouse DOWN to swing back, then push UP straight and quickly':swing.state==='back'?'Now push up through the ball…':'';
  $('#swingHint').textContent=t;
}
$('#modeBtn').onclick=()=>{swing.mode=swing.mode==='drag'?'meter':'drag';store.set('golf-swing',swing.mode);$('#modeBtn').textContent='Swing: '+(swing.mode==='drag'?'Drag':'Meter');swing.state='idle';setHint();drawMeter();};
$('#modeBtn').textContent='Swing: '+(swing.mode==='drag'?'Drag':'Meter');
function meterClick(){
  if(!canPlay())return;
  if(swing.state==='idle'){swing.state='up';swing.pos=0;}
  else if(swing.state==='up'){swing.power=swing.pos;swing.state='down';}
  else if(swing.state==='down'){strike(swing.power,-swing.pos/0.06);}
  setHint();
}
let drag=null;
canvas.addEventListener('pointerdown',e=>{
  if(e.button===2){rotDrag={x:e.clientX,aim};canvas.setPointerCapture(e.pointerId);return;}
  if(flyover){flyover=null;return;}
  if(!canPlay())return;
  if(swing.mode==='meter'){meterClick();return;}
  drag={x0:e.clientX,y0:e.clientY,max:0,fwd:false,xs:[],t:0};swing.state='back';swing.pos=0;canvas.setPointerCapture(e.pointerId);setHint();
});
let rotDrag=null;
canvas.addEventListener('pointermove',e=>{
  if(rotDrag){aim=rotDrag.aim+(e.clientX-rotDrag.x)*0.0025*(isPutter()?0.35:1);updateAimVisuals();updateHUD();return;}
  if(!drag)return;
  const pull=(e.clientY-drag.y0)/(window.innerHeight*0.25);
  if(!drag.fwd){
    swing.pos=clamp(pull,0,1.12);drag.max=Math.max(drag.max,swing.pos);
    if(drag.max>0.04&&swing.pos<drag.max-0.04){drag.fwd=true;drag.t=performance.now();drag.xs=[];drag.xb=e.clientX;}
  } else {
    drag.xs.push(e.clientX-drag.xb);
    if(e.clientY<=drag.y0){
      const tempo=(performance.now()-drag.t)/1000;
      const dev=drag.xs.reduce((a,b)=>a+b,0)/Math.max(1,drag.xs.length)/(window.innerWidth*0.04);
      let power=drag.max,err=dev;
      if(tempo>0.45){power*=0.9;err+=0.4*Math.sign(dev||1);toast('Slow tempo – swing through faster');}
      drag=null;strike(power,err);
    }
  }
  drawMeter();
});
canvas.addEventListener('pointerup',()=>{if(rotDrag){rotDrag=null;return;}if(drag){drag=null;swing.state='idle';setHint();drawMeter();}});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
const keys={};
window.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'){if(e.key==='Escape')e.target.blur();return;}
  keys[e.key]=true;
  if(e.key===' '){e.preventDefault();if(flyover){flyover=null;return;}if(anims.length&&animSkippable()){skipAnims();return;}if(swing.mode==='meter')meterClick();}
  if(e.key==='Tab'){e.preventDefault();showScorecard();}
  if(e.key==='Enter'){openChat(true);$('#chatIn').focus();}
  if(e.key==='v'||e.key==='V'){camMode=camMode==='overhead'?'address':'overhead';}
  if(!canPlay()||swing.state!=='idle')return;
  if(e.key==='ArrowUp'||e.key==='w'||e.key==='W'){e.preventDefault();changeClub(-1);}
  if(e.key==='ArrowDown'||e.key==='s'||e.key==='S'){e.preventDefault();changeClub(1);}
});
window.addEventListener('keyup',e=>{keys[e.key]=false;});
function changeClub(d){
  const r=me();
  if(isPutter()&&d!==0){const n=capIdx+(d<0?1:-1);if(n>=0&&n<PUTT_CAPS.length){capIdx=n;updateAimVisuals();updateHUD();return;}if(n<0)return;}
  let n=clubIdx+d;
  if(n<0||n>=CLUBS.length)return;
  if(CLUBS[n].id==='DR'&&r.b.lie!=='tee'&&d<0){toast('Driver off the deck – hard to hit (−10%)');}
  clubIdx=n;if(isPutter())capIdx=Math.max(0,PUTT_CAPS.findIndex(c=>c>=distToPin(r.b)*1.15));if(capIdx<0)capIdx=PUTT_CAPS.length-1;
  updateAimVisuals();updateHUD();
}
$('#clubPrev').onclick=()=>changeClub(1);
$('#clubNext').onclick=()=>changeClub(-1);
// shape widget
const shC=$('#shape'),shx=shC.getContext('2d');
function drawShape(){
  shx.clearRect(0,0,54,54);const g=shx.createRadialGradient(20,18,3,27,27,26);g.addColorStop(0,'#fff');g.addColorStop(1,'#c2c7cc');
  shx.beginPath();shx.arc(27,27,25,0,Math.PI*2);shx.fillStyle=g;shx.fill();
  shx.strokeStyle='rgba(0,0,0,.18)';shx.beginPath();shx.moveTo(27,3);shx.lineTo(27,51);shx.moveTo(3,27);shx.lineTo(51,27);shx.stroke();
  shx.beginPath();shx.arc(27-shape*17,27-spin*17,4.5,0,Math.PI*2);shx.fillStyle='#e53935';shx.fill();
  const h=shape<-0.15?'draw':shape>0.15?'fade':'',v=spin>0.15?'high spin':spin<-0.15?'low spin':'';
  $('#shapeTxt').textContent=[h,v].filter(Boolean).join(' · ')||'straight';
}
// clicking right of center = fade (ball curves right): marker drawn mirrored like hitting the left side of the ball
shC.addEventListener('click',e=>{const r=shC.getBoundingClientRect();let x=((e.clientX-r.left)/r.width*54-27)/17,y=((e.clientY-r.top)/r.height*54-27)/17;const m=Math.hypot(x,y);if(m>1){x/=m;y/=m;}shape=-Math.round(x*100)/100;spin=-Math.round(y*100)/100;drawShape();updateAimVisuals();});
shC.addEventListener('dblclick',()=>{shape=0;spin=0;drawShape();updateAimVisuals();});

/* ======================= striking & results ======================= */
function strike(power,err){
  const r=me();if(!r)return;
  swing.state='flight';swing.power=power;setHint();drawMeter();
  if(power>1)err*=1+(power-1)*10;
  err=clamp(err,-3,3);
  const c=CLUBS[clubIdx];
  const b={...r.b};
  const res=shoot(H,b,{club:c,aim,power,err,shape,spin,wind:H.wind.v,cap:PUTT_CAPS[capIdx]});
  snd(c.id==='PT'?'putt':'hit',Math.min(1,power));
  readyOverride=false;
  const compact=compactPath(res.path);
  const startDist=distToPin(b);
  // update record
  r.prev={x:b.x,y:b.y,z:b.z,lie:b.lie};
  r.b.n+=1;
  let note='';
  if(res.result==='water'){r.b.n+=1;Object.assign(r.b,{x:res.drop.x,y:res.drop.y,z:res.drop.z,lie:res.drop.lie});note='Water hazard – penalty stroke, drop taken';}
  else if(res.result==='ob'){r.b.n+=1;note='Out of bounds – stroke and distance';}
  else{Object.assign(r.b,{x:res.end.x,y:res.end.y,z:res.end.z,lie:res.lie});}
  if(res.result==='holed'){r.b.holed=true;r.sc[r.hole]=r.b.n;}
  else if(r.b.n>=MAX_STROKES){r.b.holed=true;r.sc[r.hole]=MAX_STROKES;note=(note?note+'. ':'')+`Picked up at ${MAX_STROKES}`;}
  r.paths=r.paths||{};
  const hk=String(r.hole);r.paths[hk]=r.paths[hk]||[];r.paths[hk].push(compact);
  for(const k of Object.keys(r.paths))if(+k<r.hole-1)delete r.paths[k];
  const text=shotText(r,c,res,startDist,note);
  publishMe();
  net&&net.publish('ev',{t:'shot',pid:PID,hole:r.hole,path:compact,res:res.result,text});
  playShot(PID,compact,res.result,()=>{
    swing.state='idle';
    addFeed(text);
    if(note)toast(note);
    afterMyShot(res);
  });
}
function shotText(r,c,res,startDist,note){
  const nm=esc(r.name);
  if(res.result==='holed'){const sc=r.sc[r.hole],par=course.holes[r.hole].par;return `<b>${nm}</b> holes out – ${scoreName(sc,par)} (${sc}) on #${r.hole+1}`;}
  if(c.id==='PT')return `<b>${nm}</b> putts from ${ft(startDist)} – ${ft(distToPinXZ(r.hole,r.b))} left`;
  const where=res.result==='water'?'into the water':res.result==='ob'?'out of bounds':`${LIE_NAME[res.lie]||''}, ${distTxt(distToPinXZ(r.hole,r.b),res.lie==='green')} to the pin`;
  return `<b>${nm}</b> · ${c.name} ${Math.round(res.total)} yds → ${where}`;
}
function distToPinXZ(h,b){const p=course.holes[h].pin;return Math.hypot(p.x-b.x,p.z-b.z);}
function scoreName(s,par){
  if(s===1)return 'Hole in one!';
  const d=s-par;return ({'-3':'Albatross','-2':'Eagle','-1':'Birdie','0':'Par','1':'Bogey','2':'Double bogey','3':'Triple bogey'})[d]||(d>0?`+${d}`:`${d}`);
}
function afterMyShot(res){
  const r=me();
  if(r.b.holed){
    const sc=r.sc[r.hole],par=H.par;
    if(res.result==='holed'){snd('cup');showBanner(scoreName(sc,par),`${sc} strokes on hole ${r.hole+1}`);}
    showNext();
  } else {setupShot();}
  updateHUD();
}
function showBanner(t,sub){const b=$('#banner');b.innerHTML=esc(t)+(sub?`<small>${esc(sub)}</small>`:'');b.classList.add('show');clearTimeout(showBanner.t);showBanner.t=setTimeout(()=>b.classList.remove('show'),3200);}
function showNext(){
  const r=me();
  const last=r.hole>=nHoles()-1;
  $('#nextTxt').textContent=last?'That\'s the round!':`Hole ${r.hole+1} done (${r.sc[r.hole]}).`;
  $('#nextBtn').textContent=last?'Finish round 🏁':`Tee off on hole ${r.hole+2} ▶`;
  $('#nextBox').hidden=false;$('#swing').hidden=true;
}
$('#nextBtn').onclick=()=>{
  const r=me();$('#nextBox').hidden=true;$('#swing').hidden=false;
  if(r.hole>=nHoles()-1){r.done=true;publishMe();updateHUD();showScorecard(true);return;}
  r.hole++;r.b=teeBall(r.hole);r.prev=null;publishMe();
  enterHole(r.hole,true);
};
function teeBall(h){const hh=course.holes[h];return {x:0,y:height(hh,0,0),z:0,lie:'tee',n:0,holed:false};}

/* ======================= animation ======================= */
let anims=[];     // {pid,path,t,dur,onDone,mesh}
let replaying=null;
function compactPath(p){
  const step=Math.max(1,Math.ceil(p.length/90));const out=[];
  for(let i=0;i<p.length;i+=step)out.push(p[i]);
  if(out[out.length-1]!==p[p.length-1])out.push(p[p.length-1]);
  return out.map(q=>[Math.round(q[0]*10),Math.round(q[1]*100),Math.round(q[2]*10),Math.round(q[3]*100)]).flat();
}
function expandPath(c){const out=[];for(let i=0;i<c.length;i+=4)out.push([c[i]/10,c[i+1]/100,c[i+2]/10,c[i+3]/100]);return out;}
function playShot(pid,compact,result,onDone){
  const path=expandPath(compact);
  const mesh=ballMesh(pid);
  anims.push({pid,path,t:0,dur:path[path.length-1][3],onDone,mesh,result,own:pid===PID});
  if(aimLine){aimLine.visible=false;landRing.visible=false;}
  camMode='follow';followPid=pid;
  $('#skipBtn').style.display='block';
}
function animSkippable(){return true;}
function skipAnims(){if(replaying)replaying.skip=true;for(const a of anims)a.t=a.dur;}
$('#skipBtn').onclick=skipAnims;
function stepAnims(dt){
  if(!anims.length)return;
  const a=anims[0];
  const flightEnd=a.path.findIndex((p,i)=>i>0&&p[3]>0&&i<a.path.length-1&&Math.abs(p[1]-height(H,p[0],p[2])-0.05)<0.02);
  const speed=a.t>(a.path[flightEnd>0?flightEnd:0][3]||0)?1.6:1.15;
  a.t+=dt*speed*(replaying?2.2:1);
  const p=samplePath(a.path,Math.min(a.t,a.dur));
  a.mesh.position.set(p[0],p[1],p[2]);
  if(a.t>=a.dur){
    anims.shift();
    if(a.result==='water'){snd('splash');}
    if(a.result==='holed'&&!a.own)snd('cup');
    if(!anims.length)$('#skipBtn').style.display='none';
    a.onDone&&a.onDone();
    if(!anims.length&&!replaying){camMode='address';placeBalls();updateAimVisuals();updateHUD();}
  }
}
function samplePath(p,t){
  let i=1;while(i<p.length-1&&p[i][3]<t)i++;
  const a=p[i-1],b=p[i],k=clamp((t-a[3])/((b[3]-a[3])||1),0,1);
  return [a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];
}
function placeBalls(){
  if(!H)return;
  const animating=new Set(anims.map(a=>a.pid));
  for(const pid in recs){
    const r=recs[pid];
    if(animating.has(pid))continue;
    const show=r.hole===viewHole&&!r.done&&!r.b.holed&&!replaying;
    if(!show){if(balls[pid]){balls[pid].visible=false;balls[pid].userData.shadow.visible=false;}continue;}
    const m=ballMesh(pid);m.visible=true;m.userData.shadow.visible=true;m.position.set(r.b.x,height(H,r.b.x,r.b.z)+0.05,r.b.z);
  }
}

/* ======================= camera ======================= */
let camMode='address',followPid=null,flyover=null;
const camPos=new THREE.Vector3(0,10,20),camLook=new THREE.Vector3();
function enterHole(h,withFlyover){
  buildHole(h);
  placeBalls();
  if(withFlyover){flyover={t:0,dur:5.5};}
  camMode='address';snapCam=true;
  readyOverride=false;
  setupShot();updateHUD();
}
let snapCam=true;
function focusBall(){
  const r=me();
  if(r&&r.hole===viewHole&&!r.done&&!r.b.holed)return r.b;
  // otherwise whoever is up on this hole
  const q=turnQueue(viewHole);if(q.length)return q[0].b;
  const any=playersOnHole(viewHole);if(any.length)return any[0].b;
  return {x:H.pin.x,y:height(H,H.pin.x,H.pin.z),z:H.pin.z,lie:'green'};
}
function updateCamera(dt){
  const want=new THREE.Vector3(),look=new THREE.Vector3();
  if(flyover){
    flyover.t+=dt;const u=clamp(flyover.t/flyover.dur,0,1);const e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;
    const s=e*H.len;const p=pointAt(H,s),p2=pointAt(H,Math.min(H.len,s+70));
    want.set(p.x-Math.sin(p.ang)*30,height(H,p.x,p.z)+38-e*14,p.z+Math.cos(p.ang)*30);
    look.set(p2.x,height(H,p2.x,p2.z),p2.z);
    if(u>=1){flyover=null;snapCam=true;}
    camPos.lerp(want,snapCam?1:0.08);camLook.lerp(look,snapCam?1:0.08);snapCam=false;
  } else if(camMode==='follow'&&anims.length){
    const a=anims[0];const bp=a.mesh.position;
    const s=a.path[0],dx=bp.x-s[0],dz=bp.z-s[2],dl=Math.hypot(dx,dz);
    const isPutt=a.path.length>1&&Math.abs(a.path[1][1]-a.path[0][1])<0.2&&a.dur<25&&dl<40&&a.path.every(p=>Math.abs(p[1]-height(H,p[0],p[2]))<0.4);
    const dir=dl>1?[dx/dl,dz/dl]:[Math.sin(aim),-Math.cos(aim)];
    if(isPutt){want.set(bp.x-dir[0]*4,bp.y+2.2,bp.z-dir[1]*4);}
    else want.set(bp.x-dir[0]*16,Math.max(bp.y,height(H,bp.x,bp.z))+6,bp.z-dir[1]*16);
    look.copy(bp);
    camPos.lerp(want,Math.min(1,dt*2.2));camLook.lerp(look,Math.min(1,dt*6));
  } else {
    const b=focusBall();const bx=b.x,bz=b.z,by=height(H,bx,bz);
    let a=aim;const r=me();
    if(!(r&&r.hole===viewHole&&!r.b.holed&&!r.done))a=Math.atan2(H.pin.x-bx,-(H.pin.z-bz));
    const d=[Math.sin(a),-Math.cos(a)];
    const putt=isPutter()&&r&&r.hole===viewHole;
    if(camMode==='overhead'){
      let tx,tz;if(landRing&&landRing.visible){tx=landRing.position.x;tz=landRing.position.z;}else{tx=H.pin.x;tz=H.pin.z;}
      const L=putt?14:45;want.set(tx-d[0]*L*0.5,height(H,tx,tz)+L,tz-d[1]*L*0.5);look.set(tx,height(H,tx,tz),tz);
    } else if(putt){want.set(bx-d[0]*3.4,by+1.25,bz-d[1]*3.4);look.set(bx+d[0]*5,by-0.2,bz+d[1]*5);}
    else{want.set(bx-d[0]*6.5,by+2.8,bz-d[1]*6.5);look.set(bx+d[0]*50,by+1,bz+d[1]*50);}
    const gy=height(H,want.x,want.z)+0.8;if(want.y<gy)want.y=gy;
    const k=snapCam?1:Math.min(1,dt*3.5);camPos.lerp(want,k);camLook.lerp(look,k);snapCam=false;
  }
  camera.position.copy(camPos);camera.lookAt(camLook);
}

/* ======================= HUD ======================= */
function updateHUD(){
  if(!course||!H)return;
  const r=me();
  $('#holeTitle').textContent=`Hole ${viewHole+1} · Par ${H.par} · ${Math.round(H.len)} yds`;
  $('#courseName').textContent=`${course.name} · course code ${cfg.seed} · ${nHoles()} holes`;
  const b=focusBall();const d=distToPin(b);
  const onG=b.lie==='green';
  $('#toPin').textContent=distTxt(d,onG);
  const mine=r&&r.hole===viewHole&&!r.done;
  $('#strokeNo').textContent=mine?(r.b.holed?r.sc[r.hole]:r.b.n+1):'–';
  $('#windTxt').textContent=H.wind.mph+' mph';
  const rel=H.wind.ang-(mine?aim:Math.atan2(H.pin.x-b.x,-(H.pin.z-b.z)));
  $('#windArrow').style.transform=`rotate(${rel}rad)`;
  $('#windArrow').style.opacity=H.wind.mph?1:0.3;
  const lie=b.lie;const c=CLUBS[clubIdx];
  let lt=LIE_NAME[lie]||lie;
  if(mine&&c.id!=='PT'){const [lf]=lieFactor(c,lie);if(lf<0.99)lt+=` (−${Math.round((1-lf)*100)}%)`;}
  $('#lieTag').textContent=lt;
  const dy=height(H,H.pin.x,H.pin.z)-height(H,b.x,b.z);
  $('#elevTxt').textContent=Math.abs(dy)>0.3?`${dy>0?'Uphill':'Downhill'} ${Math.round(Math.abs(dy)*3)} ft`:'';
  // club
  if(c.id==='PT'){$('#clubName').innerHTML=`<b>Putter</b><span>100% = ${ft(PUTT_CAPS[capIdx])} (↑/↓ to change)</span>`;}
  else{const [lf]=lieFactor(c,lie);$('#clubName').innerHTML=`<b>${c.name}</b><span>carry ${Math.round(c.carry*lf)} yds${lf<0.99?' from this lie':''}</span>`;}
  $('#swing').style.opacity=canPlay()||swing.state==='flight'?1:0.55;
  // waiting box
  const wb=$('#waitBox');
  if(r&&!spectator&&!r.done&&!r.b.holed&&r.hole===viewHole&&!myTurn()&&!readyOverride&&!anims.length){
    const q=turnQueue(viewHole);wb.hidden=false;$('#waitTxt').textContent=`${q[0].name} is away (farthest from the hole)`;
  } else if(spectator){wb.hidden=false;$('#waitTxt').textContent='Watching – this round already has 4 players';$('#readyBtn').hidden=true;}
  else wb.hidden=true;
  setHint();drawMeter();renderBoard();
  greenGrid.visible=d<45&&(onG||b.lie==='fringe'||isPutter()||d<30);
}
$('#readyBtn').onclick=()=>{readyOverride=true;updateHUD();updateAimVisuals();toast('Ready golf – you can play now');};
function toPar(r){let s=0,p=0;r.sc.forEach((v,i)=>{if(v!=null){s+=v;p+=course.holes[i].par;}});return {s,d:s-p,thru:r.sc.filter(v=>v!=null).length};}
const fmtPar=d=>d===0?'E':d>0?'+'+d:''+d;
function renderBoard(){
  const list=Object.values(recs).sort((a,b)=>{const A=toPar(a),B=toPar(b);return (A.d-B.d)||(B.thru-A.thru)||(a.joined-b.joined);});
  $('#boardT').innerHTML=list.map(r=>{const t=toPar(r);const on=isOnline(r.pid);
    const status=r.done?'F':r.b.holed?`thru ${t.thru}`:`#${r.hole+1} · ${r.b.n} shot${r.b.n===1?'':'s'}`;
    return `<tr><td><span class="dot" style="background:${SLOT_COL[r.slot]}"></span></td><td>${esc(r.name)}${r.pid===PID?' <span style="color:var(--muted)">(you)</span>':''}<div class="st" style="text-align:left">${on?'● online':'○ away'}</div></td><td class="tp">${t.thru?fmtPar(t.d):'–'}</td><td class="st">${status}</td></tr>`;}).join('')||'<tr><td style="color:var(--muted)">No players yet</td></tr>';
}
function addFeed(html){const d=document.createElement('div');d.innerHTML=html;$('#feed').prepend(d);setTimeout(()=>d.remove(),9200);while($('#feed').children.length>5)$('#feed').lastChild.remove();sysChat(html.replace(/<[^>]+>/g,''));}

/* ======================= minimap ======================= */
const mini=$('#mini'),mx=mini.getContext('2d');let miniBase=null,miniT=null;
const MINI_COL={tee:'#5aa646',fairway:'#61b04a',green:'#86d466',fringe:'#5fae49',rough:'#3f8b36',deep:'#2c6328',sand:'#ead9a2',water:'#3f86c0',ob:'#1f3f1d'};
function drawMiniBase(){
  const W=mini.width,Hh=mini.height;const ang=Math.atan2(H.green.x,-H.green.z);
  const ux=Math.sin(ang),uz=-Math.cos(ang),rx=Math.cos(ang),rz=Math.sin(ang);
  const scale=(Hh-30)/(H.len+30);
  miniT={toMap:(x,z)=>{const a=x*ux+z*uz,l=x*rx+z*rz;return [W/2+l*scale,Hh-15-a*scale];},
    toWorld:(px,py)=>{const l=(px-W/2)/scale,a=(Hh-15-py)/scale;return [ux*a+rx*l,uz*a+rz*l];}};
  const img=mx.createImageData(W,Hh);
  for(let y=0;y<Hh;y++)for(let x=0;x<W;x++){const [wx,wz]=miniT.toWorld(x+0.5,y+0.5);const s=surface(H,wx,wz);const c=new THREE.Color(MINI_COL[s]);const k=(y*W+x)*4;img.data[k]=c.r*255;img.data[k+1]=c.g*255;img.data[k+2]=c.b*255;img.data[k+3]=255;}
  miniBase=document.createElement('canvas');miniBase.width=W;miniBase.height=Hh;const bx=miniBase.getContext('2d');bx.putImageData(img,0,0);
  for(const t of H.trees){const [px,py]=miniT.toMap(t.x,t.z);bx.fillStyle='rgba(20,60,20,.85)';bx.beginPath();bx.arc(px,py,Math.max(1.2,t.r*scale),0,Math.PI*2);bx.fill();}
}
function drawMini(){
  if(!miniBase)return;mx.drawImage(miniBase,0,0);
  const [px,py]=miniT.toMap(H.pin.x,H.pin.z);mx.fillStyle='#e53935';mx.fillRect(px-1,py-9,2,9);mx.beginPath();mx.moveTo(px+1,py-9);mx.lineTo(px+7,py-7);mx.lineTo(px+1,py-5);mx.fill();
  if(landRing&&landRing.visible){const b=me().b;const [ax,ay]=miniT.toMap(b.x,b.z),[lx,ly]=miniT.toMap(landRing.position.x,landRing.position.z);mx.strokeStyle='rgba(255,255,255,.9)';mx.setLineDash([3,3]);mx.beginPath();mx.moveTo(ax,ay);mx.lineTo(lx,ly);mx.stroke();mx.setLineDash([]);mx.beginPath();mx.arc(lx,ly,3,0,Math.PI*2);mx.stroke();}
  for(const pid in balls){const m=balls[pid];if(!m.visible)continue;const [bx,by]=miniT.toMap(m.position.x,m.position.z);mx.fillStyle=SLOT_COL[(recs[pid]||{}).slot||0];mx.strokeStyle='#000';mx.beginPath();mx.arc(bx,by,3.5,0,Math.PI*2);mx.fill();mx.stroke();}
  mx.fillStyle='rgba(0,0,0,.5)';mx.fillRect(0,0,mini.width,16);mx.fillStyle='#fff';mx.font='bold 10px system-ui';mx.fillText(`#${viewHole+1}  Par ${H.par}`,6,11);
}
mini.addEventListener('click',e=>{
  if(!canPlay()||!miniT)return;const r=mini.getBoundingClientRect();const [wx,wz]=miniT.toWorld((e.clientX-r.left)*mini.width/r.width,(e.clientY-r.top)*mini.height/r.height);
  const b=me().b;aim=Math.atan2(wx-b.x,-(wz-b.z));
  if(!isPutter()){const d=Math.hypot(wx-b.x,wz-b.z);let best=clubIdx,bd=1e9;for(let i=0;i<CLUBS.length-1;i++){const c=CLUBS[i];if(c.id==='DR'&&b.lie!=='tee')continue;const [lf]=lieFactor(c,b.lie);const dd=Math.abs(c.carry*lf-d);if(dd<bd){bd=dd;best=i;}}clubIdx=best;}
  updateAimVisuals();updateHUD();
});

/* ======================= labels ======================= */
const labelEls={};
function updateLabels(){
  const v=new THREE.Vector3();
  for(const pid in recs){
    let el=labelEls[pid];if(!el){el=document.createElement('div');el.className='lbl3d';$('#labels').appendChild(el);labelEls[pid]=el;}
    const m=balls[pid];
    if(!m||!m.visible||pid===PID&&!anims.some(a=>a.pid===PID)&&camMode!=='overhead'){el.style.display='none';continue;}
    v.copy(m.position);v.y+=0.3;v.project(camera);
    if(v.z>1||Math.abs(v.x)>1.1||Math.abs(v.y)>1.1){el.style.display='none';continue;}
    el.style.display='block';el.style.left=((v.x+1)/2*window.innerWidth)+'px';el.style.top=((1-v.y)/2*window.innerHeight)+'px';
    el.style.color=SLOT_COL[recs[pid].slot];el.textContent=recs[pid].name;
  }
}

/* ======================= main loop ======================= */
let last=performance.now(),aimTick=0;
function frame(now){
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  if(H){
    // swing meter motion
    if(swing.mode==='meter'&&(swing.state==='up'||swing.state==='down')){
      const pt=isPutter();
      if(swing.state==='up'){swing.pos+=dt*(pt?0.75:0.95);if(swing.pos>=1.12){swing.power=1.12;swing.state='down';}}
      else{swing.pos-=dt*(pt?1.0:1.35);if(swing.pos<-0.3){strike(swing.power,3);}}
      drawMeter();
    }
    // continuous aim keys
    if(canPlay()&&swing.state==='idle'){
      const L=keys.ArrowLeft||keys.a||keys.A,R=keys.ArrowRight||keys.d||keys.D;
      if(L||R){const rate=(isPutter()?0.12:0.35)*(keys.Shift?0.2:1);aim+=(R?1:-1)*rate*dt;aimTick+=dt;if(aimTick>0.05){aimTick=0;updateAimVisuals();updateHUD();}}
    }
    stepAnims(dt);
    // ball scale & shadows
    for(const pid in balls){const m=balls[pid];const d=m.position.distanceTo(camera.position);const s=Math.max(1,d/14);m.userData.ball.scale.setScalar(s);
      const sh=m.userData.shadow;sh.visible=m.visible;sh.position.set(m.position.x,height(H,m.position.x,m.position.z)+0.02,m.position.z);sh.scale.setScalar(s);}
    if(landRing&&landRing.visible){const d=landRing.position.distanceTo(camera.position);if(!isPutter())landRing.scale.setScalar(Math.max(1,d/60));}
    updateCamera(dt);
    flagGroup.children[1].rotation.y=Math.sin(now/400)*0.15;
    drawMini();updateLabels();
  }
  renderer.render(scene,camera);
  requestAnimationFrame(frame);
}

/* ======================= networking ======================= */
function cacheKey(){return 'golf-g-'+gid;}
let saveT;function saveCache(){clearTimeout(saveT);saveT=setTimeout(()=>store.set(cacheKey(),JSON.stringify({recs,chat:chat.slice(-80)})),300);}
function publishMe(){const r=me();if(!r)return;r.ver=(r.ver||0)+1;r.ts=Date.now();if(net)net.publish('p/'+PID,JSON.parse(JSON.stringify(r)),true);saveCache();renderBoard();}
function onRecord(pid,d){
  delete d.m;
  if(!d.pid||d.pid!==pid)return;
  const cur=recs[pid];
  if(cur&&cur.ver>=d.ver)return;
  if(pid===PID&&cur){ // newer copy of my own record (another device) – adopt it
    recs[pid]=d;if(d.hole!==viewHole)enterHole(d.hole,false);else{placeBalls();setupShot();}
    return;
  }
  recs[pid]=d;
  if(!anims.some(a=>a.pid===pid))placeBalls();
  saveCache();renderBoard();updateHUD();
}
function onMessage(sub,d){
  if(sub.startsWith('p/')){onRecord(sub.slice(2),d);return;}
  if(sub==='hb'){if(d.pid&&d.pid!==PID){const was=isOnline(d.pid);online[d.pid]=Date.now();if(!was){renderBoard();updateHUD();}}return;}
  if(sub==='ev'&&d.t==='shot'&&d.pid!==PID){
    online[d.pid]=Date.now();
    const r=recs[d.pid];
    if(H&&d.hole===viewHole&&!replaying){
      playShot(d.pid,d.path,d.res,()=>{addFeed(d.text);placeBalls();updateHUD();});
    } else addFeed(d.text);
    return;
  }
  if(sub==='chat'&&d.text){
    online[d.pid]=Date.now();
    chat.push({pid:d.pid,name:String(d.name||'').slice(0,16),slot:d.slot||0,text:String(d.text).slice(0,300),ts:Date.now()});saveCache();renderChat();
    if(d.pid!==PID){snd('chat');if($('#chat').classList.contains('closed')){unread++;$('#unread').textContent=unread;$('#unread').style.display='inline';}}
  }
}
function netStatus(){
  if(!net)return;const n=net.live(),t=net.total();
  $('#netBadge').textContent=n?`● connected · ${n}/${t} servers`:'○ connecting to game servers…';
  $('#netBadge').style.color=n?'var(--green)':'var(--red)';
}
setInterval(()=>{if(net&&gid){net.publish('hb',{pid:PID,name:myName});}if(H){renderBoard();updateHUD();}},5000);

/* ======================= chat ======================= */
let unread=0;
function openChat(open){$('#chat').classList.toggle('closed',!open);$('#chatToggle').textContent=open?'▾':'▴';if(open){unread=0;$('#unread').style.display='none';const l=$('#chatLog');l.scrollTop=l.scrollHeight;}}
$('#chatHead').onclick=()=>openChat($('#chat').classList.contains('closed'));
function sysChat(text){chat.push({sys:1,text,ts:Date.now()});renderChat();}
function renderChat(){
  const l=$('#chatLog');const atB=l.scrollHeight-l.scrollTop-l.clientHeight<30;
  l.innerHTML=chat.slice(-80).map(m=>m.sys?`<div class="sys">${esc(m.text)}</div>`:`<div><b style="color:${SLOT_COL[m.slot||0]}">${esc(m.name)}:</b> ${esc(m.text)}</div>`).join('');
  if(atB)l.scrollTop=l.scrollHeight;
}
$('#chatForm').onsubmit=e=>{e.preventDefault();const v=$('#chatIn').value.trim();if(!v)return;const r=me();
  if(!net||!net.publish('chat',{pid:PID,name:myName,slot:r?r.slot:0,text:v}))toast('Not connected right now');$('#chatIn').value='';$('#chatIn').blur();};

/* ======================= scorecard / modals ======================= */
function showModal(html){$('#mbox').innerHTML=html;$('#modal').hidden=false;}
function hideModal(){$('#modal').hidden=true;}
$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')hideModal();});
function showScorecard(final){
  const n=nHoles();const list=Object.values(recs).sort((a,b)=>a.joined-b.joined);
  let h='<table class="sc"><tr><th>Hole</th>'+course.holes.map((_,i)=>`<th>${i+1}</th>`).join('')+'<th>Tot</th><th>±</th></tr>';
  h+='<tr><th>Par</th>'+course.holes.map(x=>`<th>${x.par}</th>`).join('')+`<th>${course.par}</th><th></th></tr>`;
  for(const r of list){
    h+=`<tr><td class="nm"><span style="color:${SLOT_COL[r.slot]}">●</span> ${esc(r.name)}</td>`;
    for(let i=0;i<n;i++){const v=r.sc[i];const par=course.holes[i].par;let cls='';if(v!=null){const d=v-par;cls=d<=-2?'s-eagle':d===-1?'s-birdie':d===1?'s-bogey':d>=2?'s-dbl':'';}
      const canReplay=r.paths&&r.paths[String(i)]&&r.paths[String(i)].length;
      h+=`<td><span class="${cls}" style="display:inline-block;min-width:20px">${v!=null?v:(r.hole===i&&!r.done?'·':'')}</span>${canReplay?`<button class="replay" data-pid="${r.pid}" data-h="${i}" title="Watch replay">▶</button>`:''}</td>`;}
    const t=toPar(r);h+=`<td><b>${t.s||''}</b></td><td><b>${t.thru?fmtPar(t.d):''}</b></td></tr>`;
  }
  h+='</table>';
  const done=list.length&&list.every(r=>r.done);
  let title=final?'🏁 Round complete!':'Scorecard';
  if(done){const best=[...list].sort((a,b)=>toPar(a).d-toPar(b).d)[0];title=`🏆 ${esc(best.name)} wins at ${fmtPar(toPar(best).d)}!`;}
  showModal(`<h2>${title}</h2><p>${esc(course.name)} · course code ${cfg.seed}. ▶ buttons replay a player's shots on their most recent holes.</p>${h}
    <div class="row" style="justify-content:flex-end">${final||done?'<button id="newRound">New round, same group</button>':''}<button class="primary" id="closeM">Close</button></div>`);
  $('#closeM').onclick=hideModal;
  document.querySelectorAll('.replay').forEach(b=>b.onclick=()=>{hideModal();startReplay(b.dataset.pid,+b.dataset.h);});
  const nr=$('#newRound');if(nr)nr.onclick=()=>{location.href=location.href.split('#')[0];};
}
$('#cardBtn').onclick=()=>showScorecard();
function startReplay(pid,h){
  const r=recs[pid];const ps=r&&r.paths&&r.paths[String(h)];if(!ps)return;
  replaying={pid,h};
  if(viewHole!==h)buildHole(h);
  for(const k in balls)balls[k].visible=false;
  let i=0;
  const next=()=>{
    if(i>=ps.length||(replaying&&replaying.skip)){replaying=null;const m=me();enterHole(m&&!m.done?m.hole:h,false);return;}
    const c=ps[i++];playShot(pid,c,'ok',next);
  };
  addFeed(`Replay: <b>${esc(r.name)}</b> on hole ${h+1}`);
  next();
}
function showInvite(){
  const link=location.href.split('#')[0]+'#g='+gid+'.'+cfg.seed+'.'+cfg.holes;
  const msg=`⛳ Join my round of golf (${nHoles()} holes at ${course.name}) – play live with me or whenever you're free, no sign-in: ${link}`;
  showModal(`<h2>Invite friends (up to 4 players)</h2><p>Paste this into Google Chat. Anyone with the link can join until the group has 4 players. They can play live with you, or take their shots later – the round waits for them.</p>
    <input type="text" readonly id="linkBox" value="${esc(link)}">
    <div class="row"><button class="primary" id="cm">Copy message + link</button><button id="cl">Copy link only</button><span class="copied"></span><span style="flex:1"></span><button id="closeM">Close</button></div>`);
  $('#linkBox').onclick=e=>e.target.select();
  const copy=async(t,btn)=>{let ok=false;try{await navigator.clipboard.writeText(t);ok=true;}catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();try{ok=document.execCommand('copy');}catch(_){}ta.remove();}btn.parentElement.querySelector('.copied').textContent=ok?'Copied!':'Select the link and copy it';};
  $('#cm').onclick=e=>copy(msg,e.target);$('#cl').onclick=e=>copy(link,e.target);$('#closeM').onclick=hideModal;
}
$('#inviteBtn').onclick=showInvite;
$('#helpBtn').onclick=()=>{showModal(`<h2>How to play</h2><ul>
<li><b>Aim:</b> ← / → (or A/D, hold Shift for fine aim), right-click drag, or click a spot on the hole map. The white arc and ring show where the ball will land with no wind.</li>
<li><b>Club:</b> ↑ / ↓ (or W/S, or the ◀ ▶ buttons). A club is picked for you each shot. Lies matter: rough, deep rough and bunkers cost distance.</li>
<li><b>Swing – Drag:</b> press and pull the mouse <i>down</i> for the backswing (more pull = more power), then push <i>up</i> quickly and straight. Drifting left or right hooks or slices the shot, and a slow forward swing loses power.</li>
<li><b>Swing – Meter:</b> press Space (or click) to start, again to set power, and a third time on the white line for accuracy. Early = hook, late = slice. Over 100% is extra distance but harder to hit straight.</li>
<li><b>Shape &amp; spin:</b> click the little ball. Left/right = draw/fade, up = high spin (stops quicker, more wind-affected), down = low spin (runs out).</li>
<li><b>Wind</b> pushes the ball, and the arrow shows which way it's blowing relative to your aim.</li>
<li><b>Putting:</b> the grid and arrows show the slope (arrows point downhill, redder = steeper). Use ↑/↓ to switch the putter's 100% distance (15/30/60/120 ft).</li>
<li><b>Penalties:</b> water = 1 stroke and a drop. Out of bounds = 1 stroke and replay from where you were. Max ${MAX_STROKES} strokes per hole.</li>
<li><b>Turns:</b> whoever is farthest from the hole (among players online on that hole) plays first. Use "Play now" to play ready golf. If friends are away, keep playing: they catch up whenever they come back.</li>
<li><b>Keys:</b> Space = meter / skip, V = overhead view, Tab = scorecard, Enter = chat.</li></ul><div class="row" style="justify-content:flex-end"><button class="primary" id="closeM">Got it</button></div>`);$('#closeM').onclick=hideModal;};

/* ======================= boot ======================= */
async function checkForUpdate(){
  try{const r=await fetch('version.json?t='+Date.now(),{cache:'no-store'});if(!r.ok)return false;const j=await r.json();
    if(j.v>APP_VERSION){const k='golf-upd-'+j.v;if(sessionStorage.getItem(k))return false;sessionStorage.setItem(k,'1');const u=new URL(location.href);u.searchParams.set('r',Date.now().toString(36));location.replace(u.toString());return true;}}catch(e){}
  return false;
}
function parseHash(){const m=location.hash.match(/^#g=([a-z0-9]+)\.(\d+)\.(3|9|18)$/i);return m?{gid:m[1],seed:+m[2],holes:+m[3]}:null;}
function remember(){
  let list=[];try{list=JSON.parse(store.get('golf-recent')||'[]');}catch(e){}
  list=list.filter(x=>x.gid!==gid);list.unshift({gid,seed:cfg.seed,holes:cfg.holes,name:course.name,ts:Date.now(),link:location.href.split('?')[0].split('#')[0]+'#g='+gid+'.'+cfg.seed+'.'+cfg.holes});
  store.set('golf-recent',JSON.stringify(list.slice(0,8)));
}
function showLobby(){
  $('#lobby').hidden=false;$('#nameIn').value=myName;
  let holes=9;
  document.querySelectorAll('#holesSeg button').forEach(b=>b.onclick=()=>{holes=+b.dataset.v;document.querySelectorAll('#holesSeg button').forEach(x=>x.classList.toggle('on',x===b));});
  let list=[];try{list=JSON.parse(store.get('golf-recent')||'[]');}catch(e){}
  if(list.length)$('#recent').innerHTML='<div style="color:var(--muted);font-size:13px;margin-bottom:4px">Your recent rounds</div>'+list.map(x=>`<div><a href="${esc(x.link)}">${esc(x.name)} · ${x.holes} holes</a> <span style="color:var(--muted);font-size:12px">${new Date(x.ts).toLocaleString()}</span></div>`).join('');
  $('#createBtn').onclick=()=>{
    const v=$('#nameIn').value.trim().slice(0,16);if(!v){toast('Enter your name first');$('#nameIn').focus();return;}
    myName=v;store.set('golf-name',v);
    const code=parseInt($('#codeIn').value.trim(),10);
    const seed=code>0?code:Math.floor(10000+Math.random()*89999);
    location.hash=`#g=${rid(8)}.${seed}.${holes}`;
  };
}
function askName(){
  return new Promise(res=>{
    const others=Object.values(recs).map(r=>r.name);
    showModal(`<h2>⛳ You're invited!</h2><p>${others.length?esc(others.join(', '))+' '+(others.length>1?'are':'is')+' playing':'A round is ready'} at ${esc(course.name)} (${nHoles()} holes). What's your name?</p>
      <input type="text" id="nm" maxlength="16" value="${esc(myName)}" placeholder="Your name"><div class="row" style="justify-content:flex-end"><button class="primary" id="ok">Join the round</button></div>`);
    const done=()=>{const v=$('#nm').value.trim().slice(0,16);if(!v){$('#nm').focus();return;}myName=v;store.set('golf-name',v);hideModal();res();};
    $('#ok').onclick=done;$('#nm').onkeydown=e=>{if(e.key==='Enter')done();};setTimeout(()=>$('#nm').focus(),50);
  });
}
async function boot(){
  if(await checkForUpdate())return;
  const c=parseHash();
  if(!c){showLobby();return;}
  if(typeof mqtt==='undefined'){document.body.innerHTML='<p style="padding:30px">Could not load the networking library. Please refresh.</p>';return;}
  gid=c.gid;cfg=c;
  $('#loading').hidden=false;
  await new Promise(r=>setTimeout(r,30));
  course=makeCourse(cfg.seed,cfg.holes);
  // cached state from last visit
  let cached=null;try{cached=JSON.parse(store.get(cacheKey())||'null');}catch(e){}
  const before={};
  if(cached){recs=cached.recs||{};chat=cached.chat||[];for(const k in recs)before[k]=JSON.parse(JSON.stringify(recs[k]));}
  net=new Net(gid,{onMessage,onStatus:netStatus,onConnect:cl=>{const r=me();if(r)net.publish('p/'+PID,JSON.parse(JSON.stringify(r)),true,cl);net.publish('hb',{pid:PID,name:myName},false,cl);}});
  net.start();netStatus();
  // give the brokers a moment to deliver everyone's saved records
  const t0=Date.now();
  while(Date.now()-t0<6000){await new Promise(r=>setTimeout(r,250));if(net.live()&&Date.now()-t0>2200)break;}
  $('#loading').hidden=true;
  $('#hud').hidden=false;renderChat();
  if(!me()){
    const n=Object.keys(recs).length;
    if(n>=4){spectator=true;}
    else{
      if(!myName||n>0)await askName();
      const used=new Set(Object.values(recs).map(r=>r.slot));let slot=0;while(used.has(slot))slot++;
      recs[PID]={pid:PID,name:myName,slot,ver:0,joined:Date.now(),hole:0,b:teeBall(0),prev:null,sc:Array(nHoles()).fill(null),done:false,paths:{}};
      publishMe();
      net.publish('chat',{pid:PID,name:myName,slot,text:'joined the round 👋'});
    }
  } else if(me().name!==myName&&myName){me().name=myName;publishMe();}
  remember();
  const r=me();
  const startHole=r?(r.done?nHoles()-1:r.hole):Math.max(0,...Object.values(recs).map(x=>Math.min(x.hole,nHoles()-1)));
  enterHole(startHole,!!r&&r.b.n===0&&!r.done&&r.hole===0&&!cached);
  if(r&&r.b.holed&&!r.done)showNext();
  if(r&&r.done)setTimeout(()=>showScorecard(true),600);
  // catch-up summary for returning players
  if(cached&&r){
    const lines=[];
    for(const pid in recs){if(pid===PID)continue;const now=recs[pid],was=before[pid];
      if(!was){lines.push(`<li><b>${esc(now.name)}</b> joined the round.</li>`);}
      const done=[];now.sc.forEach((v,i)=>{if(v!=null&&(!was||was.sc[i]==null))done.push(i);});
      if(done.length)lines.push(`<li><b>${esc(now.name)}</b>: `+done.map(i=>`#${i+1} ${scoreName(now.sc[i],course.holes[i].par)} (${now.sc[i]})${now.paths&&now.paths[String(i)]?` <button class="replay" style="display:inline" data-pid="${pid}" data-h="${i}">▶ watch</button>`:''}`).join(', ')+'</li>');
    }
    if(lines.length){showModal(`<h2>While you were away…</h2><ul>${lines.join('')}</ul><div class="row" style="justify-content:flex-end"><button class="primary" id="closeM">Keep playing</button></div>`);$('#closeM').onclick=hideModal;
      document.querySelectorAll('.replay').forEach(b=>b.onclick=()=>{hideModal();startReplay(b.dataset.pid,+b.dataset.h);});}
  }
  if(!cached&&r&&Object.keys(recs).length===1)setTimeout(showInvite,6200);
}
window.addEventListener('hashchange',()=>location.reload());
boot();
requestAnimationFrame(frame);
window.__golf={get recs(){return recs},get me(){return me()},get H(){return H},get anims(){return anims},strike:(p,e)=>strike(p,e),canPlay,setAim:a=>{aim=a;updateAimVisuals();},setClub:i=>{clubIdx=i;updateAimVisuals();updateHUD();},get club(){return CLUBS[clubIdx]},get viewHole(){return viewHole},skip:skipAnims,nextHole:()=>$('#nextBtn').click()};
