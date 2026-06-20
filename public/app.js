/* ================================================================
   Organt Chat — public/app.js
   WebSocket client · Markdown rendering · AI streaming · Mobile
   ================================================================ */
'use strict';

// ─── Cold-start: Render 콜드스타트 대기 UX ────────────────────────────────
async function waitForServer() {
  const overlay = document.getElementById('coldStartOverlay');
  const msg = document.getElementById('coldStartMsg');
  if (!overlay) return;
  const msgs = ['서버를 깨우는 중…', '거의 다 됐습니다…', '잠시만 기다려주세요…'];
  let i = 0;
  while (true) {
    try {
      const r = await fetch('/health');
      if (r.ok) { overlay.style.display = 'none'; return; }
    } catch {}
    msg.textContent = msgs[i++ % msgs.length];
    await new Promise(r => setTimeout(r, 2500));
  }
}

// ─── Wait for DOM ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await waitForServer();

// ─── Markdown / Highlight setup ──────────────────────────────────────────
const renderer = new marked.Renderer();

// Custom code block renderer — adds data-lang for CSS ::before label
renderer.code = (code, language) => {
  const lang = (language || '').toLowerCase().trim();
  let highlighted = '';
  if (lang && hljs.getLanguage(lang)) {
    try { highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
    catch { highlighted = hljs.highlightAuto(code).value; }
  } else {
    highlighted = hljs.highlightAuto(code).value;
  }
  const langAttr = lang ? ` data-lang="${escapeAttr(lang)}"` : ' data-lang="code"';
  return `<pre${langAttr}><code class="hljs language-${escapeAttr(lang)}">${highlighted}</code></pre>`;
};

// Custom link renderer — open in new tab
renderer.link = (href, title, text) => {
  const t = title ? ` title="${escapeAttr(title)}"` : '';
  return `<a href="${escapeAttr(href)}"${t} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.use({
  renderer,
  breaks: true,          // single newline → <br>
  gfm: true,
  headerIds: false,
  mangle: false,
});

function renderMarkdown(text) {
  if (!text) return '';
  const raw = marked.parse(text);
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      'p','br','strong','em','del','a','ul','ol','li','blockquote','hr',
      'pre','code','h1','h2','h3','h4','h5','h6','table','thead','tbody',
      'tr','th','td','img','span','div',
    ],
    ALLOWED_ATTR: ['href','title','src','alt','class','data-lang','target','rel'],
    FORBID_TAGS: ['script','style','iframe','object','embed'],
  });
}

function escapeAttr(str) {
  return String(str || '').replace(/[&"'<>]/g, c => ({
    '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;',
  }[c]));
}

// ─── State ────────────────────────────────────────────────────────────────
let ws             = null;
let myUserId       = null;
let myUserName     = null;
let currentChannel = null;
let typingTimer    = null;
let isTyping       = false;
let reconnectDelay = 1000;
let reconnecting   = false;

/** @type {Map<string, {id, name, description, hasAI, isDefault, memberCount}>} */
const channelMap   = new Map();
/** @type {Map<string, number>} unread count per channel */
const unreadMap    = new Map();
/** @type {Map<string, string>} cached last-message text per channel (for badge) */
const messageIndex = new Map(); // channelId → last message createdAt (for dedup)
/** @type {Map<string, {text: string, streaming: boolean}>} ai messages being streamed */
const streamingMsgs = new Map(); // messageId → {text, el}

// ─── DOM references ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const sidebar          = $('sidebar');
const sidebarScrim     = $('sidebarScrim');
const sidebarCloseBtn  = $('sidebarCloseBtn');
const hamburgerBtn     = $('hamburgerBtn');
const channelListEl    = $('channelList');
const userNameEl       = $('userNameEl');
const userAvatarEl     = $('userAvatar');
const userAvatarInit   = $('userAvatarInitial');
const messagesEl       = $('messages');
const messagesEnd      = $('messagesEnd');
const emptyState       = $('emptyState');
const typingArea       = $('typingArea');
const composerInput    = $('composerInput');
const sendBtn          = $('sendBtn');
const charCount        = $('charCount');
const topbarChannelName = $('topbarChannelName');
const topbarChannelDesc = $('topbarChannelDesc');
const memberCountEl    = $('memberCount');
const summaryBtn       = $('summaryBtn');
const summaryPanel     = $('summaryPanel');
const summaryScrim     = $('summaryScrim');
const summaryCloseBtn  = $('summaryCloseBtn');
const summaryBody      = $('summaryBody');
const summaryRefreshBtn = $('summaryRefreshBtn');
const toastContainer   = $('toastContainer');
const addChannelBtn    = $('addChannelBtn');
const addChannelModal  = $('addChannelModal');
const modalScrim       = $('modalScrim');
const modalCancelBtn   = $('modalCancelBtn');
const modalCreateBtn   = $('modalCreateBtn');
const newChannelName   = $('newChannelName');
const newChannelDesc   = $('newChannelDesc');
const themeToggleBtn   = $('themeToggleBtn');

// ─── Theme ────────────────────────────────────────────────────────────────
(function initTheme() {
  // Always set data-theme so CSS selectors & QA can reliably detect state
  const saved = localStorage.getItem('organt-theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
})();

themeToggleBtn.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('organt-theme', next);
});

// ─── Toast ────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast${type === 'success' ? ' toast--success' : type === 'error' ? ' toast--error' : ''}`;
  el.innerHTML = `<span style="flex:1">${escapeHtml(message)}</span>`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 200ms';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── Mobile sidebar ────────────────────────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('sidebar--open');
  sidebarScrim.classList.add('sidebar-scrim--visible');
  sidebarScrim.setAttribute('aria-hidden', 'false');
}
function closeSidebar() {
  sidebar.classList.remove('sidebar--open');
  sidebarScrim.classList.remove('sidebar-scrim--visible');
  sidebarScrim.setAttribute('aria-hidden', 'true');
}

hamburgerBtn.addEventListener('click', openSidebar);
sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarScrim.addEventListener('click', closeSidebar);

// ─── Summary panel ─────────────────────────────────────────────────────────
function openSummaryPanel() {
  summaryPanel.classList.add('summary-panel--open');
  summaryPanel.setAttribute('aria-hidden', 'false');
  summaryScrim.classList.add('summary-panel-scrim--visible');
}
function closeSummaryPanel() {
  summaryPanel.classList.remove('summary-panel--open');
  summaryPanel.setAttribute('aria-hidden', 'true');
  summaryScrim.classList.remove('summary-panel-scrim--visible');
}

summaryCloseBtn.addEventListener('click', closeSummaryPanel);
summaryScrim.addEventListener('click', closeSummaryPanel);

async function requestSummary() {
  if (!currentChannel) { showToast('채널을 먼저 선택하세요.', 'error'); return; }
  openSummaryPanel();
  summaryBody.innerHTML = `<div class="summary-panel__loading"><div class="summary-panel__spinner"></div><span>AI가 대화를 분석 중입니다…</span></div>`;

  try {
    const resp = await fetch(`/api/channels/${currentChannel}/summarize`, { method: 'POST' });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      summaryBody.innerHTML = `<div class="summary-panel__loading" style="color:var(--tone-negative-fg)">${escapeHtml(data.error || '요약 실패')}</div>`;
      return;
    }

    summaryBody.innerHTML = `
      <div class="summary-panel__meta" id="sMetaEl" style="visibility:hidden">
        <span class="summary-panel__meta-icon">🧠</span>
        <span>#${escapeHtml(currentChannel)} 최근 60개 메시지 분석</span>
        <span id="sToneBadge" class="message__tone message__tone--uncertain" data-grade="uncertain" style="margin:0">불확실</span>
      </div>
      <div class="summary-panel__content" id="sTextEl" style="white-space:pre-wrap"></div>`;

    const sMetaEl = document.getElementById('sMetaEl');
    const sTextEl = document.getElementById('sTextEl');
    const sToneBadge = document.getElementById('sToneBadge');
    const toneLabel = { positive:'긍정적', neutral:'중립적', negative:'부정적', uncertain:'불확실' };

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '', streamBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split('\n');
      sseBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6));
          if (evt.t === 'chunk') {
            streamBuffer += evt.text;
            sTextEl.textContent = streamBuffer.replace(/\nTONE:[^\n]*$/m, '');
            sMetaEl.style.visibility = 'visible';
          } else if (evt.t === 'done') {
            sTextEl.textContent = streamBuffer.replace(/\nTONE:[^\n]*$/m, '').trim();
            const tc = evt.tone || 'uncertain';
            sToneBadge.className = `message__tone message__tone--${tc}`;
            sToneBadge.dataset.grade = tc;
            sToneBadge.textContent = toneLabel[tc] ?? '불확실';
          } else if (evt.t === 'error') {
            summaryBody.innerHTML = `<div class="summary-panel__loading" style="color:var(--tone-negative-fg)">${escapeHtml(evt.error||'요약 실패')}</div>`;
          }
        } catch {}
      }
    }
  } catch (err) {
    summaryBody.innerHTML = `<div class="summary-panel__loading" style="color:var(--tone-negative-fg)">네트워크 오류: ${escapeHtml(err.message)}</div>`;
  }
}

summaryBtn.addEventListener('click', requestSummary);
summaryRefreshBtn.addEventListener('click', requestSummary);

// ─── Add Channel modal ─────────────────────────────────────────────────────
function openModal() {
  addChannelModal.style.display = 'flex';
  modalScrim.style.display = 'block';
  modalScrim.classList.add('summary-panel-scrim--visible');
  newChannelName.value = '';
  newChannelDesc.value = '';
  newChannelName.focus();
}
function closeModal() {
  addChannelModal.style.display = 'none';
  modalScrim.style.display = 'none';
  modalScrim.classList.remove('summary-panel-scrim--visible');
}

addChannelBtn.addEventListener('click', openModal);
modalCancelBtn.addEventListener('click', closeModal);
modalScrim.addEventListener('click', closeModal);

async function createChannel() {
  const name = newChannelName.value.trim();
  const desc = newChannelDesc.value.trim();
  if (!name) { newChannelName.focus(); return; }

  modalCreateBtn.disabled = true;
  try {
    const resp = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc }),
    });
    const data = await resp.json();
    if (!resp.ok) { showToast(data.error || '채널 생성 실패', 'error'); return; }
    closeModal();
    showToast(`#${data.name} 채널이 생성됐습니다.`, 'success');
    // channel_created WS event will update the list
  } catch (err) {
    showToast('네트워크 오류: ' + err.message, 'error');
  } finally {
    modalCreateBtn.disabled = false;
  }
}

modalCreateBtn.addEventListener('click', createChannel);
newChannelName.addEventListener('keydown', e => { if (e.key === 'Enter') createChannel(); });

// ─── Channel list rendering ─────────────────────────────────────────────────
function renderChannelList() {
  channelListEl.innerHTML = '';
  for (const [id, ch] of channelMap) {
    const unread = unreadMap.get(id) || 0;
    const isActive = id === currentChannel;

    const li = document.createElement('li');
    li.className = `channel-item${isActive ? ' channel-item--active' : ''}${unread > 0 && !isActive ? ' channel-item--unread' : ''}`;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', isActive ? 'true' : 'false');
    li.dataset.channelId = id;

    li.innerHTML = `
      <span class="channel-item__hash" aria-hidden="true">${ch.hasAI ? '🤖' : '#'}</span>
      <span class="channel-item__name">${escapeHtml(ch.name)}</span>
      ${unread > 0 && !isActive
        ? `<span class="channel-item__badge" aria-label="${unread}개의 안읽은 메시지">${unread > 99 ? '99+' : unread}</span>`
        : ''}`;

    li.addEventListener('click', () => joinChannel(id));
    channelListEl.appendChild(li);
  }
}

function updateChannelInList(channelId) {
  const li = channelListEl.querySelector(`[data-channel-id="${channelId}"]`);
  if (!li) { renderChannelList(); return; }
  const ch     = channelMap.get(channelId);
  const unread = unreadMap.get(channelId) || 0;
  const isActive = channelId === currentChannel;

  li.className = `channel-item${isActive ? ' channel-item--active' : ''}${unread > 0 && !isActive ? ' channel-item--unread' : ''}`;
  li.setAttribute('aria-selected', isActive ? 'true' : 'false');

  const badge = li.querySelector('.channel-item__badge');
  if (unread > 0 && !isActive) {
    if (!badge) {
      const b = document.createElement('span');
      b.className = 'channel-item__badge';
      b.setAttribute('aria-label', `${unread}개의 안읽은 메시지`);
      b.textContent = unread > 99 ? '99+' : String(unread);
      li.appendChild(b);
    } else {
      badge.textContent = unread > 99 ? '99+' : String(unread);
    }
  } else {
    badge?.remove();
  }
}

// ─── Join a channel ────────────────────────────────────────────────────────
function joinChannel(channelId) {
  if (channelId === currentChannel) { closeSidebar(); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('서버에 연결 중입니다…', 'info'); return; }

  currentChannel = channelId;
  unreadMap.set(channelId, 0);

  // Update topbar
  const ch = channelMap.get(channelId);
  topbarChannelName.textContent = ch?.name ?? channelId;
  topbarChannelDesc.textContent = ch?.description ?? '';

  // Clear messages area
  clearMessages();
  renderChannelList();

  // Update composer placeholder
  composerInput.setAttribute('data-placeholder',
    ch?.hasAI
      ? `#${ch.name}에 메시지 전송… (AI가 자동으로 응답합니다)`
      : `#${ch?.name ?? channelId}에 메시지 전송… (@ai로 AI 호출)`,
  );

  ws.send(JSON.stringify({ type: 'join', channelId }));
  closeSidebar();
  composerInput.focus();
}

// ─── Messages area ─────────────────────────────────────────────────────────
let lastMessageDate = null;
let lastMessageUserId = null;

function clearMessages() {
  // Remove all children except messagesEnd
  while (messagesEl.firstChild && messagesEl.firstChild !== messagesEnd) {
    messagesEl.removeChild(messagesEl.firstChild);
  }
  messagesEl.insertBefore(emptyState, messagesEnd);
  emptyState.style.display = '';
  lastMessageDate   = null;
  lastMessageUserId = null;
  typingArea.innerHTML = '';
  streamingMsgs.clear();
}

function getDateLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const diff  = (today.setHours(0,0,0,0) - d.setHours(0,0,0,0)) / 86400000;
  if (diff < 1) return '오늘';
  if (diff < 2) return '어제';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Renders a tone badge element (null → uncertain, structural gate)
 */
function buildToneBadge(tone) {
  // Null-gate: null always renders as uncertain (same as CSS rule)
  const grade = ['positive','neutral','negative','uncertain'].includes(tone) ? tone : 'uncertain';
  const labels = { positive: '😊 긍정', neutral: '😐 중립', negative: '😟 부정', uncertain: '🤔 불확실' };
  const span = document.createElement('span');
  span.className = `message__tone message__tone--${grade}`;
  span.dataset.grade = grade;
  span.textContent   = labels[grade];
  return span;
}

/**
 * Append a message to the message list.
 * Returns the message element so streaming can update it.
 */
function appendMessage(msg, {  atTop = false } = {}) {
  emptyState.style.display = 'none';

  const msgDate = getDateLabel(msg.createdAt);

  // Date divider
  if (!atTop && msgDate !== lastMessageDate) {
    const divider = document.createElement('div');
    divider.className = 'date-divider';
    divider.innerHTML = `<span class="date-divider__label">${escapeHtml(msgDate)}</span>`;
    messagesEl.insertBefore(divider, messagesEnd);
    lastMessageDate = msgDate;
    lastMessageUserId = null; // reset consecutive tracking after divider
  }

  // Consecutive detection
  const isConsecutive = !atTop && !msg.isSystem && !msg.isAI
    && lastMessageUserId === msg.userId
    && lastMessageDate   === msgDate;

  const msgEl = document.createElement('div');
  const isMine   = msg.userId === myUserId;
  const isAI     = msg.isAI;
  const isSystem = msg.isSystem;

  msgEl.className = [
    'message',
    isConsecutive ? 'message--consecutive' : '',
    isAI          ? 'message--ai'          : '',
    isMine && !isAI ? 'message--own'        : '',
  ].filter(Boolean).join(' ');
  msgEl.dataset.messageId = msg.id;

  const initials = isAI ? 'AI'
    : (msg.author || '?').slice(0, 2).toUpperCase();

  const avatarStyle = isAI ? '' : `--avatar-color:${stringToColor(msg.userId)};`;

  if (isSystem) {
    // System message — centered note
    msgEl.style.cssText = 'justify-content:center; padding: var(--space-1) var(--space-6);';
    msgEl.innerHTML = `<span style="font-size:var(--text-xs); color:var(--clr-text-tertiary); font-style:italic;">${escapeHtml(msg.text)}</span>`;
  } else {
    // All non-system messages render markdown (DOMPurify sanitizes XSS)
    const textHtml = renderMarkdown(msg.text || '');

    msgEl.innerHTML = `
      <div class="message__avatar" aria-hidden="true" style="${avatarStyle}">${escapeHtml(initials)}</div>
      <div class="message__body">
        <div class="message__header">
          <span class="message__author">${escapeHtml(isAI ? 'AI' : msg.author)}</span>
          <span class="message__time" title="${escapeAttr(msg.createdAt)}">${formatTime(msg.createdAt)}</span>
        </div>
        <div class="message__text${msg.streaming ? ' message__text--streaming' : ''}" data-raw="${escapeAttr(msg.text || '')}">
          ${textHtml}
        </div>
        <div class="message__tone-wrap"></div>
      </div>
      <div class="message__actions" aria-hidden="true"></div>`;

    // Tone badge (null → uncertain — structural gate)
    const toneWrap = msgEl.querySelector('.message__tone-wrap');
    if (!msg.streaming && msg.text?.trim()) {
      toneWrap.appendChild(buildToneBadge(msg.tone));
    }
  }

  messagesEl.insertBefore(msgEl, messagesEnd);

  if (!isSystem && !atTop) {
    lastMessageUserId = msg.userId;
  }

  return msgEl;
}

/** Convert userId string to a deterministic oklch color */
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `oklch(40% 0.12 ${hue})`;
}

// ─── Scroll helpers ────────────────────────────────────────────────────────
function isNearBottom(threshold = 120) {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
}
function scrollToBottom(smooth = false) {
  messagesEnd.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
}

// ─── Typing indicator ──────────────────────────────────────────────────────
let currentTypingUsers = [];

function renderTyping(users) {
  currentTypingUsers = users.filter(u => u.userId !== myUserId);
  if (!currentTypingUsers.length) {
    typingArea.innerHTML = '';
    return;
  }
  const names = currentTypingUsers.map(u => escapeHtml(u.userName)).join(', ');
  const verb  = currentTypingUsers.length === 1 ? '입력 중…' : '입력 중…';
  typingArea.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-indicator__avatar" aria-hidden="true">…</div>
      <div class="typing-indicator__body">
        <div class="typing-indicator__dots" aria-hidden="true">
          <span class="typing-indicator__dot"></span>
          <span class="typing-indicator__dot"></span>
          <span class="typing-indicator__dot"></span>
        </div>
        <span class="typing-indicator__label"><strong>${names}</strong> ${verb}</span>
      </div>
    </div>`;
}

// ─── Composer ─────────────────────────────────────────────────────────────
const MAX_TEXT = 4000;

function getComposerText() {
  return composerInput.innerText.replace(/ /g, ' ').trim();
}

composerInput.addEventListener('input', () => {
  const text = getComposerText();
  const len  = text.length;

  // Char count
  if (len > MAX_TEXT * 0.8) {
    charCount.textContent = `${len}/${MAX_TEXT}`;
    charCount.className   = `composer__char-count${len > MAX_TEXT ? ' composer__char-count--error' : ' composer__char-count--warn'}`;
  } else {
    charCount.textContent = '';
    charCount.className   = 'composer__char-count';
  }

  sendBtn.disabled = !text || len > MAX_TEXT || !currentChannel;

  // Typing signal
  if (!currentChannel) return;
  if (text && !isTyping) {
    isTyping = true;
    ws?.send(JSON.stringify({ type: 'typing', channelId: currentChannel, isTyping: true }));
  }
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    ws?.send(JSON.stringify({ type: 'typing', channelId: currentChannel, isTyping: false }));
  }, 3000);
});

composerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

function sendMessage() {
  if (!currentChannel || !ws || ws.readyState !== WebSocket.OPEN) return;
  const text = getComposerText();
  if (!text || text.length > MAX_TEXT) return;

  ws.send(JSON.stringify({ type: 'message', channelId: currentChannel, text }));

  // Clear composer
  composerInput.innerHTML = '';
  sendBtn.disabled = true;
  charCount.textContent = '';

  // Stop typing
  if (typingTimer) clearTimeout(typingTimer);
  isTyping = false;
  ws.send(JSON.stringify({ type: 'typing', channelId: currentChannel, isTyping: false }));
}

// ─── WebSocket ────────────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url   = `${proto}//${location.host}`;

  ws = new WebSocket(url);

  ws.addEventListener('open', () => {
    reconnectDelay = 1000;
    reconnecting   = false;
    sendBtn.disabled = !getComposerText() || !currentChannel;
  });

  ws.addEventListener('close', () => {
    ws = null;
    sendBtn.disabled = true;
    if (!reconnecting) {
      reconnecting = true;
      showToast('연결이 끊어졌습니다. 재연결 중…', 'error', 5000);
    }
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 16000);
  });

  ws.addEventListener('error', () => { /* close will follow */ });

  ws.addEventListener('message', e => {
    let data;
    try { data = JSON.parse(e.data); }
    catch { return; }
    handleServerMessage(data);
  });
}

// ─── Server message handler ────────────────────────────────────────────────
function handleServerMessage(data) {
  switch (data.type) {

    // ───── init ──────────────────────────────────────────────────────────
    case 'init': {
      myUserId   = data.userId;
      myUserName = data.userName;

      userNameEl.textContent       = myUserName;
      userAvatarInit.textContent   = myUserName.slice(0, 2);
      userAvatarEl.style.setProperty('--avatar-color', stringToColor(myUserId));

      channelMap.clear();
      for (const ch of (data.channels || [])) {
        channelMap.set(ch.id, ch);
        if (!unreadMap.has(ch.id)) unreadMap.set(ch.id, 0);
      }
      renderChannelList();

      // Auto-join general channel
      const general = channelMap.has('general') ? 'general'
        : (channelMap.size ? channelMap.keys().next().value : null);
      if (general && !currentChannel) joinChannel(general);
      break;
    }

    // ───── history ───────────────────────────────────────────────────────
    case 'history': {
      if (data.channelId !== currentChannel) break;
      clearMessages();
      lastMessageDate   = null;
      lastMessageUserId = null;
      for (const msg of (data.messages || [])) {
        appendMessage(msg);
      }
      // Always hide empty state when history loads — channel is selected even if 0 messages
      emptyState.style.display = 'none';
      scrollToBottom(false);
      break;
    }

    // ───── message ───────────────────────────────────────────────────────
    case 'message': {
      const { message: msg } = data;
      if (!msg) break;

      if (msg.channelId === currentChannel) {
        const existing = messagesEl.querySelector(`[data-message-id="${msg.id}"]`);
        if (existing) {
          // Update tone badge (tone analysis arrived after initial broadcast)
          const toneWrap = existing.querySelector('.message__tone-wrap');
          if (toneWrap && !existing.querySelector('.message__tone')) {
            toneWrap.appendChild(buildToneBadge(msg.tone));
          }
        } else {
          const wasNearBottom = isNearBottom();
          appendMessage(msg);
          if (wasNearBottom) scrollToBottom(true);
        }
      } else {
        // Increment unread for other channels
        unreadMap.set(msg.channelId, (unreadMap.get(msg.channelId) || 0) + 1);
        updateChannelInList(msg.channelId);
      }
      break;
    }

    // ───── AI streaming ──────────────────────────────────────────────────
    case 'ai_start': {
      const { message: msg } = data;
      if (!msg || msg.channelId !== currentChannel) break;
      const wasNearBottom = isNearBottom();
      const msgEl = appendMessage(msg);
      streamingMsgs.set(msg.id, { text: '', el: msgEl });
      if (wasNearBottom) scrollToBottom(true);
      break;
    }

    case 'ai_chunk': {
      const { messageId, channelId, delta } = data;
      if (channelId !== currentChannel) break;
      const entry = streamingMsgs.get(messageId);
      if (!entry) break;
      entry.text += delta;
      // Update the message text content with incremental markdown
      const textEl = entry.el.querySelector('.message__text');
      if (textEl) {
        textEl.innerHTML = renderMarkdown(entry.text);
      }
      if (isNearBottom(200)) scrollToBottom(false);
      break;
    }

    case 'ai_done': {
      const { messageId, channelId, text, tone } = data;
      if (channelId !== currentChannel) break;
      const entry = streamingMsgs.get(messageId);
      if (entry) {
        const textEl = entry.el.querySelector('.message__text');
        if (textEl) {
          textEl.innerHTML  = renderMarkdown(text);
          textEl.classList.remove('message__text--streaming');
        }
        // Add tone badge
        const toneWrap = entry.el.querySelector('.message__tone-wrap');
        if (toneWrap) toneWrap.appendChild(buildToneBadge(tone));
        streamingMsgs.delete(messageId);
      }
      if (isNearBottom(200)) scrollToBottom(true);
      break;
    }

    // ───── typing ─────────────────────────────────────────────────────────
    case 'typing_update': {
      if (data.channelId !== currentChannel) break;
      renderTyping(data.users || []);
      break;
    }

    // ───── user presence ──────────────────────────────────────────────────
    case 'user_joined': {
      if (data.channelId !== currentChannel) break;
      if (data.userId !== myUserId) {
        appendMessage({
          id: `sys-${Date.now()}`, channelId: data.channelId,
          userId: 'system', author: 'system',
          text: `${data.userName}님이 입장했습니다.`,
          createdAt: new Date().toISOString(),
          isAI: false, isSystem: true, tone: null, streaming: false,
        });
      }
      break;
    }

    case 'user_left': {
      if (data.channelId !== currentChannel) break;
      if (data.userId !== myUserId) {
        appendMessage({
          id: `sys-${Date.now()}`, channelId: data.channelId,
          userId: 'system', author: 'system',
          text: `${data.userName}님이 퇴장했습니다.`,
          createdAt: new Date().toISOString(),
          isAI: false, isSystem: true, tone: null, streaming: false,
        });
      }
      break;
    }

    // ───── channel events ─────────────────────────────────────────────────
    case 'channel_created': {
      const ch = data.channel;
      channelMap.set(ch.id, ch);
      unreadMap.set(ch.id, 0);
      renderChannelList();
      break;
    }

    case 'channel_updated': {
      const ch = data.channel;
      channelMap.set(ch.id, ch);
      if (ch.id === currentChannel) {
        topbarChannelName.textContent = ch.name;
        topbarChannelDesc.textContent = ch.description;
        memberCountEl.innerHTML = ch.memberCount
          ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="4"/><path d="M17 11c1.66 0 3 1.34 3 3v1h-6v-1c0-1.66 1.34-3 3-3zM2 21v-2a4 4 0 014-4h6a4 4 0 014 4v2H2z"/></svg> ${ch.memberCount}명`
          : '';
      }
      updateChannelInList(ch.id);
      break;
    }

    case 'channel_deleted': {
      const { channelId } = data;
      channelMap.delete(channelId);
      unreadMap.delete(channelId);
      renderChannelList();
      if (currentChannel === channelId) {
        currentChannel = null;
        clearMessages();
        topbarChannelName.textContent = '채널을 선택하세요';
        topbarChannelDesc.textContent = '';
        memberCountEl.innerHTML = '';
        emptyState.style.display = '';
        showToast('채널이 삭제됐습니다.', 'info');
      }
      break;
    }

    case 'error': {
      showToast(data.message || '알 수 없는 오류', 'error');
      break;
    }
  }
}

// ─── Start ────────────────────────────────────────────────────────────────
connect();

// Focus composer on click anywhere in main (desktop)
document.getElementById('main').addEventListener('click', e => {
  if (e.target.closest('.composer, .topbar, .summary-panel, #toastContainer')) return;
  if (currentChannel && window.getSelection()?.toString() === '') {
    composerInput.focus();
  }
});

}); // end DOMContentLoaded
