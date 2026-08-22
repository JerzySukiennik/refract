import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import puppeteer from 'puppeteer';
const ROOT='/Users/jurek/Downloads/Claude/Projects/refract';
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.mp3':'audio/mpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.glsl':'text/plain'};
const srv=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);let f=path.join(ROOT,u==='/'?'index.html':u);fs.readFile(f,(e,b)=>{if(e){res.writeHead(404).end();return;}res.writeHead(200,{'content-type':(MIME[path.extname(f)]||'application/octet-stream')+'; charset=utf-8','cache-control':'no-store'}).end(b);});});
await new Promise(r=>srv.listen(8201,r));
const exe='/Users/jurek/.cache/puppeteer/chrome/'+fs.readdirSync('/Users/jurek/.cache/puppeteer/chrome')[0]+'/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser=await puppeteer.launch({headless:'new',executablePath:exe,args:['--enable-unsafe-swiftshader','--use-gl=angle','--hide-scrollbars','--mute-audio','--force-device-scale-factor=1','--force-color-profile=srgb','--disable-lcd-text']});
const page=await browser.newPage();
await page.setViewport({width:720,height:694,deviceScaleFactor:2});
await page.goto('http://localhost:8201/?capture=1',{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,1500));
console.log('REFRACT api:', await page.evaluate(()=>Object.keys(window.REFRACT||{})));
await page.evaluate(async()=>{ await window.REFRACT.script('solved'); await window.REFRACT.modal('solved'); });
await new Promise(r=>setTimeout(r,1200));
const d=await page.evaluate(()=>{
 const r=el=>{if(!el)return null;const b=el.getBoundingClientRect(),c=getComputedStyle(el);return{t:el.textContent.trim().slice(0,30),x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),fs:c.fontSize,ls:c.letterSpacing,col:c.color,bg:c.backgroundColor,bd:c.borderColor};};
 return {panel:r(document.querySelector('.panel')),word:r(document.querySelector('.panel-word')),sub:r(document.querySelector('.panel-sub')),btns:[...document.querySelectorAll('.panel-actions .btn')].map(r),scrim:getComputedStyle(document.querySelector('.scrim')).backgroundColor};
});
console.log('SOLVED', JSON.stringify(d,null,1));
await page.evaluate(async()=>{ await window.REFRACT.modal('levels'); });
await new Promise(r=>setTimeout(r,900));
const g=await page.evaluate(()=>{
 const r=el=>{if(!el)return null;const b=el.getBoundingClientRect(),c=getComputedStyle(el);return{t:el.textContent.trim().slice(0,26),x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),fs:c.fontSize,ls:c.letterSpacing,col:c.color,bd:c.borderColor,op:c.opacity};};
 const cells=[...document.querySelectorAll('.level-cell')];
 return {panel:r(document.querySelector('.panel')),head:r(document.querySelector('.panel-head')),grid:r(document.querySelector('.level-grid')),c0:r(cells[0]),c1:r(cells[1]),c3:r(cells[3]),cls:cells.slice(0,5).map(c=>c.className),n:cells.length};
});
console.log('LEVELS', JSON.stringify(g,null,1));
await browser.close(); srv.close();
