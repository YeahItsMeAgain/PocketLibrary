import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const b64=(p)=>'data:image/jpeg;base64,'+readFileSync(p).toString('base64');
const A='/tmp/opencode/artifacts/rps';
const book={id:1,contentHash:'bands',format:'epub',title:'Rock Paper Scissors',authors:['Alice Feeney'],series:null,language:null,description:null,publisher:null,publishedDate:null,identifier:null,pageCount:320,addedAt:1,shelfId:1,slotIndex:0,readingStatus:'unread',labels:[{id:1,name:'Favourite',colour:'#6e2630'},{id:2,name:'Book club',colour:'#214d4c'}],spineStyle:'wrap'};
const art={1:{bookId:1,route:'crop',verdict:'pass',maskPercent:0,pagesApproximate:false,cropBox:{x:0,y:0,width:52,height:236},artDataUrl:b64(`${A}/art.jpg`),spineDataUrl:b64(`${A}/spine-2x.jpg`),fallbackDataUrl:b64(`${A}/spine-2x.jpg`),runJson:{},qaJson:{}}};
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:390,height:844}});
await p.addInitScript((seed)=>{window.__POCKETLIBRARY_MOCK__=seed;}, {state:'ready',folderName:'PocketLibrary',books:[book],shelves:[{id:1,ordinal:0,capacity:12}],spine:{backfillPending:false,queueStartPaused:true,artifacts:art}});
await p.goto('http://localhost:1420/'); await p.getByTestId('library-wall').waitFor(); await p.waitForTimeout(700);
console.log(await p.evaluate(()=>{
 const s=document.querySelector('[data-testid=spine]'); const W=s.offsetWidth;
 const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d'); const out=[...s.querySelectorAll('.spine-band-bottom .lb')].map(e=>{const st=getComputedStyle(e);ctx.font=`${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;return {font:st.fontSize,tracking:st.letterSpacing,measure:ctx.measureText((e.querySelector('.lb-name')?.textContent||'').toUpperCase()).width}}); return {W, measured:out, chips:[...s.querySelectorAll('.spine-band-bottom .lb')].map(e=>{const st=getComputedStyle(e);const r=e.getBoundingClientRect();return {short:e.querySelector('.lb-name')?.textContent, text:getComputedStyle(e,'::before').content, name:e.querySelector('.lb-name')?.textContent, nameW:e.querySelector('.lb-name')?.scrollWidth, nameC:e.querySelector('.lb-name')?.clientWidth, font:st.fontSize, pad:st.padding, border:st.borderWidth, w:r.width, h:r.height, inner:W-2, scroll:e.scrollWidth, client:e.clientWidth}}), band:(()=>{const e=s.querySelector('.spine-band-bottom');return {w:e.offsetWidth,h:e.offsetHeight}})()};
}));
await p.locator('[data-testid=spine]').screenshot({path:'/tmp/chip-current.png'});
await b.close();
