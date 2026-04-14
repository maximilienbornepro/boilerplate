const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5171';
const OUT_DIR = path.join(__dirname);

async function login(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type="text"], input[name="username"], input[placeholder*="identifiant"], input[placeholder*="login"], input[placeholder*="email"]', { timeout: 5000 }).catch(() => {});
  // Try common selectors
  const usernameInput = await page.$('input[type="text"]') || await page.$('input[name="username"]') || await page.$('input');
  if (usernameInput) {
    await usernameInput.type('admin');
    const inputs = await page.$$('input');
    if (inputs.length >= 2) {
      await inputs[1].type('admin');
    }
    // Submit
    const submitBtn = await page.$('button[type="submit"]') || await page.$('button');
    if (submitBtn) await submitBtn.click();
    await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 }).catch(() => {});
  }
}

async function ss(page, name, url, waitFor, extraAction) {
  console.log(`Capturing: ${name} -> ${url}`);
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 800));
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 5000 }).catch(() => {});
  if (extraAction) await extraAction(page);
  await new Promise(r => setTimeout(r, 500));
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  Saved: ${file}`);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 }
  });
  const page = await browser.newPage();

  // Login
  console.log('Logging in...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' }).catch(() => {});
  // Check if login redirect happened
  const url = page.url();
  if (url.includes('login') || url.includes('auth')) {
    await login(page);
  }
  await new Promise(r => setTimeout(r, 1000));

  // ======== LANDING PAGE ========
  await ss(page, '00_landing', `${BASE_URL}/`, null);

  // ======== CONGES ========
  await ss(page, '01_conges_mois', `${BASE_URL}/conges`, null);
  // Click "Trim." button
  await ss(page, '02_conges_trimestre', `${BASE_URL}/conges`, null, async (p) => {
    const btns = await p.$$('button');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('Trim')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 500));
  });
  // Click "Année"
  await ss(page, '03_conges_annee', `${BASE_URL}/conges`, null, async (p) => {
    const btns = await p.$$('button');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('Ann')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 500));
  });
  // Click "+ Nouveau" for modal
  await ss(page, '04_conges_modal', `${BASE_URL}/conges`, null, async (p) => {
    const btns = await p.$$('button');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('Nouveau')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 600));
  });

  // ======== ROADMAP ========
  await ss(page, '05_roadmap_liste', `${BASE_URL}/roadmap`, null);
  // Click into planning
  await ss(page, '06_roadmap_gantt', `${BASE_URL}/roadmap`, null, async (p) => {
    const cards = await p.$$('[class*="card"], [class*="item"], [class*="row"]');
    if (cards.length) await cards[0].click();
    await new Promise(r => setTimeout(r, 800));
  });

  // ======== SUIVITESS ========
  await ss(page, '07_suivitess_liste', `${BASE_URL}/suivitess`, null);
  await ss(page, '08_suivitess_detail', `${BASE_URL}/suivitess`, null, async (p) => {
    const items = await p.$$('a, [class*="card"], [class*="item"]');
    for (const item of items) {
      const text = await p.evaluate(el => el.textContent, item);
      if (text && text.trim().length > 0 && !text.includes('Nouvelle')) {
        await item.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));
  });

  // ======== DELIVERY ========
  await ss(page, '09_delivery_board', `${BASE_URL}/delivery`, null);

  // ======== MON CV ========
  await ss(page, '10_moncv_liste', `${BASE_URL}/mon-cv`, null);
  // Click Editer on first CV
  await ss(page, '11_moncv_editeur', `${BASE_URL}/mon-cv`, null, async (p) => {
    const btns = await p.$$('button');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('diter')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 800));
  });
  // Click Adaptations
  await ss(page, '12_moncv_adaptations_liste', `${BASE_URL}/mon-cv`, null, async (p) => {
    // Navigate to editor first
    const btns = await p.$$('button');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('diter')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 600));
    // Now click Adaptations
    const btns2 = await p.$$('button');
    for (const btn of btns2) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('Adaptation')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 600));
  });
  // Click Analyse ATS
  await ss(page, '13_moncv_analyse_ats', `${BASE_URL}/mon-cv`, null, async (p) => {
    const btns = await p.$$('button');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('diter')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 400));
    const btns2 = await p.$$('button');
    for (const btn of btns2) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text.includes('Analyser')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 600));
  });

  // ======== RAG ========
  await ss(page, '14_rag_liste', `${BASE_URL}/rag`, null);
  // Click into first RAG assistant
  await ss(page, '15_rag_chat', `${BASE_URL}/rag`, null, async (p) => {
    const items = await p.$$('[class*="card"], [class*="item"], [class*="row"], a');
    for (const item of items) {
      const text = await p.evaluate(el => el.textContent, item);
      if (text && text.trim().length > 0) {
        await item.click();
        break;
      }
    }
    await new Promise(r => setTimeout(r, 800));
  });

  // ======== ADMINISTRATION ========
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await ss(page, '16_administration', `${BASE_URL}/`, null, async (p) => {
    const btns = await p.$$('button, a');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text && text.includes('Administration')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 600));
  });

  // ======== CONNECTEURS ========
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await ss(page, '17_connecteurs', `${BASE_URL}/`, null, async (p) => {
    const btns = await p.$$('button, a');
    for (const btn of btns) {
      const text = await p.evaluate(el => el.textContent, btn);
      if (text && text.includes('Connecteur')) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 600));
  });

  // ======== NAVIGATION MENU (hamburger) ========
  await ss(page, '18_nav_menu', `${BASE_URL}/`, null, async (p) => {
    const btns = await p.$$('button');
    for (const btn of btns) {
      const box = await btn.boundingBox();
      if (box && box.x < 60 && box.y < 60) { await btn.click(); break; }
    }
    await new Promise(r => setTimeout(r, 500));
  });

  await browser.close();
  console.log('\nAll screenshots saved to:', OUT_DIR);
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
  console.log('Files:', files.join(', '));
})();
