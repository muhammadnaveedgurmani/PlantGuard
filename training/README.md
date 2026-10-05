# PlantGuard CNN Training

This folder builds a **real convolutional neural network** for plant disease
detection, so the "CNN-based" claim on the portfolio/CV is actually true.

## The idea in one paragraph

We take **MobileNetV2** (a small, fast image-recognition network pre-trained on
millions of general photos), replace its final layer with our own 38-way
classifier, and train it on **PlantVillage** — ~54,000 labeled leaf photos
across 38 crop/disease classes. Training happens in two phases: first only the
new classifier head learns (backbone frozen), then the top backbone layers are
unfrozen for fine-tuning with a tiny learning rate. The trained model is
exported to **TensorFlow.js** so it runs directly in the visitor's browser as
PlantGuard's primary diagnosis engine, with the existing vision-LLM API kept as
the fallback for low-confidence cases.

## Files

| File | What it does |
|---|---|
| `download_data.py` | Downloads PlantVillage from Kaggle, extracts the **color** variant, verifies 38 classes + healthy image counts, writes `data_manifest.json`. |
| `data_utils.py` | Shared helpers: class discovery, stratified 80/10/10 split, `tf.data` pipelines (resize 224, MobileNetV2 preprocessing, augmentation), class weights. |
| `train.py` | Two-phase training. Saves best checkpoint (`best_model.keras`), `labels.json`, `split_manifest.json`, `history.json`. |
| `evaluate.py` | Test-set accuracy, top-3 accuracy, per-class precision/recall/F1, top-5 confused pairs → `metrics.json`. |
| `export.py` | Converts to TensorFlow.js (`tfjs/`) + quantized TFLite (`plantguard_cnn.tflite`), with a TFLite sanity check and `export_manifest.json`. |
| `make_notebook.py` | Generates `PlantGuard_CNN_Training.ipynb` from these exact scripts. |
| `PlantGuard_CNN_Training.ipynb` | Self-contained Colab notebook: GPU check → install → Kaggle download → train → evaluate → export → download zip. |
| `INTEGRATION_PLAN.md` | How the exported model plugs into the Cloudflare Workers app (browser-first inference, LLM fallback). |
| `requirements.txt` | Pinned Python dependencies. |

## Workflow

**This machine has no GPU**, so the full training runs on free Colab:

1. **Smoke test locally** (CPU, synthetic data — proves the code works end to end):
   ```bash
   cd cnn-training
   python -m venv .venv && .venv/bin/pip install -r requirements.txt
   .venv/bin/python smoke_test.py        # 2 classes x 40 images, ~2 epochs
   ```
2. **Full training on Colab**: open `PlantGuard_CNN_Training.ipynb`,
   Runtime → Change runtime type → **T4 GPU**, then Run all. Upload your
   `kaggle.json` when asked. Takes ~1–2 hours.
3. Download `plantguard_cnn_artifacts.zip` from the last cell.
4. Follow `INTEGRATION_PLAN.md` to wire the model into the app.

## Expected results (honest numbers)

Published results for **PlantVillage + MobileNetV2 + two-phase fine-tuning**:

| Source | Test accuracy |
|---|---|
| plantcare-ai (38 classes, MobileNetV2) | **95.30%** |
| jameelajabir (38 classes, fine-tune last 30 layers) | **96.46%** |
| IJERT Jun-2026 paper (38 classes, two-stage fine-tune) | 94.2% val / 93.6% macro F1 |
| muhannadsalkini (MobileNetV2 transfer learning) | 91.77% |

Realistic expectation for this pipeline: **~92–96% test accuracy** on
PlantVillage. Target bar: **≥95%**. Important caveat from the literature:
on real field photos (not greenhouse PlantVillage images) accuracy drops to
**~80%** — which is exactly why the vision-LLM fallback stays in the
integration design.

## Notes

- Input size is **224×224** (MobileNetV2's native size), pixels scaled to
  **[-1, 1]** — the export manifest records this for the browser code.
- The test split is fixed by `train.py` and reused by `evaluate.py` via
  `split_manifest.json`: the test set is never seen during training.
- Class weights handle PlantVillage's imbalance (some diseases have ~10x
  fewer photos than others).
