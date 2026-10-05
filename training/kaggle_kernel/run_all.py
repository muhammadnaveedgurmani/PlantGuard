#!/usr/bin/env python3
"""Kaggle driver: download PlantVillage -> train CNN -> evaluate.

Runs the full PlantGuard training pipeline on a Kaggle GPU kernel.
All artifacts land in /kaggle/working/outputs (downloaded after the run).

Steps:
    1. pip install datasets (for the HuggingFace download)
    2. download_data_hf.py  -> /kaggle/working/data/plantvillage (38 classes)
    3. train.py             -> /kaggle/working/outputs (best_model.keras, ...)
    4. evaluate.py          -> /kaggle/working/outputs/metrics.json

TF.js / TFLite export is intentionally NOT done here (dependency risk on the
Kaggle image); it runs locally on CPU after the artifacts are pulled.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = Path("/kaggle/working")
DATA_DIR = WORK / "data"
OUT_DIR = WORK / "outputs"


def run(cmd):
    print(f"\n===== RUN: {' '.join(str(c) for c in cmd)} =====", flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=str(HERE))
    if r.returncode != 0:
        print(f"COMMAND FAILED (exit {r.returncode}): {' '.join(str(c) for c in cmd)}",
              flush=True)
        sys.exit(r.returncode)


def main():
    py = sys.executable

    print("Python:", sys.version.split()[0], flush=True)
    try:
        import tensorflow as tf
        print("TensorFlow:", tf.__version__, flush=True)
        print("GPUs:", tf.config.list_physical_devices("GPU"), flush=True)
    except Exception as e:
        print("TF import failed:", e, flush=True)
        sys.exit(1)

    # 0. extra dependency for the HF download
    run([py, "-m", "pip", "install", "--quiet", "datasets"])

    # 1. download PlantVillage (official HF mirror, 38-class color set)
    run([py, str(HERE / "download_data_hf.py"), "--out_dir", str(DATA_DIR)])

    # 2. train (full two-phase run, mixed precision for T4)
    run([py, str(HERE / "train.py"),
         "--data_dir", str(DATA_DIR / "plantvillage"),
         "--out_dir", str(OUT_DIR),
         "--mixed_precision"])

    # 3. evaluate on the held-out test split
    run([py, str(HERE / "evaluate.py"),
         "--model", str(OUT_DIR / "best_model.keras"),
         "--out_dir", str(OUT_DIR)])

    print("\n===== ALL DONE =====", flush=True)
    print("Artifacts:", flush=True)
    for f in sorted(OUT_DIR.rglob("*")):
        if f.is_file():
            print(f"  {f.relative_to(OUT_DIR)}  ({f.stat().st_size / 1e6:.2f} MB)",
                  flush=True)


if __name__ == "__main__":
    main()
