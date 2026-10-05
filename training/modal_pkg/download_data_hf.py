#!/usr/bin/env python3
"""Download PlantVillage from the HuggingFace mirror (no Kaggle auth needed).

Source: ``mohanty/PlantVillage`` — the official upload by the dataset's own
authors (Sharada Mohanty et al., Digital Epidemiology Lab, EPFL).
Config ``color`` = original RGB images. ~54,305 images, 38 classes.

Exports an ImageFolder layout that the rest of the pipeline expects:
    <out_dir>/plantvillage/<class_name>/*.jpg
and writes <out_dir>/data_manifest.json in the same schema as download_data.py.

Usage:
    python download_data_hf.py --out_dir ./data
    python download_data_hf.py --out_dir ./data --verify-only --data-dir ./data/plantvillage
"""
import argparse
import json
import shutil
import sys
from pathlib import Path

HF_DATASET = "mohanty/PlantVillage"
HF_CONFIG = "color"
EXPECTED_CLASSES = 38
MIN_IMAGES_PER_CLASS = 100


def download(out_dir: Path) -> Path:
    from datasets import load_dataset, concatenate_datasets

    data_dir = out_dir / "plantvillage"
    if data_dir.exists():
        print(f"Removing previous download at {data_dir}", flush=True)
        shutil.rmtree(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading {HF_DATASET} ({HF_CONFIG}) from HuggingFace ...", flush=True)
    ds = load_dataset(HF_DATASET, HF_CONFIG)
    print(f"  splits: { {k: len(v) for k, v in ds.items()} }", flush=True)
    full = concatenate_datasets([ds["train"], ds["test"]])
    print(f"  combined rows: {len(full)}", flush=True)

    counts = {}
    for i, row in enumerate(full):
        label = row["label"]  # e.g. "Apple___Black_rot"
        img = row["image"]    # PIL Image (RGB)
        class_dir = data_dir / label
        class_dir.mkdir(exist_ok=True)
        img.save(class_dir / f"{i:06d}.jpg", "JPEG", quality=95)
        counts[label] = counts.get(label, 0) + 1
        if (i + 1) % 5000 == 0:
            print(f"  saved {i + 1}/{len(full)} ...", flush=True)

    print(f"Saved {sum(counts.values())} images in {len(counts)} classes.", flush=True)
    return data_dir


def verify(data_dir: Path, out_dir: Path):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from data_utils import discover_classes, build_file_index, class_distribution

    class_root, classes = discover_classes(data_dir)
    print(f"Class root : {class_root}")
    print(f"Classes    : {len(classes)}")
    index = build_file_index(class_root, classes)
    dist = class_distribution(index, classes)

    print(f"\n{'class':45s} {'images':>8s}")
    print("-" * 56)
    for cls in classes:
        print(f"{cls:45s} {dist[cls]:>8d}")
    total = sum(dist.values())
    print("-" * 56)
    print(f"{'TOTAL':45s} {total:>8d}")

    problems = []
    if len(classes) != EXPECTED_CLASSES:
        problems.append(f"expected {EXPECTED_CLASSES} classes, found {len(classes)}")
    small = [c for c in classes if dist[c] < MIN_IMAGES_PER_CLASS]
    if small:
        problems.append(f"classes with < {MIN_IMAGES_PER_CLASS} images: {small}")

    manifest = {
        "dataset": f"PlantVillage (color variant) via HuggingFace {HF_DATASET}",
        "class_root": str(class_root),
        "num_classes": len(classes),
        "total_images": total,
        "classes": classes,
        "class_counts": dist,
    }
    manifest_path = out_dir / "data_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nManifest written to {manifest_path}")

    if problems:
        print("\nVERIFICATION PROBLEMS:")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("\nVerification OK: 38 classes, all counts healthy.")


def main():
    ap = argparse.ArgumentParser(description="Download PlantVillage from HuggingFace + verify.")
    ap.add_argument("--out_dir", required=True, help="Directory for data + manifest.")
    ap.add_argument("--verify-only", action="store_true", help="Skip download; only verify --data-dir.")
    ap.add_argument("--data-dir", default=None, help="Dataset location (default: <out_dir>/plantvillage).")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    data_dir = Path(args.data_dir) if args.data_dir else out_dir / "plantvillage"

    if not args.verify_only:
        data_dir = download(out_dir)

    verify(data_dir, out_dir)


if __name__ == "__main__":
    main()
