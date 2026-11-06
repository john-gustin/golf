// Shot physics (shooter-side only; others just replay the published path).
import {height,surface,slope} from './course.js';

export const G=10.73; // yd/s^2
export const CLUBS=[
  {id:'DR',name:'Driver',carry:236,roll:22,hp:32,T:6.3},
  {id:'3W',name:'3 Wood',carry:216,roll:16,hp:30,T:6.0},
  {id:'5W',name:'5 Wood',carry:201,roll:12,hp:30,T:5.8},
  {id:'4H',name:'4 Hybrid',carry:189,roll:10,hp:29,T:5.7},
  {id:'5I',name:'5 Iron',carry:178,roll:8,hp:28,T:5.5},
  {id:'6I',name:'6 Iron',carry:167,roll:6.5,hp:28,T:5.4},
  {id:'7I',name:'7 Iron',carry:156,roll:5,hp:28,T:5.3},
  {id:'8I',name:'8 Iron',carry:144,roll:4,hp:28,T:5.2},
  {id:'9I',name:'9 Iron',carry:132,roll:3,hp:28,T:5.0},
  {id:'PW',name:'Pitching Wedge',carry:118,roll:2.2,hp:27,T:4.8},
  {id:'GW',name:'Gap Wedge',carry:104,roll:1.6,hp:26,T:4.6},
  {id:'SW',name:'Sand Wedge',carry:88,roll:1.1,hp:24,T:4.3},
  {id:'LW',name:'Lob Wedge',carry:70,roll:0.6,hp:23,T:4.1},
  {id:'PT',name:'Putter'},
];
export const PUTT_CAPS=[5,10,20,40]; // yards for 100% putter power (15, 30, 60, 120 ft)
export const MU={green:0.058,fringe:0.13,fairway:0.17,tee:0.17,rough:0.42,deep:0.75,sand:1.7,water:3,ob:0.5};
const FIRM={tee:1,fairway:1,fringe:0.8,green:0.62,rough:0.33,deep:0.15,sand:0.04,water:0,ob:0.5};
export const LIE_NAME={tee:'Tee',fairway:'Fairway',fringe:'Fringe',green:'Green',rough:'Rough',deep:'Deep rough',sand:'Bunker',water:'Water',ob:'Out of bounds'};
export function lieFactor(club,lie){
  const L={tee:[1,0],fairway:[1,0],fringe:[0.97,0.05],green:[0.95,0.05],rough:[0.86,0.22],deep:[0.68,0.45],sand:[0.6,0.3]};
  let [f,d]=L[lie]||[1,0];
  if(lie==='sand'&&['GW','SW','LW'].includes(club.id)){f=0.88;d=0.18;}
  if(club.id==='DR'&&lie!=='tee'){f*=0.9;d+=0.2;}
  return [f,d];
}
function gauss(r){return Math.sqrt(-2*Math.log(Math.max(1e-9,r())))*Math.cos(2*Math.PI*r());}

// returns {path:[[x,y,z,t]...], end:{x,y,z}, result:'ok'|'holed'|'water'|'ob', drop?, carry, total, lie}
export function shoot(h,ball,o,rand=Math.random){
  if(o.club.id==='PT')return putt(h,ball,o,rand);
  const c=o.club,[lf,disp]=lieFactor(c,ball.lie);
  const p=Math.max(0.03,o.power),pc=Math.min(p,1);
  const e=o.err+gauss(rand)*disp*0.6;
  const spin=o.spin||0,shape=o.shape||0,ws=1+0.3*spin;
  const hp=c.hp*Math.pow(pc,1.4)*(1+0.22*spin)*(ball.lie==='sand'?1.08:1);
  const T=c.T*Math.pow(pc,0.55)*(1+0.08*spin);
  const dir=[Math.sin(o.aim),-Math.cos(o.aim)],right=[-dir[1],dir[0]];
  const w=o.wind||[0,0];
  const along=w[0]*dir[0]+w[1]*dir[1],cross=w[0]*right[0]+w[1]*right[1];
  let carry=c.carry*p*lf*(1+along*0.011*(hp/30)*ws);
  const startOff=e*0.035-shape*0.03;
  const curve=(shape*0.03+e*0.06)*carry;
  const drift=cross*T*0.33*(hp/30)*ws;
  const y0=ball.y;
  const path=[[ball.x,y0,ball.z,0]];
  let land=null,treeHit=false,prev=path[0];
  const N=70;
  for(let i=1;i<=N*1.8;i++){
    const u=i/N;
    const f=u<=1?carry*(u*0.55+0.45*(1-(1-u)**2)):carry*(1+0.55*(u-1));
    const yy=hp*Math.sin(Math.PI*Math.pow(u,1.3));
    const lat=startOff*f+(curve+drift)*u*u;
    const x=ball.x+dir[0]*f+right[0]*lat,z=ball.z+dir[1]*f+right[1]*lat,y=y0+yy;
    const t=u*T;
    // trees
    for(const tr of h.trees){
      const dx=x-tr.x,dz=z-tr.z;if(dx*dx+dz*dz>tr.r*tr.r)continue;
      const base=height(h,tr.x,tr.z);if(y>base+2.5&&y<base+tr.h){treeHit=true;break;}
    }
    const gy=height(h,x,z);
    if(treeHit){land={x,z,y:gy,t:t+0.6,vx:(rand()-.5)*1.5,vz:(rand()-.5)*1.5};path.push([x,y,z,t]);break;}
    if(y<=gy&&i>2){
      const py=prev[1],pg=height(h,prev[0],prev[2]);const k=(py-pg)/((py-pg)-(y-gy)||1);
      const lx=prev[0]+(x-prev[0])*k,lz=prev[2]+(z-prev[2])*k;
      land={x:lx,z:lz,y:height(h,lx,lz),t:prev[3]+(t-prev[3])*k};break;
    }
    prev=[x,y,z,t];path.push(prev);
  }
  if(!land){const l=path[path.length-1];land={x:l[0],z:l[2],y:height(h,l[0],l[2]),t:l[3]};}
  path.push([land.x,land.y+0.05,land.z,land.t]);
  const carryDist=Math.hypot(land.x-ball.x,land.z-ball.z);
  const ls=surface(h,land.x,land.z);
  if(ls==='water'||ls==='ob')return finish(h,ball,path,land,ls,carryDist);
  // roll
  let vx,vz;
  if(treeHit){vx=land.vx;vz=land.vz;}
  else{
    const fd=[dir[0]+right[0]*(startOff+2*(curve+drift)/Math.max(carry,1)),dir[1]+right[1]*(startOff+2*(curve+drift)/Math.max(carry,1))];
    const fl=Math.hypot(fd[0],fd[1]);
    let v0=Math.sqrt(2*0.17*G*c.roll*pc)*FIRM[ls]*(1-0.45*spin);
    if(ls==='green'&&['SW','LW','GW','PW'].includes(c.id)&&spin>0.4)v0=-0.6*spin; // spins back
    vx=fd[0]/fl*v0;vz=fd[1]/fl*v0;
  }
  // a couple of visual bounces
  const bh=treeHit?0:Math.min(2.4,hp*0.05*FIRM[ls]);
  const r=roll(h,land.x,land.z,vx,vz,land.t,bh);
  path.push(...r.path);
  return finish(h,ball,path,r.end,r.result,carryDist);
}

function putt(h,ball,o,rand){
  const dist=Math.max(0.2,o.power*o.cap);
  const v0=Math.sqrt(2*MU.green*G*dist);
  const a=o.aim+(o.err||0)*0.014+gauss(rand)*0.002;
  const vx=Math.sin(a)*v0,vz=-Math.cos(a)*v0;
  const r=roll(h,ball.x,ball.z,vx,vz,0,0);
  return finish(h,ball,[[ball.x,ball.y+0.05,ball.z,0],...r.path],r.end,r.result,0);
}

export function roll(h,x,z,vx,vz,t0,bounceH){
  const path=[];const dt=1/90;let t=t0,result='ok',lastDry={x,z};
  const sp0=Math.hypot(vx,vz);
  const bounceDur=bounceH>0?Math.sqrt(8*bounceH/G):0;
  for(let i=0;i<90*40;i++){
    const s=surface(h,x,z);
    if(s==='water'||s==='ob'){result=s;break;}
    lastDry={x,z};
    const sp=Math.hypot(vx,vz);
    const g=slope(h,x,z);
    const inAir=t-t0<bounceDur;
    let ax=inAir?0:-(5/7)*G*g[0],az=inAir?0:-(5/7)*G*g[1];
    const mu=MU[s]*(inAir?0.15:1);
    if(sp>1e-4){ax-=mu*G*vx/sp;az-=mu*G*vz/sp;}
    const nvx=vx+ax*dt,nvz=vz+az*dt;
    // friction can't reverse motion on its own
    if(sp>1e-4&&nvx*vx+nvz*vz<0&&(5/7)*Math.hypot(g[0],g[1])<MU[s]*1.15){vx=0;vz=0;}
    else{vx=nvx;vz=nvz;}
    const nsp=Math.hypot(vx,vz);
    // cup
    const dpx=x-h.pin.x,dpz=z-h.pin.z,dp=Math.hypot(dpx,dpz);
    if(dp<0.075){
      if(nsp<1.9){x=h.pin.x;z=h.pin.z;t+=dt;path.push([x,height(h,x,z)-0.09,z,t]);result='holed';break;}
      if(dp<0.05){const ang=(Math.random()<.5?-1:1)*(0.6+Math.random()*0.7);const c=Math.cos(ang),sn=Math.sin(ang);[vx,vz]=[(vx*c-vz*sn)*0.6,(vx*sn+vz*c)*0.6];}
    }
    if(nsp<0.02&&(5/7)*Math.hypot(g[0],g[1])<MU[s]*1.15&&!inAir){t+=dt;break;}
    x+=vx*dt;z+=vz*dt;t+=dt;
    if(i%3===0){
      let y=height(h,x,z)+0.05;
      if(inAir){const u=(t-t0);const n=Math.floor(u/(bounceDur/2.6));const hb=bounceH*Math.pow(0.35,n);const ph=(u%(bounceDur/2.6))/(bounceDur/2.6);y+=hb*4*ph*(1-ph);}
      path.push([x,y,z,t]);
    }
  }
  path.push([x,height(h,x,z)+(result==='holed'?-0.09:0.05),z,t]);
  return {path,end:{x,z,y:height(h,x,z)},result,lastDry};
}

function finish(h,ball,path,end,result,carry){
  const out={path,end:{x:end.x,y:end.y,z:end.z},result,carry,total:Math.hypot(end.x-ball.x,end.z-ball.z)};
  if(result==='water'){
    // drop: last dry point on the path, nudged back toward the shot origin, on a playable lie
    let k=path.length-1;
    while(k>0&&surface(h,path[k][0],path[k][2])==='water')k--;
    let dx=path[k][0],dz=path[k][2];
    const bx=ball.x-dx,bz=ball.z-dz,bl=Math.hypot(bx,bz)||1;
    for(let step=2;step<60;step+=1.5){const x=dx+bx/bl*step,z=dz+bz/bl*step;const s=surface(h,x,z);if(s!=='water'&&s!=='ob'){dx=x;dz=z;break;}}
    out.drop={x:dx,z:dz,y:height(h,dx,dz),lie:surface(h,dx,dz)};
  }
  if(result==='ok'||result==='holed')out.lie=result==='holed'?'green':surface(h,end.x,end.z);
  return out;
}

// Predicted carry point for the aim preview (no wind/error)
export function previewFlight(h,ball,club,aim,spin){
  if(club.id==='PT')return null;
  const [lf]=lieFactor(club,ball.lie);
  const hp=club.hp*(1+0.22*(spin||0)),carry=club.carry*lf;
  const dir=[Math.sin(aim),-Math.cos(aim)];
  const pts=[];let land=null;
  for(let i=0;i<=120;i++){
    const u=i/70;
    const f=u<=1?carry*(u*0.55+0.45*(1-(1-u)**2)):carry*(1+0.55*(u-1));
    const y=ball.y+hp*Math.sin(Math.PI*Math.pow(u,1.3));
    const x=ball.x+dir[0]*f,z=ball.z+dir[1]*f,gy=height(h,x,z);
    if(i>2&&y<=gy){land={x,z,y:gy};break;}
    pts.push([x,y,z]);
  }
  if(!land){const l=pts[pts.length-1];land={x:l[0],z:l[2],y:height(h,l[0],l[2])};}
  pts.push([land.x,land.y,land.z]);
  return {pts,land,carry:Math.hypot(land.x-ball.x,land.z-ball.z)};
}
