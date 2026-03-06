#!/usr/bin/env python3
"""Build per-intersection patch dataset from warped board images + SGF labels.

Expected input layout (recursive):
  <case_dir>/some_image.png
  <case_dir>/position.sgf

Outputs:
  <out_root>/black/*.png
  <out_root>/white/*.png
  <out_root>/empty/*.png
  <out_root>/manifest.csv
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path
from typing import Dict, Iterable, Set, Tuple

from PIL import Image

LETTERS = "abcdefghijklmnopqrstuvwxyz"
LETTER_TO_IDX = {c: i for i, c in enumerate(LETTERS)}


def parse_sgf_labels(sgf_path: Path) -> Tuple[Set[Tuple[int, int]], Set[Tuple[int, int]]]:
    text = sgf_path.read_text(encoding="utf-8", errors="ignore")

    def extract(tag: str) -> Set[Tuple[int, int]]:
        out: Set[Tuple[int, int]] = set()
        for block in re.findall(rf"{tag}((?:\[[a-z]{{2}}\])+)", text):
            for coord in re.findall(r"\[([a-z]{2})\]", block):
                c, r = coord[0], coord[1]
                if c not in LETTER_TO_IDX or r not in LETTER_TO_IDX:
                    continue
                col = LETTER_TO_IDX[c]
                row = LETTER_TO_IDX[r]
                out.add((row, col))
        return out

    return extract("AB"), extract("AW")


def find_case_pairs(root: Path) -> Iterable[Tuple[Path, Path]]:
    for sgf in sorted(root.rglob("*.sgf")):
        case_dir = sgf.parent
        imgs = sorted(
            p
            for p in case_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        )
        if not imgs:
            continue
        # Use first image in case dir by stable sort order.
        yield imgs[0], sgf


def crop_patch(img: Image.Image, cx: float, cy: float, patch_size: int) -> Image.Image:
    half = patch_size // 2
    left = int(round(cx)) - half
    top = int(round(cy)) - half
    right = left + patch_size
    bottom = top + patch_size

    src_w, src_h = img.size
    # Clamp and pad if crop spills outside image.
    pad_l = max(0, -left)
    pad_t = max(0, -top)
    pad_r = max(0, right - src_w)
    pad_b = max(0, bottom - src_h)

    left = max(0, left)
    top = max(0, top)
    right = min(src_w, right)
    bottom = min(src_h, bottom)

    patch = Image.new("L", (patch_size, patch_size), color=127)
    region = img.crop((left, top, right, bottom)).convert("L")
    patch.paste(region, (pad_l, pad_t))
    return patch


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-root", type=Path, required=True)
    parser.add_argument("--out-root", type=Path, required=True)
    parser.add_argument("--board-size", type=int, default=19)
    parser.add_argument("--patch-size", type=int, default=32)
    args = parser.parse_args()

    out_root = args.out_root
    for cls in ("black", "white", "empty"):
        (out_root / cls).mkdir(parents=True, exist_ok=True)

    manifest_path = out_root / "manifest.csv"
    rows = []
    per_class: Dict[str, int] = {"black": 0, "white": 0, "empty": 0}

    for image_path, sgf_path in find_case_pairs(args.input_root):
        black, white = parse_sgf_labels(sgf_path)
        img = Image.open(image_path).convert("RGB")
        w, h = img.size
        n = args.board_size
        step = (min(w, h) - 1) / (n - 1)
        x_offset = (w - 1 - step * (n - 1)) / 2
        y_offset = (h - 1 - step * (n - 1)) / 2

        case_id = image_path.parent.name
        for row in range(n):
            for col in range(n):
                if (row, col) in black:
                    cls = "black"
                elif (row, col) in white:
                    cls = "white"
                else:
                    cls = "empty"

                cx = x_offset + col * step
                cy = y_offset + row * step
                patch = crop_patch(img, cx, cy, args.patch_size)

                filename = f"{case_id}_r{row:02d}_c{col:02d}.png"
                rel = Path(cls) / filename
                patch.save(out_root / rel)
                per_class[cls] += 1
                rows.append(
                    {
                        "case": case_id,
                        "image": str(image_path),
                        "sgf": str(sgf_path),
                        "row": row,
                        "col": col,
                        "label": cls,
                        "patch": str(rel),
                    }
                )

    with manifest_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["case", "image", "sgf", "row", "col", "label", "patch"],
        )
        writer.writeheader()
        writer.writerows(rows)

    total = sum(per_class.values())
    print("Wrote dataset:", out_root)
    print("Total patches:", total)
    print("Class counts:", per_class)


if __name__ == "__main__":
    main()
