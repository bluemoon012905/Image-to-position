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

    model = build_model(input_shape=(args.img_size, args.img_size, 1), num_classes=3)

    callbacks = [
        tf.keras.callbacks.EarlyStopping(monitor="val_accuracy", patience=4, restore_best_weights=True),
        tf.keras.callbacks.ModelCheckpoint(
            filepath=str(args.output_dir / "best.keras"),
            monitor="val_accuracy",
            save_best_only=True,
        ),
    ]

    history = model.fit(train_ds, validation_data=val_ds, epochs=args.epochs, callbacks=callbacks)

    final_path = args.output_dir / "final.keras"
    model.save(final_path)

    best_val = max(history.history.get("val_accuracy", [0.0]))
    print(f"Saved model: {final_path}")
    print(f"Best val_accuracy: {best_val:.4f}")


if __name__ == "__main__":
    np.random.seed(42)
    tf.random.set_seed(42)
    main()
