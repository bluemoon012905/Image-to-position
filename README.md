# Image to SGF

Static browser tool to convert a Go board photo into an SGF setup position.

## Workflow (3 steps)

1. Upload board image and detect/select the 4 board corners.
2. Convert board intersections to coordinate properties (`AB` / `AW`).
3. Generate and download SGF.

## Run locally

Because browsers often block local file APIs on `file://`, run a small static server:

```bash
python3 -m http.server 8080
```

Open: `http://localhost:8080`

## Deploy to GitHub Pages

1. Push these files to your repository (`index.html`, `style.css`, `app.js`).
2. In GitHub repo settings, enable Pages from your default branch root.
3. Your app will be available at the Pages URL.

## Notes

- Corner auto-detect and stone-circle detection use OpenCV.js in the browser.
- You can import with file upload or by pasting an image into the paste box.
- You can crop after upload/paste using `Crop mode` -> drag box -> `Apply crop`.
- Step 3 includes a visual SGF preview board before download.
- Step 3 lets you click the preview to add/remove stones and use a D-pad to nudge position in any direction.
- Use `Puzzle mode` in Step 1 for partial-board snippets; it estimates visible grid count before mapping to full-board coordinates.
- If full board edges are not visible, use 2 opposite clicks and set `Board anchor` (or `Auto corner`) to place stones into a board corner.
- If auto-detect misses, click corners manually in order:
  top-left, top-right, bottom-right, bottom-left.
- Threshold sliders help tune black/white stone extraction per photo.
