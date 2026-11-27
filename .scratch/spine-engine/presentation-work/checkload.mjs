import { chromium } from "@playwright/test";
const b=await chromium.launch(); const p=await b.newPage();
p.on('console',(m)=>console.log('CONSOLE',m.type(),m.text().slice(0,300)));
p.on('pageerror',(e)=>console.log('PAGEERROR',String(e).slice(0,500)));
await p.goto('http://localhost:1420/'); await p.waitForTimeout(3000);
console.log('body', (await p.locator('body').innerText()).slice(0,300));
await b.close();
