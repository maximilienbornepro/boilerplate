// SuiviTess Importer — Popup logic
(() => {
  'use strict';

  // ==================== STATE ====================

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
    return new Promise((resolve) => {
      chrome.cookies.get({ url, name: 'auth_token' }, (cookie) => {
        resolve(cookie?.value || '');
      });
    });
  }

  async function loadConfig() {
    const data = await chrome.storage.local.get(['serverUrl']);
    serverUrl = data.serverUrl || '';
    $('server-url').value = serverUrl;

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

  async function apiFetch(path, options = {}) {
    if (!jwtToken) {
      // Try to refresh token
      jwtToken = await getTokenFromCookie(serverUrl);
      if (!jwtToken) throw new Error('Non connecte — ouvrez le serveur et connectez-vous');
    }
    const res = await fetch(`${serverUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
        ...(options.headers || {}),
      },
    });
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
    } else {
      providerBadge.textContent = 'Page non supportee';
      providerBadge.className = 'badge badge-unknown';
      showError('Ouvrez Outlook ou Slack dans cet onglet pour importer du contenu.');
      return;
    }

    // Load documents
    await loadDocuments();

    // Scrape items
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

  // Start
  loadConfig().then(init);
})();
