const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:5171';
const OUT_DIR = path.join(__dirname);

async function save(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  Saved: ${name}.png`);
}

async function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function clickButton(page, textMatch) {
  const btns = await page.$$('button');
  for (const btn of btns) {
    const text = await page.evaluate(el => el.textContent?.trim(), btn);
    if (text && text.includes(textMatch)) {
      await btn.click();
      return true;
    }
  }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 }
  });
  const page = await browser.newPage();

  // ======== LOGIN PAGE ========
  console.log('Capturing login page...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '00_login');

  // Fill login form
  console.log('Logging in...');
  const inputs = await page.$$('input');
  if (inputs.length >= 2) {
    await inputs[0].click({ clickCount: 3 });
    await inputs[0].type('admin');
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type('admin');
  }
  await page.click('button[type="submit"]').catch(() => clickButton(page, 'connecter'));
  await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 }).catch(() => {});
  await wait(1000);

  const currentUrl = page.url();
  console.log('After login URL:', currentUrl);

  if (currentUrl.includes('login') || currentUrl.includes('auth')) {
    console.log('Login failed, trying alternate method...');
    // Try clicking the button directly
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      btns.forEach(btn => { if (btn.textContent.includes('connect')) btn.click(); });
    });
    await wait(2000);
  }

  // ======== LANDING PAGE ========
  console.log('Capturing landing page...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '01_landing');

  // ======== CONGES ========
  console.log('Capturing Congés...');
  await page.goto(`${BASE_URL}/conges`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '02_conges_mois');

  // Trimestre view
  await clickButton(page, 'Trim');
  await wait(500);
  await save(page, '03_conges_trimestre');

  // Année view
  await clickButton(page, 'Ann');
  await wait(500);
  await save(page, '04_conges_annee');

  // Mois view
  await clickButton(page, 'Mois');
  await wait(300);
  // Modal
  await clickButton(page, 'Nouveau');
  await wait(600);
  await save(page, '05_conges_modal_nouveau_conge');

  // ======== ROADMAP ========
  console.log('Capturing Roadmap...');
  await page.goto(`${BASE_URL}/roadmap`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '06_roadmap_liste');

  // Click into first planning
  const planningItems = await page.$$('[class*="planning"], [class*="card"], [class*="item"], [class*="row"]');
  if (planningItems.length) {
    await planningItems[0].click();
    await wait(800);
    await save(page, '07_roadmap_gantt');
  }

  // ======== SUIVITESS ========
  console.log('Capturing SuiViTess...');
  await page.goto(`${BASE_URL}/suivitess`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '08_suivitess_liste');

  // Click a document
  const docItems = await page.$$('[class*="card"], [class*="item"]');
  for (const item of docItems) {
    const text = await page.evaluate(el => el.textContent?.trim(), item);
    if (text && text.length > 0 && !text.includes('Nouvelle')) {
      await item.click();
      await wait(800);
      await save(page, '09_suivitess_document');
      break;
    }
  }

  // ======== DELIVERY ========
  console.log('Capturing Delivery...');
  await page.goto(`${BASE_URL}/delivery`, { waitUntil: 'networkidle0' });
  await wait(1000);
  await save(page, '10_delivery_board');

  // Historique modal
  await clickButton(page, 'Historique');
  await wait(600);
  await save(page, '11_delivery_historique_modal');
  await page.keyboard.press('Escape');
  await wait(300);

  // ======== MON CV ========
  console.log('Capturing Mon CV...');
  await page.goto(`${BASE_URL}/mon-cv`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '12_moncv_liste');

  // Click Éditer on first CV
  await clickButton(page, 'diter');
  await wait(800);
  await save(page, '13_moncv_editeur');

  // Click Adaptations
  await clickButton(page, 'Adaptation');
  await wait(800);
  await save(page, '14_moncv_adaptations_liste');

  // Click first adaptation
  const adaptItems = await page.$$('[class*="adaptation-item"], [class*="card"], [class*="item"]');
  let detailOpened = false;
  for (const item of adaptItems) {
    try {
      const box = await item.boundingBox();
      if (box && box.height > 30) {
        await item.click();
        await wait(1000);
        const url = page.url();
        if (url !== `${BASE_URL}/mon-cv`) {
          await save(page, '15_moncv_adaptation_detail_top');
          // Scroll down to missions
          await page.evaluate(() => window.scrollBy(0, 500));
          await wait(400);
          await save(page, '16_moncv_adaptation_detail_missions');
          detailOpened = true;
          break;
        }
      }
    } catch(e) {}
  }
  if (!detailOpened) {
    // Try clicking any list row
    await page.goto(`${BASE_URL}/mon-cv`, { waitUntil: 'networkidle0' });
    await wait(400);
    await clickButton(page, 'diter');
    await wait(400);
    await clickButton(page, 'Adaptation');
    await wait(600);
    // Try clicking the first visible clickable element in the list
    const allLinks = await page.$$('a, [onclick], [class*="row"], [class*="entry"]');
    for (const link of allLinks) {
      const box = await link.boundingBox();
      if (box && box.height > 40 && box.y > 120) {
        await link.click();
        await wait(1000);
        await save(page, '15_moncv_adaptation_detail_top');
        break;
      }
    }
  }

  // Analyse ATS page
  await page.goto(`${BASE_URL}/mon-cv`, { waitUntil: 'networkidle0' });
  await wait(400);
  await clickButton(page, 'diter');
  await wait(400);
  await clickButton(page, 'Analyser');
  await wait(800);
  await save(page, '17_moncv_analyse_ats');

  // ======== RAG ========
  console.log('Capturing RAG...');
  await page.goto(`${BASE_URL}/rag`, { waitUntil: 'networkidle0' });
  await wait(800);
  await save(page, '18_rag_liste');

  // Click first assistant
  const ragItems = await page.$$('[class*="card"], [class*="item"], [class*="row"]');
  for (const item of ragItems) {
    const box = await item.boundingBox();
    if (box && box.height > 30 && box.y > 100) {
      await item.click();
      await wait(800);
      await save(page, '19_rag_chat');
      // Sources tab
      const tabs = await page.$$('[role="tab"], [class*="tab"], button');
      for (const tab of tabs) {
        const text = await page.evaluate(el => el.textContent?.trim(), tab);
        if (text && text.includes('Source')) {
          await tab.click();
          await wait(500);
          await save(page, '20_rag_sources');
          break;
        }
      }
      break;
    }
  }

  // ======== ADMINISTRATION ========
  console.log('Capturing Administration...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await wait(500);
  const navLinks = await page.$$('button, a, [class*="nav"]');
  for (const link of navLinks) {
    const text = await page.evaluate(el => el.textContent?.trim(), link);
    if (text && text.includes('Administration')) {
      await link.click();
      await wait(800);
      await save(page, '21_administration');
      break;
    }
  }

  // ======== CONNECTEURS ========
  console.log('Capturing Connecteurs...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await wait(500);
  const navLinks2 = await page.$$('button, a');
  for (const link of navLinks2) {
    const text = await page.evaluate(el => el.textContent?.trim(), link);
    if (text && text.includes('Connecteur')) {
      await link.click();
      await wait(800);
      await save(page, '22_connecteurs');
      // Expand Jira
      const connItems = await page.$$('[class*="connector"], [class*="item"]');
      for (const item of connItems) {
        const box = await item.boundingBox();
        if (box && box.height > 30) {
          await item.click();
          await wait(500);
          await save(page, '23_connecteurs_jira_expanded');
          break;
        }
      }
      break;
    }
  }

  // ======== NAVIGATION MENU ========
  console.log('Capturing nav menu...');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle0' });
  await wait(500);
  // Click hamburger (top-left button)
  const topBtns = await page.$$('button');
  for (const btn of topBtns) {
    const box = await btn.boundingBox();
    if (box && box.x < 80 && box.y < 60) {
      await btn.click();
      await wait(500);
      await save(page, '24_nav_menu_open');
      break;
    }
  }

  await browser.close();

  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png') && !f.startsWith('capture'));
  console.log(`\nDone! ${files.length} screenshots saved to: ${OUT_DIR}`);
  files.forEach(f => console.log('  -', f));
})();
