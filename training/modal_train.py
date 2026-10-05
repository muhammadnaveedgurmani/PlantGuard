#!/usr/bin/env python3
"""PlantGuard CNN training on Modal (T4 GPU).

Runs the full pipeline remotely:
    1. download_data_hf.py  -> PlantVillage (HuggingFace, no Kaggle auth)
    2. train.py              -> MobileNetV2 two-phase training (mixed precision)
    3. evaluate.py           -> test metrics -> metrics.json
    4. export.py             -> TensorFlow.js + TFLite
    5. copies everything to the 'plantguard-cnn' Modal Volume

Usage (from ~/workspace/plantguard-deploy/cnn-training):
    /home/hatch/modal-venv/bin/modal run modal_train.py
"""
import shutil
import subprocess
import sys
from pathlib import Path

import modal

app = modal.App("plantguard-cnn-train")

# Full TF (GPU build) on Modal; CPU-only wheel is NOT used here.
# `datasets` is extra (the original requirements.txt used Kaggle instead).
#
# NOTE: tensorflowjs==4.22.0 is installed with --no-deps on purpose: its
# metadata pulls tensorflow-decision-forests, whose pins (TF==2.19 / ~=2.15)
# conflict with tensorflow==2.21.0. export.py already stubs tfdf out at
# import time (it is only used for the TF-DF conversion path, which we never
# exercise for Keras models), so we install tfjs's other deps explicitly.
PKGS = [
    "tensorflow==2.21.0",
    "scikit-learn==1.9.1",
    "pillow==12.3.0",
    "datasets",
    "protobuf==6.31.1",
    "setuptools<81",
    "numpy==2.1.3",
    "matplotlib==3.11.2",
    "flax",
    "importlib_resources",
    "jax",
    "jaxlib",
    "tf-keras",
    "tensorflow-hub",
    "h5py",
]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install(*PKGS)
    .run_commands("python -m pip install --no-deps tensorflowjs==4.22.0")
    .add_local_dir("modal_pkg", "/opt/plantguard", copy=True)
)

vol = modal.Volume.from_name("plantguard-cnn", create_if_missing=True)

DATA_DIR = "/root/pgdata"    # ephemeral container disk (~3 GB of JPEGs)
OUT_DIR = "/root/pgout"
VOL_OUT = "/artifacts/outputs"


def _run(cmd: list[str]):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


@app.function(image=image, gpu="T4", timeout=6 * 3600, volumes={"/artifacts": vol})
def train_full(epochs1: int = 10, epochs2: int = 20, batch_size: int = 32):
    py = sys.executable
    scr = "/opt/plantguard"

    # Early smoke check: fail fast if the tfjs workaround didn't hold,
    # before burning hours on download + training.
    print("=== STEP 0/4: dependency smoke check ===", flush=True)
    _run([py, "-c",
          "import tensorflow as tf; print('tf', tf.__version__, 'gpus:', len(tf.config.list_physical_devices('GPU')));"
          "import sys; sys.path.insert(0, '/opt/plantguard');"
          "from export import _import_tfjs; _import_tfjs(); print('tfjs import OK')"])

    print("=== STEP 1/4: downloading PlantVillage (HuggingFace) ===", flush=True)
    _run([py, f"{scr}/download_data_hf.py", "--out_dir", DATA_DIR])

    print("=== STEP 2/4: training (mixed precision, T4) ===", flush=True)
    _run([
        py, f"{scr}/train.py",
        "--data_dir", f"{DATA_DIR}/plantvillage",
        "--out_dir", OUT_DIR,
        "--epochs1", str(epochs1),
        "--epochs2", str(epochs2),
        "--batch_size", str(batch_size),
        "--mixed_precision",
    ])

    print("=== STEP 3/4: evaluating on held-out test split ===", flush=True)
    _run([py, f"{scr}/evaluate.py",
          "--model", f"{OUT_DIR}/best_model.keras",
          "--out_dir", OUT_DIR])

    print("=== STEP 4/4: exporting TF.js + TFLite ===", flush=True)
    _run([py, f"{scr}/export.py",
          "--model", f"{OUT_DIR}/best_model.keras",
          "--out_dir", f"{OUT_DIR}/export"])

    print("=== copying artifacts to volume ===", flush=True)
    dst = Path(VOL_OUT)
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(OUT_DIR, dst)
    for f in sorted(dst.rglob("*")):
        if f.is_file():
            print(f"  {f.relative_to(dst)}  {f.stat().st_size / 1e6:.2f} MB", flush=True)
    print("DONE. Artifacts committed to volume 'plantguard-cnn'.", flush=True)


@app.local_entrypoint()
def main(epochs1: int = 10, epochs2: int = 20, batch_size: int = 32):
    train_full.remote(epochs1, epochs2, batch_size)
    print("Remote training finished. Artifacts are in volume 'plantguard-cnn' at /artifacts/outputs.")
