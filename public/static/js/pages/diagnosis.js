// Diagnosis page — upload flow with every state: empty, file-selected,
// staged processing, success (healthy/diseased/low-confidence/secondary),
// image-rejected, not-a-leaf, rate-limited, api-error, network-error, retry.
import { navbarHtml, footerHtml, backLink, mainHeader, setupNavbarToggle } from '../components/layout.js';
import { api } from '../api.js';
import { showToast, qs } from '../utils.js';
import { diagnosisResultHtml, notLeafHtml, imageRejectedHtml, errorStateHtml, rateLimitHtml, engineBadgeHtml } from '../components/diagnosisView.js';
import { state } from '../state.js';
import { predictLeaf, warmUpCnn } from '../cnn/cnnClient.js';

let selectedFile = null;
let selectedImgEl = null;

// Warm up the on-device model in the background so first analysis is fast.
// Failures are silent: the server vision-LLM path remains the fallback.
try { warmUpCnn(); } catch (_) {}

export function renderDiagnosis(app) {
  selectedFile = null;
  selectedImgEl = null;
  app.innerHTML = `
  <div class="page-shell">
    ${navbarHtml('#/diagnosis')}
    ${mainHeader('AI Plant Diagnosis', 'Upload a leaf photo for instant AI-powered disease detection')}
    <main class="page-main">
      <div class="page-container">
        ${backLink()}
        <div class="diag-layout" id="diag-grid">
          <div>
            <div class="upload-box" id="upload-box" role="button" tabindex="0" aria-label="Upload leaf photo"
              onclick="document.getElementById('file-input').click()"
              onkeydown="if(event.key==='Enter')document.getElementById('file-input').click()">
              <i class="fas fa-cloud-arrow-up upload-icon" aria-hidden="true"></i>
              <p class="mt-2" style="font-weight:600;color:var(--color-neutral-700);">Click to upload a leaf photo</p>
              <p class="text-muted" style="font-size:var(--font-size-xs);">PNG, JPG, JPEG &mdash; up to 8MB</p>
              <div id="preview-area"></div>
            </div>
            <input type="file" id="file-input" accept="image/png,image/jpeg,image/jpg" class="hidden" aria-label="Choose leaf image file" />
            <button class="btn btn-primary btn-block mt-4" id="analyze-btn" disabled>
              <i class="fas fa-microscope" aria-hidden="true"></i> Analyze Leaf
            </button>
          </div>
          <div id="diag-result" aria-live="polite">
            <div class="empty-state">
              <i class="fas fa-leaf" aria-hidden="true"></i>
              Upload a leaf photo and click "Analyze Leaf" to get your AI diagnosis.
            </div>
          </div>
        </div>
      </div>
    </main>
    ${footerHtml()}
  </div>`;

  setupNavbarToggle();

  const fileInput = qs('file-input');
  fileInput.addEventListener('change', onFileSelected);
  qs('analyze-btn').addEventListener('click', analyzeLeaf);

  const uploadBox = qs('upload-box');
  uploadBox.addEventListener('dragover', (e) => { e.preventDefault(); uploadBox.classList.add('drag-over'); });
  uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('drag-over'));
  uploadBox.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadBox.classList.remove('drag-over');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      fileInput.files = e.dataTransfer.files;
      handleSelectedFile(file);
    }
  });

  if (window.matchMedia('(max-width: 860px)').matches) {
    qs('diag-grid').style.gridTemplateColumns = '1fr';
  }
}

function onFileSelected(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  handleSelectedFile(file);
}

function handleSelectedFile(file) {
  selectedFile = file;
  selectedImgEl = null;
  const reader = new FileReader();
  reader.onload = (e) => {
    qs('preview-area').innerHTML = `<img class="upload-preview" id="cnn-source-img" src="${e.target.result}" alt="Selected leaf photo preview"/>`;
    selectedImgEl = document.getElementById('cnn-source-img');
  };
  reader.readAsDataURL(file);
  qs('analyze-btn').disabled = false;
  qs('diag-result').innerHTML = `<div class="empty-state"><i class="fas fa-microscope" aria-hidden="true"></i>Photo ready. Click "Analyze Leaf" to run AI diagnosis.</div>`;
}

/**
 * Heuristic leaf check: sample the image pixels and measure how many are
 * "leaf green" (green clearly dominant over red and blue). Real leaf photos
 * are 25-70% green; food/faces/objects are usually under 8%.
 */
function looksLikeLeaf(imgEl) {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  let green = 0;
  const total = SIZE * SIZE;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (g > 70 && g > r + 25 && g > b + 25) green++;
  }
  return green / total >= 0.10;
}

const STAGES = [
  { key: 'upload', label: 'Uploading photo' },
  { key: 'quality', label: 'Checking photo quality' },
  { key: 'ai', label: 'Running AI vision analysis' },
  { key: 'validate', label: 'Validating result' }
];

function renderStages(activeIndex, stage1Label) {
  const stages = STAGES.map((s, i) =>
    i === 1 && stage1Label ? { ...s, label: stage1Label } : s
  );
  return `
  <div class="text-center" style="padding:var(--space-8) 0;">
    <div class="spinner"></div>
    <div class="processing-stages">
      ${stages.map((s, i) => {
        const cls = i < activeIndex ? 'done' : i === activeIndex ? 'active' : '';
        const icon = i < activeIndex ? 'fa-check' : i === activeIndex ? 'fa-circle-notch fa-spin' : 'fa-circle';
        return `<div class="processing-stage ${cls}"><i class="fas ${icon}" aria-hidden="true"></i> ${s.label}</div>`;
      }).join('')}
    </div>
  </div>`;
}

async function analyzeLeaf() {
  if (!selectedFile) return;
  const resultEl = qs('diag-result');
  const btn = qs('analyze-btn');
  btn.disabled = true;

  // STEP 0: quick on-device leaf check — reject obvious non-leaf photos
  // (food, faces, objects) before any AI runs. A real leaf photo is mostly
  // green; if almost nothing is green, don't waste AI calls on it.
  if (selectedImgEl && selectedImgEl.complete && selectedImgEl.naturalWidth > 0) {
    try {
      if (!looksLikeLeaf(selectedImgEl)) {
        btn.disabled = false;
        resultEl.innerHTML = `<div class="diag-error"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i><strong>Image doesn't look like a plant leaf</strong><p>This image does not appear to contain a plant leaf. Please upload a clear leaf photo.</p></div>`;
        return;
      }
    } catch (_) { /* check failed — continue to normal flow */ }
  }

  resultEl.innerHTML = renderStages(0);
  await tick();

  // STEP 1: on-device CNN first (instant, free, private). If the model or
  // CDN is unavailable this throws and we silently use the server path.
  let cnn = null;
  if (selectedImgEl && selectedImgEl.complete && selectedImgEl.naturalWidth > 0) {
    resultEl.innerHTML = renderStages(1, 'On-device AI model');
    await tick();
    try {
      cnn = await predictLeaf(selectedImgEl);
    } catch (_) {
      cnn = null;
    }
  }

  resultEl.innerHTML = renderStages(2);
  const res = await api.analyzeLeaf(selectedFile, cnn);

  if (!res.ok) {
    btn.disabled = false;
    if (res.status === 429) {
      resultEl.innerHTML = rateLimitHtml(res.data);
      return;
    }
    if (res.status === 400 && res.data.image_rejected) {
      resultEl.innerHTML = imageRejectedHtml(res.data.problems, res.data.how_to_retake);
      return;
    }
    resultEl.innerHTML = errorStateHtml(
      res.data.error || 'Diagnosis failed. Please check your connection and try again.',
      'retryAnalyzeLeaf'
    );
    return;
  }

  resultEl.innerHTML = renderStages(3);
  await tick();

  const data = res.data;
  if (data.error) {
    resultEl.innerHTML = errorStateHtml(data.error, 'retryAnalyzeLeaf');
  } else if (data.is_leaf === false) {
    resultEl.innerHTML = notLeafHtml(data.message);
  } else {
    // Honest provenance: which engine produced this result.
    const badge = engineBadgeHtml(data.engine);
    resultEl.innerHTML = badge + diagnosisResultHtml(data);
    if (data.engine === 'llm' && cnn && cnn.confidence < (cnn.threshold || 0.7)) {
      showToast('On-device confidence was low — verified with cloud AI');
    } else if (data.id) {
      showToast('Diagnosis saved to your history');
    }
  }
  btn.disabled = false;
}

function tick() {
  return new Promise((r) => setTimeout(r, 220));
}

function retryAnalyzeLeaf() {
  analyzeLeaf();
}

async function sendDiagnosisFeedback(id, feedback) {
  const res = await api.sendDiagnosisFeedback(id, feedback);
  if (!res.ok) {
    showToast('Could not save feedback', true);
    return;
  }
  const upBtn = qs(`fb-up-${id}`);
  const downBtn = qs(`fb-down-${id}`);
  if (upBtn) upBtn.classList.toggle('selected-up', feedback === 'helpful');
  if (downBtn) downBtn.classList.toggle('selected-down', feedback === 'not_helpful');
  showToast('Thanks for the feedback!');
}

function askAiAboutDiagnosis(diagnosisId) {
  state.setPendingChatDiagnosis(diagnosisId);
  navigate('#/chatbot');
}

Object.assign(window, { retryAnalyzeLeaf, sendDiagnosisFeedback, askAiAboutDiagnosis });
