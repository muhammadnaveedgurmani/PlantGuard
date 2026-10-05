"""Shared dataset helpers for the PlantGuard CNN pipeline.

PlantVillage layout expected:
    <data_dir>/<class_name>/*.JPG            (38 class folders)

The abdallahalidev Kaggle copy nests this under "<root>/color/".
`discover_classes` handles both layouts.
"""
import json
import os
import random
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.model_selection import train_test_split
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

IMG_EXTS = {".jpg", ".jpeg", ".png", ".JPG", ".JPEG", ".PNG"}


def resolve_class_root(data_dir: Path) -> Path:
    """Return the directory that directly contains the class folders."""
    data_dir = Path(data_dir)
    # Kaggle "plantvillage-dataset" copy: <root>/color/<38 classes>
    color = data_dir / "color"
    if color.is_dir() and _looks_like_class_root(color):
        return color
    if _looks_like_class_root(data_dir):
        return data_dir
    # One extra nesting level (e.g. "plantvillage dataset/color")
    for child in data_dir.iterdir():
        if child.is_dir():
            nested_color = child / "color"
            if nested_color.is_dir() and _looks_like_class_root(nested_color):
                return nested_color
            if _looks_like_class_root(child):
                return child
    raise FileNotFoundError(
        f"Could not find class folders under {data_dir}. "
        "Expected <data_dir>/<class>/*.jpg (or <data_dir>/color/<class>/*.jpg)."
    )


def _looks_like_class_root(d: Path) -> bool:
    min_dirs = int(os.environ.get("PLANTGUARD_MIN_CLASS_DIRS", "5"))
    subdirs = [c for c in d.iterdir() if c.is_dir()]
    if len(subdirs) < min_dirs:
        return False
    return any(_count_images(c) > 0 for c in subdirs)


def _count_images(d: Path) -> int:
    return sum(1 for f in d.iterdir() if f.is_file() and f.suffix in IMG_EXTS)


def discover_classes(data_dir: Path):
    """Return (class_root, sorted class names)."""
    root = resolve_class_root(Path(data_dir))
    classes = sorted([c.name for c in root.iterdir() if c.is_dir() and _count_images(c) > 0])
    if not classes:
        raise FileNotFoundError(f"No class folders with images found under {root}")
    return root, classes


def build_file_index(class_root: Path, classes):
    """Return list of (filepath, label_index)."""
    index = []
    for i, cls in enumerate(classes):
        for f in sorted((class_root / cls).iterdir()):
            if f.is_file() and f.suffix in IMG_EXTS:
                index.append((str(f), i))
    return index


def stratified_split(file_index, seed=42, train_ratio=0.8, val_ratio=0.1):
    """Stratified 80/10/10 split. Returns dict with train/val/test lists of (path, label)."""
    paths = [p for p, _ in file_index]
    labels = [l for _, l in file_index]
    p_train, p_rest, y_train, y_rest = train_test_split(
        paths, labels, train_size=train_ratio, random_state=seed, stratify=labels
    )
    val_size = val_ratio / (1.0 - train_ratio)
    p_val, p_test, y_val, y_test = train_test_split(
        p_rest, y_rest, train_size=val_size, random_state=seed, stratify=y_rest
    )
    return {
        "train": list(zip(p_train, y_train)),
        "val": list(zip(p_val, y_val)),
        "test": list(zip(p_test, y_test)),
    }


def save_split_manifest(path: Path, splits):
    serial = {k: [{"path": p, "label": int(l)} for p, l in v] for k, v in splits.items()}
    Path(path).write_text(json.dumps(serial, indent=2))


def load_split_manifest(path: Path):
    raw = json.loads(Path(path).read_text())
    return {k: [(e["path"], e["label"]) for e in v] for k, v in raw.items()}


def _decode(path, label, img_size):
    img = tf.io.read_file(path)
    # PlantVillage ships JPEG; tolerate PNG as well (extension-based branch).
    img = tf.cond(
        tf.strings.regex_full_match(path, ".*\\.[pP][nN][gG]$"),
        lambda: tf.image.decode_png(img, channels=3),
        lambda: tf.image.decode_jpeg(img, channels=3),
    )
    img = tf.image.resize(img, [img_size, img_size])
    img = preprocess_input(tf.cast(img, tf.float32))  # scale to [-1, 1] for MobileNetV2
    return img, label


def make_dataset(pairs, img_size, batch_size, num_classes, augment=False, shuffle=False, seed=42):
    paths = [p for p, _ in pairs]
    labels = [l for _, l in pairs]
    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if shuffle:
        ds = ds.shuffle(buffer_size=min(len(paths), 8192), seed=seed, reshuffle_each_iteration=True)
    ds = ds.map(lambda p, l: _decode(p, l, img_size), num_parallel_calls=tf.data.AUTOTUNE)
    if augment:
        aug = tf.keras.Sequential(
            [
                tf.keras.layers.RandomFlip("horizontal"),
                tf.keras.layers.RandomRotation(0.2),
                tf.keras.layers.RandomZoom(0.2),
                tf.keras.layers.RandomContrast(0.2),
            ]
        )
        ds = ds.map(lambda x, y: (aug(x, training=True), y), num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(
        lambda x, y: (x, tf.one_hot(y, num_classes)), num_parallel_calls=tf.data.AUTOTUNE
    )
    ds = ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return ds


def make_eval_dataset(pairs, img_size, batch_size):
    """No augmentation / no one-hot: returns (images, int labels) for sklearn metrics."""
    paths = [p for p, _ in pairs]
    labels = np.array([l for _, l in pairs], dtype=np.int32)
    ds = tf.data.Dataset.from_tensor_slices(paths)
    ds = ds.map(
        lambda p: _decode(p, 0, img_size)[0], num_parallel_calls=tf.data.AUTOTUNE
    )
    ds = ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return ds, labels


def class_distribution(pairs, classes):
    counts = {c: 0 for c in classes}
    for _, l in pairs:
        counts[classes[l]] += 1
    return counts


def compute_class_weights(train_pairs, num_classes):
    """Inverse-frequency weights to counter PlantVillage class imbalance."""
    labels = np.array([l for _, l in train_pairs])
    total = len(labels)
    weights = {}
    for c in range(num_classes):
        n = int((labels == c).sum())
        weights[c] = total / (num_classes * n) if n else 1.0
    return weights


def set_seeds(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)
