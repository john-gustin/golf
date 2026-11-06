// Course generation: deterministic from a seed, so every player builds the same course.
// Units are yards. x = right, z = toward the player (holes run toward -z), y = up.

export function rng(seed){
  let a=seed>>>0;
  return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
function hash2(ix,iz,seed){
  let h=Math.imul(ix,374761393)^Math.imul(iz,668265263)^Math.imul(seed,982451653);
  h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;
  return (h>>>0)/4294967296;
}
const sm=t=>t*t*(3-2*t);
function vnoise(x,z,seed){
  const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,sx=sm(fx),sz=sm(fz);
  const a=hash2(ix,iz,seed),b=hash2(ix+1,iz,seed),c=hash2(ix,iz+1,seed),d=hash2(ix+1,iz+1,seed);
  return ((a+(b-a)*sx)+((c+(d-c)*sx)-(a+(b-a)*sx))*sz)*2-1;
}
function fbm(x,z,seed){return vnoise(x,z,seed)*0.6+vnoise(x*2.1,z*2.1,seed+11)*0.28+vnoise(x*4.3,z*4.3,seed+23)*0.12;}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

const NAMES_A=['Pine','Cedar','Willow','Eagle','Heron','Fox','Stone','Maple','Lark','Osprey','Thistle','Juniper','Copper','Silver','Bramble','Aspen'];
const NAMES_B=['Hollow','Ridge','Creek','Links','Valley','Hills','Meadows','Point','Glen','Dunes','Run','Bluff','Falls','Crossing'];

export function makeCourse(seed,nHoles){
  const R=rng(seed);
  const name=NAMES_A[Math.floor(R()*NAMES_A.length)]+' '+NAMES_B[Math.floor(R()*NAMES_B.length)];
  let pars;
  if(nHoles===3)pars=[4,3,5];
  else{
    const nine=()=>{const p=[4,4,4,4,4,3,3,5,5];for(let i=p.length-1;i>0;i--){const j=Math.floor(R()*(i+1));[p[i],p[j]]=[p[j],p[i]];}
      if(p[0]===3){const k=p.findIndex(v=>v!==3);[p[0],p[k]]=[p[k],p[0]];}return p;};
    pars=nHoles===18?[...nine(),...nine()]:nine();
  }
  const holes=pars.map((par,i)=>makeHole(seed,i,par));
  return {seed,name,holes,par:pars.reduce((a,b)=>a+b,0)};
}

function catmull(pts,step){
  const out=[];
  const P=[pts[0],...pts,pts[pts.length-1]];
  for(let i=1;i<P.length-2;i++){
    const p0=P[i-1],p1=P[i],p2=P[i+1],p3=P[i+2];
    const segLen=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);
    const n=Math.max(2,Math.ceil(segLen/step));
    for(let k=0;k<n;k++){
      const t=k/n,t2=t*t,t3=t2*t;
      const f=(a,b,c,d)=>0.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);
      out.push([f(p0[0],p1[0],p2[0],p3[0]),f(p0[1],p1[1],p2[1],p3[1])]);
    }
  }
  out.push(pts[pts.length-1].slice());
  return out;
}

function makeHole(seed,index,par){
  const R=rng((seed*7919+index*104729+13)>>>0);
  const hseed=(seed*31+index*977+5)>>>0;
  let target=par===3?135+R()*75:par===4?345+R()*105:485+R()*75;
  const ctrl=[[0,0]];
  if(par===3){ctrl.push([(R()-.5)*30,-target]);}
  else if(par===4){
    const bend=0.55+R()*0.12,ang=(R()-.5)*0.95;
    const p1=[(R()-.5)*16,-target*bend];
    ctrl.push(p1,[p1[0]+Math.sin(ang)*target*(1-bend),p1[1]-Math.cos(ang)*target*(1-bend)]);
  } else {
    const a1=(R()-.5)*0.7,a2=(R()-.5)*0.9,b1=0.45+R()*0.1;
    const p1=[(R()-.5)*16,-target*b1];
    const p2=[p1[0]+Math.sin(a1)*target*0.3,p1[1]-Math.cos(a1)*target*0.3];
    const rest=target*(1-b1-0.3);
    ctrl.push(p1,p2,[p2[0]+Math.sin(a1+a2)*rest,p2[1]-Math.cos(a1+a2)*rest]);
  }
  const path=catmull(ctrl,4);
  const cum=[0];for(let i=1;i<path.length;i++)cum.push(cum[i-1]+Math.hypot(path[i][0]-path[i-1][0],path[i][1]-path[i-1][1]));
  const len=cum[cum.length-1];
  const end=path[path.length-1],pre=path[path.length-4];
  const gAng=Math.atan2(end[0]-pre[0],-(end[1]-pre[1])); // heading at green
  const green={x:end[0],z:end[1],rx:11+R()*6,rz:13+R()*8,ang:gAng};
  const t0=path[0],t1=path[3];
  const tee={x:0,z:0,ang:Math.atan2(t1[0]-t0[0],-(t1[1]-t0[1]))};
  const h={index,par,seed:hseed,path,cum,len,green,tee,bunkers:[],ponds:[],trees:[],
    A:1.5+R()*4.5,fwStart:par===3?1e9:28+R()*35,fwBase:13+R()*6,rough:9+R()*4,ob:62+R()*15};
  // pin: random point inside 60% of the green
  {const a=R()*Math.PI*2,r=Math.sqrt(R())*0.6;const u=Math.cos(a)*r*green.rx,v=Math.sin(a)*r*green.rz;
   const c=Math.cos(gAng),s=Math.sin(gAng);h.pin={x:green.x+u*c-v*s,z:green.z+u*s+v*c};}
  // green tilt: mostly back-to-front (higher at the back)
  {const ta=gAng+(R()-.5)*1.6,mag=0.008+R()*0.022;h.tilt=[Math.sin(ta)*mag,-Math.cos(ta)*mag];}
  // hazards (use the raw base height before features)
  const at=(s,off)=>{const p=pointAt(h,s);return [p.x+p.rx*off,p.z+p.rz*off];};
  const addBunker=(x,z,r)=>{const parts=[{x,z,r}];const n=1+Math.floor(R()*3);for(let i=0;i<n;i++){const a=R()*Math.PI*2;parts.push({x:x+Math.cos(a)*r*0.6,z:z+Math.sin(a)*r*0.6,r:r*(0.5+R()*0.4)});}h.bunkers.push({x,z,r:r*1.6,parts});};
  // greenside bunkers
  const nG=par===3?2+Math.floor(R()*2):1+Math.floor(R()*3);
  for(let i=0;i<nG;i++){
    const a=gAng+[Math.PI/2,-Math.PI/2,Math.PI*0.8,-Math.PI*0.8,Math.PI][Math.floor(R()*5)]+(R()-.5)*0.5;
    const rr=Math.max(green.rx,green.rz)*0.95+5;
    addBunker(green.x+Math.sin(a)*rr*0.95,green.z-Math.cos(a)*rr*0.95,3.5+R()*2.5);
  }
  if(par>3){
    const nF=1+Math.floor(R()*2);
    for(let i=0;i<nF;i++){const s=clamp(225+R()*45+(i*30),60,len-60);const side=R()<.5?-1:1;const [x,z]=at(s,side*(h.fwBase+R()*6-2));addBunker(x,z,4+R()*3);}
    if(par===5){const s=len-90-R()*40;const side=R()<.5?-1:1;const [x,z]=at(s,side*(h.fwBase-2));addBunker(x,z,4+R()*2);}
  }
  // ponds
  const pondChance=par===3?0.45:par===4?0.3:0.4;
  if(R()<pondChance){
    let x,z,rx,rz,ang;
    if(par===3&&R()<0.6){const s=len-green.rz-14-R()*10;[x,z]=at(s,(R()-.5)*8);rx=green.rx+8+R()*10;rz=7+R()*5;ang=pointAt(h,s).ang;}
    else if(par>3&&R()<0.35){const s=par===4?120+R()*50:300+R()*60;[x,z]=at(s,(R()-.5)*6);rx=h.fwBase*2+18;rz=6+R()*4;ang=pointAt(h,s).ang;}
    else{const s=par===3?len-8:clamp(200+R()*(len-260),120,len-40);const side=R()<.5?-1:1;[x,z]=at(s,side*(h.fwBase+14+R()*8));rx=10+R()*8;rz=20+R()*20;ang=pointAt(h,s).ang;}
    const pond={x,z,rx,rz,ang};
    // keep water off the green and tee
    const gd=Math.hypot(x-green.x,z-green.z)-Math.max(rx,rz)-Math.max(green.rx,green.rz);
    if(gd>-2&&Math.hypot(x,z)>Math.max(rx,rz)+25){pond.level=baseHeight(h,x,z)-0.6;h.ponds.push(pond);}
  }
  green.base=baseHeight(h,green.x,green.z);
  tee.base=baseHeight(h,0,0);
  // trees
  const nTrees=Math.round(len/2.6);
  for(let i=0;i<nTrees*3&&h.trees.length<nTrees;i++){
    const s=-25+R()*(len+55),side=R()<.5?-1:1;
    const off=h.fwBase+h.rough+4+Math.pow(R(),1.4)*(h.ob-h.fwBase-h.rough+5);
    const [x,z]=at(clamp(s,0,len),side*off);
    const xx=x+(R()-.5)*6,zz=z+(R()-.5)*6+(s<0?-s:s>len?-(s-len):0);
    const sf=surface(h,xx,zz);
    if(sf!=='deep'&&sf!=='rough')continue;
    if(Math.hypot(xx-green.x,zz-green.z)<Math.max(green.rx,green.rz)+10)continue;
    if(Math.hypot(xx,zz)<14)continue;
    h.trees.push({x:xx,z:zz,r:2.2+R()*2.2,h:8+R()*8});
  }
  // wind
  const mph=Math.round(R()*R()*18);const wa=R()*Math.PI*2;
  h.wind={mph,ang:wa,v:[Math.sin(wa)*mph*0.4889,-Math.cos(wa)*mph*0.4889]};
  // bounds
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9;
  for(const p of path){minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minZ=Math.min(minZ,p[1]);maxZ=Math.max(maxZ,p[1]);}
  const m=h.ob+12;h.bounds={minX:minX-m,maxX:maxX+m,minZ:minZ-m-40,maxZ:maxZ+m+30};
  return h;
}

export function pointAt(h,s){
  const {path,cum}=h;s=clamp(s,0,h.len);
  let i=1;while(i<cum.length-1&&cum[i]<s)i++;
  const t=(s-cum[i-1])/((cum[i]-cum[i-1])||1);
  const x=path[i-1][0]+(path[i][0]-path[i-1][0])*t,z=path[i-1][1]+(path[i][1]-path[i-1][1])*t;
  const dx=path[i][0]-path[i-1][0],dz=path[i][1]-path[i-1][1],l=Math.hypot(dx,dz)||1;
  return {x,z,ang:Math.atan2(dx,-dz),rx:-dz/l,rz:dx/l}; // (rx,rz) = right-hand vector
}
export function pathDist(h,x,z){
  const {path,cum}=h;let best=1e9,bs=0;
  for(let i=1;i<path.length;i++){
    const ax=path[i-1][0],az=path[i-1][1],ex=path[i][0]-ax,ez=path[i][1]-az,l2=ex*ex+ez*ez;
    let t=((x-ax)*ex+(z-az)*ez)/l2;
    const tc=i===1?Math.min(t,1):i===path.length-1?Math.max(t,0):clamp(t,0,1);
    const tt=clamp(t,0,1);
    const px=ax+ex*tt,pz=az+ez*tt,d=(x-px)**2+(z-pz)**2;
    if(d<best){best=d;bs=cum[i-1]+tc*Math.sqrt(l2);}
  }
  return {d:Math.sqrt(best),s:bs};
}
export function fwHalf(h,s){return h.fwBase*(0.85+0.3*(vnoise(s/55,0.5,h.seed+3)*0.5+0.5));}
function ellipseE(o,x,z){const c=Math.cos(o.ang),s=Math.sin(o.ang);const dx=x-o.x,dz=z-o.z;const u=dx*c+dz*s,v=-dx*s+dz*c;return (u/o.rx)**2+(v/o.rz)**2;}
export function greenE(h,x,z){return ellipseE(h.green,x,z);}

export function surfaceInfo(h,x,z){
  const ge=ellipseE(h.green,x,z);
  if(ge<=1)return {surf:'green'};
  const gm=Math.min(h.green.rx,h.green.rz);
  if(Math.sqrt(ge)<=1+2.4/gm)return {surf:'fringe'};
  {const c=Math.cos(h.tee.ang),s=Math.sin(h.tee.ang);const u=x*c+z*s,v=-x*s+z*c;if(Math.abs(u)<4.5&&v>-6&&v<3)return {surf:'tee'};}
  for(const p of h.ponds)if(ellipseE(p,x,z)<=1)return {surf:'water'};
  for(const b of h.bunkers){if((x-b.x)**2+(z-b.z)**2>b.r*b.r)continue;for(const p of b.parts)if((x-p.x)**2+(z-p.z)**2<=p.r*p.r)return {surf:'sand'};}
  const {d,s}=pathDist(h,x,z);
  if(s<-55||s>h.len+60||d>h.ob)return {surf:'ob',d,s};
  const fw=fwHalf(h,s);
  if(s>h.fwStart&&s<h.len&&d<fw)return {surf:'fairway',d,s};
  const gd=Math.sqrt(ge)*gm;
  if(d<fw+h.rough||gd<gm+10||(s<14&&d<12))return {surf:'rough',d,s};
  return {surf:'deep',d,s};
}
export const surface=(h,x,z)=>surfaceInfo(h,x,z).surf;

export function baseHeight(h,x,z){return h.A*fbm(x/115,z/115,h.seed)+0.9*vnoise(x/28,z/28,h.seed+7);}
export function height(h,x,z){
  let y=baseHeight(h,x,z);
  // tee box flat
  {const d=Math.hypot(x,z);if(d<14){const w=sm(clamp((14-d)/7,0,1));y+=(h.tee.base-y)*w;}}
  // green plane with gentle undulation
  {const g=h.green,e=Math.sqrt(ellipseE(g,x,z));if(e<1.9){
    const gp=g.base+h.tilt[0]*(x-g.x)+h.tilt[1]*(z-g.z)+0.12*vnoise(x/11,z/11,h.seed+5)+0.03*vnoise(x/5,z/5,h.seed+9);
    const w=sm(clamp((1.9-e)/0.8,0,1));y+=(gp-y)*w;}}
  for(const b of h.bunkers){if((x-b.x)**2+(z-b.z)**2>(b.r+3)**2)continue;let dep=0;for(const p of b.parts){const d2=((x-p.x)**2+(z-p.z)**2)/(p.r*p.r);if(d2<1.4)dep=Math.max(dep,0.75*sm(clamp((1.4-d2)/1.4,0,1)));}y-=dep;}
  for(const p of h.ponds){const e=ellipseE(p,x,z);if(e<2.2){const target=p.level-1.4*Math.max(0,1-e)-0.05;const w=sm(clamp((2.2-e)/1.2,0,1));if(target<y)y+=(target-y)*w;}}
  return y;
}
export function slope(h,x,z){const e=0.3;return [(height(h,x+e,z)-height(h,x-e,z))/(2*e),(height(h,x,z+e)-height(h,x,z-e))/(2*e)];}
