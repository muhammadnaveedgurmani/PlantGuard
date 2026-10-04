// Shared diagnosis-result renderer. Used by the Diagnosis page (fresh
// analysis) and the History page (past record detail) so the two never
// drift out of sync. Renders every state the backend can actually produce:
// healthy / diseased / low-confidence / secondary possibilities / image
// quality warnings / feedback buttons.

import { escapeHtml, listHtml, severityClass, confidenceClass } from '../utils.js';

/** Renders the full result card for a completed, validated diagnosis. */
export function diagnosisResultHtml(data, opts = {}) {
  const {
    showFeedback = true,
    showAskAi = true,
    showReportLink = true,
    idForActions = data.id
  } = opts;

  const confBadgeClass = `badge-confidence-${confidenceClass(data.confidence_level)}`;
  const confLabel = (data.confidence_level || 'medium').toUpperCase();

  const qualityWarnings = data.image_quality_warnings || [];
  const qualityBanner = qualityWarnings.length
    ? `<div class="callout callout-warning mt-2">
        <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
        <div><strong>Photo quality note:</strong> ${qualityWarnings.map(escapeHtml).join(' ')}</div>
      </div>`
    : '';

  const secondary = data.secondary_possibilities || [];
  const secondaryHtml = secondary.length
    ? `
    <div class="info-block mt-4">
      <h5><i class="fas fa-list-check" aria-hidden="true"></i> Other Possibilities Considered</h5>
      <div class="secondary-possibilities">
        ${secondary
          .map(
            (s) => `
          <div class="secondary-possibility-row">
            <span>${escapeHtml(s.disease_name)}</span>
            <span class="text-muted">${Math.round(s.confidence)}%</span>
          </div>`
          )
          .join('')}
      </div>
      <p class="form-hint mt-2">The AI considered these as less likely alternatives. If treatment doesn't help, reconsider these.</p>
    </div>`
    : '';

  const actionsHtml = `
    <div class="row justify-between wrap mt-4" style="gap:var(--space-3);">
      ${
        showFeedback && idForActions
          ? `
        <div class="feedback-row" role="group" aria-label="Was this diagnosis helpful?">
          <span class="text-muted" style="font-size:var(--font-size-xs);">Helpful?</span>
          <button class="feedback-btn" id="fb-up-${idForActions}" onclick="sendDiagnosisFeedback(${idForActions}, 'helpful')" aria-label="Mark helpful"><i class="fas fa-thumbs-up" aria-hidden="true"></i></button>
          <button class="feedback-btn" id="fb-down-${idForActions}" onclick="sendDiagnosisFeedback(${idForActions}, 'not_helpful')" aria-label="Mark not helpful"><i class="fas fa-thumbs-down" aria-hidden="true"></i></button>
        </div>`
          : '<span></span>'
      }
      <div class="row gap-2 wrap">
        ${showAskAi && idForActions ? `<button class="btn btn-sm btn-ghost" onclick="askAiAboutDiagnosis(${idForActions})"><i class="fas fa-comment-dots" aria-hidden="true"></i> Ask AI</button>` : ''}
        ${showReportLink && idForActions ? `<button class="btn btn-sm btn-ghost" onclick="navigate('#/report/${idForActions}')"><i class="fas fa-file-lines" aria-hidden="true"></i> View Report</button>` : ''}
      </div>
    </div>`;

  if (data.is_healthy) {
    return `
    <div class="diag-result-card">
      <div class="callout callout-success">
        <i class="fas fa-circle-check" aria-hidden="true"></i>
        <div>
          <strong>${escapeHtml(data.plant_name)} appears healthy</strong>
          <p class="mt-0" style="color:inherit;">No signs of disease detected. Continue good care practices.</p>
        </div>
      </div>
      <div class="row gap-3 wrap">
        <span class="badge ${confBadgeClass}">${confLabel} CONFIDENCE (${Math.round(data.confidence)}%)</span>
      </div>
      <div class="progress-outer"><div class="progress-inner confidence-${confidenceClass(data.confidence_level)}" style="width:${Math.max(2, data.confidence)}%"></div></div>
      ${qualityBanner}
      ${data.notes ? `<p class="text-muted" style="font-size:var(--font-size-sm);"><em>${escapeHtml(data.notes)}</em></p>` : ''}
      ${actionsHtml}
    </div>`;
  }

  return `
  <div class="diag-result-card">
    <div class="diag-result-heading">
      <h3 class="mb-0">${escapeHtml(data.plant_name)} &mdash; ${escapeHtml(data.disease_name)}</h3>
      <span class="badge badge-${severityClass(data.severity)}">${escapeHtml(data.severity)} Severity</span>
    </div>
    <div class="row gap-3 wrap">
      <span class="badge ${confBadgeClass}">${confLabel} CONFIDENCE (${Math.round(data.confidence)}%)</span>
    </div>
    <div class="progress-outer"><div class="progress-inner confidence-${confidenceClass(data.confidence_level)}" style="width:${Math.max(2, data.confidence)}%"></div></div>
    ${qualityBanner}
    ${
      confidenceClass(data.confidence_level) === 'low'
        ? `<div class="callout callout-warning"><i class="fas fa-circle-question" aria-hidden="true"></i><div>Confidence is low for this result. Consider retaking the photo in better light, or treat this as a starting point rather than a certain diagnosis.</div></div>`
        : ''
    }
    <div class="grid-2 mt-2">
      <div class="info-block"><h5><i class="fas fa-magnifying-glass" aria-hidden="true"></i> Symptoms</h5><ul>${listHtml(data.symptoms)}</ul></div>
      <div class="info-block"><h5><i class="fas fa-satellite-dish" aria-hidden="true"></i> How It Spreads</h5><ul>${listHtml(data.spread)}</ul></div>
      <div class="info-block"><h5><i class="fas fa-pump-medical" aria-hidden="true"></i> Treatment</h5><ul>${listHtml(data.treatment)}</ul></div>
      <div class="info-block"><h5><i class="fas fa-shield-halved" aria-hidden="true"></i> Prevention</h5><ul>${listHtml(data.prevention)}</ul></div>
    </div>
    ${secondaryHtml}
    ${data.notes ? `<p class="text-muted" style="font-size:var(--font-size-sm);"><em>Note: ${escapeHtml(data.notes)}</em></p>` : ''}
    ${actionsHtml}
  </div>`;
}

/** Honest provenance badge: which engine produced this diagnosis. */
export function engineBadgeHtml(engine) {
  if (engine === 'cnn') {
    return `
    <div class="callout callout-success mt-0" style="margin-bottom:var(--space-3);">
      <i class="fas fa-microchip" aria-hidden="true"></i>
      <div><strong>Diagnosed on-device</strong>
      <p class="mt-0" style="color:inherit;font-size:var(--font-size-xs);">PlantGuard CNN v1 (MobileNetV2, 38 classes, 76.8% test accuracy). No cloud AI call was needed.</p></div>
    </div>`;
  }
  return `
    <div class="callout mt-0" style="margin-bottom:var(--space-3);">
      <i class="fas fa-cloud" aria-hidden="true"></i>
      <div><strong>Verified with cloud AI</strong>
      <p class="mt-0" style="color:inherit;font-size:var(--font-size-xs);">On-device confidence was low, so this result was double-checked by our expert AI model.</p></div>
    </div>`;
}

/** Renders the "not a plant leaf" rejection state. */
export function notLeafHtml(message) {
  return `
  <div class="callout callout-danger">
    <i class="fas fa-circle-xmark" aria-hidden="true"></i>
    <div>
      <strong>Image doesn't look like a plant leaf</strong>
      <p class="mt-0" style="color:inherit;">${escapeHtml(message || 'Please upload a clear leaf photo.')}</p>
    </div>
  </div>`;
}

/** Renders the pre-AI-call image-quality rejection state, with retake advice. */
export function imageRejectedHtml(problems, howToRetake) {
  return `
  <div class="callout callout-warning">
    <i class="fas fa-camera-retro" aria-hidden="true"></i>
    <div>
      <strong>This photo can't be analyzed reliably</strong>
      <ul class="mt-2">${(problems || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
      ${
        howToRetake && howToRetake.length
          ? `<p class="mt-2" style="color:inherit;font-weight:600;">Tips for a better photo:</p><ul>${howToRetake.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`
          : ''
      }
    </div>
  </div>`;
}

/** Renders a generic error state with a retry button. */
export function errorStateHtml(message, retryFnName) {
  return `
  <div class="callout callout-danger">
    <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
    <div>
      <strong>Something went wrong</strong>
      <p class="mt-0" style="color:inherit;">${escapeHtml(message || 'Please try again.')}</p>
      ${retryFnName ? `<button class="btn btn-sm btn-secondary mt-2" onclick="${retryFnName}()"><i class="fas fa-rotate-right" aria-hidden="true"></i> Retry</button>` : ''}
    </div>
  </div>`;
}

/** Renders a rate-limit state with the reset countdown baked in as text. */
export function rateLimitHtml(data) {
  return `
  <div class="callout callout-warning">
    <i class="fas fa-hourglass-half" aria-hidden="true"></i>
    <div>
      <strong>Usage limit reached</strong>
      <p class="mt-0" style="color:inherit;">${escapeHtml(data?.error || 'Please try again later.')}</p>
    </div>
  </div>`;
}
