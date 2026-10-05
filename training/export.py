#!/usr/bin/env python3
"""Export a trained PlantGuard CNN for deployment.

Produces:
    <out_dir>/tfjs/            TensorFlow.js model (model.json + weight shards)
                               -> loaded in the browser by the PlantGuard web app
    <out_dir>/plantguard_cnn.tflite
                               -> TFLite (dynamic-range quantized), for future mobile use
    <out_dir>/labels.json      copy of the 38 class names (index-aligned)
    <out_dir>/export_manifest.json   sizes + input spec for the integration

Input spec (both formats): 224x224 RGB, float32, MobileNetV2 preprocessing
(i.e. pixel values scaled to [-1, 1]:  x/127.5 - 1).

Usage:
    python export.py --model ./outputs/best_model.keras --out_dir ./outputs/export
"""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import tensorflow as tf


def _import_tfjs():
    """Import tensorflowjs, tolerating a broken tensorflow-decision-forests
    binary (it is eagerly imported by tensorflowjs but only used for the
    TF-DF model-conversion path, which we never exercise for Keras models).
    Where the real package imports fine (e.g. Colab) this is a no-op."""
    import sys
    import types

    try:
        import tensorflow_decision_forests  # noqa: F401
    except Exception:
        sys.modules.setdefault(
            "tensorflow_decision_forests",
            types.ModuleType("tensorflow_decision_forests"),
        )
    import tensorflowjs as tfjs

    return tfjs


def export_tfjs(model, tfjs_dir: Path):
    tfjs = _import_tfjs()
    if tfjs_dir.exists():
        shutil.rmtree(tfjs_dir)
    tfjs_dir.mkdir(parents=True)
    tfjs.converters.save_keras_model(model, str(tfjs_dir))
    files = sorted(tfjs_dir.glob("*"))
    total = sum(f.stat().st_size for f in files if f.is_file())
    return {"dir": str(tfjs_dir), "files": [f.name for f in files],
            "total_bytes": total}


def export_tflite(model, out_path: Path):
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]  # dynamic-range quantization
    tflite_model = converter.convert()
    out_path.write_bytes(tflite_model)
    return {"path": str(out_path), "bytes": len(tflite_model)}


def main():
    ap = argparse.ArgumentParser(description="Export PlantGuard CNN to TF.js + TFLite.")
    ap.add_argument("--model", required=True, help="Trained .keras model.")
    ap.add_argument("--out_dir", required=True)
    ap.add_argument("--labels", default=None,
                    help="labels.json (default: alongside --model).")
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    labels_src = Path(args.labels) if args.labels else Path(args.model).parent / "labels.json"

    print(f"Loading {args.model} ...")
    model = tf.keras.models.load_model(args.model)
    print(f"Input: {model.input_shape}, output: {model.output_shape}")

    print("Exporting TensorFlow.js ...")
    tfjs_info = export_tfjs(model, out_dir / "tfjs")
    print(f"  {tfjs_info['total_bytes'] / 1e6:.2f} MB in {len(tfjs_info['files'])} files")

    print("Exporting TFLite (dynamic-range quantized) ...")
    tflite_info = export_tflite(model, out_dir / "plantguard_cnn.tflite")
    print(f"  {tflite_info['bytes'] / 1e6:.2f} MB")

    shutil.copy(labels_src, out_dir / "labels.json")

    # Sanity check: run one dummy inference through the TFLite model.
    interpreter = tf.lite.Interpreter(model_path=str(out_dir / "plantguard_cnn.tflite"))
    interpreter.allocate_tensors()
    inp = interpreter.get_input_details()[0]
    dummy = np.zeros(inp["shape"], dtype=np.float32)
    interpreter.set_tensor(inp["index"], dummy)
    interpreter.invoke()
    out = interpreter.get_output_details()[0]
    probs = interpreter.get_tensor(out["index"])[0]
    assert probs.shape[0] == model.output_shape[-1]
    print(f"TFLite sanity check OK: output sums to {probs.sum():.3f}")

    manifest = {
        "source_model": str(args.model),
        "input": {"height": 224, "width": 224, "channels": 3, "dtype": "float32",
                  "preprocessing": "x = pixel/127.5 - 1  (MobileNetV2, range [-1,1])"},
        "num_classes": model.output_shape[-1],
        "tfjs": tfjs_info,
        "tflite": tflite_info,
        "labels": str(out_dir / "labels.json"),
    }
    (out_dir / "export_manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nManifest: {out_dir / 'export_manifest.json'}")
    print("Tip: for a ~2x smaller browser model, re-run the TF.js export with float16 "
          "quantization:\n"
          "  tensorflowjs_converter --input_format=keras --quantize_float16 \\\n"
          "      outputs/best_model.keras outputs/export/tfjs_fp16")


if __name__ == "__main__":
    main()
