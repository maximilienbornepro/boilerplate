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
    // Mail body in reading pane — multiple selectors covering the
    // various Outlook web builds (Monarch / classic / bottom-pane).
    body: [
      'div[aria-label="Corps du message"]',
      'div[aria-label="Message body"]',
      'div[aria-label*="message body" i]',
      'div[aria-label*="corps du" i]',
      'div[role="document"]',
      'div#ReadingPaneContainerId',
      'div[data-app-section="ReadingPane"] [role="document"]',
      'div[data-app-section="ReadingPane"] [aria-label]',
      // Fallback : the actual rendered HTML of the latest message
      'div.allowTextSelection',
      'div.PlainText',
      'div[id^="UniqueMessageBody"]',
      'div[id^="rlb"]',
    ],
    // Reading-pane content area — used to detect when a click on a
    // mail row has actually loaded a different mail (we wait until
    // the inner text changes between two snapshots before scraping).
    readingPane: [
      'div#ReadingPaneContainerId',
      'div[data-app-section="ReadingPane"]',
      'div[id^="ReadingPane"]',
      'div[role="main"]',
      // The raw fallback : the right pane that's split from the list
      'div.WACContainer',
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

  /** Scope mail-item lookup to the actual inbox virtuoso scroller —
   *  `div[data-convid]` rows also appear in the left sidebar's
   *  "Pinned messages" / "Recent" / "Search results" panels and on
   *  the Cortana suggestion strip, which is what was making the
   *  scraper return seemingly random mails (mixed across folders).
   *  Falls back to the document root only if no scroller is found. */
  function getMailListRoot() {
    return findScrollContainer() || document;
  }

  function extractVisibleEmails() {
    const root = getMailListRoot();
    // Only honour rows that look like inbox items : data-convid +
    // role="option" on the row OR an ancestor with role="listbox".
    // This filters out the sidebar suggestions which use
    // role="treeitem" / no listbox parent.
    const all = querySelectorAll(root, SELECTORS.mailItem);
    const items = Array.from(all).filter(it => {
      if (it.getAttribute('role') === 'option') return true;
      return !!it.closest('[role="listbox"]');
    });

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
   * Strategy :
   *  1. Force-scroll the virtuoso back to the top so we always start
   *     from the most recent message (otherwise a user who left their
   *     inbox scrolled mid-way captures only that window).
   *  2. Wait long enough between scrolls for virtuoso to render the
   *     newly-uncovered rows (250ms was racy on slow machines, bumped
   *     to 400ms).
   *  3. Don't stop on "no fresh seen this pass" — virtuoso can have
   *     a few empty frames between renders. Only stop on a long run
   *     (16 consecutive empty scrolls) OR when the actual scrollTop
   *     stops moving (we've truly hit the bottom).
   *  4. After the main scroll, do a final reverse-scroll back through
   *     the list so virtuoso re-mounts rows it had unmounted near
   *     the top — captures the "I scrolled past, those rows are now
   *     gone from the DOM" case.
   *  5. Log the exact exit reason so the user sees WHY scraping
   *     stopped (max-scrolls / bottom / stale / no-container).
   */
  async function extractEmails() {
    const t0 = performance.now();
    const accumulated = new Map(); // id → email object
    const skippedOld = [];          // for diagnostics
    const scrollDiag = [];          // per-iteration log

    const container = findScrollContainer();

    // Try to start from the top so we always begin with the freshest
    // mails — a leftover mid-list scroll position would otherwise cap
    // what we see.
    if (container) {
      container.scrollTop = 0;
      await new Promise(r => setTimeout(r, 400));
    }

    // First pass at top
    for (const e of extractVisibleEmails()) {
      if (isWithinLastWeek(e.date)) accumulated.set(e.id, e);
      else skippedOld.push(e);
    }

    if (!container) {
      const result = Array.from(accumulated.values());
      logExtraction(result, skippedOld, performance.now() - t0, 'no-scroll-container', scrollDiag);
      return result;
    }

    const SCROLL_STEP = 600;
    const MAX_SCROLLS = 100;
    const STALE_TOLERANCE = 16;
    let consecutiveStale = 0;
    let lastScrollTop = container.scrollTop;
    let exitReason = 'max-scrolls';

    for (let i = 0; i < MAX_SCROLLS; i++) {
      container.scrollTop += SCROLL_STEP;
      await new Promise(r => setTimeout(r, 400));

      const beforeSize = accumulated.size;
      const visible = extractVisibleEmails();
      for (const e of visible) {
        if (!isWithinLastWeek(e.date)) {
          if (!accumulated.has(e.id)) skippedOld.push(e);
          continue;
        }
        if (!accumulated.has(e.id)) accumulated.set(e.id, e);
      }
      const fresh = accumulated.size - beforeSize;

      // If scrollTop didn't actually move AND no new mails appeared,
      // count it as stale ; otherwise keep scrolling.
      const moved = container.scrollTop !== lastScrollTop;
      if (fresh === 0 && !moved) consecutiveStale++; else consecutiveStale = 0;
      lastScrollTop = container.scrollTop;

      scrollDiag.push({ i, scrollTop: container.scrollTop, fresh, totalAccum: accumulated.size, moved });

      if (consecutiveStale >= STALE_TOLERANCE) { exitReason = 'stale'; break; }
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
        exitReason = 'bottom-reached';
        break;
      }
    }

    // Reverse pass — virtuoso has likely unmounted the top rows by
    // now ; scroll back to the top and re-extract so they re-render.
    container.scrollTop = 0;
    await new Promise(r => setTimeout(r, 400));
    for (const e of extractVisibleEmails()) {
      if (isWithinLastWeek(e.date)) {
        if (!accumulated.has(e.id)) accumulated.set(e.id, e);
      } else if (!accumulated.has(e.id)) {
        skippedOld.push(e);
      }
    }

    const result = Array.from(accumulated.values());
    logExtraction(result, skippedOld, performance.now() - t0, exitReason, scrollDiag);
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

  /** Walk every same-origin iframe in the document and return the
   *  inner documents. Outlook web sometimes renders mail bodies
   *  inside `<iframe>` for HTML safety, in which case our top-level
   *  querySelectors miss them entirely → "pas de corps" everywhere. */
  function getAllDocumentRoots() {
    const roots = [document];
    try {
      for (const f of document.querySelectorAll('iframe')) {
        try {
          const doc = f.contentDocument;
          if (doc && doc.body) roots.push(doc);
        } catch { /* cross-origin */ }
      }
    } catch { /* ignore */ }
    return roots;
  }

  /**
   * Read the currently-open mail / thread out of the reading pane.
   *
   * For a single-message view, returns the body text as before.
   * For a threaded conversation, walks every message block in the
   * pane and concatenates them with `[Sender]: …\n---\n` separators
   * so the AI receives the full chain instead of only the latest
   * reply (which was the previous behaviour and made T1 routinely
   * miss subjects only mentioned earlier in the thread).
   *
   * Searches across the top document AND every reachable iframe
   * because Outlook hosts mail HTML inside an iframe in many
   * tenants — without that we'd return empty body for every row.
   */
  async function extractEmailBody(_emailId) {
    const roots = getAllDocumentRoots();

    // Find every message block in any root.
    let blocks = [];
    for (const root of roots) {
      for (const sel of THREAD_MESSAGE_SELECTORS) {
        const found = root.querySelectorAll(sel);
        if (found.length > 0) {
          blocks = Array.from(found);
          break;
        }
      }
      if (blocks.length > 0) break;
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
        return parts.join('\n\n--- next message ---\n\n');
      }
    }

    // Single-message fallback : try every body selector across every
    // root (top doc + iframes). Returns the first non-trivial hit.
    for (const root of roots) {
      for (const sel of SELECTORS.body) {
        const matches = root.querySelectorAll(sel);
        for (const el of matches) {
          const txt = (el.innerText || el.textContent || '').trim();
          if (txt.length > 5) return txt;
        }
      }
    }

    // Last-ditch — grab whatever's visible in the reading pane root.
    // Threshold lowered to 5 because some short replies legitimately
    // fit in fewer than 20 chars ("ok", "lu", "merci !").
    for (const root of roots) {
      const pane = querySelector(root, SELECTORS.readingPane);
      if (pane) {
        const txt = (pane.innerText || pane.textContent || '').trim();
        if (txt.length > 5) return txt;
      }
    }
    return '';
  }

  // ==================== FULL-BODY EXTRACTION ====================
  // For every email in the list we click the row, wait for the reading
  // pane to load, then run extractEmailBody (which handles threaded
  // conversations by walking every per-message block). The user is
  // navigated through their inbox visually — slow but the only way to
  // get the actual thread content.

  function readingPaneSignature() {
    const pane = querySelector(document, SELECTORS.readingPane);
    if (!pane) return '';
    // Use a hash of the first 200 chars of the pane innerText as a
    // change-detection signature. Cheap and survives rerenders.
    const txt = (pane.innerText || pane.textContent || '').slice(0, 200);
    return txt;
  }

  /** Outlook list rows ignore plain `.click()` — they're wired with
   *  custom pointerdown handlers. Dispatch a full pointer + mouse
   *  event sequence on the most likely clickable target (the row's
   *  subject element, falling back to the row itself). */
  function simulateRowClick(row) {
    const target = row.querySelector('span.TtcXM, div.IjzWp, div[role="option"]') || row;
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const baseInit = {
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: 0,
    };
    try {
      target.dispatchEvent(new PointerEvent('pointerdown', { ...baseInit, pointerId: 1, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mousedown', baseInit));
      target.dispatchEvent(new PointerEvent('pointerup', { ...baseInit, pointerId: 1, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('mouseup', baseInit));
      target.dispatchEvent(new MouseEvent('click', baseInit));
    } catch {
      // Fallback to plain .click() if pointer events aren't supported.
      try { target.click(); } catch { /* ignore */ }
    }
  }

  async function waitForReadingPaneChange(prevSignature, timeoutMs = 6000) {
    const start = Date.now();
    let last = prevSignature;
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 200));
      const sig = readingPaneSignature();
      if (sig && sig !== prevSignature && sig.length > 20) {
        // Wait one more frame for the body to settle in case the pane
        // is rendering progressively.
        await new Promise(r => setTimeout(r, 350));
        return true;
      }
      last = sig;
    }
    // eslint-disable-next-line no-console
    console.warn('[SuiviTess] reading-pane did not change in time, last sig:', last?.slice(0, 60));
    return false;
  }

  /** Click each row sequentially and grab the full body (incl. all
   *  thread messages). Reports progress through `onProgress(done, total)`
   *  so the popup can render a counter without waiting for the whole
   *  batch. */
  async function fetchAllBodies(emails, onProgress) {
    const root = getMailListRoot();
    if (!root) return emails;
    const selectorList = SELECTORS.mailItem;

    // Re-locate each row by id at click time — virtuoso may have
    // unmounted/remounted it between the initial extraction and now.
    function findRowById(id) {
      const all = querySelectorAll(root, selectorList);
      for (const item of all) {
        if (item.getAttribute('data-convid') === id) return item;
      }
      return null;
    }

    const enriched = [];
    const stats = { ok: 0, empty: 0, notFound: 0, paneStuck: 0 };

    for (let i = 0; i < emails.length; i++) {
      const e = emails[i];
      onProgress?.(i, emails.length, e.subject || '(sans objet)');

      let target = findRowById(e.id);
      if (!target) {
        // Walk the scroll up by one viewport to remount the row that
        // virtuoso evicted ; one shot, don't loop or we'd waste time.
        root.scrollTop = Math.max(0, root.scrollTop - 600);
        await new Promise(r => setTimeout(r, 200));
        target = findRowById(e.id);
      }
      if (!target) {
        stats.notFound++;
        enriched.push(e);
        continue;
      }

      const before = readingPaneSignature();
      try {
        target.scrollIntoView({ block: 'center', behavior: 'instant' });
        simulateRowClick(target);
      } catch {
        enriched.push(e);
        continue;
      }

      const changed = await waitForReadingPaneChange(before);
      if (!changed) stats.paneStuck++;

      // Best-effort thread expand — fire-and-forget, no extra wait
      // unless we actually clicked something.
      let clickedExpand = 0;
      try {
        const expandBtns = document.querySelectorAll(
          'button[aria-label*="messages"], button[aria-label*="Show all"], button[aria-label*="Tout afficher"], button[aria-label*="Tout dérouler"], button[aria-label*="all messages"]',
        );
        for (const btn of expandBtns) {
          try { btn.click(); clickedExpand++; } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      if (clickedExpand > 0) await new Promise(r => setTimeout(r, 200));

      const body = await extractEmailBody(e.id);
      const bodyLen = body?.length || 0;
      if (bodyLen > 20) stats.ok++; else stats.empty++;

      enriched.push({ ...e, body: body || null });

      // eslint-disable-next-line no-console
      console.log(
        `%c[SuiviTess] body[${i + 1}/${emails.length}] %c${(e.subject || '').slice(0, 60)} %c→ ${bodyLen} chars${changed ? '' : ' (pane unchanged!)'}`,
        'color:#6b7280', 'color:#e0e0e0', bodyLen > 20 ? 'color:#10b981' : 'color:#f59e0b',
      );
    }

    onProgress?.(emails.length, emails.length);
    // eslint-disable-next-line no-console
    console.log(
      `%c[SuiviTess] body-fetch summary — ok:${stats.ok} empty:${stats.empty} not-found:${stats.notFound} pane-stuck:${stats.paneStuck}`,
      stats.empty + stats.notFound > 0 ? 'color:#f59e0b;font-weight:bold' : 'color:#10b981;font-weight:bold',
    );
    return enriched;
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

    if (message.action === 'getEmailsWithBodies') {
      // Two-phase scrape : list first, then click-through each row to
      // grab the full body (incl. thread messages). Slow but the only
      // way to capture content beyond the 500-char preview Outlook
      // renders in the row. Progress is forwarded via runtime messages
      // so the popup can render a "Body 5 / 32" counter live.
      (async () => {
        try {
          const list = await extractEmails();
          const t0 = performance.now();
          const enriched = await fetchAllBodies(list, (done, total, subject) => {
            try {
              chrome.runtime.sendMessage({ action: 'bodiesProgress', done, total, subject });
            } catch { /* popup may have closed */ }
          });
          // eslint-disable-next-line no-console
          console.log(
            `%c[SuiviTess] full-body fetch → ${enriched.length} emails · ${(performance.now() - t0).toFixed(0)}ms`,
            'color:#10b981;font-weight:bold',
          );
          sendResponse({ success: true, items: enriched, provider: 'outlook' });
        } catch (err) {
          sendResponse({ success: false, error: err.message, provider: 'outlook' });
        }
      })();
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

    // Combined scroll + rect lookup — saves one round-trip per row
    // (was: scrollListTo → 250ms wait → getRowRect → 200ms wait → raf).
    // The dashboard now calls this as `scrollAndGetRect`, with an
    // optional `targetScrollTop` to coax virtuoso into rendering the
    // window around the row before we query it.
    if (message.action === 'scrollAndGetRect') {
      try {
        const container = findScrollContainer();
        if (typeof message.targetScrollTop === 'number' && container) {
          container.scrollTop = Math.max(0, message.targetScrollTop);
        }
        // One frame for virtuoso to render, then look up + reply.
        requestAnimationFrame(() => {
          const root = getMailListRoot();
          const all = querySelectorAll(root, SELECTORS.mailItem);
          let row = null;
          for (const it of all) {
            if (it.getAttribute('data-convid') === message.convId) { row = it; break; }
          }
          if (!row) {
            sendResponse({ success: false, error: 'row not in DOM (virtuoso unmounted)' });
            return;
          }
          row.scrollIntoView({ block: 'center', behavior: 'instant' });
          requestAnimationFrame(() => {
            const inner = row.querySelector('span.TtcXM, div.IjzWp') || row;
            const ir = inner.getBoundingClientRect();
            const rr = row.getBoundingClientRect();
            sendResponse({
              success: true,
              rect: {
                x: ir.left + ir.width / 2,
                y: ir.top + ir.height / 2,
                width: rr.width,
                height: rr.height,
              },
            });
          });
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }

    // Legacy single-shot rect lookup — kept for back-compat with the
    // older dashboard build. Deprecated, prefer `scrollAndGetRect`.
    if (message.action === 'getRowRect') {
      const root = getMailListRoot();
      const all = querySelectorAll(root, SELECTORS.mailItem);
      let row = null;
      for (const it of all) {
        if (it.getAttribute('data-convid') === message.convId) { row = it; break; }
      }
      if (!row) {
        sendResponse({ success: false, error: 'row not in DOM (virtuoso unmounted)' });
        return false;
      }
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
      requestAnimationFrame(() => {
        const inner = row.querySelector('span.TtcXM, div.IjzWp') || row;
        const ir = inner.getBoundingClientRect();
        sendResponse({
          success: true,
          rect: {
            x: ir.left + ir.width / 2,
            y: ir.top + ir.height / 2,
          },
        });
      });
      return true;
    }

    // Read the current reading-pane signature — used by the dashboard
    // to detect when a click has actually loaded a different mail.
    if (message.action === 'getReadingPaneSignature') {
      const pane = querySelector(document, SELECTORS.readingPane);
      const sig = pane ? (pane.innerText || pane.textContent || '').slice(0, 200) : '';
      sendResponse({ success: true, signature: sig });
      return false;
    }

    // Scroll the inbox list virtuoso to a target offset (px from top)
    // so the dashboard's debugger flow can keep the next row mounted
    // BEFORE asking for its rect — virtuoso aggressively unmounts
    // off-screen rows after each click, which was making every row
    // past the first vanish from the DOM.
    if (message.action === 'scrollListTo') {
      try {
        const container = findScrollContainer();
        if (!container) {
          sendResponse({ success: false, error: 'no scroll container' });
          return false;
        }
        const target = Math.max(0, Math.min(container.scrollHeight, message.scrollTop || 0));
        container.scrollTop = target;
        // Give virtuoso one frame to render the new viewport.
        setTimeout(() => sendResponse({ success: true, scrollTop: container.scrollTop }), 250);
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true; // async
    }

    // Best-effort thread expand inside the currently-open mail.
    if (message.action === 'expandThreadMessages') {
      try {
        const expandBtns = document.querySelectorAll(
          'button[aria-label*="messages"], button[aria-label*="Show all"], button[aria-label*="Tout afficher"], button[aria-label*="Tout dérouler"], button[aria-label*="all messages"]',
        );
        let n = 0;
        for (const btn of expandBtns) {
          try { btn.click(); n++; } catch { /* ignore */ }
        }
        sendResponse({ success: true, clicked: n });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return false;
    }
  });

  console.log('[SuiviTess Importer] Outlook content script loaded');
})();
