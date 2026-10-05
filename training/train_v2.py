#!/usr/bin/env python3
"""Train PlantGuard CNN v2: MobileNetV2 (ImageNet) + regularized head, 38 PlantVillage classes.

v2 improvements over v1 (which overfit: 92% train vs 76.8% test):
    - Stronger augmentation: flip, rotation 0.3, zoom 0.2, brightness, contrast
    - Dropout 0.5 (up from 0.2)
    - L2 weight decay 1e-4 on dense layers
    - Label smoothing 0.1
    - Cosine decay LR schedule (instead of ReduceLROnPlateau)
    - Early stopping patience 8 on val_accuracy
    - Phase 1: 15 epochs frozen backbone; Phase 2: up to 40 epochs fine-tune

Usage:
    python train_v2.py --data_dir ./data/plantvillage --out_dir ./outputs
"""
import argparse
import json
import math
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


def build_augmentation():
    """Stronger augmentation pipeline to fight overfitting."""
    return tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.3),
            tf.keras.layers.RandomZoom(0.2),
            tf.keras.layers.RandomBrightness(0.2),
            tf.keras.layers.RandomContrast(0.2),
        ],
        name="strong_augmentation",
    )


def build_model(img_size, num_classes, dropout=0.5, l2=1e-4):
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
    outputs = tf.keras.layers.Dense(
        num_classes,
        activation="softmax",
        kernel_regularizer=tf.keras.regularizers.l2(l2),
        name="predictions",
    )(x)
    model = tf.keras.Model(inputs, outputs, name="plantguard_mobilenetv2_v2")
    return model, base


def cosine_decay_schedule(initial_lr, total_steps, warmup_steps=0):
    """Cosine decay with optional linear warmup."""
    def schedule(step):
        step = tf.cast(step, tf.float32)
        total = tf.cast(total_steps, tf.float32)
        warm = tf.cast(max(warmup_steps, 1), tf.float32)
        # linear warmup
        warmup_lr = initial_lr * step / warm
        # cosine decay after warmup
        progress = tf.clip_by_value((step - warm) / tf.maximum(total - warm, 1.0), 0.0, 1.0)
        cosine_lr = 0.5 * initial_lr * (1.0 + tf.cos(math.pi * progress))
        return tf.where(step < warm, warmup_lr, cosine_lr)
    return schedule


def main():
    ap = argparse.ArgumentParser(description="Train PlantGuard CNN v2 on PlantVillage.")
    ap.add_argument("--data_dir", required=True)
    ap.add_argument("--out_dir", default="./outputs")
    ap.add_argument("--img_size", type=int, default=224)
    ap.add_argument("--batch_size", type=int, default=32)
    ap.add_argument("--epochs1", type=int, default=15, help="Phase-1 (frozen) epochs.")
    ap.add_argument("--epochs2", type=int, default=40, help="Phase-2 (fine-tune) epochs.")
    ap.add_argument("--lr1", type=float, default=1e-3)
    ap.add_argument("--lr2", type=float, default=3e-5, help="Peak LR for phase-2 cosine decay.")
    ap.add_argument("--fine_tune_layers", type=int, default=30)
    ap.add_argument("--dropout", type=float, default=0.5)
    ap.add_argument("--l2", type=float, default=1e-4)
    ap.add_argument("--label_smoothing", type=float, default=0.1)
    ap.add_argument("--patience", type=int, default=8)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--mixed_precision", action="store_true")
    args = ap.parse_args()

    set_seeds(args.seed)
    if args.mixed_precision:
        tf.keras.mixed_precision.set_global_policy("mixed_float16")
        print("Mixed precision enabled (fp16).", flush=True)

    gpus = tf.config.list_physical_devices("GPU")
    print(f"GPUs visible: {len(gpus)}", flush=True)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # ---- data ----
    class_root, classes = discover_classes(args.data_dir)
    num_classes = len(classes)
    print(f"Classes: {num_classes}  ({classes[0]} ... {classes[-1]})", flush=True)
    index = build_file_index(class_root, classes)
    print(f"Total images: {len(index)}", flush=True)
    splits = stratified_split(index, seed=args.seed)
    for k, v in splits.items():
        print(f"  {k:6s}: {len(v)} images", flush=True)
    save_split_manifest(out_dir / "split_manifest.json", splits)
    (out_dir / "labels.json").write_text(json.dumps(classes, indent=2))

    train_ds = make_dataset(splits["train"], args.img_size, args.batch_size, num_classes,
                            augment=True, shuffle=True, seed=args.seed)
    val_ds = make_dataset(splits["val"], args.img_size, args.batch_size, num_classes)
    class_weights = compute_class_weights(splits["train"], num_classes)

    # Swap in the stronger v2 augmentation (replaces data_utils default).
    # Rebuild the train dataset map with the v2 pipeline:
    from data_utils import _decode  # noqa
    import tensorflow as tf2  # noqa  (already imported as tf)
    aug = build_augmentation()
    paths = [p for p, _ in splits["train"]]
    labels = [l for _, l in splits["train"]]
    train_ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    train_ds = train_ds.shuffle(buffer_size=min(len(paths), 8192), seed=args.seed,
                                reshuffle_each_iteration=True)
    train_ds = train_ds.map(lambda p, l: _decode(p, l, args.img_size),
                            num_parallel_calls=tf.data.AUTOTUNE)
    train_ds = train_ds.map(lambda x, y: (aug(x, training=True), y),
                            num_parallel_calls=tf.data.AUTOTUNE)
    train_ds = train_ds.map(lambda x, y: (x, tf.one_hot(y, num_classes)),
                            num_parallel_calls=tf.data.AUTOTUNE)
    train_ds = train_ds.batch(args.batch_size).prefetch(tf.data.AUTOTUNE)
    print("v2 augmentation pipeline active.", flush=True)

    steps_per_epoch = math.ceil(len(splits["train"]) / args.batch_size)

    # ---- model ----
    model, base = build_model(args.img_size, num_classes, args.dropout, args.l2)
    model.summary(print_fn=print)

    ckpt = out_dir / "best_model.keras"
    csv_logger = tf.keras.callbacks.CSVLogger(str(out_dir / "training_log.csv"))
    history_all = {"config": vars(args)}

    def make_callbacks(monitor="val_accuracy"):
        return [
            tf.keras.callbacks.ModelCheckpoint(str(ckpt), monitor=monitor,
                                               save_best_only=True, mode="max", verbose=1),
            tf.keras.callbacks.EarlyStopping(monitor=monitor, patience=args.patience,
                                             restore_best_weights=True, verbose=1),
            csv_logger,
        ]

    loss_fn = tf.keras.losses.CategoricalCrossentropy(label_smoothing=args.label_smoothing)

    # ---- phase 1: frozen backbone, cosine decay ----
    print("\n===== PHASE 1 (v2): training head, backbone frozen =====", flush=True)
    total_steps1 = steps_per_epoch * args.epochs1
    sched1 = cosine_decay_schedule(args.lr1, total_steps1,
                                   warmup_steps=min(500, total_steps1 // 10))
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=sched1),
                  loss=loss_fn, metrics=["accuracy"])
    t0 = time.time()
    h1 = model.fit(train_ds, validation_data=val_ds, epochs=args.epochs1,
                   class_weight=class_weights, callbacks=make_callbacks())
    print(f"Phase 1 took {(time.time() - t0) / 60:.1f} min", flush=True)
    history_all["phase1"] = {k: [float(v) for v in vals] for k, vals in h1.history.items()}

    # ---- phase 2: fine-tune top layers, cosine decay ----
    print(f"\n===== PHASE 2 (v2): fine-tuning top {args.fine_tune_layers} layers =====", flush=True)
    base.trainable = True
    for layer in base.layers[: -args.fine_tune_layers]:
        layer.trainable = False
    for layer in base.layers[-args.fine_tune_layers:]:
        if isinstance(layer, tf.keras.layers.BatchNormalization):
            layer.trainable = False
    trainable = sum(1 for l in base.layers if l.trainable)
    print(f"Backbone layers trainable in phase 2: {trainable}/{len(base.layers)}", flush=True)

    total_steps2 = steps_per_epoch * args.epochs2
    sched2 = cosine_decay_schedule(args.lr2, total_steps2,
                                   warmup_steps=min(500, total_steps2 // 10))
    model.compile(optimizer=tf.keras.optimizers.Adam(learning_rate=sched2),
                  loss=loss_fn, metrics=["accuracy"])
    # fresh CSV logger in append mode for phase 2
    csv2 = tf.keras.callbacks.CSVLogger(str(out_dir / "training_log.csv"), append=True)
    cbs2 = [
        tf.keras.callbacks.ModelCheckpoint(str(ckpt), monitor="val_accuracy",
                                           save_best_only=True, mode="max", verbose=1),
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=args.patience,
                                         restore_best_weights=True, verbose=1),
        csv2,
    ]
    t0 = time.time()
    h2 = model.fit(train_ds, validation_data=val_ds, epochs=args.epochs2,
                   class_weight=class_weights, callbacks=cbs2)
    print(f"Phase 2 took {(time.time() - t0) / 60:.1f} min", flush=True)
    history_all["phase2"] = {k: [float(v) for v in vals] for k, vals in h2.history.items()}

    # ---- save ----
    (out_dir / "history.json").write_text(json.dumps(history_all, indent=2))
    best_val = max(h1.history["val_accuracy"] + h2.history["val_accuracy"])
    print(f"\nBest val_accuracy across both phases: {best_val:.4f}", flush=True)
    print(f"Best checkpoint: {ckpt}", flush=True)


if __name__ == "__main__":
    main()
