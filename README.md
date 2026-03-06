# Image-to-Position (ML Scaffold)

This repo is now organized for a lightweight, local-first ML workflow for Go stone recognition.

## Directory Layout

- `web/`: browser app (upload, cornering, extraction UI, SGF edit/export)
- `data/examples/references/`: your current labeled examples (image + SGF)
- `data/raw/`: place new labeled cases here (or anywhere and point the script)
- `data/processed/`: generated patch dataset (ignored by git)
- `scripts/`: dataset prep utilities
- `train/`: model training code and artifacts
- `tests/`: JS unit tests
- `docs/legacy/`: old notes kept for reference

## Quick Start

1. Run web app

```bash
npm run web
# open http://localhost:8080
```

2. Build patch dataset from labeled cases

```bash
npm run build:dataset
```

3. Train tiny classifier

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm run train
# force CPU:
python3 train/train_classifier.py --data-root data/processed/patches --output-dir train/artifacts --device cpu
# force GPU:
python3 train/train_classifier.py --data-root data/processed/patches --output-dir train/artifacts --device gpu
```

4. Run JS tests

```bash
npm test
```

## Labeled Data Format

Each case directory should contain:
- one board image (`.png/.jpg/.jpeg/.webp`)
- one SGF file with `AB`/`AW` setup stones

Example:

```
data/raw/case_001/
  board.png
  position.sgf
```

## How Much Data Is Needed?

For a small static in-browser model (per-intersection classifier):

- Minimum to start: `~50` full-board labeled positions (19x19)  
  about `18,000` patches total (`361` points each)
- Good early target: `150-300` boards  
  gives much better white-stone robustness across lighting/cameras
- Strong target: `500+` boards  
  good generalization and fewer hand-tuned heuristics

Class balance matters more than raw total. Make sure your set includes:
- sparse + dense positions
- bright/dim lighting
- glare/shadows
- multiple devices/cameras
- plenty of white stones near black stones (your current failure mode)

## Next Integration Step

After you provide more labeled data, we can:
1. train a tiny CNN (`black/white/empty`) offline,
2. export to TF.js,
3. run inference directly in `web/` with no backend.
