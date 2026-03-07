#!/usr/bin/env python3
"""Train a tiny CNN on patch dataset.

Input format:
  data_root/
    black/*.png
    white/*.png
    empty/*.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

try:
    import tensorflow as tf
except Exception as exc:  # pragma: no cover
    raise SystemExit(
        "TensorFlow is required for training. Install requirements.txt first.\n"
        f"Import error: {exc}"
    )


def build_model(input_shape=(32, 32, 1), num_classes=3) -> tf.keras.Model:
    model = tf.keras.Sequential(
        [
            tf.keras.layers.Input(shape=input_shape),
            tf.keras.layers.Rescaling(1.0 / 255.0),
            tf.keras.layers.Conv2D(16, 3, padding="same", activation="relu"),
            tf.keras.layers.MaxPool2D(),
            tf.keras.layers.Conv2D(32, 3, padding="same", activation="relu"),
            tf.keras.layers.MaxPool2D(),
            tf.keras.layers.Conv2D(64, 3, padding="same", activation="relu"),
            tf.keras.layers.GlobalAveragePooling2D(),
            tf.keras.layers.Dropout(0.2),
            tf.keras.layers.Dense(num_classes, activation="softmax"),
        ]
    )
    model.compile(
        optimizer=tf.keras.optimizers.Adam(1e-3),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def class_counts_from_dir(data_root: Path, class_names: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name in class_names:
        cls_dir = data_root / name
        if not cls_dir.exists():
            counts[name] = 0
            continue
        counts[name] = len(
            [p for p in cls_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
        )
    return counts


def make_class_weight(class_names: list[str], counts: dict[str, int]) -> dict[int, float]:
    total = sum(counts.values())
    non_zero = max(1, sum(1 for c in counts.values() if c > 0))
    out: dict[int, float] = {}
    for i, name in enumerate(class_names):
        c = counts.get(name, 0)
        if c <= 0:
            out[i] = 1.0
        else:
            out[i] = float(total) / float(non_zero * c)
    return out


def evaluate_model(
    model: tf.keras.Model, val_ds: tf.data.Dataset, class_names: list[str], output_dir: Path
) -> dict:
    y_true = []
    y_pred = []
    for x_batch, y_batch in val_ds:
        probs = model.predict(x_batch, verbose=0)
        preds = np.argmax(probs, axis=1)
        y_pred.extend(preds.tolist())
        y_true.extend(y_batch.numpy().astype(int).tolist())

    n = len(class_names)
    cm = tf.math.confusion_matrix(y_true, y_pred, num_classes=n).numpy()
    metrics = {}
    for i, name in enumerate(class_names):
        tp = int(cm[i, i])
        fp = int(cm[:, i].sum() - tp)
        fn = int(cm[i, :].sum() - tp)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        metrics[name] = {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "precision": precision,
            "recall": recall,
        }

    overall_acc = float((cm.diagonal().sum() / max(1, cm.sum())))
    report = {
        "overall_accuracy": overall_acc,
        "class_names": class_names,
        "confusion_matrix": cm.tolist(),
        "per_class": metrics,
    }
    out_path = output_dir / "eval.json"
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--img-size", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("auto", "cpu", "gpu"), default="auto")
    parser.add_argument("--resume-from", type=Path, default=None)
    parser.add_argument("--resume-auto", action="store_true")
    parser.add_argument("--class-balance", choices=("none", "weighted"), default="weighted")
    parser.add_argument("--verbose", type=int, default=2)
    args = parser.parse_args()

    if args.device == "cpu":
        tf.config.set_visible_devices([], "GPU")
        print("Device mode: CPU (GPU disabled).")
    elif args.device == "gpu":
        gpus = tf.config.list_physical_devices("GPU")
        if not gpus:
            raise SystemExit("Requested --device gpu, but no GPU is visible to TensorFlow.")
        print(f"Device mode: GPU ({len(gpus)} visible).")
    else:
        gpus = tf.config.list_physical_devices("GPU")
        if gpus:
            print(f"Device mode: auto (GPU detected: {len(gpus)}).")
        else:
            print("Device mode: auto (CPU only).")

    args.output_dir.mkdir(parents=True, exist_ok=True)

    class_names = ["black", "white", "empty"]
    counts = class_counts_from_dir(args.data_root, class_names)
    print("Class counts:", counts)
    class_weight = None
    if args.class_balance == "weighted":
        class_weight = make_class_weight(class_names, counts)
        print("Class weights:", {class_names[i]: round(w, 4) for i, w in class_weight.items()})

    train_ds = tf.keras.utils.image_dataset_from_directory(
        args.data_root,
        labels="inferred",
        label_mode="int",
        class_names=class_names,
        color_mode="grayscale",
        image_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        validation_split=args.val_split,
        subset="training",
        seed=args.seed,
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        args.data_root,
        labels="inferred",
        label_mode="int",
        class_names=class_names,
        color_mode="grayscale",
        image_size=(args.img_size, args.img_size),
        batch_size=args.batch_size,
        validation_split=args.val_split,
        subset="validation",
        seed=args.seed,
    )

    autotune = tf.data.AUTOTUNE
    train_ds = train_ds.shuffle(4096).prefetch(autotune)
    val_ds = val_ds.prefetch(autotune)

    resume_path = None
    if args.resume_from:
        resume_path = args.resume_from
    elif args.resume_auto:
        candidate = args.output_dir / "best.keras"
        if candidate.exists():
            resume_path = candidate

    if resume_path:
        if not resume_path.exists():
            raise SystemExit(f"Requested resume model does not exist: {resume_path}")
        print(f"Resuming from: {resume_path}")
        model = tf.keras.models.load_model(resume_path)
    else:
        model = build_model(input_shape=(args.img_size, args.img_size, 1), num_classes=3)

    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=4, restore_best_weights=True),
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(args.output_dir / "best.keras"),
            monitor="val_accuracy",
            save_best_only=True,
        ),
    ]

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=args.epochs,
        callbacks=callbacks,
        class_weight=class_weight,
        verbose=args.verbose,
    )

    final_path = args.output_dir / "final.keras"
    model.save(final_path)

    best_val = max(history.history.get("val_accuracy", [0.0]))
    report = evaluate_model(model, val_ds, class_names, args.output_dir)
    print(f"Saved model: {final_path}")
    print(f"Best val_accuracy: {best_val:.4f}")
    print(f"Eval accuracy: {report['overall_accuracy']:.4f}")
    for name in class_names:
        m = report["per_class"][name]
        print(
            f"{name:>5} precision={m['precision']:.4f} recall={m['recall']:.4f} "
            f"(tp={m['tp']} fp={m['fp']} fn={m['fn']})"
        )


if __name__ == "__main__":
    np.random.seed(42)
    tf.random.set_seed(42)
    main()
