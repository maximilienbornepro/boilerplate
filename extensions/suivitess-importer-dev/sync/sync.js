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

  /** Read auth_token cookie via chrome.cookies (extension tabs can't
   *  rely on credentials:'include' to inherit the user's session). */
  async function getAuthToken() {
    const candidates = [serverUrl];
    try {
      const u = new URL(serverUrl);
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

  async function pushToBackend(payload) {
    const token = await getAuthToken();
    if (!token) {
      throw new Error(`Non connecté à ${serverDomain}. Ouvre le serveur et connecte-toi, puis relance la sync.`);
    }
    // Try /suivitess-api first (dev proxy), fall back to /suivitess/api
    // (prod nginx). Same dual-path strategy as the popup's apiFetch.
    const tryPaths = ['/suivitess-api/outlook/sync', '/suivitess/api/outlook/sync'];
    let lastErr = null;
    for (const path of tryPaths) {
      const url = `${serverUrl.replace(/\/+$/, '')}${path}`;
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

  // ── Main flow ─────────────────────────────────────────────────────────
  (async function run() {
    if (!outlookTabId) {
      barSub.textContent = '⚠ Aucun onglet Outlook fourni — relance depuis le popup.';
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Erreur : tabId manquant.</td></tr>';
      return;
    }

    barSub.textContent = `Onglet Outlook #${outlookTabId} · destination : ${serverUrl}`;
    progressText.textContent = 'Lecture de la liste des mails…';

    // 1) List
    let listResp;
    try {
      listResp = await callOutlookTab('getEmails');
    } catch (err) {
      barSub.textContent = `⚠ ${err.message}`;
      tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${escapeHtml(err.message)}</td></tr>`;
      return;
    }
    emails = (listResp.items || []).map(e => ({
      ...e,
      body: null,
      bodyChars: 0,
      status: 'queued',
    }));
    if (emails.length === 0) {
      barSub.textContent = '⚠ Aucun mail trouvé sur la page Outlook.';
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Aucun mail à synchroniser.</td></tr>';
      return;
    }
    renderTable();
    updateStats();

    // 2) Body extraction (delegates to content script ; live progress
    //    via the chrome.runtime.onMessage above)
    progressText.textContent = `Préparation de l'extraction de ${emails.length} corps…`;
    let enriched;
    try {
      const resp = await callOutlookTab('getEmailsWithBodies');
      enriched = resp.items || [];
    } catch (err) {
      barSub.textContent = `⚠ Extraction interrompue : ${err.message}`;
      return;
    }

    // Merge body data back, mark statuses
    const byId = new Map(enriched.map(e => [e.id, e]));
    for (const e of emails) {
      const fresh = byId.get(e.id);
      if (fresh) {
        e.body = fresh.body || null;
        e.bodyChars = e.body ? e.body.length : 0;
        e.status = e.bodyChars > 20 ? 'ok' : 'empty';
      } else {
        e.status = 'failed';
        e.error = 'Pas dans la réponse de l\'extraction';
      }
    }
    progressFill.style.width = '70%';
    progressText.textContent = `Extraction terminée — push vers ${serverDomain}…`;
    renderTable();
    updateStats();

    // 3) Push to backend
    try {
      const payload = emails
        .filter(e => e.status !== 'failed')
        .map(e => ({
          id: e.id,
          subject: e.subject || '(sans objet)',
          sender: e.sender || 'Inconnu',
          date: e.date || '',
          preview: e.preview || '',
          body: e.body || null,
          threadCount: e.threadCount || 1,
        }));
      const result = await pushToBackend(payload);
      progressFill.style.width = '100%';
      const skipped = result.skipped || 0;
      const errs = Array.isArray(result.errors) ? result.errors : [];
      // Cross-reference per-email errors
      const errIds = new Set(errs.map(x => x.messageId));
      for (const e of emails) {
        if (errIds.has(e.id)) {
          e.status = 'failed';
          const found = errs.find(x => x.messageId === e.id);
          e.error = found?.reason || 'INSERT failed';
        } else if (e.status === 'ok' || e.status === 'empty') {
          e.syncedAt = new Date().toISOString();
        }
      }
      progressText.textContent = `✓ ${result.stored} mail(s) synchronisé(s)${skipped ? ` · ${skipped} ignoré(s)` : ''} sur ${serverDomain}`;
      barSub.textContent = `Sync OK — ${result.stored}/${emails.length} stockés. Tu peux fermer cet onglet.`;
    } catch (err) {
      progressText.textContent = `⚠ Push échoué : ${err.message}`;
      for (const e of emails) {
        if (e.status === 'ok' || e.status === 'empty') {
          e.status = 'failed';
          e.error = err.message;
        }
      }
    }
    renderTable();
    updateStats();
    retryBtn.disabled = emails.filter(e => e.status === 'failed').length === 0;
  })();

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
    const html = visible.map(e => `
      <tr class="row-${e.status}">
        <td><span class="status-badge ${e.status}">${labelFor(e.status)}</span></td>
        <td class="cell-date">${escapeHtml(formatShortDate(e.date))}</td>
        <td class="cell-sender" title="${escapeHtml(e.sender || '')}">${escapeHtml((e.sender || '').slice(0, 50))}</td>
        <td class="cell-subject" title="${escapeHtml(e.subject || '')}">${escapeHtml(e.subject || '(sans objet)')}</td>
        <td class="cell-thread">${e.threadCount && e.threadCount > 1 ? '💬 ' + e.threadCount : '·'}</td>
        <td class="cell-body ${e.bodyChars > 20 ? 'has' : 'empty'}">${e.bodyChars > 0 ? e.bodyChars + ' c.' : '—'}</td>
      </tr>
      ${e.error ? `<tr class="row-failed"><td colspan="6" style="padding:4px 12px 8px 130px;color:var(--err);font-size:11px">⚠ ${escapeHtml(e.error.slice(0, 200))}</td></tr>` : ''}
    `).join('');
    tbody.innerHTML = html;
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
