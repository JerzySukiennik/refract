import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer';
const ROOT='/Users/jurek/Downloads/Claude/Projects/refract';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.mp3':'audio/mpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.glsl':'text/plain'};
const srv=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'index.html':u);fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':(MIME[path.extname(f)]||'application/octet-stream')+'; charset=utf-8','cache-control':'no-store'}).end(b);});});
await new Promise(r=>srv.listen(8199,r));
const exe='/Users/jurek/.cache/puppeteer/chrome/'+fs.readdirSync('/Users/jurek/.cache/puppeteer/chrome')[0]+'/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser=await puppeteer.launch({headless:'new',executablePath:exe,args:['--enable-unsafe-swiftshader','--use-gl=angle','--hide-scrollbars','--mute-audio','--force-device-scale-factor=1','--force-color-profile=srgb','--disable-lcd-text']});
const page=await browser.newPage();
await page.setViewport({width:720,height:694,deviceScaleFactor:2});
await page.goto('http://localhost:8199/?capture=1',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,2500));
const data=await page.evaluate(()=>{
 const r=el=>{if(!el)return null;const b=el.getBoundingClientRect(),c=getComputedStyle(el);return{t:el.textContent.trim().slice(0,26),x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),fs:c.fontSize,ls:c.letterSpacing,col:c.color,bd:c.borderColor,bg:c.backgroundColor};};
 const d=document.documentElement,cs=getComputedStyle(d);
 return {bs:cs.getPropertyValue('--board-size'),fsTitle:cs.getPropertyValue('--fs-title'),coarse:matchMedia('(pointer:coarse)').matches,
  tag:r(document.querySelector('.level-tag')),name:r(document.querySelector('.level-name')),
  chips:[...document.querySelectorAll('.chip')].map(r),
  dock:r(document.querySelector('.dock')),tiles:[...document.querySelectorAll('.dock-tile')].map(r),
  badges:[...document.querySelectorAll('.badge')].map(r),
  hint:r(document.querySelector('.hint-line')),readout:r(document.querySelector('.readout')),
  fonts:document.fonts.check('12px "Share Tech Mono"')};
});
console.log(JSON.stringify(data,null,1));
// now solved modal
await page.evaluate(()=>window.REFRACT&&window.REFRACT.debug&&0);
await browser.close(); srv.close();
