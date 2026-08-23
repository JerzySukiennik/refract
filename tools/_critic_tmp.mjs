import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer';
const ROOT='/Users/jurek/Downloads/Claude/Projects/refract';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glsl':'text/plain','.woff2':'font/woff2','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
const srv=http.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'index.html':u);fs.readFile(f,(e,b)=>{if(e){r.writeHead(404).end();return}r.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream','cache-control':'no-store'}).end(b)})});
await new Promise(r=>srv.listen(8577,r));
const browser=await puppeteer.launch({headless:'new',executablePath:process.env.CHROME_BIN,args:['--enable-unsafe-swiftshader','--use-gl=angle','--hide-scrollbars','--mute-audio','--force-device-scale-factor=1','--force-color-profile=srgb']});
const page=await browser.newPage();
await page.setViewport({width:720,height:694,deviceScaleFactor:1});
await page.goto('http://localhost:8577/?capture=1',{waitUntil:'networkidle0'});
await page.waitForFunction('!!(window.REFRACT&&window.REFRACT.ready)');
await page.evaluate(()=>window.REFRACT.ready);
await page.evaluate(()=>window.REFRACT.script('dispersion'));
await page.evaluate(()=>window.REFRACT.settle());
const info=await page.evaluate(()=>{const s=window.REFRACT.state;const p=(s.optics||[]).filter(o=>o.type==='prism');return {level:s.levelIndex,optics:(s.optics||[]).map(o=>({id:o.id,type:o.type,x:o.x,y:o.y,angle:o.angle})),segs:(s.trace&&s.trace.segments||[]).length};});
console.log(JSON.stringify(info,null,1).slice(0,1500));
const prism=info.optics.find(o=>o.type==='prism');
if(prism){
 for(const d of [0,8,16,24,32]){
  await page.evaluate((id,a)=>{const s=window.REFRACT.state;const o=s.optics.find(o=>o.id===id);window.REFRACT.removeOptic(id);window.REFRACT.place({type:'prism',x:o.x,y:o.y,angle:a});},prism.id,prism.angle+d*Math.PI/180);
  await page.evaluate(()=>window.REFRACT.settle());
  await page.screenshot({path:`/private/tmp/claude-501/-Users-jurek-Downloads-Claude-Projects/919fa8e6-0764-4be3-9058-3f3cbca65550/scratchpad/sweep_${d}.png`});
 }
}
await browser.close(); srv.close();
