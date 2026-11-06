// Shared game state over public MQTT brokers (no host).
// Each player owns one retained record: golf/v1/<gid>/p/<pid>. Shots, chat and presence are live messages.
const QS=new URLSearchParams(location.search);
const BROKERS=QS.get('mq')?QS.get('mq').split(',').map(url=>({url})):[
  {url:'wss://broker.emqx.io:8084/mqtt'},
  {url:'wss://broker.hivemq.com:8884/mqtt'},
  {url:'wss://test.mosquitto.org:8081/mqtt'},
  {url:'wss://public.cloud.shiftr.io',username:'public',password:'public'},
];
const rid=n=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return Array.from(a,b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join('');};

export class Net{
  constructor(gid,handlers){
    this.gid=gid;this.h=handlers;this.clients=[];this.seen=new Map();
    this.base=`golf/v1/${gid}`;
  }
  start(){
    /* global mqtt */
    for(const b of BROKERS){
      const opts={clientId:'golf_'+rid(14),clean:true,reconnectPeriod:4000,connectTimeout:10000,keepalive:30,resubscribe:true};
      if(b.username){opts.username=b.username;opts.password=b.password;}
      let c;try{c=mqtt.connect(b.url,opts);}catch(e){continue;}
      c.on('connect',()=>{c.subscribe(this.base+'/#',{qos:0});this.h.onConnect&&this.h.onConnect(c);this.h.onStatus&&this.h.onStatus();});
      c.on('message',(topic,buf)=>{
        let d;try{d=JSON.parse(typeof buf==='string'?buf:new TextDecoder().decode(buf));}catch(e){return;}
        if(!d||typeof d!=='object'||!d.m)return;
        if(this.seen.has(d.m))return;
        this.seen.set(d.m,Date.now());
        if(this.seen.size>1500){const cut=Date.now()-300000;for(const [k,v] of this.seen)if(v<cut)this.seen.delete(k);}
        const sub=topic.slice(this.base.length+1);
        this.h.onMessage(sub,d);
      });
      for(const ev of ['close','offline','error','reconnect'])c.on(ev,()=>this.h.onStatus&&this.h.onStatus());
      this.clients.push(c);
    }
  }
  live(){return this.clients.filter(c=>c.connected).length;}
  total(){return this.clients.length;}
  publish(sub,obj,retain,onlyClient){
    obj.m=rid(12);
    const s=JSON.stringify(obj);let n=0;
    for(const c of onlyClient?[onlyClient]:this.clients)if(c.connected){try{c.publish(this.base+'/'+sub,s,{qos:0,retain:!!retain});n++;}catch(e){}}
    return n;
  }
}
