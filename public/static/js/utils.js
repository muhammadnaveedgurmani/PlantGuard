// PlantGuard shared utility functions (escaping, formatting, small helpers).

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showToast(message, isError) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function listHtml(arr) {
  if (!arr || arr.length === 0) return '<li>Not specified</li>';
  return arr.map((s) => `<li>${escapeHtml(s)}</li>`).join('');
}

export function severityClass(sev) {
  const s = (sev || 'none').toLowerCase();
  return 'severity-' + (['low', 'moderate', 'high', 'critical'].includes(s) ? s : 'none');
}

export function confidenceClass(level) {
  const l = (level || 'medium').toLowerCase();
  return ['high', 'medium', 'low'].includes(l) ? l : 'medium';
}

export function debounce(fn, delayMs) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delayMs);
  };
}

export function qs(id) {
  return document.getElementById(id);
}

export function renderMarkdownSafe(text) {
  // 2026-10-03 (H2 fix): AI output is attacker-influenceable (prompt
  // injection), and marked passes raw HTML straight through. Sanitize the
  // rendered HTML with DOMPurify. Fail closed: if DOMPurify did not load,
  // render as escaped plain text rather than unsanitized HTML.
  if (window.DOMPurify) {
    try {
      const html = window.marked ? marked.parse(text) : `<p>${escapeHtml(text)}</p>`;
      return DOMPurify.sanitize(html);
    } catch {
      return `<p>${escapeHtml(text)}</p>`;
    }
  }
  return `<p>${escapeHtml(text)}</p>`;
}
