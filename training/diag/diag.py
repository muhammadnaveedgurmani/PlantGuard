#!/usr/bin/env python3
"""Diagnostic: list /kaggle/input tree to confirm mount paths for dataset + kernel sources."""
import os
from pathlib import Path

root = Path("/kaggle/input")
print("=== /kaggle/input top level ===", flush=True)
for child in sorted(root.iterdir()):
    print(("DIR " if child.is_dir() else "FILE ") + child.name, flush=True)

print("\n=== tree (depth<=2) + key file search ===", flush=True)
targets = {"split_manifest.json", "best_model.keras", "labels.json", "color"}
for dirpath, dirnames, filenames in os.walk(root):
    depth = dirpath.replace(str(root), "").count(os.sep)
    if depth <= 2:
        print(f"[d{depth}] {dirpath}: dirs={dirnames[:10]} nfiles={len(filenames)}", flush=True)
    for t in targets:
        if t in filenames or t in dirnames:
            print(f"FOUND '{t}' at {dirpath}", flush=True)
print("Diagnostic done.", flush=True)
