#!/usr/bin/env python3
"""Kaggle driver for PlantGuard CNN v2: mounted PlantVillage -> train -> evaluate.

Same data source as v1 (abdallahalidev/plantvillage-dataset, mounted).
All artifacts land in /kaggle/working/outputs.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = Path("/kaggle/working")
OUT_DIR = WORK / "outputs"
MOUNT_COLOR = Path("/kaggle/input/plantvillage-dataset/color")
EXPECTED_CLASSES = 38
MIN_IMAGES_PER_CLASS = 100


def verify_mounted_data() -> Path:
    sys.path.insert(0, str(HERE))
    from data_utils import discover_classes, build_file_index, class_distribution

    if not MOUNT_COLOR.is_dir():
        print(f"ERROR: mounted dataset not found at {MOUNT_COLOR}", flush=True)
        inp = Path("/kaggle/input")
        if inp.is_dir():
            for p in sorted(inp.iterdir()):
                print(f"  {p}", flush=True)
        sys.exit(1)

    class_root, classes = discover_classes(MOUNT_COLOR)
    index = build_file_index(class_root, classes)
    dist = class_distribution(index, classes)
    total = sum(dist.values())
    print(f"Mounted data: {len(classes)} classes, {total} images", flush=True)

    problems = []
    if len(classes) != EXPECTED_CLASSES:
        problems.append(f"expected {EXPECTED_CLASSES} classes, found {len(classes)}")
    small = [c for c in classes if dist[c] < MIN_IMAGES_PER_CLASS]
    if small:
        problems.append(f"classes with < {MIN_IMAGES_PER_CLASS} images: {small}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {
        "dataset": "PlantVillage (color) via Kaggle abdallahalidev/plantvillage-dataset (mounted)",
        "model_version": "v2",
        "class_root": str(class_root),
        "num_classes": len(classes),
        "total_images": total,
        "classes": classes,
        "class_counts": dist,
    }
    (OUT_DIR / "data_manifest.json").write_text(json.dumps(manifest, indent=2))
    print("Manifest written.", flush=True)

    if problems:
        print("VERIFICATION PROBLEMS:", flush=True)
        for p in problems:
            print(f"  - {p}", flush=True)
        sys.exit(1)
    print("Data verification OK.", flush=True)
    return class_root


def run(cmd):
    print(f"\n===== RUN: {' '.join(str(c) for c in cmd)} =====", flush=True)
    r = subprocess.run([str(c) for c in cmd], cwd=str(HERE))
    if r.returncode != 0:
        print(f"COMMAND FAILED (exit {r.returncode})", flush=True)
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

    data_dir = verify_mounted_data()

    run([py, str(HERE / "train_v2.py"),
         "--data_dir", str(data_dir),
         "--out_dir", str(OUT_DIR),
         "--mixed_precision"])

    run([py, str(HERE / "evaluate.py"),
         "--model", str(OUT_DIR / "best_model.keras"),
         "--out_dir", str(OUT_DIR)])

    print("\n===== ALL DONE (v2) =====", flush=True)
    for f in sorted(OUT_DIR.rglob("*")):
        if f.is_file():
            print(f"  {f.relative_to(OUT_DIR)}  ({f.stat().st_size / 1e6:.2f} MB)",
                  flush=True)


if __name__ == "__main__":
    main()
