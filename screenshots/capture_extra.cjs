const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5171';
const OUT_DIR = path.join(__dirname);

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 }
  });
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));

  // Mon CV Adaptation Detail
  console.log('Capturing adaptation detail...');
  await page.goto(`${BASE_URL}/mon-cv`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  // Click Editer
  const btns = await page.$$('button');
  for (const btn of btns) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('\u00e9diter') || text.toLowerCase().includes('diter')) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 600));
  // Click Adaptations
  const btns2 = await page.$$('button');
  for (const btn of btns2) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Adaptation')) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 600));
  // Click first adaptation
  const rows = await page.$$('[class*="adaptation"], [class*="item"], [class*="card"], [class*="row"]');
  if (rows.length) {
    await rows[0].click();
    await new Promise(r => setTimeout(r, 1000));
    await page.screenshot({ path: path.join(OUT_DIR, '19_moncv_adaptation_detail.png') });
    console.log('Saved: 19_moncv_adaptation_detail.png');
  }

  // RAG Sources tab
  console.log('Capturing RAG sources...');
  await page.goto(`${BASE_URL}/rag`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const ragItems = await page.$$('[class*="card"], [class*="item"], [class*="row"], a');
  for (const item of ragItems) {
    const text = await page.evaluate(el => el.textContent, item);
    if (text && text.trim().length > 0) { await item.click(); break; }
  }
  await new Promise(r => setTimeout(r, 800));
  // Click Sources tab
  const tabs = await page.$$('[role="tab"], [class*="tab"], button');
  for (const tab of tabs) {
    const text = await page.evaluate(el => el.textContent, tab);
    if (text && text.includes('Source')) { await tab.click(); break; }
  }
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: path.join(OUT_DIR, '20_rag_sources.png') });
  console.log('Saved: 20_rag_sources.png');

  // Light mode landing
  console.log('Capturing light mode...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  // Open nav menu
  const menuBtns = await page.$$('button');
  for (const btn of menuBtns) {
    const box = await btn.boundingBox();
    if (box && box.x < 60 && box.y < 60) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 400));
  // Click theme toggle
  const themeBtns = await page.$$('button, [role="button"]');
  for (const btn of themeBtns) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && (text.includes('Sombre') || text.includes('Clair') || text.includes('Light') || text.includes('Dark'))) {
      await btn.click();
      break;
    }
  }
  await new Promise(r => setTimeout(r, 600));
  // Close menu
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: path.join(OUT_DIR, '21_landing_light_mode.png') });
  console.log('Saved: 21_landing_light_mode.png');

  await browser.close();
  console.log('Done!');
})();
