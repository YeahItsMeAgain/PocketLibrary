import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const A='/tmp/opencode/artifacts/rps'; const b64=p=>'data:image/jpeg;base64,'+readFileSync(p).toString('base64');
const hashes=['edge-3','edge-2','edge-1'];
const books=hashes.map((h,i)=>({id:i+1,contentHash:h,format:'epub',title:'Rock Paper Scissors',authors:['Alice Feeney'],series:null,language:null,description:null,publisher:null,publishedDate:null,identifier:null,pageCount:320,addedAt:1,shelfId:1,slotIndex:0,readingStatus:'unread',labels:[],spineStyle:'art'}));
const art=Object.fromEntries(books.map(b=>[b.id,{bookId:b.id,route:'crop',verdict:'pass',maskPercent:0,pagesApproximate:false,cropBox:{x:0,y:0,width:52,height:236},artDataUrl:b64(`${A}/art.jpg`),spineDataUrl:b64(`${A}/spine-2x.jpg`),fallbackDataUrl:b64(`${A}/spine-2x.jpg`),runJson:{},qaJson:{}}]));
const b=await chromium.launch(); const p=await b.newPage({viewport:{width:390,height:844},deviceScaleFactor:3});
await p.addInitScript((seed)=>{window.__POCKETLIBRARY_MOCK__=seed;window.localStorage.setItem('pocketlibrary.dragHintSeen','1');},{state:'ready',folderName:'PocketLibrary',books,shelves:[{id:1,ordinal:0,capacity:12}],spine:{backfillPending:false,queueStartPaused:true,artifacts:art}});
await p.goto('http://localhost:1420/'); await p.getByTestId('library-wall').waitFor(); await p.waitForTimeout(800);
for (const [i,book] of books.entries()) {
 const el=p.locator(`[data-testid=spine][data-book-id="${book.id}"]`);
 const w=await el.evaluate(e=>e.clientWidth);
 await el.screenshot({path:`/mnt/ssd2/Projects/PocketLibrary/.scratch/spine-engine/spine-centering/art-width-${w}.png`});
}
console.log('done');
await b.close();
