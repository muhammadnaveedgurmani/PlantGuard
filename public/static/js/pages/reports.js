// Reports — index of generated diagnosis reports. Frontend-only view over the
// existing /api/diagnosis/history endpoint: each record links to its full
// printable report at #/report/:id. One of the 6 core app functions.
import { navbarHtml, footerHtml, backLink, mainHeader, setupNavbarToggle } from '../components/layout.js';
import { api } from '../api.js';
import { escapeHtml, timeAgo, showToast, qs } from '../utils.js';

let currentPage = 1;
const PAGE_SIZE = 12;

export async function renderReports(app) {
  currentPage = 1;

  app.innerHTML = `
  <div class="page-shell">
    ${navbarHtml('#/reports')}
    ${mainHeader('Diagnosis Reports', 'Open, review, and print the full report for any past diagnosis')}
    <main class="page-main">
      <div class="page-container">
        ${backLink()}
        <div id="reports-list"><div class="skeleton" style="height:120px;"></div></div>
        <div class="pagination" id="reports-pagination"></div>
      </div>
    </main>
    ${footerHtml()}
  </div>`;

  setupNavbarToggle();
  await loadReports();
}

async function loadReports() {
  const el = qs('reports-list');
  const res = await api.getHistory({ page: currentPage, page_size: PAGE_SIZE });
  if (!res.ok) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i>Failed to load reports. <button class="btn btn-sm btn-secondary" onclick="reloadReports()">Retry</button></div>`;
    return;
  }
  const { records, page, total_pages } = res.data;
  if (!records || records.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="fas fa-file-lines" aria-hidden="true"></i>No reports yet. <button class="btn btn-sm btn-primary" onclick="navigate('#/diagnosis')">Run your first diagnosis</button></div>`;
    qs('reports-pagination').innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="grid-auto">${records.map(reportCardHtml).join('')}</div>`;
  renderPagination(page, total_pages);
}

function reportCardHtml(r) {
  const label = r.is_healthy ? 'Healthy' : r.disease_name;
  const healthy = !!r.is_healthy;
  return `
  <div class="card card-interactive" role="button" tabindex="0" onclick="navigate('#/report/${r.id}')" onkeydown="if(event.key==='Enter'){navigate('#/report/${r.id}')}">
    <div class="row justify-between">
      <span class="badge ${healthy ? 'badge-confidence-high' : 'badge-confidence-medium'}"><i class="fas ${healthy ? 'fa-circle-check' : 'fa-triangle-exclamation'}" aria-hidden="true"></i> ${escapeHtml(label)}</span>
      <span class="text-muted" style="font-size:var(--font-size-xs);">${timeAgo(r.created_at)}</span>
    </div>
    <h4 class="mt-2 mb-0">${escapeHtml(r.plant_name)}</h4>
    <p class="text-muted mt-0 mb-0" style="font-size:var(--font-size-sm);">${Math.round(r.confidence)}% confidence</p>
    <div class="row gap-2 mt-3">
      <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();navigate('#/report/${r.id}')"><i class="fas fa-file-lines" aria-hidden="true"></i> Open Report</button>
    </div>
  </div>`;
}

function renderPagination(page, totalPages) {
  const el = qs('reports-pagination');
  if (!el) return;
  if (totalPages <= 1) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <button class="btn btn-sm btn-ghost" ${page <= 1 ? 'disabled' : ''} onclick="goToReportsPage(${page - 1})"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>
    <span class="page-info">Page ${page} of ${totalPages}</span>
    <button class="btn btn-sm btn-ghost" ${page >= totalPages ? 'disabled' : ''} onclick="goToReportsPage(${page + 1})"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>`;
}

function goToReportsPage(page) {
  currentPage = page;
  loadReports();
  window.scrollTo(0, 0);
}

function reloadReports() {
  loadReports();
}

Object.assign(window, { goToReportsPage, reloadReports });
