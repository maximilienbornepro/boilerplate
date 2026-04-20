// SuiviTess Importer — Popup logic
(() => {
  'use strict';

  // ==================== STATE ====================

  const ENV = window.__SUIVITESS_CONFIG || {};
  let serverUrl = '';
  let jwtToken = '';
  let provider = null; // 'outlook' | 'slack' | null
  let items = []; // scraped emails/messages
  let selectedIds = new Set();

  // ==================== DOM REFS ====================

  const $ = (id) => document.getElementById(id);
  const configSection = $('config-section');
  const statusSection = $('status');
  const providerBadge = $('provider-badge');
  const errorMsg = $('error-msg');
  const docSection = $('doc-section');
  const docSelect = $('doc-select');
  const modeSection = $('mode-section');
  const itemsSection = $('items-section');
  const itemsCount = $('items-count');
  const itemsList = $('items-list');
  const actionsSection = $('actions-section');
  const importBtn = $('import-btn');
  const progressSection = $('progress-section');
  const progressFill = $('progress-fill');
  const progressText = $('progress-text');
  const resultSection = $('result-section');
  const resultMsg = $('result-msg');
  const envBadge = $('env-badge');

  // ==================== BRAND LOGOS ====================

  /** Minimal Slack mark (4-color hash). Sized 12×12 to sit inline next to the
   *  badge label. Uses official Slack palette so the logo reads correctly
   *  on both the purple badge and any theme. */
  const SLACK_LOGO_SVG = `
    <svg class="provider-logo" width="12" height="12" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M22 37a5 5 0 1 1-5-5h5v5z" fill="#E01E5A"/>
      <path d="M24.5 37a5 5 0 0 1 10 0v12.5a5 5 0 0 1-10 0V37z" fill="#E01E5A"/>
      <path d="M29.5 17a5 5 0 1 1 5-5v5h-5z" fill="#ECB22E"/>
      <path d="M29.5 19.5a5 5 0 0 1 0 10H17a5 5 0 0 1 0-10h12.5z" fill="#ECB22E"/>
      <path d="M49.5 24.5a5 5 0 1 1 5 5h-5v-5z" fill="#2EB67D"/>
      <path d="M47 24.5a5 5 0 0 1-10 0V12a5 5 0 0 1 10 0v12.5z" fill="#2EB67D"/>
      <path d="M42 44.5a5 5 0 1 1-5 5v-5h5z" fill="#ECB22E"/>
      <path d="M42 42a5 5 0 0 1 0-10h12.5a5 5 0 0 1 0 10H42z" fill="#ECB22E"/>
    </svg>
  `;

  /** Simplified Outlook "O + envelope" mark in white — reads cleanly against
   *  the blue Outlook badge. */
  const OUTLOOK_LOGO_SVG = `
    <svg class="provider-logo" width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="1.5" fill="#fff"/>
      <path d="M2.5 6L12 13l9.5-7" stroke="#0078d4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <circle cx="8" cy="12" r="3" fill="#0078d4"/>
      <circle cx="8" cy="12" r="1.4" fill="#fff"/>
    </svg>
  `;

  function setProviderBadge(kind, label) {
    providerBadge.className = `badge badge-${kind}`;
    if (kind === 'slack') {
      providerBadge.innerHTML = SLACK_LOGO_SVG + `<span>${label}</span>`;
    } else if (kind === 'outlook') {
      providerBadge.innerHTML = OUTLOOK_LOGO_SVG + `<span>${label}</span>`;
    } else {
      providerBadge.textContent = label;
    }
  }

  // Dev build marker — visible "D" next to the header title.
  if (ENV.isDev && envBadge) envBadge.classList.remove('hidden');

  // ==================== CONFIG ====================

  async function getTokenFromCookie(url) {
    // Only look for the cookie on the configured server URL.
    // In dev, also check the backend port (3010) since Vite proxies
    // from 5170 but the cookie may be set on 5170.
    const candidates = [url];
    try {
      const u = new URL(url);
      if (u.hostname === 'localhost') {
        // Dev: also try other common local ports
        if (u.port !== '3010') candidates.push(`${u.protocol}//${u.hostname}:3010`);
        if (u.port !== '5170') candidates.push(`${u.protocol}//${u.hostname}:5170`);
      }
    } catch { /* invalid URL, try as-is */ }

    for (const candidate of candidates) {
      const token = await new Promise((resolve) => {
        chrome.cookies.get({ url: candidate, name: 'auth_token' }, (cookie) => {
          resolve(cookie?.value || '');
        });
      });
      if (token) return token;
    }
    return '';
  }

  async function loadConfig() {
    const data = await chrome.storage.local.get(['serverUrl']);
    serverUrl = data.serverUrl || ENV.defaultServerUrl || '';
    $('server-url').value = serverUrl;
    $('server-url').placeholder = ENV.defaultServerUrl || 'https://francetv.vitess.tech';

    if (serverUrl) {
      jwtToken = await getTokenFromCookie(serverUrl);
      const authStatus = $('auth-status');
      if (jwtToken) {
        authStatus.textContent = 'Connecte';
        authStatus.className = 'auth-status auth-ok';
      } else {
        authStatus.textContent = 'Non connecte — ouvrez le serveur et connectez-vous';
        authStatus.className = 'auth-status auth-error';
      }
    }
  }

  async function saveConfig() {
    serverUrl = $('server-url').value.trim().replace(/\/$/, '');
    await chrome.storage.local.set({ serverUrl });
    // Read token from cookie for this URL
    jwtToken = await getTokenFromCookie(serverUrl);
    const authStatus = $('auth-status');
    if (jwtToken) {
      authStatus.textContent = 'Connecte';
      authStatus.className = 'auth-status auth-ok';
      configSection.classList.add('hidden');
      init();
    } else {
      authStatus.textContent = 'Non connecte — ouvrez le serveur et connectez-vous d\'abord';
      authStatus.className = 'auth-status auth-error';
    }
  }

  // ==================== API HELPERS ====================

  /**
   * Resolve the API prefix. In dev (localhost), Vite proxies /suivitess-api/
   * to the backend's /suivitess/api/. In prod, nginx does the same but the
   * direct URL is /suivitess/api/. We auto-detect by trying /suivitess-api/
   * first and falling back to /suivitess/api/ if the server returns 404.
   */
  let apiPrefix = ENV.apiPrefix || '/suivitess-api';

  async function apiFetch(path, options = {}) {
    if (!jwtToken) {
      jwtToken = await getTokenFromCookie(serverUrl);
      if (!jwtToken) throw new Error('Non connecte — ouvrez le serveur et connectez-vous');
    }

    // Replace the /suivitess-api prefix with the resolved one
    const resolvedPath = path.replace(/^\/suivitess-api/, apiPrefix);

    const res = await fetch(`${serverUrl}${resolvedPath}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
        ...(options.headers || {}),
      },
    });

    // If 404 on the first attempt, try the alternative prefix once
    if (res.status === 404 && !options._retried) {
      const alt = apiPrefix === '/suivitess-api' ? '/suivitess/api' : '/suivitess-api';
      apiPrefix = alt;
      return apiFetch(path, { ...options, _retried: true });
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function loadDocuments() {
    try {
      const docs = await apiFetch('/suivitess-api/documents');
      docSelect.innerHTML = '<option value="">-- Choisir un document --</option>';
      for (const doc of docs) {
        const opt = document.createElement('option');
        opt.value = doc.id;
        opt.textContent = doc.title;
        docSelect.appendChild(opt);
      }
      docSection.classList.remove('hidden');
    } catch (err) {
      showError(`Impossible de charger les documents: ${err.message}`);
    }
  }

  // ==================== PROVIDER DETECTION ====================

  async function detectProvider() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { resolve(null); return; }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'detectProvider' }, (response) => {
          if (chrome.runtime.lastError || !response) { resolve(null); return; }
          resolve(response.provider || null);
        });
      });
    });
  }

  // ==================== SCRAPING ====================

  async function scrapeItems() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { reject(new Error('Pas d\'onglet actif')); return; }
        const action = provider === 'outlook' ? 'getEmails' : 'getMessages';
        chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error('Content script non charge. Rechargez la page.'));
            return;
          }
          if (!response?.success) {
            reject(new Error(response?.error || 'Erreur de scraping'));
            return;
          }
          resolve(response.items || []);
        });
      });
    });
  }

  // ==================== RENDERING ====================

  function renderItems() {
    itemsList.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = `item-row ${selectedIds.has(item.id) ? 'selected' : ''}`;

      const isEmail = provider === 'outlook';

      row.innerHTML = `
        <input type="checkbox" ${selectedIds.has(item.id) ? 'checked' : ''} />
        <div class="item-info">
          <div class="item-subject">${escapeHtml(isEmail ? item.subject : item.text?.slice(0, 80))}</div>
          <div class="item-meta">
            ${!isEmail && item.channel ? `<span class="item-channel">#${escapeHtml(item.channel)}</span>` : ''}
            ${escapeHtml(isEmail ? item.sender : item.sender)} - ${escapeHtml(item.date || '')}
          </div>
        </div>
      `;

      row.addEventListener('click', () => {
        if (selectedIds.has(item.id)) {
          selectedIds.delete(item.id);
        } else {
          selectedIds.add(item.id);
        }
        renderItems();
        updateImportBtn();
      });

      itemsList.appendChild(row);
    }
    itemsCount.textContent = `${items.length} elements`;
  }

  function updateImportBtn() {
    const count = selectedIds.size;
    importBtn.disabled = count === 0 || !docSelect.value;
    importBtn.textContent = count > 0 ? `Importer ${count} element${count > 1 ? 's' : ''}` : 'Importer la selection';
  }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.remove('hidden');
  }

  function hideError() {
    errorMsg.classList.add('hidden');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==================== IMPORT ====================

  async function doImport() {
    hideError();
    const docId = docSelect.value;
    if (!docId || selectedIds.size === 0) return;

    const mode = document.querySelector('input[name="mode"]:checked')?.value || 'analyze';
    const selected = items.filter(i => selectedIds.has(i.id));

    // Build aggregated content
    let content = '';
    const sourceName = provider === 'outlook' ? 'Outlook' : 'Slack';

    for (const item of selected) {
      if (provider === 'outlook') {
        const body = item.body || item.preview || '(contenu non disponible)';
        content += `=== Mail de ${item.sender} (${item.date}) ===\nObjet: ${item.subject}\n\n${body}\n\n`;
      } else {
        content += `=== ${item.channel ? '#' + item.channel + ' - ' : ''}${item.sender} (${item.date}) ===\n${item.fullText || item.text}\n\n`;
      }
    }

    if (content.trim().length < 50) {
      showError('Contenu trop court pour etre analyse. Verifiez que les mails sont bien charges.');
      itemsSection.classList.remove('hidden');
      actionsSection.classList.remove('hidden');
      modeSection.classList.remove('hidden');
      return;
    }

    const sourceTitle = `${selected.length} ${provider === 'outlook' ? 'mail' : 'message'}${selected.length > 1 ? 's' : ''}`;
    // Send individual item IDs for server-side dedup
    const itemIds = selected.map(i => i.id);

    // Show progress
    itemsSection.classList.add('hidden');
    actionsSection.classList.add('hidden');
    modeSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    progressFill.style.width = '30%';
    progressText.textContent = 'Envoi au serveur...';

    try {
      let result;

      if (mode === 'analyze') {
        progressText.textContent = 'Analyse IA en cours...';
        progressFill.style.width = '50%';

        const proposals = await apiFetch(`/suivitess-api/documents/${docId}/content-analyze-and-propose`, {
          method: 'POST',
          body: JSON.stringify({ content, source: provider, sourceTitle, itemIds }),
        });

        progressText.textContent = 'Application des propositions...';
        progressFill.style.width = '80%';

        // Auto-apply all proposals
        result = await apiFetch(`/suivitess-api/documents/${docId}/transcript-apply`, {
          method: 'POST',
          body: JSON.stringify({ proposals: proposals.proposals }),
        });
      } else {
        progressText.textContent = mode === 'ai-section' ? 'Extraction IA...' : 'Import brut...';
        progressFill.style.width = '60%';

        result = await apiFetch(`/suivitess-api/documents/${docId}/content-import`, {
          method: 'POST',
          body: JSON.stringify({
            content,
            source: provider,
            sourceTitle,
            useAI: mode === 'ai-section',
            itemIds,
          }),
        });
      }

      progressFill.style.width = '100%';

      // Show result
      progressSection.classList.add('hidden');
      resultSection.classList.remove('hidden');

      const skippedMsg = result.skipped ? ` (${result.skipped} deja importe${result.skipped > 1 ? 's' : ''})` : '';
      if (mode === 'analyze') {
        resultMsg.textContent = `Import termine : ${result.enriched || 0} sujets enrichis, ${result.created || 0} sujets crees, ${result.sectionsCreated || 0} sections creees.${skippedMsg}`;
      } else {
        resultMsg.textContent = `Import termine : ${result.subjectCount || 0} sujets crees dans la section "${result.sectionName || ''}".${skippedMsg}`;
      }
      resultMsg.className = 'result-msg';

    } catch (err) {
      progressSection.classList.add('hidden');
      resultSection.classList.remove('hidden');
      resultMsg.textContent = `Erreur: ${err.message}`;
      resultMsg.className = 'result-msg error';
    }
  }

  // ==================== INIT ====================

  async function init() {
    hideError();

    if (!serverUrl || !jwtToken) {
      configSection.classList.remove('hidden');
      setProviderBadge('unknown', 'Configuration requise');
      return;
    }

    // Detect provider
    provider = await detectProvider();
    if (provider === 'outlook') {
      setProviderBadge('outlook', 'Outlook');
      // Scrape emails and push them to the server — no analysis in the extension.
      await syncOutlookToServer();
      return;
    } else if (provider === 'slack') {
      setProviderBadge('slack', 'Slack');
      // For Slack, just show the connect section.
      return;
    } else {
      setProviderBadge('unknown', 'Page non supportee');
      showError('Ouvrez Outlook ou Slack dans cet onglet pour importer du contenu.');
      return;
    }
  }

  // ==================== EVENT LISTENERS ====================

  $('save-config').addEventListener('click', saveConfig);
  $('toggle-config').addEventListener('click', () => {
    configSection.classList.toggle('hidden');
  });
  $('select-all').addEventListener('click', () => {
    if (selectedIds.size === items.length) {
      selectedIds.clear();
    } else {
      selectedIds = new Set(items.map(i => i.id));
    }
    renderItems();
    updateImportBtn();
  });
  $('refresh-btn').addEventListener('click', async () => {
    try {
      items = await scrapeItems();
      selectedIds.clear();
      renderItems();
      updateImportBtn();
      hideError();
    } catch (err) {
      showError(err.message);
    }
  });
  importBtn.addEventListener('click', doImport);
  docSelect.addEventListener('change', updateImportBtn);
  $('done-btn').addEventListener('click', () => {
    resultSection.classList.add('hidden');
    itemsSection.classList.remove('hidden');
    actionsSection.classList.remove('hidden');
    modeSection.classList.remove('hidden');
    selectedIds.clear();
    renderItems();
    updateImportBtn();
  });

  // ==================== OUTLOOK SYNC ====================

  async function syncOutlookToServer() {
    hideError();
    setProviderBadge('outlook', 'Outlook — Synchronisation...');

    try {
      // 1) Scrape emails from the page
      const emails = await scrapeItems();
      if (emails.length === 0) {
        showError('Aucun email trouvé sur cette page.');
        return;
      }

      // 2) For each email, try to grab the body (click to open + read)
      // For now we send subject + preview — bodies require clicking each mail.
      const payload = emails.map(e => ({
        id: e.id,
        subject: e.subject || '(sans objet)',
        sender: e.sender || 'Inconnu',
        date: e.date || '',
        preview: e.preview || '',
        body: e.body || null,
      }));

      // 3) Push to server
      const result = await apiFetch('/suivitess-api/outlook/sync', {
        method: 'POST',
        body: JSON.stringify({ emails: payload }),
      });

      setProviderBadge('outlook', 'Outlook');

      resultSection.classList.remove('hidden');
      resultMsg.textContent = `✓ ${result.stored} email(s) synchronisé(s). Ouvrez SuiviTess > "Importer & ranger" pour les analyser.`;
      resultMsg.className = 'result-msg';

    } catch (err) {
      setProviderBadge('outlook', 'Outlook');

      if (err.message.includes('Non connecte')) {
        resultSection.classList.remove('hidden');
        resultMsg.innerHTML = `✗ Non connecté au serveur.<br><a href="${serverUrl || ENV.defaultServerUrl}" target="_blank" style="color:#10b981">Connectez-vous ici</a>, puis rechargez cette page.`;
        resultMsg.className = 'result-msg error';
      } else {
        showError(err.message);
      }
    }
  }

  // ==================== SLACK CREDENTIALS ====================

  const slackCredsSection = $('slack-creds-section');
  const slackCredsBtn = $('slack-creds-btn');
  const slackCredsStatus = $('slack-creds-status');
  const slackChannelsInput = $('slack-channels-input');
  const slackDaysInput = $('slack-days-input');

  function showSlackCredsSection() {
    if (provider !== 'slack') return;
    slackCredsSection.classList.remove('hidden');

    // Pre-fill with current channel URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url?.includes('slack.com/client/')) {
        const currentUrl = tabs[0].url;
        const existing = slackChannelsInput.value.trim();
        if (!existing) {
          slackChannelsInput.value = currentUrl;
        } else if (!existing.includes(currentUrl)) {
          slackChannelsInput.value = existing + '\n' + currentUrl;
        }
      }
    });

    // Load saved channels from storage
    chrome.storage.local.get(['slackChannels', 'slackDays'], (data) => {
      if (data.slackChannels && !slackChannelsInput.value.trim()) {
        slackChannelsInput.value = data.slackChannels;
      }
      if (data.slackDays) slackDaysInput.value = data.slackDays;
    });
  }

  async function handleSlackConnect() {
    slackCredsBtn.disabled = true;
    slackCredsBtn.textContent = 'Récupération...';
    slackCredsStatus.classList.add('hidden');

    // Ensure we have a valid auth token before proceeding
    if (!jwtToken) {
      jwtToken = await getTokenFromCookie(serverUrl);
    }
    if (!jwtToken) {
      slackCredsStatus.innerHTML = `✗ Non connecté au serveur SuiviTess.<br><a href="${serverUrl || 'http://localhost:5170'}" target="_blank" style="color:#10b981">Cliquez ici pour vous connecter</a>, puis réessayez.`;
      slackCredsStatus.className = 'slack-creds-status error';
      slackCredsStatus.classList.remove('hidden');
      slackCredsBtn.disabled = false;
      slackCredsBtn.textContent = '🔄 Connecter et synchroniser';
      return;
    }

    try {
      // 1) Get xoxc token from content script
      const creds = await new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs[0]) { reject(new Error('Pas d\'onglet Slack actif')); return; }
          chrome.tabs.sendMessage(tabs[0].id, { action: 'getSlackCredentials' }, (response) => {
            if (chrome.runtime.lastError || !response?.success) {
              reject(new Error(response?.error || 'Impossible de lire le token Slack. Rechargez la page Slack.'));
              return;
            }
            resolve(response);
          });
        });
      });

      if (!creds.xoxcToken) {
        throw new Error('Token xoxc introuvable. Rechargez Slack et réessayez.');
      }

      // 2) Get xoxd cookie via chrome.cookies API
      const xoxdCookie = await new Promise((resolve) => {
        chrome.cookies.get({ url: 'https://app.slack.com', name: 'd' }, (cookie) => {
          resolve(cookie?.value || '');
        });
      });

      if (!xoxdCookie) {
        throw new Error('Cookie xoxd introuvable. Vérifiez que vous êtes connecté à Slack.');
      }

      // 3) Parse channel URLs
      const channelUrls = slackChannelsInput.value.trim().split('\n').filter(u => u.trim());
      const channels = [];
      for (const url of channelUrls) {
        const match = url.match(/\/client\/[A-Z0-9]+\/([A-Z0-9]+)/);
        if (match) {
          // Try to get channel name from the page if it's the current channel
          channels.push({ id: match[1], name: match[1], url: url.trim() });
        }
      }

      if (channels.length === 0) {
        throw new Error('Aucune URL de channel valide. Format attendu : https://app.slack.com/client/TXXXXX/CXXXXX');
      }

      const days = parseInt(slackDaysInput.value, 10) || 7;

      // Save to local storage for next time
      chrome.storage.local.set({
        slackChannels: slackChannelsInput.value,
        slackDays: days,
      });

      // 4) Send to server
      slackCredsBtn.textContent = 'Envoi au serveur...';

      const result = await apiFetch('/suivitess-api/slack/configure', {
        method: 'POST',
        body: JSON.stringify({
          workspaceUrl: creds.workspaceUrl || 'https://francetv.slack.com',
          xoxcToken: creds.xoxcToken,
          xoxdCookie: xoxdCookie,
          channels,
          daysToFetch: days,
        }),
      });

      // 5) Trigger immediate sync
      slackCredsBtn.textContent = 'Synchronisation...';

      try {
        const syncResult = await apiFetch('/suivitess-api/slack/sync-now', {
          method: 'POST',
        });
        slackCredsStatus.textContent = `✓ Connecté en tant que ${result.user || 'OK'}. ${syncResult.total || 0} messages collectés.`;
        slackCredsStatus.className = 'slack-creds-status success';
      } catch (syncErr) {
        slackCredsStatus.textContent = `✓ Identifiants sauvés. Sync échouée : ${syncErr.message}`;
        slackCredsStatus.className = 'slack-creds-status warning';
      }

      slackCredsStatus.classList.remove('hidden');

    } catch (err) {
      slackCredsStatus.textContent = `✗ ${err.message}`;
      slackCredsStatus.className = 'slack-creds-status error';
      slackCredsStatus.classList.remove('hidden');
    } finally {
      slackCredsBtn.disabled = false;
      slackCredsBtn.textContent = '🔄 Connecter et synchroniser';
    }
  }

  if (slackCredsBtn) {
    slackCredsBtn.addEventListener('click', handleSlackConnect);
  }

  // Start
  loadConfig().then(async () => {
    await init();
    showSlackCredsSection();
  });
})();
