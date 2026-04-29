// SuiviTess Importer — Outlook Web content script
// Scrapes email list and bodies from Outlook web UI (outlook.office.com)

(() => {
  'use strict';

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // ==================== SELECTORS (defensive, multiple fallbacks) ====================

  const SELECTORS = {
    // Mail list items (div with data-convid attribute = one email row)
    mailItem: [
      'div[data-convid]',
      'div[role="option"][aria-label]',
    ],
    // Subject inside a mail item (span with class TtcXM)
    subject: [
      'span.TtcXM',
      'div.IjzWp span',
      'span[title]',
    ],
    // Sender inside a mail item (span inside div.ESO13)
    sender: [
      'div.ESO13 span',
      'div.gCSJa span',
    ],
    // Date inside a mail item (span with class _rWRU)
    date: [
      'span._rWRU',
      'span[title*="/"]',
    ],
    // Preview text inside a mail item (span.FqgPc)
    preview: [
      'span.FqgPc',
      'div.GVo2G span',
      'div.tAtdo span',
    ],
    // Virtuoso scroller container
    scrollContainer: [
      'div[data-testid="virtuoso-scroller"]',
      'div.jEpCF',
    ],
    // Mail body in reading pane
    body: [
      'div[aria-label="Corps du message"]',
      'div[aria-label="Message body"]',
      'div[role="document"]',
      'div#ReadingPaneContainerId',
    ],
  };

  function querySelector(el, selectorList) {
    for (const sel of selectorList) {
      const found = el.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  function querySelectorAll(el, selectorList) {
    for (const sel of selectorList) {
      const found = el.querySelectorAll(sel);
      if (found.length > 0) return found;
    }
    return [];
  }

  // ==================== DATE PARSING ====================

  function parseDate(dateStr) {
    if (!dateStr) return null;
    // Extract from title attribute format: "Lun 13/04/2026 12:26"
    const titleMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (titleMatch) return new Date(+titleMatch[3], +titleMatch[2] - 1, +titleMatch[1]);
    // Try native parse
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    // Time only (e.g. "12:26") = today
    if (/^\d{1,2}:\d{2}$/.test(dateStr.trim())) return new Date();
    // Relative: "Aujourd'hui", "Hier", etc.
    const now = new Date();
    if (/aujourd/i.test(dateStr)) return now;
    if (/hier/i.test(dateStr)) return new Date(now.getTime() - 86400000);
    return null;
  }

  function isWithinLastWeek(dateStr) {
    const d = parseDate(dateStr);
    if (!d) return true; // if can't parse, include it
    return (Date.now() - d.getTime()) <= SEVEN_DAYS_MS;
  }

  // ==================== EXTRACTION (with scroll accumulation) ====================

  /** Detect a thread-count badge in the row, e.g. "(5)" or a span
   *  with aria-label like "5 messages". Outlook surfaces this when
   *  the row groups multiple replies (conversation view). Returns
   *  the integer, or 1 when no badge is found (= single message).
   *  Used downstream so the user sees in the bulk-import preview
   *  that a row covers a whole thread, not just one message. */
  function detectThreadCount(item) {
    // 1. aria-label on a child element — most reliable when present
    const labelled = item.querySelector('[aria-label*="message"]');
    if (labelled) {
      const m = (labelled.getAttribute('aria-label') || '').match(/(\d+)\s*message/i);
      if (m) return Math.max(1, parseInt(m[1], 10));
    }
    // 2. Visible "(N)" near the subject
    const txt = item.textContent || '';
    const m2 = txt.match(/\((\d{1,3})\)/);
    if (m2) {
      const n = parseInt(m2[1], 10);
      if (n >= 2 && n <= 999) return n; // sanity bounds
    }
    return 1;
  }

  function extractVisibleEmails() {
    const items = querySelectorAll(document, SELECTORS.mailItem);
    const emails = [];

    for (const item of items) {
      const subjectEl = querySelector(item, SELECTORS.subject);
      const senderEl = querySelector(item, SELECTORS.sender);
      const dateEl = querySelector(item, SELECTORS.date);
      const previewEl = querySelector(item, SELECTORS.preview);

      const subject = subjectEl?.textContent?.trim() || '(sans objet)';
      const sender = senderEl?.textContent?.trim() || 'Inconnu';
      // Prefer title attribute which has full date "Lun 13/04/2026 12:26"
      const dateText = dateEl?.getAttribute('title') || dateEl?.textContent?.trim() || '';
      const preview = previewEl?.textContent?.trim() || '';

      const convId = item.getAttribute('data-convid') || item.getAttribute('id') || `mail-${Date.now()}-${Math.random()}`;
      const threadCount = detectThreadCount(item);

      emails.push({
        id: convId,
        subject,
        sender,
        date: dateText,
        preview: preview.slice(0, 500),
        threadCount,
      });
    }

    return emails;
  }

  function findScrollContainer() {
    // Virtuoso scroller is the primary target
    const virtuoso = querySelector(document, SELECTORS.scrollContainer);
    if (virtuoso && virtuoso.scrollHeight > virtuoso.clientHeight) return virtuoso;

    // Fallback: walk up from first mail item
    const firstItem = querySelector(document, SELECTORS.mailItem);
    if (firstItem) {
      let parent = firstItem.parentElement;
      while (parent) {
        if (parent.scrollHeight > parent.clientHeight + 50) return parent;
        parent = parent.parentElement;
      }
    }
    return null;
  }

  /**
   * Scroll the virtualized list and accumulate emails from each viewport.
   * Returns deduplicated list of all emails found within last 7 days.
   *
   * Tunables — increased to compensate for a typical busy mailbox where
   * 30 × 400 = 12000px wasn't enough to surface a full 7-day window.
   * Also tolerates a few "old" rows in a row before stopping (Outlook
   * pins / promoted items may sit above today's mail and would
   * previously trip the early break).
   */
  async function extractEmails() {
    const t0 = performance.now();
    const accumulated = new Map(); // id → email object
    const skippedOld = [];          // for diagnostics

    // First pass: grab what's visible now
    for (const e of extractVisibleEmails()) {
      if (isWithinLastWeek(e.date)) accumulated.set(e.id, e);
      else skippedOld.push(e);
    }

    const container = findScrollContainer();
    if (!container) {
      const result = Array.from(accumulated.values());
      logExtraction(result, skippedOld, performance.now() - t0, 'no-scroll-container');
      return result;
    }

    const SCROLL_STEP = 600;
    const MAX_SCROLLS = 60;
    const OLD_TOLERANCE = 8; // consecutive old rows before we give up
    let consecutiveOld = 0;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      container.scrollTop += SCROLL_STEP;
      await new Promise(r => setTimeout(r, 250));

      const visible = extractVisibleEmails();
      let foundFreshThisPass = false;
      for (const e of visible) {
        if (!isWithinLastWeek(e.date)) {
          if (!accumulated.has(e.id)) skippedOld.push(e);
          continue;
        }
        if (!accumulated.has(e.id)) {
          accumulated.set(e.id, e);
          foundFreshThisPass = true;
        }
      }

      if (!foundFreshThisPass) consecutiveOld++; else consecutiveOld = 0;
      if (consecutiveOld >= OLD_TOLERANCE) break;

      // Stop if scroll didn't move (end of list)
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) break;
    }

    // Scroll back to top
    container.scrollTop = 0;

    const result = Array.from(accumulated.values());
    logExtraction(result, skippedOld, performance.now() - t0, 'ok');
    return result;
  }

  /** Pretty per-day breakdown printed to the page console — lets the
   *  user inspect WHY a given day looks under-counted (parsing
   *  failures, conversation-view collapsing N messages into 1 row,
   *  scroll didn't reach far enough, …). */
  function logExtraction(emails, skippedOld, durationMs, reason) {
    const byDay = new Map();
    for (const e of emails) {
      const d = parseDate(e.date);
      const key = d ? d.toISOString().slice(0, 10) : '?';
      const arr = byDay.get(key) || [];
      arr.push(e);
      byDay.set(key, arr);
    }
    const dayStats = Array.from(byDay.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([day, list]) => `  ${day} : ${list.length} mail(s)`)
      .join('\n');

    /* eslint-disable no-console */
    console.groupCollapsed(
      `%c[SuiviTess] Outlook extraction → ${emails.length} mails%c (${durationMs.toFixed(0)}ms · ${reason})`,
      'color:#10b981;font-weight:bold', 'color:#6b7280',
    );
    console.log('Par jour :');
    console.log(dayStats || '  (aucun)');
    console.table(emails.map(e => ({
      date: e.date,
      sender: e.sender,
      subject: e.subject.slice(0, 80),
      thread: e.threadCount && e.threadCount > 1 ? `${e.threadCount} msgs` : '1',
      id: e.id,
    })));
    const threadedCount = emails.filter(e => e.threadCount && e.threadCount > 1).length;
    if (threadedCount > 0) {
      const totalHidden = emails.reduce((s, e) => s + Math.max(0, (e.threadCount || 1) - 1), 0);
      console.log(
        `%c${threadedCount} conversation(s) groupent ${totalHidden} message(s) supplémentaire(s) — ouvre chaque mail avant la sync pour que l'extension lise tout le fil, ou passe Outlook en vue "Messages individuels".`,
        'color:#f59e0b',
      );
    }
    if (skippedOld.length > 0) {
      console.log(`%c${skippedOld.length} mails ignorés (>7j)`, 'color:#9ca3af');
    }
    console.groupEnd();
    /* eslint-enable no-console */
  }

  // Per-message block selectors used by the threaded-aware body
  // extractor. Outlook renders each message in a thread as its own
  // <article> / collapsible header inside the reading pane.
  const THREAD_MESSAGE_SELECTORS = [
    '[role="article"]',
    'div[aria-label*="message"][aria-expanded]',
    'div[data-convitemid]',
  ];
  const THREAD_SENDER_SELECTORS = [
    'span[data-testid="message-sender"]',
    'div.OZZZK span',
    'div.AbDvi span',
    'span[title*="@"]',
  ];

  /**
   * Read the currently-open mail / thread out of the reading pane.
   *
   * For a single-message view, returns the body text as before.
   * For a threaded conversation, walks every message block in the
   * pane and concatenates them with `[Sender]: …\n---\n` separators
   * so the AI receives the full chain instead of only the latest
   * reply (which was the previous behaviour and made T1 routinely
   * miss subjects only mentioned earlier in the thread).
   */
  async function extractEmailBody(_emailId) {
    // Find every message block in the reading pane.
    let blocks = [];
    for (const sel of THREAD_MESSAGE_SELECTORS) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) { blocks = Array.from(found); break; }
    }

    if (blocks.length > 1) {
      const parts = [];
      for (const b of blocks) {
        const senderEl = THREAD_SENDER_SELECTORS
          .map(s => b.querySelector(s))
          .find(Boolean);
        const sender = senderEl?.textContent?.trim() || '?';
        const text = (b.innerText || b.textContent || '').trim();
        if (!text) continue;
        parts.push(`[${sender}]:\n${text}`);
      }
      if (parts.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`%c[SuiviTess] thread body extracted — ${parts.length} messages`, 'color:#10b981');
        return parts.join('\n\n--- next message ---\n\n');
      }
    }

    // Single-message fallback : grab the whole reading pane.
    const bodyEl = querySelector(document, SELECTORS.body);
    if (bodyEl) {
      return bodyEl.innerText?.trim() || bodyEl.textContent?.trim() || '';
    }
    return '';
  }

  // ==================== MESSAGE HANDLER ====================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'detectProvider') {
      sendResponse({ provider: 'outlook' });
      return;
    }

    if (message.action === 'getEmails') {
      extractEmails().then(emails => {
        sendResponse({ success: true, items: emails, provider: 'outlook' });
      }).catch(err => {
        sendResponse({ success: false, error: err.message, provider: 'outlook' });
      });
      return true; // async
    }

    if (message.action === 'getEmailBody') {
      extractEmailBody(message.id).then(body => {
        sendResponse({ success: true, body });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true; // async
    }
  });

  console.log('[SuiviTess Importer] Outlook content script loaded');
})();
