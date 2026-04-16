// SuiviTess Importer — Slack Web content script
// Scrapes messages from the currently visible channel/DM in Slack web UI

(() => {
  'use strict';

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // ==================== EXTRACTION ====================

  function getCurrentChannelName() {
    // View header title (DM name or channel name)
    const headerName = document.querySelector('.p-view_header__member_name');
    if (headerName) return headerName.textContent.trim();

    // Channel name from header button
    const channelBtn = document.querySelector('[data-qa="channel_name_button"]');
    if (channelBtn) return channelBtn.textContent.trim();

    return 'unknown';
  }

  function isWithinLastWeek(tsStr) {
    if (!tsStr) return true;
    // Slack timestamps are Unix epoch seconds (e.g. "1775810163.567119")
    const ts = parseFloat(tsStr);
    if (isNaN(ts)) return true;
    const msgDate = new Date(ts * 1000);
    return (Date.now() - msgDate.getTime()) <= SEVEN_DAYS_MS;
  }

  function extractMessagesFromView() {
    const channel = getCurrentChannelName();
    const messageEls = document.querySelectorAll('div[data-qa="message_container"]');
    const messages = [];

    for (const msgEl of messageEls) {
      // Message text
      const textEl = msgEl.querySelector('div[data-qa="message-text"] .p-rich_text_section')
        || msgEl.querySelector('div[data-qa="message-text"]')
        || msgEl.querySelector('.c-message_kit__blocks');
      const text = textEl?.innerText?.trim() || '';
      if (!text) continue;

      // Sender
      const senderEl = msgEl.querySelector('button[data-qa="message_sender_name"]');
      const sender = senderEl?.textContent?.trim() || 'Inconnu';

      // Timestamp — from the data-ts attribute on the timestamp link
      const tsLink = msgEl.querySelector('a.c-timestamp');
      const dataTs = tsLink?.getAttribute('data-ts') || '';
      const timeLabel = tsLink?.querySelector('.c-timestamp__label')?.textContent?.trim() || '';

      // Filter: only last 7 days
      if (!isWithinLastWeek(dataTs)) continue;

      messages.push({
        id: `${channel}/${dataTs || messages.length}`,
        channel,
        sender,
        date: timeLabel,
        text: text.slice(0, 500),
        fullText: text,
      });
    }

    return messages;
  }

  function getChannelList() {
    const items = document.querySelectorAll('div[data-qa="channel-sidebar-channel"] span[dir="auto"]');
    const channels = [];
    for (const item of items) {
      const name = item.textContent?.trim();
      if (name) channels.push(name);
    }
    return [...new Set(channels)];
  }

  // ==================== MESSAGE HANDLER ====================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'detectProvider') {
      sendResponse({ provider: 'slack' });
      return;
    }

    // Extract Slack credentials (xoxc token + xoxd cookie) for the collector service
    if (message.action === 'getSlackCredentials') {
      try {
        // xoxc token from boot_data or localStorage
        const token = window.boot_data?.api_token
          || (localStorage.getItem('localConfig_v2') || '').match(/"token":"(xoxc-[^"]+)"/)?.[1]
          || null;

        // Workspace URL
        const workspaceUrl = window.boot_data?.team_url
          || window.location.origin
          || null;

        // Team name
        const teamName = window.boot_data?.team_name || null;

        sendResponse({
          success: true,
          xoxcToken: token,
          workspaceUrl,
          teamName,
          // xoxd cookie must be read via chrome.cookies API (done in popup.js)
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }

    if (message.action === 'getMessages') {
      try {
        const messages = extractMessagesFromView();
        const channels = getChannelList();
        sendResponse({
          success: true,
          items: messages,
          channels,
          currentChannel: getCurrentChannelName(),
          provider: 'slack',
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message, provider: 'slack' });
      }
      return;
    }

    if (message.action === 'getThread') {
      try {
        const threadMsgs = document.querySelectorAll('.p-thread_view div[data-qa="message_container"]');
        const entries = [];
        for (const el of threadMsgs) {
          const textEl = el.querySelector('div[data-qa="message-text"]');
          const senderEl = el.querySelector('button[data-qa="message_sender_name"]');
          entries.push({
            sender: senderEl?.textContent?.trim() || 'Inconnu',
            text: textEl?.innerText?.trim() || '',
          });
        }
        sendResponse({ success: true, thread: entries });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return;
    }
  });

  console.log('[SuiviTess Importer] Slack content script loaded');
})();
