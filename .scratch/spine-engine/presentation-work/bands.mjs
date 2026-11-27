import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const b64=(p)=>'data:image/jpeg;base64,'+readFileSync(p).toString('base64');
const A='/tmp/opencode/artifacts/rps';
const book={id:1,contentHash:'bands',format:'epub',title:'Rock Paper Scissors',authors:['Alice Feeney'],series:null,language:null,description:null,publisher:null,publishedDate:null,identifier:null,pageCount:320,addedAt:1,shelfId:1,slotIndex:0,readingStatus:'finished',labels:[{id:1,name:'Thriller',colour:'#7a2828'},{id:2,name:'Owned',colour:'#3c5a34'}],spineStyle:'wrap'};
const art={1:{bookId:1,route:'crop',verdict:'pass',maskPercent:0,pagesApproximate:false,cropBox:{x:0,y:0,width:52,height:236},artDataUrl:b64(`${A}/art.jpg`),spineDataUrl:b64(`${A}/spine-2x.jpg`),fallbackDataUrl:b64(`${A}/spine-2x.jpg`),runJson:{},qaJson:{}}};
const b=await chromium.launch();
for (const width of [390,320]) {
 const p=await b.newPage({viewport:{width,height:844}});
 await p.addInitScript((seed)=>{window.__POCKETLIBRARY_MOCK__=seed;window.localStorage.setItem('pocketlibrary.dragHintSeen','1');},{state:'ready',folderName:'PocketLibrary',books:[book],shelves:[{id:1,ordinal:0,capacity:12}],spine:{backfillPending:false,queueStartPaused:true,artifacts:art}});
 await p.goto('http://localhost:1420/'); await p.getByTestId('library-wall').waitFor(); await p.waitForTimeout(800);
 console.log(width, await p.evaluate(()=>{
  const s=document.querySelector('[data-testid=spine]'); const H=s.offsetHeight, W=s.offsetWidth;
  const q=(sel)=>{const e=s.querySelector(sel);return e?{top:e.offsetTop,h:e.offsetHeight,w:e.offsetWidth,bottom:e.offsetTop+e.offsetHeight}:null};
  return {W,H, top:q('.spine-band-top'), bottom:q('.spine-band-bottom'), art:q('img.spine-generated'), text:q('.spine-text'), title:q('.st'), author:q('.spine-band-bottom .sa'), chips:q('.spine-band-bottom .bands')};
 }));
 await p.close();
}
await b.close();
