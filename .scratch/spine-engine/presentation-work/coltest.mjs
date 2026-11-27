import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<style>
.box{writing-mode:vertical-rl;text-orientation:mixed;height:200px;width:40px;background:#222;color:#fff;font:16px serif;line-height:1;text-align:center}
.col{display:block;white-space:nowrap}
</style><div class="box"><span class="col">Rock Paper</span><span class="col">Scissors</span></div>`);
console.log(await p.evaluate(()=>{
 const box=document.querySelector('.box'); const r=box.getBoundingClientRect();
 return {w:r.width,h:r.height, cols:[...box.children].map(c=>{const q=c.getBoundingClientRect();return {x:q.x-r.x,w:q.width,h:q.height,text:c.textContent}}), range: (()=>{const g=document.createRange();g.selectNodeContents(box);const q=g.getBoundingClientRect();return {x:q.x-r.x,w:q.width,h:q.height}})()};
}));
await b.close();
