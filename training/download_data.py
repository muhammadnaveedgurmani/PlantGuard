#!/usr/bin/env python3
"""Download the PlantVillage dataset from Kaggle and verify it.

Usage:
    python download_data.py --out_dir ./data                       # download + extract + verify
    python download_data.py --out_dir ./data --verify-only          # only verify an existing dir
    python download_data.py --out_dir ./data --dataset-slug other/slug

Needs a Kaggle API token (~/.kaggle/kaggle.json). On Colab, upload kaggle.json
via files.upload() first — the notebook does this for you.

The Kaggle copy "abdallahalidev/plantvillage-dataset" (~54k images, 38 classes)
ships three variants: color/, grayscale/, segmented/. We use the COLOR variant.
"""
import argparse
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

from data_utils import discover_classes, build_file_index, class_distribution

DEFAULT_SLUG = "abdallahalidev/plantvillage-dataset"
EXPECTED_CLASSES = 38
MIN_IMAGES_PER_CLASS = 100  # sanity floor; real PlantVillage classes are much larger


def run(cmd):
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def ensure_kaggle_auth():
    kaggle_json = Path.home() / ".kaggle" / "kaggle.json"
    if not kaggle_json.exists():
        sys.exit(
            "ERROR: Kaggle credentials not found at ~/.kaggle/kaggle.json\n"
            "  1. Go to https://www.kaggle.com/settings -> API -> Create New Token\n"
            "  2. Save it as ~/.kaggle/kaggle.json and chmod 600 it.\n"
            "  (On Colab the notebook uploads it for you.)"
        )


def download(slug: str, dest: Path):
    ensure_kaggle_auth()
    dest.mkdir(parents=True, exist_ok=True)
    run(["kaggle", "datasets", "download", "-d", slug, "-p", str(dest)])
    zips = list(dest.glob("*.zip"))
    if not zips:
        sys.exit(f"ERROR: no .zip downloaded into {dest}")
    for z in zips:
        print(f"Extracting {z.name} ...", flush=True)
        with zipfile.ZipFile(z, "r") as zf:
            zf.extractall(dest)
        z.unlink()


def verify(data_dir: Path, out_dir: Path):
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
        "dataset": "PlantVillage (color variant)",
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
    ap = argparse.ArgumentParser(description="Download + verify the PlantVillage dataset.")
    ap.add_argument("--out_dir", required=True, help="Directory for data + manifest.")
    ap.add_argument("--dataset-slug", default=DEFAULT_SLUG)
    ap.add_argument("--verify-only", action="store_true",
                    help="Skip download; only verify --data-dir.")
    ap.add_argument("--data-dir", default=None,
                    help="Dataset location (default: <out_dir>/plantvillage).")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    data_dir = Path(args.data_dir) if args.data_dir else out_dir / "plantvillage"

    if not args.verify_only:
        # keep any previous download out of the way, then fetch fresh
        if data_dir.exists():
            print(f"Removing previous download at {data_dir}")
            shutil.rmtree(data_dir)
        download(args.dataset_slug, data_dir)

    verify(data_dir, out_dir)


if __name__ == "__main__":
    main()
