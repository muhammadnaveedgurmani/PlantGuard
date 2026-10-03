// Shared layout pieces: navbar, footer, page header, back-link.
// 3D PREMIUM EDITION: dimensional brand badge + inline 3D leaf art.

const NAV_LINKS = [
  ['#/home', 'Dashboard', 'fa-gauge-high'],
  ['#/diagnosis', 'Diagnosis', 'fa-magnifying-glass'],
  ['#/chatbot', 'AI Assistant', 'fa-comment-dots'],
  ['#/weather', 'Weather', 'fa-cloud-sun'],
  ['#/library', 'Library', 'fa-book'],
  ['#/community', 'Community', 'fa-users'],
  ['#/history', 'History', 'fa-clock-rotate-left']
];

/** Small 3D-style leaf mark used in the navbar brand badge. */
export function leafMarkSvg() {
  return `
  <svg viewBox="0 0 48 48" width="24" height="24" aria-hidden="true">
    <defs>
      <linearGradient id="pg-leafmark" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#bef264"/>
        <stop offset="0.55" stop-color="#a3e635"/>
        <stop offset="1" stop-color="#65a30d"/>
      </linearGradient>
    </defs>
    <path d="M24 4 C 38 12, 44 28, 24 44 C 4 28, 10 12, 24 4 Z" fill="url(#pg-leafmark)"/>
    <path d="M24 8 L24 40" stroke="rgba(255,255,255,0.75)" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M24 16 L33 22 M24 24 L35 31 M24 16 L15 22 M24 24 L13 31" stroke="rgba(255,255,255,0.55)" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Large dimensional 3D leaf illustration for hero scenes.
 * Layered gradients + vein highlights + ground shadow = soft-3D feel.
 * Inline SVG only, zero external requests.
 */
export function leafArt3d() {
  return `
  <svg class="fx-leaf-3d hero-leaf-main" viewBox="0 0 420 420" aria-hidden="true">
    <defs>
      <linearGradient id="pg-leaf-back" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#86c9a5"/>
        <stop offset="1" stop-color="#2f8a5c"/>
      </linearGradient>
      <linearGradient id="pg-leaf-front" x1="0" y1="0" x2="0.9" y2="1">
        <stop offset="0" stop-color="#a3e635"/>
        <stop offset="0.45" stop-color="#4fa87a"/>
        <stop offset="1" stop-color="#185939"/>
      </linearGradient>
      <linearGradient id="pg-leaf-sprout" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#bef264"/>
        <stop offset="1" stop-color="#65a30d"/>
      </linearGradient>
      <radialGradient id="pg-leaf-glow" cx="0.5" cy="0.4" r="0.7">
        <stop offset="0" stop-color="#bef264" stop-opacity="0.5"/>
        <stop offset="1" stop-color="#bef264" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="210" cy="200" r="170" fill="url(#pg-leaf-glow)"/>
    <ellipse cx="210" cy="368" rx="120" ry="20" fill="rgba(10,36,23,0.16)"/>
    <!-- back leaf -->
    <g transform="rotate(-24 210 220)">
      <path d="M210 90 C 300 140, 320 250, 210 330 C 100 250, 120 140, 210 90 Z" fill="url(#pg-leaf-back)" opacity="0.9"/>
      <path d="M210 110 L210 310" stroke="rgba(255,255,255,0.45)" stroke-width="7" stroke-linecap="round"/>
    </g>
    <!-- sprout leaf -->
    <g transform="rotate(20 268 300)">
      <path d="M268 210 C 322 236, 332 300, 268 346 C 204 300, 214 236, 268 210 Z" fill="url(#pg-leaf-sprout)"/>
      <path d="M268 226 L268 330" stroke="rgba(255,255,255,0.6)" stroke-width="5" stroke-linecap="round"/>
    </g>
    <!-- main front leaf -->
    <path d="M210 50 C 330 120, 352 260, 210 352 C 68 260, 90 120, 210 50 Z" fill="url(#pg-leaf-front)"/>
    <path d="M210 50 C 330 120, 352 260, 210 352 C 68 260, 90 120, 210 50 Z" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="3"/>
    <!-- center vein -->
    <path d="M210 78 L210 326" stroke="rgba(255,255,255,0.65)" stroke-width="8" stroke-linecap="round"/>
    <path d="M210 78 L210 326" stroke="rgba(10,36,23,0.18)" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 7"/>
    <!-- side veins -->
    <g stroke="rgba(255,255,255,0.5)" stroke-width="4.5" stroke-linecap="round" fill="none">
      <path d="M210 130 L286 168"/>
      <path d="M210 130 L134 168"/>
      <path d="M210 190 L298 232"/>
      <path d="M210 190 L122 232"/>
      <path d="M210 250 L286 292"/>
      <path d="M210 250 L134 292"/>
    </g>
    <!-- glossy highlight -->
    <ellipse cx="158" cy="150" rx="34" ry="72" fill="rgba(255,255,255,0.22)" transform="rotate(-18 158 150)"/>
    <!-- floating droplets -->
    <circle cx="120" cy="120" r="10" fill="#bef264" opacity="0.85"/>
    <circle cx="318" cy="96" r="7" fill="#a3e635" opacity="0.8"/>
    <circle cx="340" cy="250" r="5" fill="#86c9a5" opacity="0.8"/>
  </svg>`;
}

export function navbarHtml(activePage) {
  return `
  <nav class="navbar" aria-label="Primary navigation">
    <button class="navbar-brand" onclick="navigate('#/home')" aria-label="PlantGuard home">
      <span class="brand-badge">${leafMarkSvg()}</span> PlantGuard
    </button>
    <ul class="navbar-nav" id="navbar-nav">
      ${NAV_LINKS
        .map(
          ([href, label, icon]) =>
            `<li><button class="nav-link ${href === activePage ? 'active' : ''}" ${href === activePage ? 'aria-current="page"' : ''} onclick="navigate('${href}')"><i class="fas ${icon}" aria-hidden="true"></i> ${label}</button></li>`
        )
        .join('')}
    </ul>
    <button class="navbar-toggle" id="navbar-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="navbar-nav">
      <i class="fas fa-bars" aria-hidden="true"></i>
    </button>
  </nav>`;
}

export function footerHtml() {
  return `
  <footer class="site-footer">
    <div class="footer-inner">
      <div class="footer-brand"><span class="brand-badge" style="width:34px;height:34px;">${leafMarkSvg()}</span> PlantGuard</div>
      <div class="footer-links">
        <button onclick="navigate('#/home')">Dashboard</button>
        <button onclick="navigate('#/diagnosis')">Diagnosis</button>
        <button onclick="navigate('#/community')">Community</button>
        <button onclick="navigate('#/chatbot')">AI Assistant</button>
      </div>
      <div class="footer-credit">AI plant diagnosis assistant &mdash; not a substitute for professional agronomic advice. Built with Hono + Cloudflare.</div>
    </div>
  </footer>`;
}

export function backLink(label) {
  return `<button class="page-back" onclick="navigate('#/home')"><i class="fas fa-arrow-left" aria-hidden="true"></i> ${label || 'Back to Dashboard'}</button>`;
}

export function mainHeader(title, subtitle) {
  return `
  <header class="main-header">
    <h1 class="main-header-title">${title}</h1>
    <p class="main-header-subtitle">${subtitle}</p>
  </header>`;
}

export function setupNavbarToggle() {
  const toggle = document.getElementById('navbar-toggle');
  const nav = document.getElementById('navbar-nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}
