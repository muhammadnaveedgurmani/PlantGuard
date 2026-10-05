#!/usr/bin/env python3
"""Generate PlantGuard_CNN_Training.ipynb — self-contained Colab notebook.

The notebook recreates download_data.py / data_utils.py / train.py /
evaluate.py / export.py inside Colab via %%writefile cells, so the code that
runs on the GPU is byte-identical to this folder. Run:
    python make_notebook.py
"""
import json
from pathlib import Path

HERE = Path(__file__).parent


def read(name):
    return (HERE / name).read_text()


def md(source):
    return {"cell_type": "markdown", "metadata": {},
            "source": source.splitlines(keepends=True)}


def code(source, writefile=None):
    src = source
    if writefile:
        src = f"%%writefile {writefile}\n" + source
    return {"cell_type": "code", "metadata": {}, "execution_count": None,
            "outputs": [], "source": src.splitlines(keepends=True)}


cells = [
    md("# PlantGuard CNN Training — PlantVillage + MobileNetV2\n"
       "\n"
       "This notebook trains a **real convolutional neural network** for plant disease "
       "detection and exports it for the PlantGuard web app.\n"
       "\n"
       "**What happens, step by step:**\n"
       "1. Check that a GPU is available (free Colab T4).\n"
       "2. Install the needed Python packages.\n"
       "3. Download the PlantVillage dataset from Kaggle (~54,000 leaf photos, 38 classes).\n"
       "4. Train MobileNetV2 in two phases — first the new classification head, then "
       "fine-tuning the top backbone layers.\n"
       "5. Evaluate on a held-out test set the model has never seen.\n"
       "6. Export the model to TensorFlow.js (for the website) and TFLite (for mobile).\n"
       "7. Download everything as one zip file.\n"
       "\n"
       "> Expected result based on published work with this exact setup: **~92–96% test "
       "accuracy**. Anything in that range means the pipeline worked correctly."),

    md("## Step 1 — Check the GPU\n"
       "Colab gives a free NVIDIA T4. Without it, training would take many hours."),

    code('import tensorflow as tf\n'
         'print("TensorFlow:", tf.__version__)\n'
         'gpus = tf.config.list_physical_devices("GPU")\n'
         'print("GPUs:", [g.name for g in gpus] or "NONE — enable GPU via Runtime > Change runtime type")\n'
         '!nvidia-smi -L'),

    md("## Step 2 — Install packages\n"
       "`tensorflowjs` converts the trained model to the browser format used by the PlantGuard site."),

    code('!pip install -q tensorflowjs scikit-learn kaggle matplotlib\n'
         'print("packages installed")'),

    md("## Step 3 — Kaggle credentials\n"
       "1. Go to https://www.kaggle.com/settings → **API** → **Create New Token** (downloads `kaggle.json`).\n"
       "2. Run the cell below and **upload `kaggle.json`** when asked."),

    code('from google.colab import files\n'
         'import os, shutil\n'
         'os.makedirs(os.path.expanduser("~/.kaggle"), exist_ok=True)\n'
         'uploaded = files.upload()  # <-- upload kaggle.json here\n'
         'for name in uploaded:\n'
         '    shutil.move(name, os.path.expanduser("~/.kaggle/kaggle.json"))\n'
         'os.chmod(os.path.expanduser("~/.kaggle/kaggle.json"), 0o600)\n'
         'print("Kaggle credentials saved.")'),

    md("## Step 4 — Write the training scripts\n"
       "These are the exact files from the PlantGuard repo (`cnn-training/`), recreated here so "
       "Colab runs byte-identical code."),

    code(read("data_utils.py"), writefile="data_utils.py"),
    code(read("download_data.py"), writefile="download_data.py"),
    code(read("train.py"), writefile="train.py"),
    code(read("evaluate.py"), writefile="evaluate.py"),
    code(read("export.py"), writefile="export.py"),

    md("## Step 5 — Download + verify PlantVillage\n"
       "Downloads ~800MB–1GB. The color variant is used (38 classes)."),

    code('!python download_data.py --out_dir /content/data'),

    md("## Step 6 — Train (the long step, ~1–2 hours on a T4)\n"
       "\n"
       "**Phase 1** (frozen backbone): only the new classification head learns — fast and stable.\n"
       "**Phase 2** (fine-tuning): the top 30 backbone layers unfreeze with a tiny learning rate, "
       "adapting ImageNet features to leaf-disease patterns. BatchNorm layers stay frozen.\n"
       "\n"
       "Class weights counter the dataset imbalance (some diseases have far fewer photos). "
       "The best checkpoint by validation accuracy is saved automatically."),

    code('!python train.py --data_dir /content/data/plantvillage --out_dir /content/outputs \\\n'
         '    --epochs1 10 --epochs2 25 --batch_size 32 --mixed_precision'),

    md("## Step 7 — Evaluate on the held-out test set\n"
       "The test split was fixed before training and never touched until now — "
       "this number is the honest accuracy."),

    code('!python evaluate.py --model /content/outputs/best_model.keras --out_dir /content/outputs'),

    md("## Step 8 — Export for deployment\n"
       "- **TensorFlow.js** → runs in the browser; becomes PlantGuard's primary diagnosis engine.\n"
       "- **TFLite** (quantized) → for a future mobile app."),

    code('!python export.py --model /content/outputs/best_model.keras --out_dir /content/outputs/export'),

    md("## Step 9 — Download everything\n"
       "One zip with the model, browser files, labels, metrics, and training logs. "
       "This is what gets wired into the PlantGuard website."),

    code('!cd /content/outputs && zip -qr /content/plantguard_cnn_artifacts.zip . -x ".*" \n'
         'from google.colab import files\n'
         'files.download("/content/plantguard_cnn_artifacts.zip")\n'
         'print("Done. Next: follow INTEGRATION_PLAN.md in the repo to wire the model into the app.")'),
]

nb = {
    "nbformat": 4,
    "nbformat_minor": 5,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "accelerator": "GPU",
    },
    "cells": cells,
}

out = HERE / "PlantGuard_CNN_Training.ipynb"
out.write_text(json.dumps(nb, indent=1))
print(f"Wrote {out} ({len(cells)} cells)")
