#!/usr/bin/env python3
"""Train the PlantGuard CNN: MobileNetV2 (ImageNet) + custom head, 38 PlantVillage classes.

Two-phase transfer learning:
    Phase 1: backbone frozen, train only the classification head.
    Phase 2: unfreeze the top N backbone layers (BatchNorm kept frozen),
             fine-tune with a small learning rate.

Usage:
    python train.py --data_dir ./data/plantvillage --out_dir ./outputs
    python train.py --data_dir ./data/plantvillage --epochs1 2 --epochs2 1 --batch_size 8  # smoke test
"""
import argparse
import json
import time
from pathlib import Path

import tensorflow as tf

from data_utils import (
    discover_classes,
    build_file_index,
    stratified_split,
    save_split_manifest,
    make_dataset,
    compute_class_weights,
    set_seeds,
)


def build_model(img_size, num_classes, dropout=0.2):
    base = tf.keras.applications.MobileNetV2(
        input_shape=(img_size, img_size, 3),
        include_top=False,
        weights="imagenet",
    )
    base.trainable = False  # phase 1: frozen
    inputs = tf.keras.Input(shape=(img_size, img_size, 3))
    x = base(inputs, training=False)
    x = tf.keras.layers.GlobalAveragePooling2D()(x)
    x = tf.keras.layers.Dropout(dropout)(x)
    outputs = tf.keras.layers.Dense(num_classes, activation="softmax")(x)
    model = tf.keras.Model(inputs, outputs, name="plantguard_mobilenetv2")
    return model, base


def main():
    ap = argparse.ArgumentParser(description="Train PlantGuard CNN on PlantVillage.")
    ap.add_argument("--data_dir", required=True)
    ap.add_argument("--out_dir", default="./outputs")
    ap.add_argument("--img_size", type=int, default=224, help="MobileNetV2 native input size.")
    ap.add_argument("--batch_size", type=int, default=32)
    ap.add_argument("--epochs1", type=int, default=10, help="Phase-1 (frozen backbone) epochs.")
    ap.add_argument("--epochs2", type=int, default=20, help="Phase-2 (fine-tune) epochs.")
    ap.add_argument("--lr1", type=float, default=1e-3)
    ap.add_argument("--lr2", type=float, default=1e-5)
    ap.add_argument("--fine_tune_layers", type=int, default=30,
                    help="How many top backbone layers to unfreeze in phase 2.")
    ap.add_argument("--dropout", type=float, default=0.2)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--mixed_precision", action="store_true",
                    help="Enable fp16 mixed precision (recommended on Colab T4).")
    args = ap.parse_args()

    set_seeds(args.seed)
    if args.mixed_precision:
        tf.keras.mixed_precision.set_global_policy("mixed_float16")
        print("Mixed precision enabled (fp16).")

    gpus = tf.config.list_physical_devices("GPU")
    print(f"GPUs visible: {len(gpus)}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- data ----
    class_root, classes = discover_classes(args.data_dir)
    num_classes = len(classes)
    print(f"Classes: {num_classes}  ({classes[0]} ... {classes[-1]})")
    index = build_file_index(class_root, classes)
    print(f"Total images: {len(index)}")
    splits = stratified_split(index, seed=args.seed)
    for k, v in splits.items():
        print(f"  {k:6s}: {len(v)} images")
    save_split_manifest(out_dir / "split_manifest.json", splits)
    (out_dir / "labels.json").write_text(json.dumps(classes, indent=2))

    train_ds = make_dataset(splits["train"], args.img_size, args.batch_size, num_classes,
                            augment=True, shuffle=True, seed=args.seed)
    val_ds = make_dataset(splits["val"], args.img_size, args.batch_size, num_classes)
    class_weights = compute_class_weights(splits["train"], num_classes)

    # ---- model ----
    model, base = build_model(args.img_size, num_classes, args.dropout)
    model.summary(print_fn=print)

    ckpt = out_dir / "best_model.keras"
    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(str(ckpt), monitor="val_accuracy",
                                           save_best_only=True, mode="max", verbose=1),
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=4,
                                         restore_best_weights=True, verbose=1),
        tf.keras.callbacks.CSVLogger(str(out_dir / "training_log.csv")),
    ]

    history_all = {}

    # ---- phase 1: frozen backbone ----
    print("\n===== PHASE 1: training head (backbone frozen) =====")
    model.compile(optimizer=tf.keras.optimizers.Adam(args.lr1),
                  loss="categorical_crossentropy", metrics=["accuracy"])
    t0 = time.time()
    h1 = model.fit(train_ds, validation_data=val_ds, epochs=args.epochs1,
                   class_weight=class_weights, callbacks=callbacks)
    print(f"Phase 1 took {(time.time() - t0) / 60:.1f} min")
    history_all["phase1"] = {k: [float(v) for v in vals] for k, vals in h1.history.items()}

    # ---- phase 2: fine-tune top layers ----
    print(f"\n===== PHASE 2: fine-tuning top {args.fine_tune_layers} backbone layers =====")
    base.trainable = True
    for layer in base.layers[: -args.fine_tune_layers]:
        layer.trainable = False
    # Keep BatchNorm frozen: with small batches its statistics get corrupted.
    for layer in base.layers[-args.fine_tune_layers:]:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False
    trainable = sum(1 for l in base.layers if l.trainable)
    print(f"Backbone layers trainable in phase 2: {trainable}/{len(base.layers)}")

    model.compile(optimizer=tf.keras.optimizers.Adam(args.lr2),
                  loss="categorical_crossentropy", metrics=["accuracy"])
    callbacks2 = [
        tf.keras.callbacks.ModelCheckpoint(str(ckpt), monitor="val_accuracy",
                                           save_best_only=True, mode="max", verbose=1),
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=5,
                                         restore_best_weights=True, verbose=1),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.5,
                                             patience=2, verbose=1),
        tf.keras.callbacks.CSVLogger(str(out_dir / "training_log.csv"), append=True),
    ]
    t0 = time.time()
    h2 = model.fit(train_ds, validation_data=val_ds, epochs=args.epochs2,
                   class_weight=class_weights, callbacks=callbacks2)
    print(f"Phase 2 took {(time.time() - t0) / 60:.1f} min")
    history_all["phase2"] = {k: [float(v) for v in vals] for k, vals in h2.history.items()}

    # ---- save ----
    (out_dir / "history.json").write_text(json.dumps(history_all, indent=2))
    best_val = max(h1.history["val_accuracy"] + h2.history["val_accuracy"])
    print(f"\nBest val_accuracy across both phases: {best_val:.4f}")
    print(f"Best checkpoint: {ckpt}")
    print(f"Labels: {out_dir / 'labels.json'}")
    print(f"Split manifest: {out_dir / 'split_manifest.json'}")
    print("\nNext: python evaluate.py --model outputs/best_model.keras --out_dir outputs")


if __name__ == "__main__":
    main()
