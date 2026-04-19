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

      emails.push({
        id: convId,
        subject,
        sender,
        date: dateText,
        preview: preview.slice(0, 500),
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
   */
  async function extractEmails() {
    const accumulated = new Map(); // id → email object

    // First pass: grab what's visible now
    for (const e of extractVisibleEmails()) {
      if (isWithinLastWeek(e.date)) accumulated.set(e.id, e);
    }

    const container = findScrollContainer();
    if (!container) return Array.from(accumulated.values());

    // Scroll progressively and accumulate
    const SCROLL_STEP = 400;
    const MAX_SCROLLS = 30;
    let reachedOldMails = false;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      container.scrollTop += SCROLL_STEP;
      await new Promise(r => setTimeout(r, 250));

      const visible = extractVisibleEmails();
      for (const e of visible) {
        if (!isWithinLastWeek(e.date)) {
          reachedOldMails = true;
          continue;
        }
        if (!accumulated.has(e.id)) {
          accumulated.set(e.id, e);
        }
      }

      if (reachedOldMails) break;

      // Stop if scroll didn't move (end of list)
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) break;
    }

    // Scroll back to top
    container.scrollTop = 0;

    return Array.from(accumulated.values());
  }

  async function extractEmailBody(emailId) {
    // Try to find the currently open mail's body
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
