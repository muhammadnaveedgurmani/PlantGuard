// Weather page — decision-support: current conditions, 7-day forecast,
// deterministic risk alerts, recommended actions.
import { navbarHtml, footerHtml, backLink, mainHeader, setupNavbarToggle } from '../components/layout.js';
import { api } from '../api.js';
import { escapeHtml, qs } from '../utils.js';
import { errorStateHtml } from '../components/diagnosisView.js';

export async function renderWeather(app) {
  app.innerHTML = `
  <div class="page-shell">
    ${navbarHtml('#/weather')}
    ${mainHeader('7-Day Weather Forecast', 'Real-time forecast data and disease-risk alerts for farming decisions')}
    <main class="page-main">
      <div class="page-container">
        ${backLink()}
        <div class="row gap-2 wrap" style="align-items:flex-end;margin-bottom:var(--space-5);">
          <div class="form-group flex-1" style="min-width:200px;margin-bottom:0;">
            <label class="form-label" for="city-input">City Name</label>
            <input type="text" id="city-input" placeholder="e.g., Lahore, Karachi"/>
          </div>
          <button class="btn btn-primary" id="get-weather-btn"><i class="fas fa-magnifying-glass" aria-hidden="true"></i> Get Weather</button>
        </div>
        <div id="weather-content"><div class="skeleton" style="height:160px;"></div></div>
      </div>
    </main>
    ${footerHtml()}
  </div>`;

  setupNavbarToggle();
  qs('get-weather-btn').addEventListener('click', fetchWeather);
  qs('city-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') fetchWeather(); });

  const detect = await api.detectLocation();
  // Guard: the user may have navigated away while detection was in flight.
  const cityInput = qs('city-input');
  const contentEl = qs('weather-content');
  if (!cityInput || !contentEl) return;
  if (detect.ok && detect.data.city) {
    cityInput.value = detect.data.city;
    await fetchWeather();
  } else {
    contentEl.innerHTML = `<div class="empty-state"><i class="fas fa-location-dot" aria-hidden="true"></i>Enter a city name to see the forecast.</div>`;
  }
}

async function fetchWeather() {
  const city = qs('city-input').value.trim();
  const contentEl = qs('weather-content');
  if (!city) {
    contentEl.innerHTML = `<div class="empty-state"><i class="fas fa-location-dot" aria-hidden="true"></i>Please enter a city name.</div>`;
    return;
  }

  contentEl.innerHTML = `<div class="text-center" style="padding:var(--space-8) 0;"><div class="spinner"></div></div>`;

  const res = await api.getForecast({ city });
  if (!res.ok) {
    contentEl.innerHTML = errorStateHtml(res.data.error, 'retryFetchWeather');
    return;
  }

  const data = res.data;
  const risk = data.risk;

  contentEl.innerHTML = `
    ${riskAlertsHtml(risk)}
    <div class="weather-hero">
      <h2>${escapeHtml(data.city)}${data.country ? ', ' + escapeHtml(data.country) : ''}</h2>
      <p style="opacity:0.9;margin:0;">Today &mdash; ${escapeHtml(data.current.condition)}</p>
    </div>
    <div class="weather-metrics">
      ${weatherMetric('fa-temperature-half', data.current.temp + '°C', 'Temperature')}
      ${weatherMetric('fa-droplet', data.current.humidity, 'Humidity')}
      ${weatherMetric('fa-wind', data.current.wind, 'Wind')}
      ${weatherMetric('fa-cloud-rain', data.current.precipitation, 'Precipitation')}
    </div>
    <h3 class="mt-6">7-Day Forecast</h3>
    <div class="forecast-grid">
      ${data.daily
        .map(
          (d) => `
        <div class="forecast-day">
          <div class="d">${escapeHtml(d.date)}</div>
          <div class="t">${d.temp_max}°C</div>
          <div class="c">${d.temp_min}°C &middot; ${escapeHtml(d.condition)}</div>
          <div class="c">${escapeHtml(d.wind)}</div>
        </div>`
        )
        .join('')}
    </div>
  `;
}

function weatherMetric(icon, value, label) {
  return `
  <div class="weather-metric">
    <div class="value"><i class="fas ${icon}" aria-hidden="true" style="font-size:var(--font-size-base);color:var(--color-brand-500);"></i> ${value}</div>
    <div class="label">${label}</div>
  </div>`;
}

function riskAlertsHtml(risk) {
  if (!risk || risk.insufficient_info) return '';
  if (!risk.has_meaningful_alert) {
    return `<div class="callout callout-success mb-4"><i class="fas fa-circle-check" aria-hidden="true"></i><div>No elevated disease/weather risk detected for current conditions.</div></div>`;
  }
  return risk.alerts
    .map(
      (a) => `
    <div class="callout callout-${a.level === 'high' ? 'danger' : 'warning'} mb-3">
      <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
      <div>
        <strong>${escapeHtml(a.title)}</strong>
        <p class="mt-1 mb-1" style="color:inherit;">${escapeHtml(a.reason)}</p>
        <p class="mt-0" style="color:inherit;font-weight:600;">Recommendation: ${escapeHtml(a.recommendation)}</p>
        <span class="text-muted" style="font-size:var(--font-size-xs);">${escapeHtml(a.weather_factor)}</span>
      </div>
    </div>`
    )
    .join('');
}

function retryFetchWeather() {
  fetchWeather();
}

Object.assign(window, { retryFetchWeather });
