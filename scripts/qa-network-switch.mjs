import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const page = await browser.newPage(); const errors=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3000'}/app`);
 await page.getByRole('button',{name:'Mainnet',exact:true}).waitFor();
 await page.getByRole('button',{name:'Testnet',exact:true}).click();
 await page.waitForTimeout(2500);
 assert.equal(await page.locator('.net-active').innerText(), 'Testnet');
 assert.equal(await page.locator('.vlist .vault').count(), 4);
 assert.match(await page.locator('.stats').innerText(), /not tracked on testnet/);

 await page.reload(); await page.waitForTimeout(2000);
 assert.equal(await page.locator('.net-active').innerText(), 'Testnet');
 await page.getByRole('button',{name:'Mainnet',exact:true}).click(); await page.waitForTimeout(2000);
 assert.equal(await page.locator('.net-active').innerText(), 'Mainnet');
 assert.match(await page.locator('.vlist').innerText(), /Steakhouse/);
 await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(300);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false);
 await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3000'}/`); await page.waitForTimeout(1000);
 await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3000'}/docs`); await page.waitForTimeout(1000);
 assert.deepEqual(errors, []); console.log('PASS: network switch, vault isolation, persistence, mobile width, landing and docs');
} finally {await browser.close();}
