import { chromium } from "@playwright/test";
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:390,height:844}});
const A="/tmp/opencode/artifacts/rps"; const fs=await import("node:fs");
const d=(f)=>'data:image/jpeg;base64,'+fs.readFileSync(`${A}/${f}`).toString('base64');
const book={id:1,contentHash:'m',format:'epub',title:'Rock Paper Scissors',authors:['Alice Feeney'],series:null,language:null,description:null,publisher:null,publishedDate:null,identifier:null,pageCount:320,addedAt:1,shelfId:1,slotIndex:0,readingStatus:'unread',labels:[],spineStyle:'wrap'};
const art={1:{bookId:1,route:'crop',verdict:'pass',maskPercent:0,pagesApproximate:false,cropBox:{x:0,y:0,width:52,height:236},artDataUrl:d('art.jpg'),spineDataUrl:d('spine-2x.jpg'),fallbackDataUrl:d('spine-2x.jpg'),runJson:{},qaJson:{}}};
await p.addInitScript((seed)=>{window.__POCKETLIBRARY_MOCK__=seed;}, {state:'ready',folderName:'PocketLibrary',books:[book],shelves:[{id:1,ordinal:0,capacity:12}],spine:{backfillPending:false,queueStartPaused:true,artifacts:art}});
await p.goto('http://localhost:1420/'); await p.getByTestId('library-wall').waitFor(); await p.waitForTimeout(800);
console.log(await p.evaluate(()=>{
 const mark=document.querySelector('.spine-cap-mark'); const band=document.querySelector('.spine-band-top'); const cs=mark?getComputedStyle(mark):null; const r=mark?.getBoundingClientRect(); const br=band?.getBoundingClientRect();
 return {exists:!!mark, rect:r?{x:r.x,y:r.y,w:r.width,h:r.height}:null, band:br?{x:br.x,y:br.y,w:br.width,h:br.height}:null, display:cs?.display, bg:cs?.backgroundImage, transform:cs?.transform, z:cs?.zIndex};
}));
await b.close();
