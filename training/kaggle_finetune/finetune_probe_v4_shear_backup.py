#!/usr/bin/env python3
"""PlantGuard warm-start fine-tune -- STAGE 1 PROBE (3 epochs).

Loads best_model.keras (run-1 best: val 0.7738 / test 0.7680) via kernel_sources
mount of the v1 training kernel, unfreezes the top-50 backbone layers
(BatchNorm stays frozen), and trains 3 epochs with the improved recipe:
  - stronger augmentation: flip H+V, rotation +/-30deg, zoom +/-20%,
    contrast jitter, brightness jitter, small random shear
  - Adam LR 1e-5 with cosine decay
  - label smoothing 0.1 + categorical focal loss (gamma 2.0), no class weights
  - mixed precision (fp16) on T4

Uses the EXACT same train/val/test split as run 1 (split_manifest.json from
the v1 kernel outputs); manifest paths are remapped at runtime to the actual
dataset mount, so the numbers are directly comparable.

Writes /kaggle/working/outputs/probe_results.json with per-epoch val metrics
and test metrics for the go/no-go decision on Stage 2.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

print("Installing pinned deps ...", flush=True)
subprocess.check_call([
    sys.executable, "-m", "pip", "install", "--quiet",
    "tensorflow==2.21.0", "scikit-learn==1.9.1",
    "pillow==12.3.0", "numpy==2.1.3", "protobuf==6.31.1",
])
print("Deps installed.", flush=True)

import numpy as np
import tensorflow as tf
from sklearn.metrics import accuracy_score, f1_score
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

# ---------------- config ----------------
EPOCHS = 3
BATCH_SIZE = 32
IMG_SIZE = 224
NUM_CLASSES = 38
LR0 = 1e-5
LABEL_SMOOTHING = 0.1
FOCAL_GAMMA = 2.0
UNFREEZE_TOP = 50
SEED = 42
OUT = Path("/kaggle/working/outputs")
OUT.mkdir(parents=True, exist_ok=True)

tf.keras.utils.set_random_seed(SEED)
tf.keras.mixed_precision.set_global_policy("mixed_float16")
print("Mixed precision policy: mixed_float16", flush=True)
gpus = tf.config.list_physical_devices("GPU")
print(f"GPUs visible: {len(gpus)}", flush=True)
assert gpus, "NO GPU VISIBLE - aborting probe"

# ---------------- locate v1 assets (kernel_sources mount) ----------------
def find_v1_asset(name):
    primary = (Path("/kaggle/input/notebooks/muhammadnaveedg")
               / "plantguard-cnn-training" / "outputs" / name)
    if primary.is_file():
        print(f"v1 asset {name} -> {primary}", flush=True)
        return primary
    for p in Path("/kaggle/input").rglob(name):
        if p.is_file() and "plantguard-cnn-training" in str(p):
            print(f"v1 asset {name} -> {p} (fallback)", flush=True)
            return p
    raise FileNotFoundError(f"v1 asset not found: {name}")


def find_color_dir(class_names):
    """Find the dataset 'color' dir whose subfolders match the class names."""
    likely = [
        Path("/kaggle/input/plantvillage-dataset/color"),
        Path("/kaggle/input/datasets/abdallahalidev/plantvillage-dataset/color"),
        Path("/kaggle/input/datasets/abdallahalidev/plantvillage-dataset"
             "/plantvillage dataset/color"),
    ]
    for c in likely:
        if c.is_dir():
            subs = {d.name for d in c.iterdir() if d.is_dir()}
            if len(set(class_names) & subs) >= 30:
                print(f"color dir -> {c} (likely path)", flush=True)
                return c
    for p in Path("/kaggle/input").rglob("color"):
        if p.is_dir():
            subs = {d.name for d in p.iterdir() if d.is_dir()}
            if len(set(class_names) & subs) >= 30:
                print(f"color dir -> {p} (search fallback)", flush=True)
                return p
    raise FileNotFoundError("no valid dataset 'color' dir found under /kaggle/input")


labels = json.loads(find_v1_asset("labels.json").read_text())
print(f"Classes: {len(labels)}", flush=True)
color_dir = find_color_dir(labels)

splits_raw = json.loads(find_v1_asset("split_manifest.json").read_text())
splits = {}
for k, v in splits_raw.items():
    remapped = []
    for e in v:
        rel = e["path"].split("/color/", 1)[1]  # class/file.jpg
        remapped.append((str(color_dir / rel), e["label"]))
    splits[k] = remapped
for k, v in splits.items():
    print(f"split {k}: {len(v)} images", flush=True)
for k in ("train", "val", "test"):  # fail fast if remap is wrong
    assert os.path.exists(splits[k][0][0]), f"remapped path missing: {splits[k][0][0]}"
    assert os.path.exists(splits[k][-1][0]), f"remapped path missing: {splits[k][-1][0]}"
print("Dataset paths remapped and verified.", flush=True)

# ---------------- data pipeline ----------------
def _decode(path, label):
    img = tf.io.read_file(path)
    img = tf.cond(
        tf.strings.regex_full_match(path, ".*\\.[pP][nN][gG]$"),
        lambda: tf.image.decode_png(img, channels=3),
        lambda: tf.image.decode_jpeg(img, channels=3),
    )
    img = tf.image.resize(img, [IMG_SIZE, IMG_SIZE])
    return preprocess_input(tf.cast(img, tf.float32)), label


def _random_shear(x, max_shear=0.15):
    s = tf.random.uniform([], -max_shear, max_shear)
    t = tf.stack([1.0, s, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0])
    x = tf.raw_ops.ImageProjectiveTransformV3(
        images=tf.expand_dims(x, 0),
        transforms=tf.expand_dims(t, 0),
        output_shape=tf.shape(x)[:2],
        interpolation="BILINEAR",
        fill_value=tf.constant(0.0),
    )
    return tf.squeeze(x, 0)


_aug = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal_and_vertical"),
    tf.keras.layers.RandomRotation(0.0833),   # +/-30 deg
    tf.keras.layers.RandomZoom(0.2),          # +/-20%
    tf.keras.layers.RandomContrast(0.2),
    tf.keras.layers.RandomBrightness(0.2),
])


def _augment(x, y):
    x = _aug(x, training=True)
    x = _random_shear(x)
    return x, y


def make_train_ds(pairs):
    paths = [p for p, _ in pairs]
    labels_ = [l for _, l in pairs]
    ds = tf.data.Dataset.from_tensor_slices((paths, labels_))
    ds = ds.shuffle(min(len(paths), 8192), seed=SEED, reshuffle_each_iteration=True)
    ds = ds.map(_decode, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(_augment, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(lambda x, y: (x, tf.one_hot(y, NUM_CLASSES)),
                num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


def make_val_ds(pairs):
    paths = [p for p, _ in pairs]
    labels_ = [l for _, l in pairs]
    ds = tf.data.Dataset.from_tensor_slices((paths, labels_))
    ds = ds.map(_decode, num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(lambda x, y: (x, tf.one_hot(y, NUM_CLASSES)),
                num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE)


def make_test_ds(pairs):
    paths = [p for p, _ in pairs]
    labels_ = np.array([l for _, l in pairs], dtype=np.int32)
    ds = tf.data.Dataset.from_tensor_slices(paths)
    ds = ds.map(lambda p: _decode(p, 0)[0], num_parallel_calls=tf.data.AUTOTUNE)
    return ds.batch(BATCH_SIZE).prefetch(tf.data.AUTOTUNE), labels_


train_ds = make_train_ds(splits["train"])
val_ds = make_val_ds(splits["val"])

# ---------------- model surgery ----------------
print("Loading best_model.keras ...", flush=True)
model = tf.keras.models.load_model(str(find_v1_asset("best_model.keras")))

base = next(l for l in model.layers if isinstance(l, tf.keras.Model))
print(f"Base model: {base.name} ({len(base.layers)} layers)", flush=True)
base.trainable = True
for layer in base.layers[:-UNFREEZE_TOP]:
    layer.trainable = False
n_bn = 0
for layer in base.layers[-UNFREEZE_TOP:]:
    if isinstance(layer, tf.keras.layers.BatchNormalization):
        layer.trainable = False
        n_bn += 1
n_train = sum(1 for l in base.layers if l.trainable)
print(f"Backbone trainable: {n_train}/{len(base.layers)} "
      f"(top-{UNFREEZE_TOP} unfrozen, BatchNorm kept frozen: {n_bn})", flush=True)


def categorical_focal_loss(gamma=2.0, smoothing=0.1):
    def loss(y_true, y_pred):
        y_pred = tf.cast(y_pred, tf.float32)
        n = tf.cast(tf.shape(y_true)[-1], tf.float32)
        y_true = y_true * (1.0 - smoothing) + smoothing / n
        y_pred = tf.clip_by_value(y_pred, 1e-7, 1.0 - 1e-7)
        ce = -y_true * tf.math.log(y_pred)
        w = tf.pow(1.0 - y_pred, gamma)
        return tf.reduce_sum(w * ce, axis=-1)
    return loss


steps = len(splits["train"]) // BATCH_SIZE
sched = tf.keras.optimizers.schedules.CosineDecay(LR0, steps * EPOCHS)
model.compile(
    optimizer=tf.keras.optimizers.Adam(sched),
    loss=categorical_focal_loss(FOCAL_GAMMA, LABEL_SMOOTHING),
    metrics=["accuracy"],
)
print(f"Compiled: Adam cosine-decay LR {LR0}, focal loss(gamma={FOCAL_GAMMA}, "
      f"smoothing={LABEL_SMOOTHING}), {EPOCHS} epochs", flush=True)

cb = [
    tf.keras.callbacks.ModelCheckpoint(
        str(OUT / "probe_best.keras"), monitor="val_accuracy",
        save_best_only=True, mode="max", verbose=1),
    tf.keras.callbacks.CSVLogger(str(OUT / "probe_log.csv")),
]

t0 = time.time()
hist = model.fit(train_ds, validation_data=val_ds, epochs=EPOCHS,
                 callbacks=cb, verbose=2)
print(f"Probe training took {(time.time() - t0) / 60:.1f} min", flush=True)

# ---------------- test eval (best probe checkpoint) ----------------
print("Loading best probe checkpoint for test eval ...", flush=True)
best = tf.keras.models.load_model(str(OUT / "probe_best.keras"))
test_ds, y_true = make_test_ds(splits["test"])
print("Running test inference ...", flush=True)
y_prob = best.predict(test_ds, verbose=1)
y_pred = np.argmax(y_prob, axis=1)
test_acc = float(accuracy_score(y_true, y_pred))
test_f1 = float(f1_score(y_true, y_pred, average="macro", zero_division=0))

results = {
    "stage": "probe",
    "epochs": EPOCHS,
    "recipe": {
        "unfreeze_top": UNFREEZE_TOP,
        "lr": LR0,
        "lr_schedule": "cosine_decay",
        "label_smoothing": LABEL_SMOOTHING,
        "focal_gamma": FOCAL_GAMMA,
        "augmentation": "flip_hv, rotation_+-30deg, zoom_+-20%, contrast, brightness, shear_+-0.15",
    },
    "val_accuracy_per_epoch": [float(v) for v in hist.history["val_accuracy"]],
    "val_loss_per_epoch": [float(v) for v in hist.history["val_loss"]],
    "train_accuracy_per_epoch": [float(v) for v in hist.history["accuracy"]],
    "test_accuracy": round(test_acc, 4),
    "test_macro_f1": round(test_f1, 4),
    "v1_test_accuracy": 0.7680,
    "v1_best_val_accuracy": 0.7738,
}
(OUT / "probe_results.json").write_text(json.dumps(results, indent=2))
print("PROBE_RESULTS_JSON_BEGIN", flush=True)
print(json.dumps(results, indent=2), flush=True)
print("PROBE_RESULTS_JSON_END", flush=True)
print("Probe done.", flush=True)
