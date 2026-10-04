// Dashboard — priority-weighted layout: Quick Diagnosis > Weather/Risk >
// Recent Diagnosis > AI Assistant > History > Library > Cultivation > Community.
import { navbarHtml, footerHtml, setupNavbarToggle } from '../components/layout.js';
import { api } from '../api.js';
import { escapeHtml, timeAgo } from '../utils.js';

export async function renderDashboard(app) {
  app.innerHTML = `
  <div class="page-shell">
    ${navbarHtml('#/home')}
    <main class="page-main">
      <div class="page-container">
        <h1>Plant Health Workspace</h1>
        <p class="text-muted">Six tools, one place &mdash; diagnose, chat, check weather risk, browse the library, review history, and open reports.</p>

        <div class="dashboard-primary-action mt-4">
          <i class="fas fa-magnifying-glass cta-icon" aria-hidden="true"></i>
          <div class="flex-1">
            <h2>Diagnose a Plant</h2>
            <p>Upload a leaf photo for instant AI-powered disease detection.</p>
            <button class="btn btn-primary" onclick="navigate('#/diagnosis')">Start Diagnosis</button>
          </div>
        </div>

        <div id="dash-risk-widget" class="risk-widget-inline"></div>

        <div class="dashboard-section-label">Recent Activity</div>
        <div id="dash-recent"><div class="skeleton" style="height:80px;"></div></div>

        <div class="dashboard-section-label">Core Functions</div>
        <div class="dash-grid grid-auto">
          ${dashCard('fa-magnifying-glass', 'Diagnosis', 'Upload a leaf photo for instant AI disease detection', "navigate('#/diagnosis')")}
          ${dashCard('fa-comment-dots', 'AI Assistant', 'Ask any plant care question', "navigate('#/chatbot')")}
          ${dashCard('fa-cloud-sun', 'Weather', '7-day real forecast &amp; risk alerts', "navigate('#/weather')")}
          ${dashCard('fa-book', 'Library', 'Disease reference &amp; cultivation guidance', "navigate('#/library')")}
          ${dashCard('fa-clock-rotate-left', 'History', 'Your past diagnosis records', "navigate('#/history')")}
          ${dashCard('fa-file-lines', 'Reports', 'Open and print full diagnosis reports', "navigate('#/reports')")}
        </div>
      </div>
    </main>
    ${footerHtml()}
  </div>`;

  setupNavbarToggle();
  loadRiskWidget();
  loadRecentActivity();
}

function dashCard(icon, title, desc, onclick) {
  return `
  <div class="card card-interactive dash-card" role="button" tabindex="0" onclick="${onclick}" onkeydown="if(event.key==='Enter'){${onclick}}">
    <div class="dash-card-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
    <h4>${title}</h4>
    <p>${desc}</p>
  </div>`;
}

async function loadRiskWidget() {
  const el = document.getElementById('dash-risk-widget');
  if (!el) return;
  const res = await api.getRiskSummary();
  if (!res.ok) {
    el.innerHTML = '';
    return;
  }
  const { risk, city } = res.data;
  if (!risk || risk.insufficient_info || !risk.alerts || risk.alerts.length === 0) {
    el.innerHTML = `
    <div class="callout callout-success mt-4">
      <i class="fas fa-circle-check" aria-hidden="true"></i>
      <div>No elevated weather-related risk detected right now${city ? ` for ${escapeHtml(city)}` : ''}. <button class="btn btn-sm btn-ghost" onclick="navigate('#/weather')">View forecast</button></div>
    </div>`;
    return;
  }
  const top = risk.alerts[0];
  el.innerHTML = `
  <div class="callout callout-warning mt-4">
    <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
    <div>
      <strong>${escapeHtml(top.title)}</strong>
      <p class="mt-0" style="color:inherit;">${escapeHtml(top.reason)}</p>
      <button class="btn btn-sm btn-secondary mt-2" onclick="navigate('#/weather')">View full forecast &amp; risk details</button>
    </div>
  </div>`;
}

async function loadRecentActivity() {
  const el = document.getElementById('dash-recent');
  if (!el) return;
  const res = await api.getHistory({ page: 1, page_size: 3 });
  if (!res.ok || !res.data.records || res.data.records.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-leaf" aria-hidden="true"></i>No diagnoses yet. Start by analyzing a plant leaf.</div>`;
    return;
  }
  el.innerHTML = `<div class="grid-auto">${res.data.records.map(recentCardHtml).join('')}</div>`;
}

function recentCardHtml(r) {
  const label = r.is_healthy ? 'Healthy' : r.disease_name;
  return `
  <div class="card card-interactive" role="button" tabindex="0" onclick="navigate('#/report/${r.id}')" onkeydown="if(event.key==='Enter'){navigate('#/report/${r.id}')}">
    <div class="row justify-between">
      <strong style="color:var(--color-brand-700);">${escapeHtml(r.plant_name)}</strong>
      <span class="text-muted" style="font-size:var(--font-size-xs);">${timeAgo(r.created_at)}</span>
    </div>
    <p class="mt-2 mb-0" style="font-size:var(--font-size-sm);">${escapeHtml(label)} &middot; ${Math.round(r.confidence)}% confidence</p>
  </div>`;
}
