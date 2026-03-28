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
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const DEBUG_DIR = join(tmpdir(), 'teams-agent-debug');
try { mkdirSync(DEBUG_DIR, { recursive: true }); } catch {}

async function screenshot(page: any, name: string) {
  try {
    const file = join(DEBUG_DIR, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    send({ type: 'debug', message: `Screenshot: ${file}` });
  } catch {}
}

async function logUrl(page: any, label: string) {
  try {
    const url = page.url();
    const title = await page.title();
    send({ type: 'debug', message: `[${label}] url=${url} title="${title}"` });
  } catch {}
}

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
    send({ type: 'debug', message: `Navigating to: ${targetUrl}` });

    // Navigate to the Teams meeting link
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000)); // let JS render
    await logUrl(page, 'after-goto');
    await screenshot(page, '01-after-goto');

    // --- Helper: click a button/link by visible text content ---
    async function clickByText(texts: string[]): Promise<string | null> {
      return page.evaluate((texts: string[]) => {
        const all = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        for (const el of all) {
          const t = (el as HTMLElement).innerText?.trim() || el.textContent?.trim() || '';
          for (const needle of texts) {
            if (t.toLowerCase().includes(needle.toLowerCase())) {
              (el as HTMLElement).click();
              return t;
            }
          }
        }
        return null;
      }, texts);
    }

    // --- Helper: type into the name input using page-level keyboard ---
    // React ignores input.value. handle.type() can fail if the OS window lacks focus.
    // Strategy: bring window to front, click input by placeholder, use page.keyboard.type().
    async function typeIntoInput(value: string): Promise<boolean> {
      try {
        await page.bringToFront(); // ensure OS window focus
        // Try targeting by placeholder first (most specific)
        const placeholderSelectors = [
          'input[placeholder*="nom" i]',
          'input[placeholder*="name" i]',
          'input[placeholder*="votre" i]',
        ];
        for (const sel of placeholderSelectors) {
          const el = await page.$(sel);
          if (el) {
            await page.click(sel, { clickCount: 3 }); // focus + select all
            await page.keyboard.press('Backspace');
            await new Promise(r => setTimeout(r, 100));
            await page.keyboard.type(value, { delay: 80 });
            send({ type: 'debug', message: `Typed via page.keyboard into: ${sel}` });
            return true;
          }
        }
        // Fallback: click first visible input by coordinates
        const coords = await page.evaluate((): { x: number; y: number } | null => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input'));
          for (const input of inputs) {
            const r = input.getBoundingClientRect();
            if (r.width > 50 && r.height > 10) {
              return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
          }
          return null;
        });
        if (coords) {
          await page.mouse.click(coords.x, coords.y, { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await new Promise(r => setTimeout(r, 100));
          await page.keyboard.type(value, { delay: 80 });
          send({ type: 'debug', message: `Typed via mouse coords (${coords.x},${coords.y})` });
          return true;
        }
      } catch (e) {
        send({ type: 'debug', message: `typeIntoInput error: ${e}` });
      }
      return false;
    }

    // ── Step 1: "Continue in browser" (Teams launcher page) ──────────────────
    // The button text is "Continuer sur ce navigateur" (FR) or "Continue in this browser" (EN).
    // We match on visible text because Teams changes data-tid attributes frequently.
    let clickedText = await clickByText([
      'Continuer sur ce navigateur',
      'Continue in this browser',
      'Continue on this browser',
      'Rejoindre depuis le navigateur',
      'Join on the web instead',
    ]);
    if (clickedText) {
      send({ type: 'debug', message: `Clicked continue: "${clickedText}"` });
      await new Promise(r => setTimeout(r, 4000)); // wait for prejoin page to load
    } else {
      send({ type: 'debug', message: 'No continue button found (may already be on prejoin page)' });
    }
    await logUrl(page, 'after-continue');
    await screenshot(page, '02-after-continue');

    // ── Step 2: Guest name input ──────────────────────────────────────────────
    // Wait up to 10s for an input to appear, then use real keystroke simulation.
    let filledName = false;
    const nameWaitStart = Date.now();
    while (Date.now() - nameWaitStart < 10_000) {
      filledName = await typeIntoInput('Agent Suivitess');
      if (filledName) break;
      await new Promise(r => setTimeout(r, 500));
    }
    send({ type: 'debug', message: filledName ? 'Typed name via keystrokes' : 'WARNING: no name input found' });
    await new Promise(r => setTimeout(r, 500)); // let React process the input events
    await screenshot(page, '03-after-name');

    // ── Step 3: Join / Rejoindre button ──────────────────────────────────────
    await new Promise(r => setTimeout(r, 500)); // let React update after input
    clickedText = await clickByText([
      'Rejoindre maintenant',
      'Participer maintenant',
      'Join now',
      'Rejoindre',
      'Join',
    ]);
    if (clickedText) {
      send({ type: 'debug', message: `Clicked join: "${clickedText}"` });
    } else {
      send({ type: 'debug', message: 'WARNING: no join button found' });
    }
    await new Promise(r => setTimeout(r, 2000));
    await screenshot(page, '04-after-join-click');
    await logUrl(page, 'after-join-click');

    // ── Step 4: Wait to be admitted ──────────────────────────────────────────
    // Poll the page: detect "in call" vs "in lobby" using both data-tid and text heuristics.
    const joinStart = Date.now();
    let joined = false;
    let lastStatus = '';

    while (Date.now() - joinStart < JOIN_TIMEOUT_MS) {
      try {
        const status: string = await page.evaluate(() => {
          // Joined indicators: call timer, mute button, roster, call controls
          const joinedTids = ['call-duration-timer', 'meeting-composite', 'roster', 'microphone-button', 'hangup-button'];
          for (const tid of joinedTids) {
            if (document.querySelector(`[data-tid="${tid}"]`)) return 'joined';
          }
          // Lobby / waiting room indicators
          const lobbyTids = ['lobby-title', 'waitingForHost', 'waiting-for-host'];
          for (const tid of lobbyTids) {
            if (document.querySelector(`[data-tid="${tid}"]`)) return 'lobby';
          }
          // Text-based lobby detection (FR + EN)
          const body = document.body.innerText || '';
          if (body.includes("salle d'attente") || body.includes("waiting room") ||
              body.includes("waiting for") || body.includes("en attente")) return 'lobby';
          return 'unknown';
        });

        if (status !== lastStatus) {
          send({ type: 'debug', message: `Join status: ${status}` });
          if (status !== 'unknown') await screenshot(page, `join-status-${status}`);
          lastStatus = status;
        }

        if (status === 'joined') { joined = true; break; }
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
