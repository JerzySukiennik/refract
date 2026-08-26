// Captures every level in its untouched state, for judging geometry and legibility.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import { fileURLToPath } from 'node:url'; import puppeteer from 'puppeteer';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUT='/tmp/levels'; fs.mkdirSync(OUT,{recursive:true});
const M={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.svg':'image/svg+xml'};
const srv=await new Promise(r=>{const s=http.createServer((q,e)=>{const u=decodeURIComponent(q.url.split('?')[0]);const f=path.join(ROOT,u==='/'?'index.html':u);fs.readFile(f,(x,b)=>x?e.writeHead(404).end():e.writeHead(200,{'content-type':M[path.extname(f)]||'application/octet-stream','cache-control':'no-store'}).end(b));});s.listen(8301,()=>r(s));});
const chrome=(()=>{const c=path.join(process.env.HOME,'.cache/puppeteer/chrome');const b=fs.readdirSync(c).map(d=>path.join(c,d,'chrome-mac-x64','Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).filter(fs.existsSync).sort();return b.at(-1);})();
const br=await puppeteer.launch({headless:'new',executablePath:chrome,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=default','--hide-scrollbars','--mute-audio','--force-color-profile=srgb']});
const p=await br.newPage(); await p.setViewport({width:720,height:694,deviceScaleFactor:1});
await p.goto('http://localhost:8301/?capture=1',{waitUntil:'networkidle0'});
await p.evaluate(()=>window.REFRACT.ready);
const names=[];
for(let i=0;i<24;i++){
  const n=await p.evaluate(async(k)=>{const R=window.REFRACT;R.showModal(null);R.setLevel(k);R.clearOptics();await R.settle();return R.state.level.name;},i);
  names.push(n);
  await new Promise(r=>setTimeout(r,220));
  fs.writeFileSync(path.join(OUT,`lv${String(i+1).padStart(2,'0')}.png`), await p.screenshot({encoding:'binary'}));
}
// Contact sheets, 6 per row.
console.log(names.map((n,i)=>`${i+1}. ${n}`).join('\n'));
await br.close(); srv.close();
