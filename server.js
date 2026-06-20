'use strict';

const express = require('express');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');
const http = require('http');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MAX_MESSAGES_PER_CHANNEL = 1000;
const TYPING_EXPIRY_MS = 6000;
const VALID_TONES = ['positive', 'neutral', 'negative', 'uncertain'];

// ─── Anthropic client (eager init so misconfiguration surfaces at start) ───
let anthropic = null;
if (ANTHROPIC_API_KEY) {
  anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
} else {
  console.warn('[Organt Chat] ANTHROPIC_API_KEY not set — AI features disabled');
}

// ─── In-memory state ───────────────────────────────────────────────────────
/** @type {Map<string, Channel>} */
const channels = new Map();
/** @type {Map<string, Message[]>} */
const messages = new Map();
/** @type {Map<WebSocket, ClientState>} */
const clients = new Map();
/** @type {Map<string, Map<string, TypingEntry>>} */
const typing = new Map();

// ─── Type definitions (JSDoc for editor support) ────────────────────────────
/**
 * @typedef {Object} Channel
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {boolean} hasAI
 * @property {boolean} isDefault
 * @property {string} createdAt
 * @property {number} memberCount
 *
 * @typedef {Object} Message
 * @property {string} id
 * @property {string} channelId
 * @property {string} userId
 * @property {string} author
 * @property {string} text
 * @property {string} createdAt
 * @property {boolean} isAI
 * @property {boolean} isSystem
 * @property {string|null} tone  positive|neutral|negative|uncertain|null
 * @property {boolean} streaming
 *
 * @typedef {Object} ClientState
 * @property {string} userId
 * @property {string} userName
 * @property {string|null} channelId
 *
 * @typedef {Object} TypingEntry
 * @property {string} userId
 * @property {string} userName
 * @property {number} ts
 */

// ─── Seed default channels ──────────────────────────────────────────────────
const SEED_CHANNELS = [
  { id: 'general',  name: 'general',  description: '일반 대화 채널',         hasAI: false, isDefault: true },
  { id: 'ai-chat',  name: 'ai-chat',  description: 'AI와 함께하는 채널 (@ai)', hasAI: true,  isDefault: true },
  { id: 'random',   name: 'random',   description: '자유로운 잡담',           hasAI: false, isDefault: true },
];

const SEED_TIME = new Date().toISOString();
for (const seed of SEED_CHANNELS) {
  channels.set(seed.id, { ...seed, createdAt: SEED_TIME, memberCount: 0 });
  messages.set(seed.id, []);
  typing.set(seed.id, new Map());
}

// ─── Korean random names ────────────────────────────────────────────────────
const KO_ADJ = [
  '행복한', '빠른', '조용한', '신나는', '차분한', '활발한', '귀여운',
  '멋진',   '용감한','현명한','따뜻한', '밝은',   '우아한', '재미있는',
  '씩씩한', '느긋한','상쾌한','영리한', '다정한', '단호한',
];
const KO_NOUN = [
  '고양이', '강아지', '토끼', '여우', '곰', '판다', '코끼리',
  '기린',   '사자',  '호랑이','수달','너구리','오리','펭귄','다람쥐',
  '부엉이','고슴도치','낙타','코알라','플라밍고',
];

function randomName() {
  const adj  = KO_ADJ[Math.floor(Math.random() * KO_ADJ.length)];
  const noun = KO_NOUN[Math.floor(Math.random() * KO_NOUN.length)];
  return `${adj}${noun}`;
}

// ─── Broadcast helpers ──────────────────────────────────────────────────────
function broadcastToChannel(channelId, data, excludeWs = null) {
  const payload = JSON.stringify(data);
  for (const [ws, state] of clients) {
    if (state.channelId === channelId && ws !== excludeWs && ws.readyState === 1 /* OPEN */) {
      ws.send(payload);
    }
  }
}

function broadcastAll(data, excludeWs = null) {
  const payload = JSON.stringify(data);
  for (const [ws] of clients) {
    if (ws !== excludeWs && ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

function sendTo(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

// ─── Typing state helpers ────────────────────────────────────────────────────
function pushTypingUpdate(channelId) {
  const chTyping = typing.get(channelId);
  if (!chTyping) return;
  broadcastToChannel(channelId, {
    type: 'typing_update',
    channelId,
    users: [...chTyping.values()].map(u => ({ userId: u.userId, userName: u.userName })),
  });
}

function clearUserTyping(channelId, userId) {
  const chTyping = typing.get(channelId);
  if (!chTyping) return false;
  const existed = chTyping.has(userId);
  if (existed) { chTyping.delete(userId); pushTypingUpdate(channelId); }
  return existed;
}

// Auto-expire typing entries every 2 s
setInterval(() => {
  const now = Date.now();
  for (const [channelId, chTyping] of typing) {
    let changed = false;
    for (const [uid, info] of chTyping) {
      if (now - info.ts > TYPING_EXPIRY_MS) { chTyping.delete(uid); changed = true; }
    }
    if (changed) pushTypingUpdate(channelId);
  }
}, 2000);

// ─── Channel member count ────────────────────────────────────────────────────
function recalcMemberCount(channelId) {
  let count = 0;
  for (const state of clients.values()) {
    if (state.channelId === channelId) count++;
  }
  const ch = channels.get(channelId);
  if (!ch) return;
  ch.memberCount = count;
  broadcastAll({ type: 'channel_updated', channel: { ...ch } });
}

// ─── Message storage ─────────────────────────────────────────────────────────
function addMessage(msg) {
  const arr = messages.get(msg.channelId) ?? [];
  arr.push(msg);
  // Trim to max, keeping newest
  if (arr.length > MAX_MESSAGES_PER_CHANNEL) {
    arr.splice(0, arr.length - MAX_MESSAGES_PER_CHANNEL);
  }
  messages.set(msg.channelId, arr);
  return msg;
}

// ─── Tone analysis ───────────────────────────────────────────────────────────
// Null-gate: any non-enum result → 'uncertain' (never silent null)
async function analyzeTone(text) {
  if (!anthropic || !text?.trim()) return 'uncertain';
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      system: 'Classify the perceived tone of this chat message as exactly one word: positive, neutral, negative, or uncertain. Reply with only that single word, lowercase.',
      messages: [{ role: 'user', content: String(text).slice(0, 500) }],
    });
    const raw = (resp.content?.[0]?.text ?? '').trim().toLowerCase();
    return VALID_TONES.includes(raw) ? raw : 'uncertain';
  } catch (err) {
    console.error('[tone] analysis failed:', err.message);
    return 'uncertain';
  }
}

// ─── Build alternating role context for Claude ───────────────────────────────
function buildContext(channelId, excludeId = null) {
  const hist = (messages.get(channelId) ?? [])
    .filter(m => !m.isSystem && !m.streaming && m.id !== excludeId)
    .slice(-20);

  const result = [];
  for (const m of hist) {
    const role = m.isAI ? 'assistant' : 'user';
    if (result.length && result[result.length - 1].role === role) {
      // Merge consecutive same-role messages
      result[result.length - 1].content += '\n' + m.text;
    } else {
      result.push({ role, content: m.text });
    }
  }
  // Claude requires alternating and starting with user
  if (result.length && result[0].role === 'assistant') {
    result.unshift({ role: 'user', content: '(대화 시작)' });
  }
  return result;
}

// ─── AI streaming response ───────────────────────────────────────────────────
async function streamAIResponse(channelId, userText) {
  if (!anthropic) return;

  const msgId  = uuidv4();
  const now    = new Date().toISOString();
  const aiMsg  = {
    id: msgId, channelId, userId: 'ai', author: 'AI',
    text: '', createdAt: now,
    isAI: true, isSystem: false, tone: null, streaming: true,
  };

  addMessage(aiMsg);
  broadcastToChannel(channelId, { type: 'ai_start', message: { ...aiMsg } });

  const contextMsgs = buildContext(channelId, msgId);
  // If context is empty or ends with assistant, ensure userText is the final user turn
  if (!contextMsgs.length || contextMsgs[contextMsgs.length - 1].role !== 'user') {
    contextMsgs.push({ role: 'user', content: userText });
  }

  let fullText = '';
  try {
    const stream = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      stream: true,
      system: 'You are AI, a helpful assistant in Organt Chat. Respond in the same language as the user. Use markdown for formatting when appropriate.',
      messages: contextMsgs,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        const delta = event.delta.text;
        fullText += delta;
        broadcastToChannel(channelId, { type: 'ai_chunk', messageId: msgId, channelId, delta });
      }
    }
  } catch (err) {
    console.error('[AI] streaming error:', err.message);
    fullText = fullText || '죄송합니다, AI 응답 중 오류가 발생했습니다.';
  }

  // Tone analysis on completed text (fire, then update)
  const tone = await analyzeTone(fullText);

  // Update stored message
  const arr = messages.get(channelId) ?? [];
  const stored = arr.find(m => m.id === msgId);
  if (stored) {
    stored.text      = fullText;
    stored.tone      = tone;    // never null: always enum or 'uncertain'
    stored.streaming = false;
  }

  broadcastToChannel(channelId, {
    type: 'ai_done', messageId: msgId, channelId, text: fullText, tone,
  });
}

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /health ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ ok: true, channels: channels.size, clients: clients.size });
});

// ── GET /api/channels ────────────────────────────────────────────────────────
app.get('/api/channels', (_req, res) => {
  res.json([...channels.values()]);
});

// ── POST /api/channels ───────────────────────────────────────────────────────
app.post('/api/channels', (req, res) => {
  const { name, description = '' } = req.body ?? {};

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: '채널 이름이 필요합니다.' });
  }
  const slug = name.trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-가-힣]/g, '');
  if (!slug || slug.length > 50) {
    return res.status(400).json({ error: '유효한 채널 이름이 아닙니다. (영문·한글·숫자·하이픈, 최대 50자)' });
  }
  if (channels.has(slug)) {
    return res.status(409).json({ error: '이미 존재하는 채널입니다.' });
  }

  const channel = {
    id: slug, name: slug,
    description: String(description).trim().slice(0, 200),
    hasAI: false, isDefault: false,
    createdAt: new Date().toISOString(), memberCount: 0,
  };
  channels.set(slug, channel);
  messages.set(slug, []);
  typing.set(slug, new Map());

  broadcastAll({ type: 'channel_created', channel: { ...channel } });
  res.status(201).json(channel);
});

// ── DELETE /api/channels/:id ─────────────────────────────────────────────────
app.delete('/api/channels/:id', (req, res) => {
  const ch = channels.get(req.params.id);
  if (!ch) return res.status(404).json({ error: '채널을 찾을 수 없습니다.' });
  if (ch.isDefault) return res.status(403).json({ error: '기본 채널은 삭제할 수 없습니다.' });

  // Move members in this channel to null
  for (const state of clients.values()) {
    if (state.channelId === ch.id) state.channelId = null;
  }
  channels.delete(ch.id);
  messages.delete(ch.id);
  typing.delete(ch.id);

  broadcastAll({ type: 'channel_deleted', channelId: ch.id });
  res.json({ ok: true });
});

// ── GET /api/channels/:id/messages ──────────────────────────────────────────
app.get('/api/channels/:id/messages', (req, res) => {
  if (!channels.has(req.params.id)) {
    return res.status(404).json({ error: '채널을 찾을 수 없습니다.' });
  }
  const limit  = Math.min(Math.max(parseInt(req.query.limit) || 80, 1), 200);
  const before = req.query.before;
  let msgs = messages.get(req.params.id) ?? [];

  if (before) {
    const idx = msgs.findLastIndex(m => m.createdAt < before);
    if (idx >= 0) msgs = msgs.slice(0, idx + 1);
    else msgs = [];
  }
  res.json(msgs.slice(-limit));
});

// ── POST /api/channels/:id/summarize  (SSE streaming) ──────────────────────
app.post('/api/channels/:id/summarize', async (req, res) => {
  if (!channels.has(req.params.id)) return res.status(404).json({ error: '채널을 찾을 수 없습니다.' });
  if (!anthropic) return res.status(503).json({ error: 'AI 서비스가 구성되지 않았습니다.' });

  const recent = (messages.get(req.params.id) ?? [])
    .filter(m => !m.isSystem && !m.streaming && m.text?.trim())
    .slice(-60).map(m => `${m.author}: ${m.text}`).join('\n');

  if (!recent) return res.status(400).json({ error: '요약할 메시지가 없습니다.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const stream = await anthropic.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 600, stream: true,
      system: `You are a Korean chat summarizer. Write:
1. A 1-3 sentence summary in Korean.
2. 2-5 key points in Korean (each starting with "• ").
3. On the very last line ONLY: TONE:positive  TONE:neutral  TONE:negative  TONE:uncertain
No markdown, no code fences.`,
      messages: [{ role: 'user', content: recent }],
    });
    let fullText = '';
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        fullText += ev.delta.text;
        res.write(`data: ${JSON.stringify({ t: 'chunk', text: ev.delta.text })}\n\n`);
      }
    }
    const m = fullText.match(/TONE:(positive|neutral|negative|uncertain)/i);
    const tone = VALID_TONES.includes(m?.[1]?.toLowerCase()) ? m[1].toLowerCase() : 'uncertain';
    res.write(`data: ${JSON.stringify({ t: 'done', tone })}\n\n`);
    res.end();
  } catch (err) {
    console.error('[summarize] error:', err.message);
    res.write(`data: ${JSON.stringify({ t: 'error', error: 'AI 요약 오류' })}\n\n`);
    res.end();
  }
});

// ─── HTTP server + WebSocket ─────────────────────────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  const userId   = uuidv4();
  const userName = randomName();
  clients.set(ws, { userId, userName, channelId: null });

  // Send init
  sendTo(ws, {
    type: 'init',
    userId,
    userName,
    channels: [...channels.values()],
  });

  ws.on('message', async (raw) => {
    let data;
    try { data = JSON.parse(raw.toString()); }
    catch { sendTo(ws, { type: 'error', message: 'JSON 파싱 오류' }); return; }

    const state = clients.get(ws);
    if (!state) return;

    switch (data.type) {
      // ──────────────────────────────────────────────────────────── join
      case 'join': {
        const { channelId } = data;
        if (typeof channelId !== 'string' || !channels.has(channelId)) {
          sendTo(ws, { type: 'error', message: '채널을 찾을 수 없습니다.' }); return;
        }

        // Leave previous channel cleanly
        if (state.channelId && state.channelId !== channelId) {
          const prevId = state.channelId;
          clearUserTyping(prevId, state.userId);
          broadcastToChannel(prevId, {
            type: 'user_left', channelId: prevId,
            userId: state.userId, userName: state.userName,
          });
          recalcMemberCount(prevId);
        }

        state.channelId = channelId;

        // Send history (newest 80 messages)
        const hist = (messages.get(channelId) ?? []).slice(-80);
        sendTo(ws, { type: 'history', channelId, messages: hist });

        // Notify others
        broadcastToChannel(channelId, {
          type: 'user_joined', channelId,
          userId: state.userId, userName: state.userName,
        }, ws);
        recalcMemberCount(channelId);
        break;
      }

      // ──────────────────────────────────────────────────────────── leave
      case 'leave': {
        const { channelId } = data;
        if (state.channelId !== channelId) break;

        clearUserTyping(channelId, state.userId);
        state.channelId = null;
        broadcastToChannel(channelId, {
          type: 'user_left', channelId,
          userId: state.userId, userName: state.userName,
        });
        recalcMemberCount(channelId);
        break;
      }

      // ──────────────────────────────────────────────────────────── message
      case 'message': {
        const { channelId, text } = data;
        if (typeof channelId !== 'string' || !channels.has(channelId)) {
          sendTo(ws, { type: 'error', message: '채널을 찾을 수 없습니다.' }); return;
        }
        if (!text || typeof text !== 'string' || !text.trim()) return;
        if (text.length > 4000) {
          sendTo(ws, { type: 'error', message: '메시지가 너무 깁니다. (최대 4000자)' }); return;
        }

        // Clear typing for this user
        clearUserTyping(channelId, state.userId);

        const msg = {
          id: uuidv4(), channelId,
          userId: state.userId, author: state.userName,
          text: text.trim(),
          createdAt: new Date().toISOString(),
          isAI: false, isSystem: false,
          tone: null, streaming: false,
        };
        addMessage(msg);
        // Broadcast immediately to ALL clients (clients filter by channel;
        // other-channel clients use this to update their unread badge)
        broadcastAll({ type: 'message', message: { ...msg } });

        // Async tone analysis — update message and re-broadcast to ALL
        analyzeTone(msg.text).then(tone => {
          msg.tone = tone;  // enum, never null after analysis
          broadcastAll({ type: 'message', message: { ...msg } });
        });

        // AI trigger: ai-chat channel OR text starts with @ai
        const ch = channels.get(channelId);
        if ((ch?.hasAI || /^@ai\b/i.test(msg.text)) && anthropic) {
          setImmediate(() => streamAIResponse(channelId, msg.text));
        }
        break;
      }

      // ──────────────────────────────────────────────────────────── typing
      case 'typing': {
        const { channelId, isTyping } = data;
        if (typeof channelId !== 'string' || !channels.has(channelId)) return;

        const chTyping = typing.get(channelId) ?? new Map();
        typing.set(channelId, chTyping);

        if (isTyping) {
          chTyping.set(state.userId, {
            userId: state.userId, userName: state.userName, ts: Date.now(),
          });
        } else {
          chTyping.delete(state.userId);
        }

        // Broadcast to others in channel (not back to sender)
        broadcastToChannel(channelId, {
          type: 'typing_update', channelId,
          users: [...chTyping.values()].map(u => ({ userId: u.userId, userName: u.userName })),
        }, ws);
        break;
      }

      default:
        sendTo(ws, { type: 'error', message: `알 수 없는 메시지 타입: ${data.type}` });
    }
  });

  ws.on('close', () => {
    const state = clients.get(ws);
    if (state?.channelId) {
      clearUserTyping(state.channelId, state.userId);
      broadcastToChannel(state.channelId, {
        type: 'user_left', channelId: state.channelId,
        userId: state.userId, userName: state.userName,
      });
      const prevCh = state.channelId;
      clients.delete(ws);
      recalcMemberCount(prevCh);
    } else {
      clients.delete(ws);
    }
  });

  ws.on('error', err => console.error('[WS] client error:', err.message));
});

// ─── Start server ─────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`[Organt Chat] ✓ Server running on http://localhost:${PORT}`);
  console.log(`[Organt Chat] ✓ Channels: ${[...channels.keys()].join(', ')}`);
  console.log(`[Organt Chat] ✓ AI: ${anthropic ? 'enabled (claude-haiku-4-5)' : 'DISABLED'}`);
});

server.on('error', err => {
  console.error('[Server] Fatal:', err.message);
  process.exit(1);
});
