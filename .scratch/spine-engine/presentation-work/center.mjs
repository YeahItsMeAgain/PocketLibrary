import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const b64=(p)=>'data:image/jpeg;base64,'+readFileSync(p).toString('base64');
const A='/tmp/opencode/artifacts';
const strips={rps:b64(`${A}/rps/spine-2x.jpg`),dorian:b64(`${A}/dorian/spine-2x.jpg`),cover:b64(`${A}/cover/spine-2x.jpg`)};
const titles=[
 ['Dune','Frank Herbert',0],['Rock Paper Scissors','Alice Feeney',1],
 ['The Picture of Dorian Gray','Oscar Wilde',2],
 ['The Extraordinary, Long and Complicated Lighthouse Keeper\'s Daughter','A. Marlowe',0]
];
const books=[];
let id=1;
for (const style of ['cloth','typography']) for (const [title,author,labels] of titles) {
 books.push({id,contentHash:`center-${style}-${id}`,format:'epub',title,authors:[author],series:null,language:null,description:null,publisher:null,publishedDate:null,identifier:null,pageCount:320,addedAt:1,shelfId:1,slotIndex:id-1,readingStatus:'unread',labels:labels?Array.from({length:labels},(_,i)=>({id:i+1,name:`Label ${i+1}`,colour:i?'#3c5a34':'#6e2630'})):[],spineStyle:style}); id++;
}
const artifacts=Object.fromEntries(books.map(b=>[b.id,{bookId:b.id,route:'crop',verdict:'pass',maskPercent:0,pagesApproximate:false,cropBox:{x:0,y:0,width:52,height:236},artDataUrl:strips.rps,spineDataUrl:strips.rps,fallbackDataUrl:strips.rps,runJson:{},qaJson:{}}]));
const b=await chromium.launch();
for (const width of [390,320]) {
 const p=await b.newPage({viewport:{width,height:844}});
 await p.addInitScript((seed)=>{window.__POCKETLIBRARY_MOCK__=seed;window.localStorage.setItem('pocketlibrary.dragHintSeen','1');},{state:'ready',folderName:'PocketLibrary',books,shelves:[{id:1,ordinal:0,capacity:20}],spine:{backfillPending:false,queueStartPaused:true,artifacts}});
 await p.goto('http://localhost:1420/'); await p.getByTestId('library-wall').waitFor(); await p.waitForTimeout(800);
 const out=await p.evaluate(()=>[...document.querySelectorAll('[data-testid=spine]')].map(s=>{
  const H=s.offsetHeight, W=s.offsetWidth; const q=(sel)=>{const e=s.querySelector(sel); if(!e)return null; const r=e.getBoundingClientRect(); return {top:+(r.top-s.getBoundingClientRect().top).toFixed(1),bottom:+(r.bottom-s.getBoundingClientRect().top).toFixed(1),h:+r.height.toFixed(1),scrollH:e.scrollHeight,clientH:e.clientHeight,text:e.textContent}};
  const text=q('.spine-text'), st=q('.st'), sa=q('.sa');
  const glyphs=(sel)=>{const e=s.querySelector(sel); if(!e)return null; const range=document.createRange(); range.selectNodeContents(e); const r=range.getBoundingClientRect(); const sr=s.getBoundingClientRect(); return {top:+(r.top-sr.top).toFixed(1),bottom:+(r.bottom-sr.top).toFixed(1),h:+r.height.toFixed(1)}};
  const labels=s.querySelectorAll('.lb').length; const seal=!!s.querySelector('.seal');
  return {style:s.dataset.style,title:s.querySelector('.st')?.textContent.slice(0,20),H,W,labels,seal,text,st,sa,stGlyph:glyphs('.st'),saGlyph:glyphs('.sa'),faceCenter:+(H/2).toFixed(1),textCenter:text?+((text.top+text.bottom)/2).toFixed(1):null};
 }));
 console.log('WIDTH',width); for (const o of out) console.log(JSON.stringify(o));
 await p.close();
}
await b.close();
