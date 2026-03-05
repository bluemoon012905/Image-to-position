# State Flow Investigation

This app uses a single mutable `state` object in [`app.js`](/home/bluey/personal/Image-to-position/app.js), not an explicit finite state machine. Flow is enforced by guard checks in event handlers (`if (!state.imageLoaded) return`, etc.) and by status messages.

## Core State Buckets

- Image/session: `image`, `imageLoaded`, `drawMeta`, `cvReady`
- Board framing: `corners`, `activeCorners`
- Crop interaction: `cropMode`, `cropRect`, `cropDragStart`, `isCropping`
- Detection/extraction: `warpedImageData`, `lastDetectionMeta`, `extracting`, thresholds via inputs
- Mapping/editing: `rawStones`, `stones`, `mappingContext`, `manualEdits`, `shiftX`, `shiftY`, `rotation`, `editTool`, `hoverPoint`

## End-to-End Flow

1. Boot/idle
- `waitForCv()` flips `cvReady=true` when OpenCV is ready.
- UI initializes empty preview and default thresholds.

2. Image intake
- Upload/paste calls `loadImageFromBlob()`.
- On successful image load: `image`, `imageLoaded=true`, then `resetStateForNewImage()` clears prior work.
- Resulting state is “image loaded, waiting for crop/corners”.

3. Optional crop sub-flow
- `cropMode` toggle enables drag rectangle on source canvas.
- Drag lifecycle: `mousedown` sets `cropDragStart`+`cropRect`, `mousemove` updates rect, `mouseup/leave` ends drag.
- `applyCropToImage()` replaces `state.image` with cropped image, then calls `resetStateForNewImage()` (full pipeline reset).

4. Corner definition
- Manual click flow pushes points into `corners`; at 4 points it orders them and reports ready.
- Auto flow (`autoDetectCorners()`) writes ordered 4-corner set directly.
- Reset corners clears corners plus all extraction/mapping/editing outputs.

5. Extraction run
- `extractStones()` guarded by `extracting` lock (re-entrancy prevention).
- `warpBoardFromCorners()` produces `warpedImageData`.
- Circle detection -> intersection snapping -> brightness classification.
- Output of extraction:
  - `rawStones` = detected/classified stones in image-local grid
  - `manualEdits` reset to `{}` for a fresh run
- Then `applyPositionMapping()` maps to board coordinates and sets `stones`.

6. Mapping/edit loop (post-extraction)
- `applyPositionMapping()` derives `mappingContext` from `rawStones` + board size + rotation + shifts.
- Combines mapped `rawStones` with `manualEdits` (local-space overrides) to produce final `stones`.
- Preview clicks modify `manualEdits` (`black`/`white`/`empty`) then immediately re-map.
- Shift and rotate buttons mutate `shiftX/shiftY/rotation` then re-map.

7. SGF output
- `generateSgf()` serializes current `stones` into SGF text.
- `downloadSgf()` requires non-empty SGF output.

## Practical State Model (Implicit)

- `INIT`: before `cvReady`
- `READY_NO_IMAGE`: OpenCV ready, no image loaded
- `IMAGE_READY`: image loaded; no extraction artifacts
- `CROP_ACTIVE` (overlay sub-state of `IMAGE_READY`)
- `CORNERS_PARTIAL`: 1-3 corners
- `CORNERS_READY`: 4 corners (manual or auto)
- `EXTRACTING`: async extraction in progress (`extracting=true`)
- `MAPPED`: extraction done; `rawStones`/`stones`/`mappingContext` present
- `SGF_READY`: SGF text generated (orthogonal output state)

Transitions are mostly one-way via user actions, with hard resets at image load, crop apply, and reset corners.

## What Looks Good

- Centralized state object makes mutation points easy to audit.
- Guard clauses prevent most invalid actions.
- `extracting` flag prevents overlapping extraction runs.
- Manual edits are stored in local coordinates, so they survive shift/rotation remapping.

## Risks / Polish Opportunities

- No explicit FSM means legal state transitions are spread across many handlers.
- `drawMeta` is created dynamically (not in initial state), which can hide dependencies.
- `boardSize` changes only update status text; existing mapped data can appear stale until re-extract.
- Multiple reset paths duplicate similar clearing logic (`resetStateForNewImage` vs `resetCornersBtn` handler).
- `SGF_READY` is decoupled from subsequent edits; users can generate once, then change stones without regenerating.

## Recommendation for Next Polish Pass

- Add a tiny phase enum (for example: `phase: "no_image" | "image" | "corners" | "extracting" | "mapped"`) and central transition helpers.
- Consolidate reset routines into one canonical reset function with optional scopes (`image`, `mapping`, `edits`).
- Add “dirty SGF” flag after any change to `stones` so SGF generation status is always accurate.
