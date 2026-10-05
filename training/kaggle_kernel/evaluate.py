#!/usr/bin/env python3
"""Evaluate a trained PlantGuard CNN on the held-out TEST split.

Reads the exact test file list from split_manifest.json (written by train.py),
so the test set is identical to training time — no re-splitting, no leakage.

Reports: test accuracy, top-3 accuracy, per-class precision/recall/F1,
macro/weighted averages, and the top-5 most-confused class pairs.
Writes everything to metrics.json.

Usage:
    python evaluate.py --model ./outputs/best_model.keras --out_dir ./outputs
"""
import argparse
import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.metrics import (accuracy_score, classification_report,
                             confusion_matrix)

from data_utils import load_split_manifest, make_eval_dataset, set_seeds


def top_confused_pairs(cm, classes, k=5):
    pairs = []
    n = cm.shape[0]
    for i in range(n):
        for j in range(n):
            if i != j and cm[i, j] > 0:
                pairs.append({"true": classes[i], "predicted": classes[j],
                              "count": int(cm[i, j])})
    pairs.sort(key=lambda d: d["count"], reverse=True)
    return pairs[:k]


def main():
    ap = argparse.ArgumentParser(description="Evaluate PlantGuard CNN on the test split.")
    ap.add_argument("--model", required=True, help="Path to trained .keras model.")
    ap.add_argument("--out_dir", required=True,
                    help="Dir with split_manifest.json + labels.json (from train.py).")
    ap.add_argument("--batch_size", type=int, default=64)
    ap.add_argument("--img_size", type=int, default=224)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=None, help="metrics.json path (default: <out_dir>/metrics.json).")
    args = ap.parse_args()

    set_seeds(args.seed)
    out_dir = Path(args.out_dir)
    classes = json.loads((out_dir / "labels.json").read_text())
    splits = load_split_manifest(out_dir / "split_manifest.json")
    test_pairs = splits["test"]
    print(f"Test images: {len(test_pairs)}, classes: {len(classes)}")

    model = tf.keras.models.load_model(args.model)
    test_ds, y_true = make_eval_dataset(test_pairs, args.img_size, args.batch_size)

    print("Running inference on test set ...")
    y_prob = model.predict(test_ds, verbose=1)
    y_pred = np.argmax(y_prob, axis=1)

    acc = accuracy_score(y_true, y_pred)
    # Manual top-k (avoids sklearn's binary-vs-multiclass type dispatch on tiny splits).
    k = min(3, len(classes))
    topk_idx = np.argsort(y_prob, axis=1)[:, -k:]
    top3 = float(np.mean([y_true[i] in topk_idx[i] for i in range(len(y_true))]))
    report = classification_report(y_true, y_pred, labels=list(range(len(classes))),
                                   target_names=classes,
                                   output_dict=True, zero_division=0)
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(classes))))

    per_class = {
        cls: {"precision": round(report[cls]["precision"], 4),
              "recall": round(report[cls]["recall"], 4),
              "f1": round(report[cls]["f1-score"], 4),
              "support": int(report[cls]["support"])}
        for cls in classes
    }
    worst5 = sorted(per_class.items(), key=lambda kv: kv[1]["f1"])[:5]

    metrics = {
        "model": str(args.model),
        "test_images": len(test_pairs),
        "num_classes": len(classes),
        "test_accuracy": round(float(acc), 4),
        "test_top3_accuracy": round(float(top3), 4),
        "macro_avg": {k: round(float(report["macro avg"][k]), 4)
                      for k in ("precision", "recall", "f1-score")},
        "weighted_avg": {k: round(float(report["weighted avg"][k]), 4)
                         for k in ("precision", "recall", "f1-score")},
        "per_class": per_class,
        "worst_5_classes_by_f1": [{"class": c, **m} for c, m in worst5],
        "top_5_confused_pairs": top_confused_pairs(cm, classes),
    }

    out_path = Path(args.out) if args.out else out_dir / "metrics.json"
    out_path.write_text(json.dumps(metrics, indent=2))

    print(f"\nTest accuracy     : {acc:.4f}")
    print(f"Test top-3 acc    : {top3:.4f}")
    print(f"Macro F1          : {report['macro avg']['f1-score']:.4f}")
    print(f"Weighted F1       : {report['weighted avg']['f1-score']:.4f}")
    print("\nWorst 5 classes by F1:")
    for c, m in worst5:
        print(f"  {c:45s} F1={m['f1']:.3f} (n={m['support']})")
    print("\nTop 5 confused pairs (true -> predicted):")
    for p in metrics["top_5_confused_pairs"]:
        print(f"  {p['true']} -> {p['predicted']}  ({p['count']} images)")
    print(f"\nFull metrics written to {out_path}")


if __name__ == "__main__":
    main()
