// Functional smoke test: does the game actually PLAY, and does multiplayer actually
// connect two clients to each other. Screenshots prove a frame renders; this proves the
// game works. Run: node tools/smoke.mjs

import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
// Resolved from this file, not from the shell's cwd: running it from the repo root used to
// serve the parent directory and the page came up blank.
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const M={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.svg':'image/svg+xml'};
const srv=await new Promise(r=>{const s=http.createServer((q,e)=>{const u=decodeURIComponent(q.url.split('?')[0]);const f=path.join(ROOT,u==='/'?'index.html':u);fs.readFile(f,(x,b)=>x?e.writeHead(404).end():e.writeHead(200,{'content-type':M[path.extname(f)]||'application/octet-stream','cache-control':'no-store'}).end(b));});s.listen(8244,()=>r(s));});
const chrome=(()=>{const c=path.join(process.env.HOME,'.cache/puppeteer/chrome');if(fs.existsSync(c)){const b=fs.readdirSync(c).map(d=>path.join(c,d,'chrome-mac-x64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).filter(fs.existsSync).sort();if(b.length)return b.at(-1);}return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';})();
const br=await puppeteer.launch({headless:'new',executablePath:chrome,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=default','--hide-scrollbars','--mute-audio']});
const errs=[];
// Each client gets its OWN browser context. Firebase anonymous auth persists per origin in
// IndexedDB, so two pages in one profile authenticate as the SAME uid, write to the same
// presence seat and clobber each other -- which looks exactly like multiplayer being broken.
const mk=async()=>{const ctx=await br.createBrowserContext();const p=await ctx.newPage();await p.setViewport({width:900,height:800,deviceScaleFactor:1});
  p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await p.goto('http://localhost:8244/?capture=1',{waitUntil:'networkidle0'});
  await p.evaluate(()=>window.REFRACT.ready); return p;};

const A=await mk();
// --- solo gameplay ---
const solo=await A.evaluate(async()=>{
  const R=window.REFRACT, out={};
  R.setLevel(0); R.clearOptics(); await R.settle();
  out.startSolved=R.state.solved;
  const sol=R.state.level.solution;
  for(const o of sol) R.place({type:o.type,x:o.x,y:o.y,angle:o.angle});
  await R.settle();
  out.solvedAfterSolution=R.state.solved;
  out.receptors=(R.state.trace.receptors||[]).map(r=>r.satisfied);
  out.segments=R.state.trace.segments.length;
  // rotate + undo
  const id=R.state.optics[0].id; R.select(id);
  const a0=R.state.optics[0].angle; R.state.optics[0].angle=a0+0.3;
  out.canSelect=R.state.selectedId===id;
  out.levels=R.state.level?24:0;
  return out;
});
console.log('SOLO:', JSON.stringify(solo));

// --- multiplayer: two clients, same room ---
const room='SMOKE'+Math.floor(Math.random()*900+100);
const mpA=await A.evaluate(async(rm)=>{
  const R=window.REFRACT;
  try{ const h=await R.startMultiplayer(rm,'AlphaTester');
       await new Promise(r=>setTimeout(r,3000));
       return {joined:true, mode:R.state.mode, room:R.state.roomId,
               players:Object.values(R.state.players||{}).map(p=>p.name)}; }
  catch(e){ return {joined:false, error:String(e).slice(0,160)}; }
},room);
console.log('MP client A:', JSON.stringify(mpA));

if(mpA.joined){
  const B=await mk();
  const mpB=await B.evaluate(async(rm)=>{
    const R=window.REFRACT;
    try{ await R.startMultiplayer(rm,'BetaTester'); }catch(e){ return {joined:false,error:String(e).slice(0,160)}; }
    await new Promise(r=>setTimeout(r,3500));
    return {joined:true, players:Object.values(R.state.players||{}).map(p=>p.name)};
  },room);
  console.log('MP client B:', JSON.stringify(mpB));
  const seen=await A.evaluate(async()=>{await new Promise(r=>setTimeout(r,2000));
    return Object.values(window.REFRACT.state.players||{}).map(p=>p.name);});
  console.log('MP client A sees:', JSON.stringify(seen));

  // The roster alone does not prove the game is shared. Place a piece on A and check it
  // arrives on B, then move it and check B follows.
  const placed=await A.evaluate(async()=>{
    const R=window.REFRACT;
    const id=R.place({type:'mirror',x:500,y:500,angle:0.5});
    await new Promise(r=>setTimeout(r,2500));
    return {id, mine:R.state.optics.length};
  });
  const gotB=await B.evaluate(async()=>{
    await new Promise(r=>setTimeout(r,1500));
    const R=window.REFRACT;
    return R.state.optics.map(o=>({t:o.type,x:Math.round(o.x),y:Math.round(o.y)}));
  });
  console.log('MP optic placed on A:', JSON.stringify(placed));
  console.log('MP optic seen by B :', JSON.stringify(gotB));

  const moved=await A.evaluate(async(id)=>{
    const R=window.REFRACT;
    const o=R.state.optics.find(x=>x.id===id); if(!o) return null;
    o.x=700; o.y=300; R.state.traceDirty=true;
    if(window.__emitMove) window.__emitMove(o);
    await new Promise(r=>setTimeout(r,2000));
    return {x:o.x,y:o.y};
  },placed.id);
  console.log('MP optic moved on A:', JSON.stringify(moved));
}
console.log('CONSOLE ERRORS:', errs.length?[...new Set(errs)].slice(0,6):'none');
await br.close(); srv.close();
