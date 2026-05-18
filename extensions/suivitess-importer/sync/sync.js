// SuiviTess Importer — Sync dashboard
// Standalone fullscreen tab that orchestrates the body extraction and
// the push to the backend, with a live table showing every email's
// status. Driven by URL parameters set by the popup when it opens
// the dashboard via chrome.tabs.create.

(() => {
  'use strict';

  const params = new URLSearchParams(window.location.search);
  const outlookTabId = parseInt(params.get('tabId') || '0', 10);
  const serverUrl = params.get('serverUrl') || 'https://studio.vitess.tech';
  const serverDomain = (() => {
    try { return new URL(serverUrl).host; } catch { return serverUrl; }
  })();
  // `?mode=replay` = open the dashboard without launching a fresh sync
  // (just review what was persisted from the last run). The popup
  // adds this when re-opening the dashboard from the history menu.
  const replayMode = params.get('mode') === 'replay';

  const STORAGE_KEY = 'lastOutlookSync';

  /** Persist the current `emails` array + run metadata to
   *  chrome.storage.local. Stored fields are kept lean (no body —
   *  it's already on the server, and storage.local has a per-key
   *  cap of ~5MB). */
  async function persistSnapshot(extra = {}) {
    try {
      // Bodies are kept too so the user can inspect what got
      // extracted in the dashboard (expandable row). Truncated at
      // 20k chars per body to stay safe under chrome.storage.local's
      // ~5MB per-key cap on a busy mailbox.
      const lean = emails.map(e => ({
        id: e.id,
        subject: e.subject,
        sender: e.sender,
        date: e.date,
        preview: e.preview,
        threadCount: e.threadCount,
        body: e.body ? String(e.body).slice(0, 20000) : null,
        bodyChars: e.bodyChars,
        status: e.status,
        error: e.error,
        syncedAt: e.syncedAt,
      }));
      await chrome.storage.local.set({
        [STORAGE_KEY]: {
          syncedAt: new Date().toISOString(),
          serverDomain,
          serverUrl,
          emails: lean,
          ...extra,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[SuiviTess sync] persist failed:', err);
    }
  }

  async function loadSnapshot() {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY]);
      return data?.[STORAGE_KEY] || null;
    } catch { return null; }
  }

  async function clearSnapshot() {
    try { await chrome.storage.local.remove([STORAGE_KEY]); } catch { /* ignore */ }
  }

  // ── DOM refs ───────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const tbody = $('email-tbody');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const barSub = $('bar-sub');
  const filterInput = $('filter');
  const statusFilter = $('status-filter');
  const retryBtn = $('retry-failed');
  const closeBtn = $('close-btn');
  const stats = { ok: $('stat-ok'), warn: $('stat-warn'), err: $('stat-err'), queue: $('stat-queue') };

  $('server-domain').textContent = serverDomain;

  // ── State ──────────────────────────────────────────────────────────────
  /** @type {Array<{id: string, subject: string, sender: string, date: string,
   *  preview: string, threadCount: number, body: string|null, bodyChars: number,
   *  status: 'queued'|'extracting'|'ok'|'empty'|'failed', error?: string,
   *  syncedAt?: string }>} */
  let emails = [];
  let cancelled = false;

  closeBtn.addEventListener('click', () => {
    cancelled = true;
    window.close();
  });
  filterInput.addEventListener('input', renderTable);
  statusFilter.addEventListener('change', renderTable);
  retryBtn.addEventListener('click', () => retryFailed());

  // 🗑 Clear-all : wipes the local snapshot AND tells the backend to
  // delete every outlook_messages row for this user. Two-step confirm
  // to avoid an accidental nuke. After completion the table is empty
  // and the user can re-launch a fresh 7-day sync.
  const clearAllBtn = $('clear-all-btn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      const confirmed = window.confirm(
        '⚠ Supprimer toutes les données ?\n\n' +
        '• Snapshot local de l\'extension\n' +
        '• Tous les mails stockés côté serveur (outlook_messages)\n\n' +
        'La prochaine sync repartira de zéro sur les 7 derniers jours.'
      );
      if (!confirmed) return;
      clearAllBtn.disabled = true;
      try {
        await clearSnapshot();
        // Tell the backend to wipe outlook_messages for this user.
        const token = await getAuthToken();
        if (token) {
          for (const path of ['/suivitess-api/outlook/clear', '/suivitess/api/outlook/clear']) {
            try {
              const url = `${serverUrl.replace(/\/+$/, '')}${path}`;
              const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
              });
              if (res.ok) break;
            } catch { /* try next path */ }
          }
        }
        emails = [];
        renderTable();
        updateStats();
        progressFill.style.width = '0%';
        progressText.textContent = '🗑 Tout effacé. Recharge la page pour relancer une sync.';
        barSub.textContent = `Storage purged · ${serverDomain}`;
      } catch (err) {
        progressText.textContent = `⚠ Effacement échoué : ${err.message}`;
      } finally {
        clearAllBtn.disabled = false;
      }
    });
  }

  // ── Cross-domain push ──────────────────────────────────────────────────
  // Reuses the in-memory `emails` array (already scraped, with bodies)
  // and ships it to a target backend chosen from the dropdown — useful
  // to push a batch indexed locally to prod without re-running the
  // 7-day Outlook scrape on the prod tab.
  const pushOtherBtn = $('push-other-btn');
  const pushTargetSelect = $('push-target');

  /** Resolve the dropdown's current value into a real backend URL.
   *  Returns null if the user cancels the custom prompt or picks an
   *  invalid URL — caller surfaces a message via `progressText`. */
  function resolvePushTarget() {
    if (!pushTargetSelect) return null;
    let target = pushTargetSelect.value;
    if (target === '__current__') target = serverUrl;
    if (target === '__custom__') {
      target = window.prompt(
        'URL du backend cible (ex : https://francetv.vitess.tech)',
        'https://',
      ) || '';
      target = target.trim();
      if (!target) return null;
    }
    try { new URL(target); } catch {
      progressText.textContent = `⚠ URL cible invalide : ${target}`;
      return null;
    }
    return target;
  }

  /** Shared push pipeline used by BOTH the "📤 Pousser" button AND the
   *  auto-trigger that runs at the end of every sync. Filters to
   *  rows with bodies, chunks into batches of 25, ships each via
   *  `pushToBackend`, drives the progress bar + status text. */
  async function pushReadyEmailsTo(target) {
    const targetDomain = (() => { try { return new URL(target).host; } catch { return target; } })();
    // Only ship rows that actually have a body — pushing rows with
    // status 'failed' / 'empty' is harmless but pollutes the target
    // with empty messages. Keep it tight by default.
    const ready = emails.filter(e => e.body && e.body.trim().length > 0);
    if (ready.length === 0) {
      progressText.textContent = '⚠ Aucun mail avec corps disponible — relance la sync d\'abord.';
      return { totalPushed: 0, errors: [], skipped: 0 };
    }

    if (pushOtherBtn) pushOtherBtn.disabled = true;
    if (pushTargetSelect) pushTargetSelect.disabled = true;
    const restoreUI = () => {
      if (pushOtherBtn) pushOtherBtn.disabled = false;
      if (pushTargetSelect) pushTargetSelect.disabled = false;
    };

    // Chunk into batches of 25 to keep individual POST payloads
    // under a reasonable size (~5 MB worst case with 20k-char
    // bodies). Failures on one chunk don't roll back the previous
    // chunks — backend already dedup-by-message-id on the upsert.
    const BATCH_SIZE = 25;
    const chunks = [];
    for (let i = 0; i < ready.length; i += BATCH_SIZE) {
      chunks.push(ready.slice(i, i + BATCH_SIZE));
    }
    let totalPushed = 0;
    const errors = [];
    progressFill.style.width = '0%';
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      progressText.textContent = `📤 Push vers ${targetDomain} — batch ${i + 1}/${chunks.length} (${chunk.length} mail(s))…`;
      try {
        const lean = chunk.map(e => ({
          id: e.id,
          subject: e.subject,
          sender: e.sender,
          date: e.date,
          preview: e.preview,
          threadCount: e.threadCount,
          body: e.body,
          bodyChars: e.bodyChars || (e.body?.length || 0),
          syncedAt: e.syncedAt || new Date().toISOString(),
        }));
        await pushToBackend(lean, target);
        totalPushed += chunk.length;
      } catch (err) {
        errors.push(`batch ${i + 1}: ${err.message}`);
        // eslint-disable-next-line no-console
        console.warn('[SuiviTess sync] cross-domain push batch failed:', err);
      }
      progressFill.style.width = `${Math.round(((i + 1) / chunks.length) * 100)}%`;
    }

    if (errors.length === 0) {
      progressText.textContent = `✓ ${totalPushed} mail(s) poussés vers ${targetDomain}.`;
      barSub.textContent = `Push réussi vers ${targetDomain} · ${totalPushed} mail(s) · ${new Date().toLocaleTimeString()}`;
    } else {
      progressText.textContent = `⚠ Push partiel : ${totalPushed}/${ready.length} mail(s) poussés. ${errors.length} échec(s) de batch — voir la console.`;
      barSub.textContent = `Push partiel vers ${targetDomain}`;
    }
    restoreUI();
    return { totalPushed, errors, skipped: emails.length - ready.length };
  }

  if (pushOtherBtn && pushTargetSelect) {
    pushOtherBtn.addEventListener('click', async () => {
      const target = resolvePushTarget();
      if (!target) return;
      const targetDomain = (() => { try { return new URL(target).host; } catch { return target; } })();
      const ready = emails.filter(e => e.body && e.body.trim().length > 0);
      if (ready.length === 0) {
        progressText.textContent = '⚠ Aucun mail avec corps disponible — relance la sync d\'abord.';
        return;
      }
      const skipped = emails.length - ready.length;
      const confirmed = window.confirm(
        `Pousser ${ready.length} mail(s) déjà extrait(s) vers ${targetDomain} ?\n\n` +
        (skipped > 0 ? `(${skipped} mail(s) sans corps seront ignorés)\n\n` : '') +
        `L'extension Outlook ne sera PAS sollicitée — c'est juste un envoi des données déjà en mémoire.\n\n` +
        `Tu dois être connecté(e) à ${targetDomain} dans un autre onglet (auth cookie requis).`,
      );
      if (!confirmed) return;
      await pushReadyEmailsTo(target);
    });
  }

  // ── Bridge helpers ─────────────────────────────────────────────────────
  function callOutlookTab(action, extra = {}) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(outlookTabId, { action, ...extra }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`Outlook tab unreachable: ${chrome.runtime.lastError.message}`));
          return;
        }
        if (!response?.success) {
          reject(new Error(response?.error || 'Erreur de scraping'));
          return;
        }
        resolve(response);
      });
    });
  }

  /** Read auth_token cookie via chrome.cookies for a specific target
   *  URL (extension tabs can't rely on credentials:'include' to
   *  inherit the user's session). Defaults to the current dashboard's
   *  serverUrl ; pass another origin for cross-domain push. */
  async function getAuthTokenFor(targetUrl) {
    const target = targetUrl || serverUrl;
    const candidates = [target];
    try {
      const u = new URL(target);
      if (u.hostname === 'localhost') {
        if (u.port !== '3010') candidates.push(`${u.protocol}//${u.hostname}:3010`);
        if (u.port !== '5170') candidates.push(`${u.protocol}//${u.hostname}:5170`);
      }
    } catch { /* ignore */ }
    for (const candidate of candidates) {
      const token = await new Promise(resolve => {
        chrome.cookies.get({ url: candidate, name: 'auth_token' }, (cookie) => {
          resolve(cookie?.value || '');
        });
      });
      if (token) return token;
    }
    return '';
  }

  // Backwards-compatible shim used by the existing scrape flow.
  async function getAuthToken() {
    return getAuthTokenFor(serverUrl);
  }

  /** POST a batch of scraped emails to the chosen backend. By default
   *  hits the dashboard's `serverUrl` (the one the user opened against)
   *  ; pass `targetUrl` to redirect to another domain — used by the
   *  "📤 Pousser" button to ship the same batch to prod / staging
   *  without re-running the Outlook scrape. */
  async function pushToBackend(payload, targetUrl) {
    const target = (targetUrl || serverUrl).replace(/\/+$/, '');
    const targetDomain = (() => { try { return new URL(target).host; } catch { return target; } })();
    const token = await getAuthTokenFor(target);
    if (!token) {
      throw new Error(`Non connecté à ${targetDomain}. Ouvre ${target} dans un onglet, connecte-toi, puis relance le push.`);
    }
    // Try /suivitess-api first (dev proxy), fall back to /suivitess/api
    // (prod nginx). Same dual-path strategy as the popup's apiFetch.
    const tryPaths = ['/suivitess-api/outlook/sync', '/suivitess/api/outlook/sync'];
    let lastErr = null;
    for (const path of tryPaths) {
      const url = `${target}${path}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ emails: payload }),
        });
        if (res.ok) return res.json();
        if (res.status === 404) { lastErr = new Error(`404 on ${path}`); continue; }
        const text = await res.text().catch(() => '');
        throw new Error(`Backend ${res.status}: ${text.slice(0, 200)}`);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Push failed');
  }

  /** Fire-and-forget : ship a failure event to the boilerplate
   *  `/extension/error` endpoint so admins can investigate via the
   *  admin dashboard instead of having to ask the user for their
   *  Chrome devtools console. Best-effort — never throws, never
   *  blocks the calling flow. */
  async function logExtensionError({ type, message, context }) {
    try {
      const token = await getAuthTokenFor(serverUrl);
      if (!token) return;
      const target = serverUrl.replace(/\/+$/, '');
      const tryPaths = ['/suivitess-api/extension/error', '/suivitess/api/extension/error'];
      for (const path of tryPaths) {
        try {
          const res = await fetch(`${target}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              type: type || 'unknown',
              message: String(message || '').slice(0, 1000),
              context: context || null,
              plugin_version: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || null,
              user_agent: navigator.userAgent.slice(0, 200),
            }),
          });
          if (res.ok || res.status === 404) {
            // 404 means the endpoint isn't deployed yet — try the next path.
            if (res.ok) return;
          } else {
            return; // non-404 non-ok → endpoint exists but rejected, stop trying
          }
        } catch { /* try next path */ }
      }
    } catch {
      // Never let the logger crash the calling flow.
    }
  }

  // ── Listeners for live progress from outlook content script ───────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.action === 'bodiesProgress') {
      // Mark the email at index `done` as extracting, the previous one as ok/empty
      const idx = msg.done;
      if (idx > 0 && emails[idx - 1] && emails[idx - 1].status === 'extracting') {
        // The content script doesn't tell us the body length here ; we'll
        // collect it from the final response. Just clear the spinner.
        emails[idx - 1].status = 'queued'; // placeholder until enrichment
      }
      if (emails[idx]) {
        emails[idx].status = 'extracting';
      }
      progressText.textContent = `Extraction du corps — ${idx + 1}/${msg.total} · ${(msg.subject || '').slice(0, 60)}`;
      progressFill.style.width = `${Math.round((idx / msg.total) * 100)}%`;
      renderTable();
      updateStats();
    }
  });

  // ── Debugger-based click helpers ──────────────────────────────────────
  // chrome.debugger lets us dispatch trusted (isTrusted=true) input
  // events that Outlook actually honours — synthetic JS clicks have
  // isTrusted=false and the reading pane never opens. Attach once,
  // dispatch press/release per row, detach at end. Banner showing
  // "Cette extension débogue cet onglet" appears on the Outlook tab
  // throughout the sync — that's the cost of trusted events.

  let dbgAttached = false;
  const dbgTarget = { tabId: outlookTabId };

  async function dbgAttach() {
    if (dbgAttached) return;
    await chrome.debugger.attach(dbgTarget, '1.3');
    dbgAttached = true;
    // If the user closes the Outlook tab mid-sync the debugger auto-
    // detaches — keep the flag in sync so we don't try to send
    // commands afterwards.
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId === outlookTabId) dbgAttached = false;
    });
  }

  async function dbgDetach() {
    if (!dbgAttached) return;
    try { await chrome.debugger.detach(dbgTarget); } catch { /* already gone */ }
    dbgAttached = false;
  }

  async function trustedClickAt(x, y) {
    // Some Outlook builds bind their selection logic on a hover-then-
    // click sequence — fire `mouseMoved` first so React's synthetic
    // event tree sees a stable target before the press.
    await chrome.debugger.sendCommand(dbgTarget, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y, button: 'none',
    });
    await new Promise(r => setTimeout(r, 30));
    await chrome.debugger.sendCommand(dbgTarget, 'Input.dispatchMouseEvent', {
      type: 'mousePressed', x, y, button: 'left', clickCount: 1,
    });
    await new Promise(r => setTimeout(r, 30));
    await chrome.debugger.sendCommand(dbgTarget, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
    });
  }

  async function getRowRect(convId) {
    return callOutlookTab('getRowRect', { convId });
  }

  async function getReadingPaneSig() {
    const r = await callOutlookTab('getReadingPaneSignature').catch(() => ({ signature: '', subject: '' }));
    return { sig: r.signature || '', subject: r.subject || '' };
  }

  async function waitForPaneChange(prev, expectedSubject, timeoutMs = 5000) {
    // Two parallel signals : either (a) the subject heading in the
    // reading pane matches our target, OR (b) the inner-text snapshot
    // changes substantially. Either is enough to say "the pane has
    // loaded a different mail". Subject-match is the strong signal,
    // sig-diff is the fallback when Outlook doesn't expose the
    // heading where we expect it.
    //
    // Logs each iteration's snapshot so we can see in the console
    // exactly when/why the loop bailed. Cold-cache first click can
    // take ~3-4s — 5s ceiling balances responsiveness vs missed
    // detections.
    const start = Date.now();
    const expectedNorm = (expectedSubject || '').trim().toLowerCase().slice(0, 80);
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 100));
      const cur = await getReadingPaneSig();
      const subjMatch = expectedNorm
        && cur.subject
        && cur.subject.trim().toLowerCase().includes(expectedNorm);
      const sigChanged = cur.sig && cur.sig !== prev.sig && cur.sig.length > 20;
      if (subjMatch || sigChanged) {
        await new Promise(r => setTimeout(r, 150)); // settle
        return true;
      }
    }
    // eslint-disable-next-line no-console
    console.warn('[SuiviTess sync] pane change timeout', {
      expected: expectedSubject?.slice(0, 60),
      lastSubject: (await getReadingPaneSig()).subject?.slice(0, 60),
    });
    return false;
  }

  // Adaptive scroll position kept across iterations — after each
  // successful body fetch we advance it slightly so the just-clicked
  // row drifts off-screen and the next one scrolls into the
  // virtuoso render window. This survives variable row heights
  // (notifications/calendar invites are taller than plain mails).
  let listScrollTop = 0;

  async function fetchBodyForEmail(email) {
    // 1) Jump to the row's absolute Y position recorded at scrape
    // time (canvasY = top - rootTop + container.scrollTop). This
    // is the row's stable coordinate inside virtuoso's canvas — it
    // doesn't change when we scroll, only when rows are added/
    // removed above. Subtract a small margin so the row is just
    // inside the viewport, not glued to the top.
    const VIEWPORT_MARGIN = 100;
    let rectResp = null;
    const canvasY = typeof email.scrollTopAtCapture === 'number'
      ? email.scrollTopAtCapture
      : null;

    if (canvasY !== null) {
      try {
        const r = await callOutlookTab('scrollAndGetRect', {
          convId: email.id,
          targetScrollTop: Math.max(0, canvasY - VIEWPORT_MARGIN),
        });
        if (r?.success) rectResp = r;
      } catch { /* fall through */ }
    }

    // Two short fallbacks if the absolute Y missed (e.g. virtuoso
    // freshly added a notification banner above the list, shifting
    // every row down). Try ±300px around the captured Y.
    if (!rectResp) {
      for (const delta of [300, -300, 600, -600]) {
        const probe = Math.max(0, (canvasY ?? 0) - VIEWPORT_MARGIN + delta);
        try {
          const r = await callOutlookTab('scrollAndGetRect', {
            convId: email.id,
            targetScrollTop: probe,
          });
          if (r?.success) { rectResp = r; break; }
        } catch { /* swallow */ }
      }
    }

    if (!rectResp?.success || !rectResp.rect) {
      // eslint-disable-next-line no-console
      console.warn('[SuiviTess sync] row missed', { id: email.id, canvasY, subject: email.subject?.slice(0, 60) });
      return { ok: false, body: null, error: `row not found (canvasY=${canvasY})` };
    }
    listScrollTop = canvasY ?? listScrollTop;

    // 2) Capture pane signature before, dispatch trusted click, wait
    // for either the subject to match `email.subject` OR the snapshot
    // inner-text to change.
    const before = await getReadingPaneSig();
    try {
      await trustedClickAt(rectResp.rect.x, rectResp.rect.y);
    } catch (err) {
      return { ok: false, body: null, error: `click: ${err.message}` };
    }
    const changed = await waitForPaneChange(before, email.subject);
    if (!changed) {
      return { ok: false, body: null, error: 'reading pane did not load (timeout)' };
    }

    // 3) Skip the thread-expand call when the row's threadCount is 1
    // (no replies to unfold). Saves ~50ms per single-message mail.
    if (email.threadCount && email.threadCount > 1) {
      try { await callOutlookTab('expandThreadMessages'); } catch { /* ignore */ }
      await new Promise(r => setTimeout(r, 150));
    }

    let bodyResp;
    try {
      bodyResp = await callOutlookTab('getEmailBody', { id: email.id });
    } catch (err) {
      return { ok: false, body: null, error: `body: ${err.message}` };
    }
    const body = bodyResp?.body || '';

    // Stabilisation pause — Outlook batches mark-as-read updates
    // and re-renders the inbox list every ~3-4 clicks. If the next
    // iteration races against that re-flow, the lookup misses.
    // 350ms is just enough to let the list settle without dragging
    // the total wall time too much.
    await new Promise(r => setTimeout(r, 350));

    // Threshold lowered from 20 → 5 chars — short auto-replies
    // ("ok", "lu", "merci !") are still legitimate body content.
    if (body.length < 5) return { ok: false, body: null, error: 'empty body extracted' };
    return { ok: true, body, error: null };
  }

  // ── Main flow ─────────────────────────────────────────────────────────
  // Sync flow extracted into a named function so the "🔄 Relancer la
  // sync" button can re-invoke it without reloading the page. Each
  // call re-attaches the debugger if needed, switches focus back to
  // the Outlook tab, and reuses the existing in-memory `emails` array
  // (so previously-OK rows stay 'ok' and aren't re-clicked).
  let syncRunning = false;
  async function runSync() {
    // Replay mode : just hydrate from chrome.storage.local and stop.
    // Used when the popup re-opens the dashboard from history without
    // wanting to trigger a fresh scrape. Also kicks in when the
    // dashboard URL is missing the Outlook tabId.
    if (replayMode || !outlookTabId) {
      const snap = await loadSnapshot();
      if (snap) {
        emails = (snap.emails || []).map(e => ({ ...e, bodyChars: e.bodyChars || (e.body?.length || 0) }));
        progressFill.style.width = '100%';
        progressText.textContent = `Dernière synchro : ${new Date(snap.syncedAt).toLocaleString('fr-FR')} sur ${snap.serverDomain}`;
        barSub.textContent = `Mode lecture — ${emails.length} mail(s) issus de la dernière synchro. Clique 'Relancer la sync' pour repartir.`;
        renderTable();
        updateStats();
        retryBtn.textContent = '↻ Relancer une sync complète';
        retryBtn.disabled = false;
        retryBtn.removeEventListener('click', retryFailed);
        retryBtn.addEventListener('click', () => {
          window.location.search = `?tabId=${outlookTabId || ''}&serverUrl=${encodeURIComponent(serverUrl)}`;
        });
        return;
      }
      if (!outlookTabId) {
        barSub.textContent = '⚠ Aucun onglet Outlook fourni — relance depuis le popup.';
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Erreur : tabId manquant.</td></tr>';
        return;
      }
    }

    // Hydrate the previousById map. Two cases :
    //  • First run : load from chrome.storage.local snapshot, mark
    //    every row as wasInPreviousRun.
    //  • Refresh button : reuse the in-memory `emails` array — every
    //    row already has its status/body. Don't reload from storage,
    //    that would discard fresh extractions made in this session.
    const previousById = new Map();
    if (emails.length === 0) {
      const previous = await loadSnapshot();
      if (previous?.emails?.length) {
        emails = previous.emails.map(e => ({
          ...e,
          bodyChars: e.bodyChars || (e.body?.length || 0),
          status: e.status || 'ok',
          wasInPreviousRun: true,
        }));
        const okCount = emails.filter(e => e.status === 'ok').length;
        barSub.textContent = `Pré-chargé : ${emails.length} mails de la sync du ${new Date(previous.syncedAt).toLocaleString('fr-FR')} (${okCount} avec corps) — recherche des nouveautés…`;
      }
    }
    for (const e of emails) {
      previousById.set(e.id, e);
      // Drop any "newSinceLastRun" / "stale" flag from the previous
      // round — they'll be recomputed against the upcoming scrape.
      e.isNewSinceLastRun = false;
      e.isStale = false;
      // Anything we'd marked as previous-run stays that way ; freshly-
      // OK rows from this session also count as "previous" for the
      // next scrape.
      if (!e.wasInPreviousRun) e.wasInPreviousRun = true;
    }
    renderTable();
    updateStats();

    barSub.textContent = `Onglet Outlook #${outlookTabId} · destination : ${serverUrl}`;
    progressText.textContent = 'Lecture de la liste des mails…';

    // 1) List — scrape only the inbox tab the user is currently on
    // (typically "Prioritaire"). Per user direction, we don't crawl
    // "Autres" — those mails are intentionally filtered out.
    let listResp;
    try {
      listResp = await callOutlookTab('getEmails');
    } catch (err) {
      barSub.textContent = `⚠ ${err.message}`;
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
      return;
    }

    // Merge strategy : a mail seen for the first time is added with
    // status='new' (treated by downstream as 'queued' for fetch).
    // A mail already in the previous snapshot keeps its status —
    // we won't re-fetch its body unless it's marked 'failed'/'empty'.
    // This preserves the "what's been done" view across runs.
    const incoming = listResp.items || [];
    const incomingIds = new Set(incoming.map(e => e.id));
    const merged = [];
    for (const inc of incoming) {
      const prev = previousById.get(inc.id);
      if (prev) {
        // Refresh metadata (subject/sender/date may have changed) but
        // keep body/status/error from the last run.
        merged.push({
          ...prev,
          subject: inc.subject ?? prev.subject,
          sender: inc.sender ?? prev.sender,
          date: inc.date ?? prev.date,
          preview: inc.preview ?? prev.preview,
          threadCount: inc.threadCount ?? prev.threadCount,
        });
      } else {
        merged.push({
          ...inc,
          body: null,
          bodyChars: inc.preview ? inc.preview.length : 0,
          status: 'queued',
          isNewSinceLastRun: true,
        });
      }
    }
    // Keep mails from previous runs that aren't in this scrape (older
    // than 7 days now) ONLY if they had a body — they're history, the
    // user can still inspect them.
    for (const prev of emails) {
      if (!incomingIds.has(prev.id) && prev.body) {
        merged.push({ ...prev, isStale: true });
      }
    }
    emails = merged;
    if (emails.length === 0) {
      barSub.textContent = '⚠ Aucun mail trouvé sur la page Outlook.';
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucun mail à synchroniser.</td></tr>';
      return;
    }
    renderTable();
    updateStats();

    // 2) Body extraction via chrome.debugger (trusted clicks).
    // Chrome throttles background tabs : when the user switches to
    // this dashboard, the Outlook tab loses CPU/DOM activity and
    // the reading pane stops rendering — every body comes back
    // empty. We ACTIVATE the Outlook tab for the duration of the
    // scrape, then return the user to the dashboard at the end.
    // The dashboard itself runs the orchestration via extension
    // APIs (chrome.debugger / chrome.tabs.sendMessage) which are
    // NOT subject to background-tab throttling, so the loop keeps
    // ticking even when the user is staring at Outlook.
    let dashboardTabId = null;
    try {
      dashboardTabId = (await chrome.tabs.getCurrent())?.id ?? null;
    } catch { /* fall back to detached behavior */ }

    progressText.textContent = `Connexion DevTools à l'onglet Outlook…`;
    try {
      await dbgAttach();
    } catch (err) {
      barSub.textContent = `⚠ Impossible d'attacher le débogueur : ${err.message}`;
      progressText.textContent = `⚠ ${err.message}`;
      return;
    }

    // Bring Outlook to the foreground so the page actually renders
    // while we click through it. Best-effort — if the user has
    // closed the tab we error out cleanly.
    try {
      await chrome.tabs.update(outlookTabId, { active: true });
      const outlookTab = await chrome.tabs.get(outlookTabId);
      if (outlookTab?.windowId != null) {
        await chrome.windows.update(outlookTab.windowId, { focused: true });
      }
    } catch (err) {
      progressText.textContent = `⚠ Onglet Outlook fermé : ${err.message}`;
      await dbgDetach();
      return;
    }

    barSub.textContent = `Outlook au premier plan pendant la sync — re-bascule auto à la fin · destination ${serverUrl}`;

    // Wrap every iteration in its own try/catch so an Outlook re-render,
    // a stale signature or a transient debugger drop on one row doesn't
    // tank the whole loop. We also auto-re-attach the debugger between
    // iterations if Chrome reports it detached (typically happens when
    // Outlook reloads the SPA, e.g. after a background session refresh).
    async function safeFetch(email) {
      try {
        if (!dbgAttached) {
          // eslint-disable-next-line no-console
          console.warn('[SuiviTess sync] debugger detached mid-loop — re-attaching');
          await dbgAttach();
        }
        return await fetchBodyForEmail(email);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[SuiviTess sync] iteration error', err);
        return { ok: false, body: null, error: err?.message || String(err) };
      }
    }

    // Identify the rows that actually need body extraction this run :
    // either fresh queued mails (new since last sync) or rows that
    // failed / came back empty before (we re-try them). Already-OK
    // rows are SKIPPED — saves a ton of time and respects the "what's
    // already done" view on the dashboard.
    const toProcess = emails.filter(e =>
      e.status === 'queued' || e.status === 'failed' || e.status === 'empty',
    );
    if (toProcess.length === 0) {
      progressFill.style.width = '90%';
      progressText.textContent = `Aucun nouveau mail à analyser — tout le snapshot est déjà à jour.`;
    }

    // eslint-disable-next-line no-console
    console.log(`[SuiviTess sync] body-fetch loop : ${toProcess.length} mails à traiter`);
    for (let i = 0; i < toProcess.length; i++) {
      const e = toProcess[i];
      const tag = `${i + 1}/${toProcess.length}`;
      e.status = 'extracting';
      const pct = Math.round((i / toProcess.length) * 90);
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `Lecture du corps — ${tag} (${pct}%) · ${(e.subject || '').slice(0, 60)}`;
      renderTable();
      updateStats();

      let result;
      try {
        result = await safeFetch(e);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[SuiviTess sync] ${tag} FATAL`, err);
        result = { ok: false, body: null, error: `fatal: ${err?.message || err}` };
      }

      if (result.ok) {
        e.body = result.body;
        e.bodyChars = result.body.length;
        e.status = 'ok';
        e.error = undefined;
        // eslint-disable-next-line no-console
        console.log(`[SuiviTess sync] ${tag} ✓ ${result.body.length} chars · ${(e.subject || '').slice(0, 50)}`);
      } else {
        e.body = null;
        e.bodyChars = e.preview ? e.preview.length : 0;
        e.status = 'empty';
        e.error = result.error;
        // eslint-disable-next-line no-console
        console.warn(`[SuiviTess sync] ${tag} ✗ ${result.error} · ${(e.subject || '').slice(0, 50)}`);
      }

      // Persist after each iteration so a crash mid-loop doesn't lose
      // the partial progress — the user can reopen and resume.
      if ((i + 1) % 5 === 0) {
        try { await persistSnapshot(); } catch { /* ignore */ }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[SuiviTess sync] body-fetch loop terminée — ok:${emails.filter(x=>x.status==='ok').length} / empty:${emails.filter(x=>x.status==='empty').length} / failed:${emails.filter(x=>x.status==='failed').length}`);

    await dbgDetach();

    // Bring the user back to the dashboard now that the loud part
    // is over. Wrapped in try/catch — if the dashboard tab id was
    // never resolved (chrome.tabs.getCurrent failed at boot) we
    // skip silently, the user can switch back manually.
    if (dashboardTabId) {
      try {
        await chrome.tabs.update(dashboardTabId, { active: true });
      } catch { /* ignore */ }
    }

    // 3) Push everything (with bodies when we got them) to the backend.
    //
    // CHUNKED + retry strategy : a single batch failure used to flip
    // EVERY mail (potentially 100+) to "failed" because the whole
    // payload was sent in one fetch. Now we slice into 25-mail
    // chunks ; each chunk gets 3 retries with exponential backoff on
    // transient "Failed to fetch" / 5xx ; only the mails inside a
    // permanently-failed chunk are flipped to failed. The rest stays
    // OK so the user doesn't lose 95 mails because the 96th's chunk
    // timed out.
    progressText.textContent = `Push vers ${serverDomain}…`;
    progressFill.style.width = '92%';
    const BATCH_SIZE = 25;
    const payload = emails.map(e => ({
      id: e.id,
      subject: e.subject || '(sans objet)',
      sender: e.sender || 'Inconnu',
      date: e.date || '',
      preview: e.preview || '',
      body: e.body || null,
      threadCount: e.threadCount || 1,
    }));
    const chunks = [];
    for (let i = 0; i < payload.length; i += BATCH_SIZE) {
      chunks.push(payload.slice(i, i + BATCH_SIZE));
    }
    let totalStored = 0;
    let totalSkipped = 0;
    const allBackendErrors = [];
    const fatalChunkErrors = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const pct = 92 + Math.round((i / chunks.length) * 7);
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `Push vers ${serverDomain} — batch ${i + 1}/${chunks.length} (${chunk.length} mail(s))…`;
      let attempt = 0;
      let chunkResult = null;
      let lastErr = null;
      while (attempt < 3 && !chunkResult) {
        attempt++;
        try {
          chunkResult = await pushToBackend(chunk);
        } catch (err) {
          lastErr = err;
          // Only retry on transient errors — "Failed to fetch" (network
          // blip), TypeError, or 5xx. Permanent errors (401, 404, 400)
          // are useless to retry.
          const msg = err?.message || String(err);
          const transient = /Failed to fetch|NetworkError|timeout|50\d/i.test(msg);
          if (!transient || attempt >= 3) break;
          const wait = (2 ** attempt) * 500 + Math.random() * 300; // 0.5-1.3s, 1-2.6s
          // eslint-disable-next-line no-console
          console.warn(`[SuiviTess sync] chunk ${i + 1} attempt ${attempt} failed (${msg}) — retrying in ${wait}ms`);
          await new Promise(r => setTimeout(r, wait));
        }
      }
      if (chunkResult) {
        totalStored += chunkResult.stored || 0;
        totalSkipped += chunkResult.skipped || 0;
        if (Array.isArray(chunkResult.errors)) {
          allBackendErrors.push(...chunkResult.errors);
        }
      } else {
        // Permanent chunk failure — record so we can flip ONLY these
        // mails to failed, and ship the error to the backend log.
        fatalChunkErrors.push({
          chunkIndex: i,
          messageIds: chunk.map(m => m.id),
          error: lastErr?.message || 'unknown',
        });
        // eslint-disable-next-line no-console
        console.error(`[SuiviTess sync] chunk ${i + 1} permanently failed after 3 attempts:`, lastErr);
        // Fire-and-forget : log to the boilerplate DB so the user can
        // see this in the admin dashboard later — failing silently
        // here was making "all my last mails are in error" inscrutable.
        void logExtensionError({
          type: 'push_chunk_failed',
          message: lastErr?.message || 'unknown',
          context: {
            chunkIndex: i,
            chunkSize: chunk.length,
            messageIds: chunk.map(m => m.id),
            domain: serverDomain,
          },
        });
      }
    }

    // Apply the results back to the in-memory list.
    progressFill.style.width = '100%';
    const errIds = new Set(allBackendErrors.map(x => x.messageId));
    const fatalIds = new Set(fatalChunkErrors.flatMap(c => c.messageIds));
    for (const e of emails) {
      if (errIds.has(e.id)) {
        e.status = 'failed';
        const found = allBackendErrors.find(x => x.messageId === e.id);
        e.error = found?.reason || 'INSERT failed';
      } else if (fatalIds.has(e.id)) {
        e.status = 'failed';
        const found = fatalChunkErrors.find(c => c.messageIds.includes(e.id));
        e.error = `Push échoué (3 tentatives) : ${found?.error || 'unknown'}`;
      } else if (e.status === 'ok') {
        e.syncedAt = new Date().toISOString();
      }
    }
    const withBody = emails.filter(e => e.bodyChars > 20).length;
    if (fatalChunkErrors.length === 0) {
      progressText.textContent = `✓ ${totalStored} mail(s) synchronisé(s)${totalSkipped ? ` · ${totalSkipped} ignoré(s)` : ''} sur ${serverDomain}`;
      barSub.textContent = `Sync OK — ${totalStored}/${emails.length} stockés · ${withBody} avec corps complet`;
    } else {
      progressText.textContent = `⚠ Sync partielle : ${totalStored}/${emails.length} stockés · ${fatalIds.size} échec(s) après retries`;
      barSub.textContent = `Sync partielle — ${fatalChunkErrors.length} batch(s) en erreur, voir la console`;
    }
    renderTable();
    updateStats();
    retryBtn.disabled = emails.filter(e => e.status === 'failed').length === 0;

    // Persist the final state so reloading the dashboard surfaces
    // the last sync without having to re-run everything.
    await persistSnapshot();
  }

  // Wire the "🔄 Relancer la sync" button + auto-launch on page load.
  const refreshBtn = $('refresh-btn');
  async function triggerSync() {
    if (syncRunning) return;
    syncRunning = true;
    if (refreshBtn) refreshBtn.disabled = true;
    try {
      await runSync();
      // Auto-push at the end of every sync — runs the same pipeline
      // as the "📤 Pousser" button (resolve target → filter → chunk
      // → POST each batch) but skips the confirm dialog. The user
      // controls the target via the dropdown ; "__custom__" is
      // skipped since it requires a prompt() we can't auto-answer.
      if (pushTargetSelect && pushTargetSelect.value !== '__custom__') {
        const target = resolvePushTarget();
        if (target) await pushReadyEmailsTo(target);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[SuiviTess sync] runSync threw', err);
      progressText.textContent = `⚠ Sync interrompue : ${err?.message || err}`;
    } finally {
      syncRunning = false;
      if (refreshBtn) refreshBtn.disabled = false;
    }
  }
  refreshBtn?.addEventListener('click', () => { triggerSync(); });

  // Auto-launch on first load (preserves the previous behaviour).
  triggerSync();

  // Detach the debugger if the dashboard tab is closed mid-sync.
  window.addEventListener('beforeunload', () => {
    if (dbgAttached) {
      try { chrome.debugger.detach(dbgTarget); } catch { /* ignore */ }
    }
  });

  // ── Retry failed ──────────────────────────────────────────────────────
  async function retryFailed() {
    retryBtn.disabled = true;
    const toRetry = emails.filter(e => e.status === 'failed');
    if (toRetry.length === 0) return;

    progressText.textContent = `Rejeu de ${toRetry.length} échec(s)…`;
    progressFill.style.width = '0%';

    // Re-trigger body fetch for the failed ones only.
    try {
      const resp = await callOutlookTab('getEmailsWithBodies');
      const byId = new Map((resp.items || []).map(e => [e.id, e]));
      for (const e of toRetry) {
        const fresh = byId.get(e.id);
        if (fresh && fresh.body && fresh.body.length > 20) {
          e.body = fresh.body;
          e.bodyChars = fresh.body.length;
          e.status = 'ok';
          e.error = undefined;
        }
      }
      renderTable();
      updateStats();

      // Re-push the now-ok ones
      const payload = toRetry
        .filter(e => e.status === 'ok')
        .map(e => ({
          id: e.id, subject: e.subject, sender: e.sender, date: e.date,
          preview: e.preview, body: e.body, threadCount: e.threadCount || 1,
        }));
      if (payload.length > 0) {
        await pushToBackend(payload);
      }
      progressText.textContent = `✓ Retry terminé`;
    } catch (err) {
      progressText.textContent = `⚠ Retry échoué : ${err.message}`;
    }
    retryBtn.disabled = emails.filter(e => e.status === 'failed').length === 0;
  }

  // ── Render ────────────────────────────────────────────────────────────
  // Tracks which rows are currently expanded (key = email.id) so the
  // expansion survives re-renders triggered by the live progress
  // updates during the sync.
  const expandedIds = new Set();

  function renderTable() {
    const filterTxt = filterInput.value.trim().toLowerCase();
    const filterStatus = statusFilter.value;
    const visible = emails.filter(e => {
      if (filterStatus && e.status !== filterStatus) return false;
      if (!filterTxt) return true;
      return (e.subject || '').toLowerCase().includes(filterTxt)
        || (e.sender || '').toLowerCase().includes(filterTxt);
    });
    if (visible.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucun mail correspondant.</td></tr>';
      return;
    }
    const html = visible.map(e => {
      const isExpanded = expandedIds.has(e.id);
      const hasBody = e.body && e.body.length > 0;
      const bodyExcerpt = hasBody ? e.body.slice(0, 20000) : '';
      const previewText = !hasBody && e.preview ? e.preview : '';
      const expandRow = isExpanded ? `
        <tr class="row-expanded">
          <td colspan="6" class="expanded-cell">
            ${hasBody
              ? `<pre class="body-text">${escapeHtml(bodyExcerpt)}</pre>`
              : previewText
                ? `<div class="body-preview-only"><strong>Preview seule</strong> (corps non récupéré) :<br>${escapeHtml(previewText)}</div>`
                : `<div class="body-empty">Aucun contenu capturé.</div>`}
          </td>
        </tr>
      ` : '';
      // Origin marker — clarifies WHY a row is in this state :
      //   • new     — first time seen, freshly captured this run
      //   • old     — already extracted in a previous sync, untouched
      //   • stale   — older than 7 days, kept for history view only
      const originBadge = e.isNewSinceLastRun
        ? '<span class="origin-badge new" title="Nouveau mail détecté lors de cette sync">✨ nouveau</span>'
        : e.isStale
          ? '<span class="origin-badge stale" title="Plus dans la fenêtre 7 jours — historique">📦 ancien</span>'
          : e.wasInPreviousRun
            ? '<span class="origin-badge prev" title="Synchronisé lors d\'une session précédente">↺ précédent</span>'
            : '';
      return `
        <tr class="row-${e.status} expandable ${e.wasInPreviousRun ? 'row-from-prev' : ''}" data-id="${escapeHtml(e.id)}">
          <td><span class="status-badge ${e.status}">${labelFor(e.status)}</span></td>
          <td class="cell-date">${escapeHtml(formatShortDate(e.date))}</td>
          <td class="cell-sender" title="${escapeHtml(e.sender || '')}">${escapeHtml((e.sender || '').slice(0, 50))}</td>
          <td class="cell-subject" title="${escapeHtml(e.subject || '')}">
            <span class="expand-toggle" aria-expanded="${isExpanded}">${isExpanded ? '▾' : '▸'}</span>
            ${escapeHtml(e.subject || '(sans objet)')}
            ${originBadge}
          </td>
          <td class="cell-thread">${e.threadCount && e.threadCount > 1 ? '💬 ' + e.threadCount : '·'}</td>
          <td class="cell-body ${e.bodyChars > 20 ? 'has' : 'empty'}">${e.bodyChars > 0 ? e.bodyChars + ' c.' : '—'}</td>
        </tr>
        ${e.error ? `<tr class="row-failed"><td colspan="6" style="padding:4px 12px 8px 130px;color:var(--err);font-size:11px">⚠ ${escapeHtml(e.error.slice(0, 200))}</td></tr>` : ''}
        ${expandRow}
      `;
    }).join('');
    tbody.innerHTML = html;

    // Wire expand/collapse on click — limited to the subject cell so
    // the row's surrounding chrome (status badge, date) remains
    // non-interactive.
    for (const tr of tbody.querySelectorAll('tr.expandable')) {
      const id = tr.getAttribute('data-id');
      const subjectCell = tr.querySelector('.cell-subject');
      subjectCell?.addEventListener('click', () => {
        if (expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
        renderTable();
      });
    }
  }

  function updateStats() {
    let ok = 0, warn = 0, err = 0, queue = 0;
    for (const e of emails) {
      if (e.status === 'ok') ok++;
      else if (e.status === 'empty') warn++;
      else if (e.status === 'failed') err++;
      else queue++;
    }
    stats.ok.textContent = ok;
    stats.warn.textContent = warn;
    stats.err.textContent = err;
    stats.queue.textContent = queue;
  }

  function labelFor(s) {
    return ({
      queued: 'En file',
      extracting: 'En cours',
      ok: 'Sync',
      empty: 'Sans corps',
      failed: 'Échec',
    })[s] || s;
  }

  function formatShortDate(s) {
    if (!s) return '—';
    const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')} ${m[4].padStart(2, '0')}:${m[5]}`;
    return s.slice(0, 20);
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
