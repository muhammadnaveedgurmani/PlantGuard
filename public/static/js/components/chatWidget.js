// Floating chatbot widget — fixed bottom-right bubble on EVERY view.
// Opens a slide-up chat panel wired to the same /api/chat endpoints as
// the dedicated chatbot page. Mounted once from main.js.
//
// ================================================================
//  CHATBOT AVATAR — SWAP POINT (owner will decide the final picture)
// ---------------------------------------------------------------
//  Replace the SVG string in CHATBOT_AVATAR_SVG below with either:
//    1. an <img> tag:  '<img src="/static/img/my-bot.png" alt="PlantGuard assistant"/>'
//    2. your own inline SVG.
//  It renders in BOTH the floating bubble and the panel header via
//  avatarHtml(), so changing this ONE constant updates everywhere.
//  File: public/static/js/components/chatWidget.js
//  Constant: CHATBOT_AVATAR_SVG (near the top of this file)
// ================================================================
const CHATBOT_AVATAR_SVG = `
  <svg viewBox="0 0 64 64" width="38" height="38" aria-hidden="true">
    <defs>
      <linearGradient id="pg-bot-avatar" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#bef264"/>
        <stop offset="0.55" stop-color="#a3e635"/>
        <stop offset="1" stop-color="#4fa87a"/>
      </linearGradient>
    </defs>
    <circle cx="32" cy="32" r="30" fill="url(#pg-bot-avatar)"/>
    <path d="M32 12 C 44 18, 48 30, 32 46 C 16 30, 20 18, 32 12 Z" fill="#0f3322" opacity="0.85"/>
    <path d="M32 15 L32 43" stroke="#bef264" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M32 22 L40 27 M32 22 L24 27 M32 30 L42 36 M32 30 L22 36" stroke="#bef264" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>
    <circle cx="23" cy="16" r="3.4" fill="#ffffff" opacity="0.9"/>
    <circle cx="41" cy="16" r="2.6" fill="#ffffff" opacity="0.7"/>
  </svg>`;

import { api } from '../api.js';
import { escapeHtml, renderMarkdownSafe } from '../utils.js';

const QUICK_REPLIES = [
  'How do I treat early blight?',
  'Is today good for watering?',
  'Prevent powdery mildew'
];

let root = null;
let panelOpen = false;
let historyLoaded = false;
let unreadShown = false;

function avatarHtml() {
  return `<span class="pg-chat-avatar">${CHATBOT_AVATAR_SVG}</span>`;
}

function bubbleHtml(m) {
  const content =
    m.role === 'assistant'
      ? renderMarkdownSafe(m.content)
      : `<p>${escapeHtml(m.content)}</p>`;
  return `<div class="chat-bubble ${m.role}">${content}</div>`;
}

/** Mount the widget once. Safe to call multiple times (idempotent). */
export function mountChatWidget() {
  if (root) return;
  root = document.createElement('div');
  root.id = 'pg-chat-widget-root';
  root.innerHTML = `
    <button class="pg-chat-bubble-btn" id="pg-chat-bubble-btn" aria-label="Open PlantGuard assistant chat" aria-expanded="false">
      ${avatarHtml()}
      <span class="pg-chat-unread-dot hidden" id="pg-chat-unread-dot" aria-hidden="true"></span>
    </button>
    <div id="pg-chat-panel-slot"></div>`;
  document.body.appendChild(root);

  makeBubbleDraggable();

  // Show the unread dot shortly after load to draw attention (once per page load).
  setTimeout(() => {
    if (!panelOpen && !unreadShown) {
      unreadShown = true;
      document.getElementById('pg-chat-unread-dot')?.classList.remove('hidden');
    }
  }, 6000);

  syncChatbotPageVisibility();
  window.addEventListener('hashchange', syncChatbotPageVisibility);
}

/** Draggable bubble: drag anywhere on screen, tap still opens chat. Position persists. */
function makeBubbleDraggable() {
  const btn = document.getElementById('pg-chat-bubble-btn');
  if (!btn) return;

  // Restore saved position.
  try {
    const saved = JSON.parse(localStorage.getItem('pg-chat-bubble-pos') || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      positionBubble(btn, saved.x, saved.y);
    }
  } catch { /* ignore bad saved data */ }

  let dragging = false;
  let moved = false;
  let startX = 0, startY = 0, baseX = 0, baseY = 0;

  const currentPos = () => {
    const r = btn.getBoundingClientRect();
    return { x: r.left, y: r.top };
  };

  btn.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const p = currentPos();
    baseX = p.x;
    baseY = p.y;
    btn.setPointerCapture(e.pointerId);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) + Math.abs(dy) > 8) moved = true;
    if (moved) positionBubble(btn, baseX + dx, baseY + dy);
  });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      // Persist position.
      const p = currentPos();
      try { localStorage.setItem('pg-chat-bubble-pos', JSON.stringify({ x: p.x, y: p.y })); } catch { /* ignore */ }
      e.preventDefault();
      e.stopPropagation();
    } else {
      togglePanel();
    }
  };
  btn.addEventListener('pointerup', endDrag);
  btn.addEventListener('pointercancel', () => { dragging = false; });

  // Keep bubble inside viewport on resize/orientation change.
  window.addEventListener('resize', () => {
    const p = currentPos();
    positionBubble(btn, p.x, p.y);
  });
}

/** Place the bubble at viewport coords, clamped inside the screen. */
function positionBubble(btn, x, y) {
  const size = btn.getBoundingClientRect();
  const margin = 8;
  const maxX = Math.max(margin, window.innerWidth - size.width - margin);
  const maxY = Math.max(margin, window.innerHeight - size.height - margin);
  const cx = Math.min(Math.max(margin, x), maxX);
  const cy = Math.min(Math.max(margin, y), maxY);
  btn.style.position = 'fixed';
  btn.style.left = cx + 'px';
  btn.style.top = cy + 'px';
  btn.style.right = 'auto';
  btn.style.bottom = 'auto';
  btn.style.touchAction = 'none';
}

/** Hide the floating widget while on the dedicated chatbot page. */
function syncChatbotPageVisibility() {
  const onChatbot = (window.location.hash || '').startsWith('#/chatbot');
  document.body.classList.toggle('pg-on-chatbot-page', onChatbot);
}

function togglePanel() {
  if (panelOpen) {
    closePanel();
  } else {
    openPanel();
  }
}

function openPanel() {
  panelOpen = true;
  document.getElementById('pg-chat-unread-dot')?.classList.add('hidden');
  const btn = document.getElementById('pg-chat-bubble-btn');
  btn.setAttribute('aria-expanded', 'true');

  const slot = document.getElementById('pg-chat-panel-slot');
  slot.innerHTML = `
  <div class="pg-chat-panel" id="pg-chat-panel" role="dialog" aria-label="PlantGuard assistant chat">
    <div class="pg-chat-panel-header">
      ${avatarHtml()}
      <div class="pg-chat-panel-title">
        <strong>PlantGuard Assistant</strong>
        <span><span class="pg-chat-online-dot"></span> Online — asks about plants</span>
      </div>
      <button class="pg-chat-panel-close" id="pg-chat-panel-close" aria-label="Close chat">
        <i class="fas fa-xmark" aria-hidden="true"></i>
      </button>
    </div>
    <div class="pg-chat-panel-messages" id="pg-chat-panel-messages" aria-live="polite">
      <div class="chat-empty">Loading conversation...</div>
    </div>
    <div class="pg-chat-quick-replies" id="pg-chat-quick-replies">
      ${QUICK_REPLIES.map((q) => `<button class="pg-chat-quick-reply" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}
    </div>
    <div class="pg-chat-panel-input">
      <label for="pg-chat-panel-input-field" class="sr-only">Type your message</label>
      <input type="text" id="pg-chat-panel-input-field" placeholder="Ask about plant care..." autocomplete="off"/>
      <button class="btn btn-primary btn-icon" id="pg-chat-panel-send" aria-label="Send message">
        <i class="fas fa-paper-plane" aria-hidden="true"></i>
      </button>
    </div>
  </div>`;

  document.getElementById('pg-chat-panel-close').addEventListener('click', closePanel);
  document.getElementById('pg-chat-panel-send').addEventListener('click', sendPanelMessage);
  document.getElementById('pg-chat-panel-input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendPanelMessage();
  });
  document.querySelectorAll('.pg-chat-quick-reply').forEach((b) => {
    b.addEventListener('click', () => {
      document.getElementById('pg-chat-panel-input-field').value = b.dataset.q;
      sendPanelMessage();
    });
  });

  loadPanelHistory();
}

function closePanel() {
  const panel = document.getElementById('pg-chat-panel');
  if (panel) {
    panel.classList.add('closing');
    setTimeout(() => {
      document.getElementById('pg-chat-panel-slot').innerHTML = '';
    }, 200);
  } else {
    document.getElementById('pg-chat-panel-slot').innerHTML = '';
  }
  panelOpen = false;
  document.getElementById('pg-chat-bubble-btn')?.setAttribute('aria-expanded', 'false');
}

async function loadPanelHistory() {
  const box = document.getElementById('pg-chat-panel-messages');
  if (!box) return;
  const res = await api.getChatHistory();
  if (!res.ok) {
    box.innerHTML = `<div class="chat-empty">Couldn't load conversation. Try sending a message.</div>`;
    return;
  }
  const messages = res.data.messages || [];
  historyLoaded = true;
  if (messages.length === 0) {
    box.innerHTML = `<div class="chat-bubble assistant"><p><strong>Hi, I'm the PlantGuard assistant</strong> 🌿</p><p>Ask me about plant diseases, care tips, or weather-based risks.</p></div>`;
    return;
  }
  box.innerHTML = messages.map((m) => bubbleHtml(m)).join('');
  box.scrollTop = box.scrollHeight;
}

async function sendPanelMessage() {
  const input = document.getElementById('pg-chat-panel-input-field');
  const box = document.getElementById('pg-chat-panel-messages');
  if (!input || !box) return;
  const message = input.value.trim();
  if (!message) return;
  input.value = '';

  if (box.querySelector('.chat-empty')) box.innerHTML = '';
  box.innerHTML += bubbleHtml({ role: 'user', content: message });
  const typingId = 'pg-typing-indicator';
  box.innerHTML += `<div class="chat-bubble assistant" id="${typingId}"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> thinking...</div>`;
  box.scrollTop = box.scrollHeight;

  const res = await api.sendChatMessage(message, null);
  document.getElementById(typingId)?.remove();

  if (!res.ok) {
    box.innerHTML += `<div class="chat-bubble assistant"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> ${escapeHtml(res.data.error || 'Something went wrong. Please try again.')}</div>`;
  } else {
    box.innerHTML += bubbleHtml({ role: 'assistant', content: res.data.reply });
  }
  box.scrollTop = box.scrollHeight;
}
