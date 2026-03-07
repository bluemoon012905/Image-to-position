from pathlib import Path
from PIL import Image

root = Path("data/processed/patches")
bad = []
for p in root.rglob("*"):
    if not p.is_file():
        continue
    if p.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        continue
    try:
        with Image.open(p) as im:
            im.verify()
    except Exception:
        bad.append(p)

print("bad files:", len(bad))
for p in bad[:20]:
    print(p)
for p in bad:
    p.unlink(missing_ok=True)
print("removed:", len(bad))