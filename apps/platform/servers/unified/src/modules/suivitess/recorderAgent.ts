/**
 * recorderAgent.ts — Puppeteer agent that joins a Teams call and collects live captions.
 *
 * This script is spawned as a child process by recorderService.ts.
 * It communicates via stdout (JSON messages) and stdin (commands).
 *
 * Stdout message types:
 *   { type: 'status', status: 'joining' | 'recording' | 'done' | 'error', error?: string }
 *   { type: 'caption', speaker: string, text: string, timestamp: number }
 *   { type: 'done', transcript: CaptionEntry[] }
 */

import puppeteer from 'puppeteer';

interface CaptionEntry {
  speaker: string;
  text: string;
  timestamp: number;
}

const MEETING_URL = process.argv[2];
const JOIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2000;

function send(msg: object) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * Resolve a Teams meeting URL to the direct web client URL.
 * Teams launcher URLs (dl/launcher/launcher.html?url=...) trigger a Chrome
 * dialog asking to open the Teams app. We decode the inner URL and navigate
 * directly to bypass that dialog.
 */
function resolveTeamsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/dl/launcher/launcher.html')) {
      const inner = parsed.searchParams.get('url');
      if (inner) {
        return 'https://teams.microsoft.com' + decodeURIComponent(inner);
      }
    }
  } catch { /* invalid URL — let the caller handle */ }
  return url;
}

async function main() {
  if (!MEETING_URL) {
    send({ type: 'status', status: 'error', error: 'No meeting URL provided' });
    process.exit(1);
  }

  send({ type: 'status', status: 'joining' });

  const browser = await puppeteer.launch({
    headless: false,  // Teams blocks headless — must use visible browser
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--use-fake-ui-for-media-stream',     // auto-accept mic/camera prompts
      '--use-fake-device-for-media-stream', // no real mic/camera needed
      '--disable-infobars',
      '--disable-notifications',
      '--lang=fr-FR',
      '--window-size=1280,720',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  const transcript: CaptionEntry[] = [];
  let recording = false;

  try {
    const page = await browser.newPage();

    // Mask automation detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Resolve launcher URLs (teams.microsoft.com/dl/launcher/...) to direct web URLs
    // to avoid the "Ouvrir Microsoft Teams ?" Chrome dialog
    const targetUrl = resolveTeamsUrl(MEETING_URL);

    // Navigate to the Teams meeting link
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Teams may redirect to teams.microsoft.com/v2 or show a "continue in browser" button
    // Wait for and click "Continue in this browser" if present
    const continueSelector = '[data-tid="joinOnWeb"], [data-id="prejoin-join-button"], button[class*="continue"]';
    try {
      await page.waitForSelector(continueSelector, { timeout: 8000 });
      await page.click(continueSelector);
    } catch {
      // Might already be on the prejoin page
    }

    // Fill guest name if prompted
    const nameInputSelector = '[data-tid="prejoin-display-name-input"], input[placeholder*="name"], input[placeholder*="nom"]';
    try {
      await page.waitForSelector(nameInputSelector, { timeout: 10000 });
      await page.type(nameInputSelector, 'Agent Suivitess');

      // Click Join button
      const joinSelector = '[data-tid="prejoin-join-button"], button[class*="join"]';
      await page.waitForSelector(joinSelector, { timeout: 5000 });
      await page.click(joinSelector);
    } catch {
      // May already be in the meeting
    }

    // Wait to be admitted (or join directly) — up to JOIN_TIMEOUT_MS
    const joinedSelector = '[data-tid="call-duration-timer"], [data-tid="meeting-composite"]';
    const lobbySelector = '[data-tid="lobby-title"], [class*="lobby"]';

    const joinStart = Date.now();
    let joined = false;

    while (Date.now() - joinStart < JOIN_TIMEOUT_MS) {
      try {
        const inCall = await page.$(joinedSelector);
        if (inCall) { joined = true; break; }

        const inLobby = await page.$(lobbySelector);
        if (inLobby) {
          // Still in lobby, wait
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }
      } catch {
        // Page may be navigating
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!joined) {
      send({ type: 'status', status: 'error', error: 'Timeout: impossible de rejoindre la réunion après 5 minutes' });
      await browser.close();
      process.exit(0);
    }

    // Enable live captions — Teams shortcut Ctrl+Shift+,  or click the button
    send({ type: 'status', status: 'recording' });
    recording = true;

    try {
      await page.keyboard.down('Control');
      await page.keyboard.down('Shift');
      await page.keyboard.press('Comma');
      await page.keyboard.up('Shift');
      await page.keyboard.up('Control');
    } catch {
      // Keyboard shortcut may fail — try button click
      try {
        const captionsBtn = await page.$('[data-tid="toggle-captions"], [aria-label*="ption"]');
        if (captionsBtn) await captionsBtn.click();
      } catch { /* captions may not be available */ }
    }

    // Wait a bit for captions to initialize
    await new Promise(r => setTimeout(r, 3000));

    // Inject MutationObserver to collect captions
    await page.exposeFunction('onCaption', (speaker: string, text: string) => {
      const entry: CaptionEntry = { speaker, text, timestamp: Date.now() };
      transcript.push(entry);
      send({ type: 'caption', ...entry });
    });

    await page.evaluate(() => {
      // Teams live captions selectors (may vary by Teams version)
      const CAPTION_SELECTORS = [
        '[data-tid="closed-captions-renderer"]',
        '[class*="caption-renderer"]',
        '[class*="closedCaptions"]',
        '.ts-caption-container',
      ];

      function findCaptionContainer(): Element | null {
        for (const sel of CAPTION_SELECTORS) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      }

      const seenTexts = new Set<string>();

      const observer = new MutationObserver(() => {
        const container = findCaptionContainer();
        if (!container) return;

        // Each caption line may look like: <span class="speaker">Alice</span><span class="text">Bonjour</span>
        const lines = container.querySelectorAll('[class*="caption-line"], [class*="captionLine"], [data-tid*="caption"]');

        lines.forEach((line) => {
          const speakerEl = line.querySelector('[class*="speaker"], [class*="displayName"]');
          const textEl = line.querySelector('[class*="text"], [class*="content"]');

          const speaker = speakerEl?.textContent?.trim() || 'Inconnu';
          const text = textEl?.textContent?.trim() || line.textContent?.trim() || '';

          if (!text || text.length < 2) return;

          const key = `${speaker}:${text}`;
          if (seenTexts.has(key)) return;
          seenTexts.add(key);

          // Avoid retaining too many keys in memory
          if (seenTexts.size > 5000) seenTexts.clear();

          (window as any).onCaption(speaker, text);
        });
      });

      // Start observing — watch document.body and subtree
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });

    // Poll for call end
    const callEndedSelector = '[data-tid="call-ended-screen"], [class*="callEnded"], [class*="call-ended"]';

    while (recording) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      try {
        const ended = await page.$(callEndedSelector);
        if (ended) break;

        // Also check if page navigated away from meeting
        const url = page.url();
        if (!url.includes('teams.microsoft.com') || url.includes('teams.microsoft.com/_#/')) {
          break;
        }
      } catch {
        // Page closed or navigated
        break;
      }
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: 'status', status: 'error', error: message });
  } finally {
    await browser.close().catch(() => {});
  }

  // Send final transcript
  send({ type: 'done', transcript });
  process.exit(0);
}

// Handle manual stop signal from parent
process.stdin.on('data', (data) => {
  const msg = data.toString().trim();
  if (msg === 'stop') {
    recording = false;
  }
});

let recording = false;

main().catch((err) => {
  send({ type: 'status', status: 'error', error: String(err) });
  process.exit(1);
});
