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

  // ==================== CONFIG ====================

  async function getTokenFromCookie(url) {
    // Try the exact URL first, then common variations (different ports,
    // http vs https) to handle dev proxy setups where the cookie domain
    // may differ from the configured server URL.
    const candidates = [url];
    try {
      const u = new URL(url);
      // Also try without port, with common dev ports, and with/without https
      if (u.port) candidates.push(`${u.protocol}//${u.hostname}`);
      if (!u.port || u.port !== '3010') candidates.push(`${u.protocol}//${u.hostname}:3010`);
      if (!u.port || u.port !== '5170') candidates.push(`${u.protocol}//${u.hostname}:5170`);
      if (u.protocol === 'http:') candidates.push(`https://${u.host}`);
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

    // If 404, the prefix might be wrong — try the alternative
    if (res.status === 404 && apiPrefix === '/suivitess-api') {
      apiPrefix = '/suivitess/api';
      return apiFetch(path, options);
    }
    if (res.status === 404 && apiPrefix === '/suivitess/api') {
      apiPrefix = '/suivitess-api';
      // Don't loop — throw the error
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
      providerBadge.textContent = 'Configuration requise';
      providerBadge.className = 'badge badge-unknown';
      return;
    }

    // Detect provider
    provider = await detectProvider();
    if (provider === 'outlook') {
      providerBadge.textContent = 'Outlook';
      providerBadge.className = 'badge badge-outlook';
    } else if (provider === 'slack') {
      providerBadge.textContent = 'Slack';
      providerBadge.className = 'badge badge-slack';
      // For Slack, skip the old scraping flow entirely — the server-side
      // collector handles message fetching. Just show the Slack connect
      // section and hide the doc/mode/items sections.
      return;
    } else {
      providerBadge.textContent = 'Page non supportee';
      providerBadge.className = 'badge badge-unknown';
      showError('Ouvrez Outlook ou Slack dans cet onglet pour importer du contenu.');
      return;
    }

    // Load documents (Outlook only — Slack uses the server-side collector)
    await loadDocuments();

    // Scrape items (Outlook only)
    try {
      items = await scrapeItems();
      if (items.length === 0) {
        showError('Aucun element trouve sur cette page (derniere semaine).');
      } else {
        modeSection.classList.remove('hidden');
        itemsSection.classList.remove('hidden');
        actionsSection.classList.remove('hidden');
        renderItems();
        updateImportBtn();
      }
    } catch (err) {
      showError(err.message);
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
