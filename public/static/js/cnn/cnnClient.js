// PlantGuard on-device CNN client (TensorFlow.js).
//
// Runs the trained MobileNetV2 (plantguard-cnn v1, 38 classes) directly in
// the user's browser. TF.js is lazy-loaded from CDN on first use so the
// initial page stays light. The model is cached in memory for the session.
//
// Model format: TF.js graph-model converted from the Keras SavedModel.
// Input spec: 224x224 RGB, float32, MobileNetV2 preprocessing (x/127.5 - 1).

const TFJS_CDN = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
const IMG_SIZE = 224;

let tfPromise = null;
let modelPromise = null;
let labelsCache = null;
let configCache = null;

function loadTfJs() {
  if (window.tf) return Promise.resolve(window.tf);
  if (tfPromise) return tfPromise;
  tfPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TFJS_CDN;
    s.async = true;
    s.onload = () => (window.tf ? resolve(window.tf) : reject(new Error('tfjs failed to initialize')));
    s.onerror = () => reject(new Error('Could not load TensorFlow.js from CDN'));
    document.head.appendChild(s);
    // Don't hang forever on a dead CDN.
    setTimeout(() => reject(new Error('TensorFlow.js load timed out')), 30000);
  });
  return tfPromise;
}

async function getConfig() {
  if (configCache) return configCache;
  const res = await fetch('/api/diagnosis/cnn-config');
  if (!res.ok) throw new Error('CNN config unavailable');
  configCache = await res.json();
  return configCache;
}

/** Load (and cache) the model + labels. Resolves to { model, labels, threshold }. */
export async function loadCnn() {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const tf = await loadTfJs();
    const cfg = await getConfig();
    if (!cfg.enabled) throw new Error('On-device CNN disabled by server');

    const res = await fetch(cfg.labelsUrl);
    if (!res.ok) throw new Error('Could not load CNN labels');
    labelsCache = await res.json();

    // Graph-model format (converted from SavedModel). Memory-cached only.
    const model = await tf.loadGraphModel(cfg.modelUrl);
    return { model, labels: labelsCache, threshold: cfg.threshold, version: cfg.version };
  })();
  // Allow retry after a failure instead of caching a rejection forever.
  modelPromise.catch(() => {
    modelPromise = null;
  });
  return modelPromise;
}

function imageToTensor(tf, img) {
  return tf.tidy(() => {
    const t = tf.browser.fromPixels(img); // h x w x 3, uint8
    const resized = tf.image.resizeBilinear(t, [IMG_SIZE, IMG_SIZE]);
    return resized.toFloat().div(127.5).sub(1).expandDims(0); // 1x224x224x3, [-1,1]
  });
}

/**
 * Run on-device inference on an <img> element (or any drawable source).
 * Returns { label, confidence (0-1), top3: [{label, confidence}] }.
 * Throws if the model/CDN is unavailable -- callers must fall back to the
 * server vision-LLM path.
 */
export async function predictLeaf(img) {
  const { model, labels, threshold, version } = await loadCnn();
  const tf = window.tf;
  const input = imageToTensor(tf, img);
  let probs;
  try {
    const out = model.predict(input);
    probs = await out.data();
    if (out.dispose) out.dispose();
  } finally {
    input.dispose();
  }
  const idx = Array.from(probs.keys());
  idx.sort((a, b) => probs[b] - probs[a]);
  const top = idx.slice(0, 3).map((i) => ({ label: labels[i], confidence: probs[i] }));
  return {
    label: top[0].label,
    confidence: top[0].confidence,
    top3: top,
    threshold,
    version
  };
}

/** Fire-and-forget warm-up so the first real diagnosis feels instant. */
export function warmUpCnn() {
  loadCnn().catch(() => {});
}
