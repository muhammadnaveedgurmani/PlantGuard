// PlantGuard SPA entry point. Wires the router to every page module and
// exposes the small set of functions still needed as global `onclick`
// handlers in server-rendered template strings (module scope isn't global
// by default with type="module").
import { registerRoute, navigate, startRouter } from './router.js';
import { mountChatWidget } from './components/chatWidget.js';
import { renderLanding } from './pages/landing.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderDiagnosis } from './pages/diagnosis.js';
import { renderChatbot } from './pages/chatbot.js';
import { renderWeather } from './pages/weather.js';
import { renderLibrary } from './pages/library.js';
import { renderCommunity } from './pages/community.js';
import { renderHistory } from './pages/history.js';
import { renderReports } from './pages/reports.js';
import { renderReport } from './pages/report.js';

axios.defaults.withCredentials = true;

const app = document.getElementById('app');

// PlantGuard is a web app: it opens directly into the workspace dashboard.
// The marketing landing page lives at #/welcome only.
registerRoute('', () => renderDashboard(app));
registerRoute('#/', () => renderDashboard(app));
registerRoute('#/welcome', () => renderLanding(app));
registerRoute('#/home', () => renderDashboard(app));
registerRoute('#/diagnosis', () => renderDiagnosis(app));
registerRoute('#/chatbot', () => renderChatbot(app));
registerRoute('#/weather', () => renderWeather(app));
registerRoute('#/library', () => renderLibrary(app, getQueryParam('tab')));
registerRoute('#/community', () => renderCommunity(app));
registerRoute('#/history', () => renderHistory(app));
registerRoute('#/reports', () => renderReports(app));
registerRoute('#/report/:id', (params) => renderReport(app, params.id));

function getQueryParam(name) {
  const hash = window.location.hash;
  const qIndex = hash.indexOf('?');
  if (qIndex === -1) return null;
  const params = new URLSearchParams(hash.slice(qIndex + 1));
  return params.get(name);
}

startRouter(app, () => renderDashboard(app));

// Floating chatbot widget: mounted once, persists across route changes.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountChatWidget);
} else {
  mountChatWidget();
}

// Expose navigate() globally since inline onclick="navigate(...)" strings
// are used throughout the server-rendered page HTML.
window.navigate = navigate;
