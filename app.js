const state = {
  image: null,
  imageLoaded: false,
  boardSize: 19,
  corners: [],
  cvReady: false,
  warpedImageData: null,
  activeCorners: [],
  cropMode: false,
  cropRect: null,
  cropDragStart: null,
  isCropping: false,
  shiftX: 0,
  shiftY: 0,
  rotation: 0,
  editTool: "erase",
  manualEdits: {},
  hoverPoint: null,
  puzzleMode: false,
  preprocessMode: "off",
  puzzleVisibleCols: 0,
  puzzleVisibleRows: 0,
  detectedPuzzleGrid: null,
  mappingContext: null,
  rawStones: [],
  stones: [],
};

const sourceCanvas = document.getElementById("sourceCanvas");
const sourceCtx = sourceCanvas.getContext("2d");
const warpCanvas = document.getElementById("warpCanvas");
const warpCtx = warpCanvas.getContext("2d");
const sgfPreviewCanvas = document.getElementById("sgfPreviewCanvas");
const sgfPreviewCtx = sgfPreviewCanvas.getContext("2d");

const imageInput = document.getElementById("imageInput");
const pasteZone = document.getElementById("pasteZone");
const boardSizeSelect = document.getElementById("boardSizeSelect");
const puzzleModeSelect = document.getElementById("puzzleModeSelect");
const preprocessModeSelect = document.getElementById("preprocessModeSelect");
const autoCornersBtn = document.getElementById("autoCornersBtn");
const resetCornersBtn = document.getElementById("resetCornersBtn");
const cropModeBtn = document.getElementById("cropModeBtn");
const applyCropBtn = document.getElementById("applyCropBtn");
const cancelCropBtn = document.getElementById("cancelCropBtn");
const extractBtn = document.getElementById("extractBtn");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");

const boardAnchorSelect = document.getElementById("boardAnchorSelect");
const puzzleColsInput = document.getElementById("puzzleColsInput");
const puzzleRowsInput = document.getElementById("puzzleRowsInput");
const puzzleGridStatus = document.getElementById("puzzleGridStatus");

const cornerStatus = document.getElementById("cornerStatus");
const extractStatus = document.getElementById("extractStatus");
const sgfStatus = document.getElementById("sgfStatus");
const sgfOutput = document.getElementById("sgfOutput");
const gameNameInput = document.getElementById("gameName");
const komiInput = document.getElementById("komiInput");
const toolBlackBtn = document.getElementById("toolBlackBtn");
const toolWhiteBtn = document.getElementById("toolWhiteBtn");
const toolEraseBtn = document.getElementById("toolEraseBtn");
const editToolStatus = document.getElementById("editToolStatus");
const shiftUpBtn = document.getElementById("shiftUpBtn");
const shiftDownBtn = document.getElementById("shiftDownBtn");
const shiftLeftBtn = document.getElementById("shiftLeftBtn");
const shiftRightBtn = document.getElementById("shiftRightBtn");
const rotateBtn = document.getElementById("rotateBtn");
const shiftValue = document.getElementById("shiftValue");

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DEFAULT_BLACK_THRESHOLD = 24;
const DEFAULT_WHITE_THRESHOLD = 22;

function setStatus(el, message) {
  el.textContent = message;
}

function updateShiftLabel() {
  if (shiftValue) {
    shiftValue.textContent = `Shift: x=${state.shiftX}, y=${state.shiftY}, rot=${state.rotation * 90}deg`;
  }
}

function updatePuzzleGridUI() {
  if (puzzleColsInput) puzzleColsInput.value = String(state.puzzleVisibleCols || 0);
  if (puzzleRowsInput) puzzleRowsInput.value = String(state.puzzleVisibleRows || 0);
  if (puzzleGridStatus) {
    if (state.puzzleVisibleCols > 0 && state.puzzleVisibleRows > 0) {
      puzzleGridStatus.textContent = `Detected grid: ${state.puzzleVisibleCols} x ${state.puzzleVisibleRows}`;
    } else {
      puzzleGridStatus.textContent = "Detected grid: -";
    }
  }
}

function setPuzzleVisibleGrid(cols, rows) {
  const maxN = Math.max(2, state.boardSize);
  const c = Number(cols);
  const r = Number(rows);
  state.puzzleVisibleCols =
    Number.isFinite(c) && c >= 2 ? Math.max(2, Math.min(maxN, Math.round(c))) : 0;
  state.puzzleVisibleRows =
    Number.isFinite(r) && r >= 2 ? Math.max(2, Math.min(maxN, Math.round(r))) : 0;
  updatePuzzleGridUI();
}

function updateEditToolUI() {
  toolBlackBtn.classList.toggle("toggle-active", state.editTool === "black");
  toolWhiteBtn.classList.toggle("toggle-active", state.editTool === "white");
  toolEraseBtn.classList.toggle("toggle-active", state.editTool === "erase");
  if (editToolStatus) {
    const text = state.editTool === "erase" ? "remove" : `add ${state.editTool}`;
    editToolStatus.textContent = `Tool: ${text}`;
  }
}

function setEditTool(tool) {
  state.editTool = tool;
  updateEditToolUI();
  drawSgfPreview(state.stones, state.boardSize);
}

function propertyForColor(color) {
  if (color === "black") return "AB";
  if (color === "white") return "AW";
  return "";
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function applyManualEdits(stones, n) {
  const map = new Map();
  for (const stone of stones) {
    map.set(`${stone.localRow},${stone.localCol}`, { ...stone });
  }

  for (const [key, color] of Object.entries(state.manualEdits)) {
    if (color === "empty") {
      map.delete(key);
      continue;
    }
  }

  return [...map.values()].sort((a, b) => a.row - b.row || a.col - b.col);
}

function getPreviewBoardPoint(event) {
  const n = state.boardSize;
  const rect = sgfPreviewCanvas.getBoundingClientRect();
  const px = ((event.clientX - rect.left) * sgfPreviewCanvas.width) / rect.width;
  const py = ((event.clientY - rect.top) * sgfPreviewCanvas.height) / rect.height;
  const size = Math.min(sgfPreviewCanvas.width, sgfPreviewCanvas.height);
  const margin = Math.round(size * 0.08);
  const boardArea = size - margin * 2;
  const step = boardArea / (n - 1);
  const offsetX = (sgfPreviewCanvas.width - size) / 2;
  const offsetY = (sgfPreviewCanvas.height - size) / 2;

  const lx = px - offsetX;
  const ly = py - offsetY;
  const col = Math.round((lx - margin) / step);
  const row = Math.round((ly - margin) / step);
  if (col < 0 || row < 0 || col >= n || row >= n) return null;

  const gx = margin + col * step;
  const gy = margin + row * step;
  const dist = Math.hypot(lx - gx, ly - gy);
  if (dist > step * 0.52) return null;
  return { row, col };
}

function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function prepareHiDPICanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width || canvas.clientWidth || 420));
  const cssH = Math.max(1, Math.round(rect.height || cssW));
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  const pixelW = Math.round(cssW * dpr);
  const pixelH = Math.round(cssH * dpr);

  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: cssW, height: cssH };
}

function drawWoodTexture(ctx, width, height) {
  const base = ctx.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#d6b382");
  base.addColorStop(0.5, "#caa06d");
  base.addColorStop(1, "#b98d5b");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  for (let i = 0; i < 42; i += 1) {
    const y = (i / 42) * height;
    const wobble = ((i * 97) % 11) - 5;
    ctx.strokeStyle = i % 2 ? "rgba(88,52,26,0.08)" : "rgba(255,234,193,0.06)";
    ctx.lineWidth = 1 + (i % 3) * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, y + wobble);
    ctx.bezierCurveTo(width * 0.25, y - wobble, width * 0.75, y + wobble, width, y - wobble);
    ctx.stroke();
  }

  for (let i = 0; i < 320; i += 1) {
    const x = (i * 73) % width;
    const y = (i * 97) % height;
    const a = i % 2 ? 0.04 : 0.025;
    ctx.fillStyle = `rgba(48, 27, 11, ${a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();
}

function normalizeRect(rect) {
  const x = Math.min(rect.x1, rect.x2);
  const y = Math.min(rect.y1, rect.y2);
  const width = Math.abs(rect.x2 - rect.x1);
  const height = Math.abs(rect.y2 - rect.y1);
  return { x, y, width, height };
}

function updateCropModeUI() {
  cropModeBtn.classList.toggle("toggle-active", state.cropMode);
}

function drawSgfPreview(stones = state.stones, n = state.boardSize) {
  const ctx = sgfPreviewCtx;
  const canvas = sgfPreviewCanvas;
  const vp = prepareHiDPICanvas(canvas, ctx);
  const size = Math.min(vp.width, vp.height);
  const margin = Math.round(size * 0.08);
  const boardArea = size - margin * 2;
  const step = boardArea / (n - 1);

  ctx.clearRect(0, 0, vp.width, vp.height);
  drawWoodTexture(ctx, vp.width, vp.height);

  ctx.save();
  ctx.translate((vp.width - size) / 2, (vp.height - size) / 2);

  ctx.strokeStyle = "rgba(26, 20, 14, 0.75)";
  ctx.lineWidth = 1;
  for (let i = 0; i < n; i += 1) {
    const pos = Math.round(margin + i * step) + 0.5;
    ctx.beginPath();
    ctx.moveTo(margin, pos);
    ctx.lineTo(Math.round(margin + boardArea) + 0.5, pos);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos, margin);
    ctx.lineTo(pos, Math.round(margin + boardArea) + 0.5);
    ctx.stroke();
  }

  const starMap = {
    19: [3, 9, 15],
    13: [3, 6, 9],
    9: [2, 4, 6],
  };
  const starPts = starMap[n] || [];
  ctx.fillStyle = "rgba(30, 21, 13, 0.76)";
  for (const r of starPts) {
    for (const c of starPts) {
      const x = margin + c * step;
      const y = margin + r * step;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(2, step * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const stoneRadius = Math.max(3, step * 0.44);
  const occupied = new Map();
  for (const stone of stones) {
    const x = margin + stone.col * step;
    const y = margin + stone.row * step;
    occupied.set(`${stone.row},${stone.col}`, stone.color);

    ctx.beginPath();
    ctx.arc(x, y, stoneRadius, 0, Math.PI * 2);
    if (stone.color === "black") {
      ctx.fillStyle = "#111";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (stone.color === "white") {
      ctx.fillStyle = "#f9f9f7";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.38)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (state.hoverPoint) {
    const hx = margin + state.hoverPoint.col * step;
    const hy = margin + state.hoverPoint.row * step;
    const key = `${state.hoverPoint.row},${state.hoverPoint.col}`;
    const hasStone = occupied.has(key);

    if (state.editTool === "erase" && hasStone) {
      const xSize = Math.max(5, stoneRadius * 0.65);
      ctx.strokeStyle = "rgba(189, 27, 27, 0.9)";
      ctx.lineWidth = Math.max(1.8, step * 0.08);
      ctx.beginPath();
      ctx.moveTo(hx - xSize, hy - xSize);
      ctx.lineTo(hx + xSize, hy + xSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx + xSize, hy - xSize);
      ctx.lineTo(hx - xSize, hy + xSize);
      ctx.stroke();
    } else if (state.editTool === "black" || state.editTool === "white") {
      ctx.beginPath();
      ctx.arc(hx, hy, stoneRadius, 0, Math.PI * 2);
      if (state.editTool === "black") {
        ctx.fillStyle = "rgba(17, 17, 17, 0.32)";
        ctx.strokeStyle = "rgba(255, 255, 255, 0.38)";
      } else {
        ctx.fillStyle = "rgba(255, 255, 255, 0.52)";
        ctx.strokeStyle = "rgba(40, 40, 40, 0.46)";
      }
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawSourceImage() {
  if (!state.image) return;

  clearCanvas(sourceCtx, sourceCanvas);

  const scale = Math.min(
    sourceCanvas.width / state.image.width,
    sourceCanvas.height / state.image.height
  );

  const drawW = state.image.width * scale;
  const drawH = state.image.height * scale;
  const offsetX = (sourceCanvas.width - drawW) / 2;
  const offsetY = (sourceCanvas.height - drawH) / 2;

  sourceCtx.drawImage(state.image, offsetX, offsetY, drawW, drawH);

  state.drawMeta = {
    scale,
    drawW,
    drawH,
    offsetX,
    offsetY,
  };

  drawCornerOverlay();
  drawCropOverlay();
}

function drawCornerOverlay() {
  if (!state.corners.length) return;

  sourceCtx.save();
  sourceCtx.lineWidth = 2;
  sourceCtx.strokeStyle = "#0e8f67";
  sourceCtx.fillStyle = "#0e8f67";

  state.corners.forEach((point, idx) => {
    sourceCtx.beginPath();
    sourceCtx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    sourceCtx.fill();

    sourceCtx.fillStyle = "#102f26";
    sourceCtx.font = "13px 'IBM Plex Mono', monospace";
    sourceCtx.fillText(String(idx + 1), point.x + 9, point.y - 8);
    sourceCtx.fillStyle = "#0e8f67";
  });

  if (state.corners.length === 4) {
    sourceCtx.beginPath();
    sourceCtx.moveTo(state.corners[0].x, state.corners[0].y);
    for (let i = 1; i < 4; i += 1) {
      sourceCtx.lineTo(state.corners[i].x, state.corners[i].y);
    }
    sourceCtx.closePath();
    sourceCtx.stroke();
  }

  sourceCtx.restore();
}

function drawCropOverlay() {
  if (!state.cropRect) return;
  const rect = normalizeRect(state.cropRect);
  if (rect.width < 2 || rect.height < 2) return;

  sourceCtx.save();
  sourceCtx.fillStyle = "rgba(31, 95, 74, 0.16)";
  sourceCtx.strokeStyle = "rgba(31, 95, 74, 0.88)";
  sourceCtx.lineWidth = 2;
  sourceCtx.fillRect(rect.x, rect.y, rect.width, rect.height);
  sourceCtx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  sourceCtx.restore();
}

function isPointInsideImage(x, y) {
  const m = state.drawMeta;
  if (!m) return false;
  return (
    x >= m.offsetX &&
    y >= m.offsetY &&
    x <= m.offsetX + m.drawW &&
    y <= m.offsetY + m.drawH
  );
}

function clampPointToImage(x, y) {
  const m = state.drawMeta;
  if (!m) return { x, y };
  return {
    x: Math.max(m.offsetX, Math.min(m.offsetX + m.drawW, x)),
    y: Math.max(m.offsetY, Math.min(m.offsetY + m.drawH, y)),
  };
}

function getCanvasPointFromEvent(event) {
  const rect = sourceCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * sourceCanvas.width) / rect.width;
  const y = ((event.clientY - rect.top) * sourceCanvas.height) / rect.height;
  return { x, y };
}

function orderedCorners(points) {
  const sumSorted = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const diffSorted = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));

  const tl = sumSorted[0];
  const br = sumSorted[3];
  const tr = diffSorted[0];
  const bl = diffSorted[3];

  return [tl, tr, br, bl];
}

function getWorkingCanvasCorners() {
  if (state.corners.length === 4) {
    return orderedCorners(state.corners);
  }

  const m = state.drawMeta;
  if (!m) return null;

  if (state.corners.length >= 2) {
    const xs = state.corners.map((p) => p.x);
    const ys = state.corners.map((p) => p.y);
    const minX = Math.max(m.offsetX, Math.min(...xs));
    const maxX = Math.min(m.offsetX + m.drawW, Math.max(...xs));
    const minY = Math.max(m.offsetY, Math.min(...ys));
    const maxY = Math.min(m.offsetY + m.drawH, Math.max(...ys));

    if (maxX - minX > 12 && maxY - minY > 12) {
      return orderedCorners([
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ]);
    }
  }

  return [
    { x: m.offsetX, y: m.offsetY },
    { x: m.offsetX + m.drawW, y: m.offsetY },
    { x: m.offsetX + m.drawW, y: m.offsetY + m.drawH },
    { x: m.offsetX, y: m.offsetY + m.drawH },
  ];
}

function canvasToOriginal(point) {
  const m = state.drawMeta;
  return {
    x: (point.x - m.offsetX) / m.scale,
    y: (point.y - m.offsetY) / m.scale,
  };
}

function originalToCanvas(point) {
  const m = state.drawMeta;
  return {
    x: point.x * m.scale + m.offsetX,
    y: point.y * m.scale + m.offsetY,
  };
}

function warpBoardFromCorners() {
  if (!state.image || !state.cvReady) {
    return false;
  }

  const canvasCorners = getWorkingCanvasCorners();
  if (!canvasCorners || canvasCorners.length !== 4) {
    return false;
  }

  state.activeCorners = canvasCorners;
  const src = cv.imread(state.image);
  const dst = new cv.Mat();

  const originalCorners = canvasCorners.map(canvasToOriginal);

  const srcTri = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    originalCorners.flatMap((p) => [p.x, p.y])
  );

  const targetSize = 760;
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    targetSize - 1,
    0,
    targetSize - 1,
    targetSize - 1,
    0,
    targetSize - 1,
  ]);

  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  cv.warpPerspective(
    src,
    dst,
    M,
    new cv.Size(targetSize, targetSize),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar()
  );

  warpCanvas.width = targetSize;
  warpCanvas.height = targetSize;
  cv.imshow(warpCanvas, dst);

  state.warpedImageData = warpCtx.getImageData(0, 0, warpCanvas.width, warpCanvas.height);

  src.delete();
  dst.delete();
  srcTri.delete();
  dstTri.delete();
  M.delete();

  return true;
}

function autoDetectCorners() {
  if (!state.cvReady || !state.image) {
    setStatus(cornerStatus, "OpenCV not ready or image not loaded.");
    return;
  }

  const src = cv.imread(state.image);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
  cv.Canny(blur, edges, 70, 210);
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  let bestContour = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i += 1) {
    const c = contours.get(i);
    const perimeter = cv.arcLength(c, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(c, approx, 0.02 * perimeter, true);

    if (approx.rows === 4) {
      const area = Math.abs(cv.contourArea(approx));
      if (area > bestArea) {
        if (bestContour) {
          bestContour.delete();
        }
        bestContour = approx;
        bestArea = area;
      } else {
        approx.delete();
      }
    } else {
      approx.delete();
    }

    c.delete();
  }

  if (!bestContour) {
    setStatus(cornerStatus, "Auto-detect failed. Click 4 corners manually.");
  } else {
    const points = [];
    for (let i = 0; i < 4; i += 1) {
      const x = bestContour.intPtr(i, 0)[0];
      const y = bestContour.intPtr(i, 0)[1];
      points.push(originalToCanvas({ x, y }));
    }

    state.corners = orderedCorners(points);
    drawSourceImage();

    setStatus(cornerStatus, "Detected 4 corners automatically. Review and adjust if needed.");
  }

  src.delete();
  gray.delete();
  blur.delete();
  edges.delete();
  contours.delete();
  hierarchy.delete();
  if (bestContour) bestContour.delete();
}

function drawWarpGrid(gridOverride = null) {
  if (!state.warpedImageData) return;

  const size = warpCanvas.width;
  const n = state.boardSize;
  const fullStep = (size - 1) / (n - 1);

  const usePuzzleGrid =
    !!gridOverride &&
    Number.isFinite(gridOverride.step) &&
    Number.isFinite(gridOverride.minX) &&
    Number.isFinite(gridOverride.minY);

  const cols = usePuzzleGrid ? gridOverride.visibleCols : n;
  const rows = usePuzzleGrid ? gridOverride.visibleRows : n;
  const step = usePuzzleGrid ? gridOverride.step : fullStep;
  const originX = usePuzzleGrid ? gridOverride.minX : 0;
  const originY = usePuzzleGrid ? gridOverride.minY : 0;

  warpCtx.save();
  warpCtx.strokeStyle = "rgba(24,24,24,0.65)";
  warpCtx.lineWidth = 1;

  for (let i = 0; i < cols; i += 1) {
    const x = originX + i * step;
    warpCtx.beginPath();
    warpCtx.moveTo(x, originY);
    warpCtx.lineTo(x, originY + (rows - 1) * step);
    warpCtx.stroke();
  }

  for (let i = 0; i < rows; i += 1) {
    const y = originY + i * step;
    warpCtx.beginPath();
    warpCtx.moveTo(originX, y);
    warpCtx.lineTo(originX + (cols - 1) * step, y);
    warpCtx.stroke();
  }

  warpCtx.restore();
}

function preprocessWarpImage() {
  if (!state.warpedImageData || state.preprocessMode === "off") return;

  const src = cv.imread(warpCanvas);
  const gray = new cv.Mat();
  const denoise = new cv.Mat();
  const local = new cv.Mat();
  const bhH = new cv.Mat();
  const bhV = new cv.Mat();
  const bh = new cv.Mat();
  const enhanced = new cv.Mat();
  const tuned = new cv.Mat();
  const out = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const isStrong = state.preprocessMode === "strong";

  // Preserve edges while removing compression/noise artifacts.
  cv.bilateralFilter(gray, denoise, isStrong ? 9 : 7, isStrong ? 75 : 55, isStrong ? 75 : 55, cv.BORDER_DEFAULT);

  // Local contrast is more stable than global equalization for mixed lighting.
  if (typeof cv.createCLAHE === "function") {
    const clahe = cv.createCLAHE(isStrong ? 3.2 : 2.2, new cv.Size(8, 8));
    clahe.apply(denoise, local);
    clahe.delete();
  } else {
    cv.equalizeHist(denoise, local);
  }

  // Boost dark board lines in both horizontal and vertical directions.
  const kLen = isStrong ? 13 : 9;
  const kernelH = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(kLen, 1));
  const kernelV = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, kLen));
  cv.morphologyEx(local, bhH, cv.MORPH_BLACKHAT, kernelH);
  cv.morphologyEx(local, bhV, cv.MORPH_BLACKHAT, kernelV);
  cv.addWeighted(bhH, 0.5, bhV, 0.5, 0, bh);

  // Subtract line map from luminance so grid lines appear cleaner/darker.
  cv.addWeighted(local, 1.0, bh, isStrong ? -1.05 : -0.78, 0, enhanced);

  // Light smoothing after enhancement to avoid crunchy artifacts.
  if (state.preprocessMode === "strong") {
    cv.GaussianBlur(enhanced, tuned, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.convertScaleAbs(tuned, tuned, 1.05, 1);
  } else {
    cv.GaussianBlur(enhanced, tuned, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    cv.convertScaleAbs(tuned, tuned, 1.02, 0);
  }
  cv.cvtColor(tuned, out, cv.COLOR_GRAY2RGBA);

  cv.imshow(warpCanvas, out);
  state.warpedImageData = warpCtx.getImageData(0, 0, warpCanvas.width, warpCanvas.height);

  kernelH.delete();
  kernelV.delete();
  src.delete();
  gray.delete();
  denoise.delete();
  local.delete();
  bhH.delete();
  bhV.delete();
  bh.delete();
  enhanced.delete();
  tuned.delete();
  out.delete();
}

function sampleCircleStats(imgData, cx, cy, rInner, rOuter = rInner) {
  const { data, width, height } = imgData;
  let sum = 0;
  let count = 0;

  const minX = Math.max(0, Math.floor(cx - rOuter));
  const maxX = Math.min(width - 1, Math.ceil(cx + rOuter));
  const minY = Math.max(0, Math.floor(cy - rOuter));
  const maxY = Math.min(height - 1, Math.ceil(cy + rOuter));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= rOuter && d >= rInner) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        sum += brightness;
        count += 1;
      }
    }
  }

  return count ? sum / count : 0;
}

function pointToSgfCoord(i, j, n) {
  const x = LETTERS[i];
  const y = LETTERS[j];
  return `${x}${y}`;
}

function classifyStone(delta, blackThreshold, whiteThreshold) {
  if (delta > blackThreshold) {
    return { color: "black", property: "AB" };
  }
  if (-delta > whiteThreshold) {
    return { color: "white", property: "AW" };
  }
  return { color: "empty", property: "" };
}

function estimateStoneRadius(imgData, cx, cy, step, color) {
  const centerMean = sampleCircleStats(imgData, cx, cy, 0, Math.max(2, step * 0.28));
  const bgMean = sampleCircleStats(imgData, cx, cy, step * 0.62, step * 0.82);
  const maxR = Math.max(3, Math.floor(step * 0.72));
  const threshold = Math.max(10, Math.abs(bgMean - centerMean) * 0.35);
  const { data, width, height } = imgData;

  let count = 0;
  const minX = Math.max(0, Math.floor(cx - maxR));
  const maxX = Math.min(width - 1, Math.ceil(cx + maxR));
  const minY = Math.max(0, Math.floor(cy - maxR));
  const maxY = Math.min(height - 1, Math.ceil(cy + maxR));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxR) continue;

      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;

      if (color === "black" && brightness < bgMean - threshold) {
        count += 1;
      } else if (color === "white" && brightness > bgMean + threshold) {
        count += 1;
      }
    }
  }

  if (!count) return 0;
  return Number(Math.sqrt(count / Math.PI).toFixed(2));
}

function detectCircleCandidates(step) {
  const src = cv.imread(warpCanvas);
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.medianBlur(gray, blur, 5);

  const all = [];
  const minDist = Math.max(8, step * 0.72);
  const minR = Math.max(3, Math.floor(step * 0.2));
  const maxR = Math.max(minR + 2, Math.floor(step * 0.74));
  const param1 = 110;

  for (const param2 of [12, 14, 16, 18, 20, 22, 24]) {
    const circles = new cv.Mat();
    cv.HoughCircles(
      blur,
      circles,
      cv.HOUGH_GRADIENT,
      1.2,
      minDist,
      param1,
      param2,
      minR,
      maxR
    );

    for (let i = 0; i < circles.cols; i += 1) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];
      all.push({ x, y, r });
    }
    circles.delete();
  }

  src.delete();
  gray.delete();
  blur.delete();

  const merged = [];
  for (const c of all) {
    const existing = merged.find((m) => Math.hypot(m.x - c.x, m.y - c.y) <= step * 0.3);
    if (!existing) {
      merged.push({ ...c });
      continue;
    }

    existing.x = (existing.x + c.x) / 2;
    existing.y = (existing.y + c.y) / 2;
    existing.r = (existing.r + c.r) / 2;
  }

  return merged;
}

function circlesToIntersections(circles, n, step) {
  const bestByPoint = new Map();

  for (const circle of circles) {
    const col = Math.round(circle.x / step);
    const row = Math.round(circle.y / step);
    if (col < 0 || row < 0 || col >= n || row >= n) continue;

    const gx = col * step;
    const gy = row * step;
    const dist = Math.hypot(circle.x - gx, circle.y - gy);
    if (dist > step * 0.43) continue;

    const key = `${row},${col}`;
    const prev = bestByPoint.get(key);
    if (!prev || dist < prev.dist) {
      bestByPoint.set(key, {
        row,
        col,
        x: gx,
        y: gy,
        dist,
        r: circle.r,
      });
    }
  }

  return [...bestByPoint.values()];
}

function estimatePuzzleGrid(circles, imageSize) {
  if (circles.length < 2) return null;

  const axisDists = [];
  for (let i = 0; i < circles.length; i += 1) {
    for (let j = i + 1; j < circles.length; j += 1) {
      const dx = Math.abs(circles[i].x - circles[j].x);
      const dy = Math.abs(circles[i].y - circles[j].y);
      const d = Math.hypot(dx, dy);
      if (d < 4 || d > imageSize * 0.35) continue;
      if (dy < dx * 0.45) axisDists.push(dx);
      if (dx < dy * 0.45) axisDists.push(dy);
    }
  }

  let step = median(axisDists.filter((d) => d > 4));
  if (!step) {
    const nn = [];
    for (let i = 0; i < circles.length; i += 1) {
      let best = Infinity;
      for (let j = 0; j < circles.length; j += 1) {
        if (i === j) continue;
        const d = Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y);
        if (d > 3 && d < best) best = d;
      }
      if (Number.isFinite(best)) nn.push(best);
    }
    step = median(nn);
  }

  if (!step || step < 6) return null;

  let minX = Math.min(...circles.map((c) => c.x));
  let maxX = Math.max(...circles.map((c) => c.x));
  let minY = Math.min(...circles.map((c) => c.y));
  let maxY = Math.max(...circles.map((c) => c.y));
  let visibleCols = Math.max(2, Math.round((maxX - minX) / step) + 1);
  let visibleRows = Math.max(2, Math.round((maxY - minY) / step) + 1);

  // Refine step/origin by snapping circles to coarse bins, then averaging each bin center.
  const xBins = new Map();
  const yBins = new Map();
  for (const c of circles) {
    const col = Math.round((c.x - minX) / step);
    const row = Math.round((c.y - minY) / step);
    if (!xBins.has(col)) xBins.set(col, []);
    if (!yBins.has(row)) yBins.set(row, []);
    xBins.get(col).push(c.x);
    yBins.get(row).push(c.y);
  }
  const xCenters = [...xBins.keys()]
    .sort((a, b) => a - b)
    .map((k) => median(xBins.get(k)));
  const yCenters = [...yBins.keys()]
    .sort((a, b) => a - b)
    .map((k) => median(yBins.get(k)));
  const xSteps = [];
  const ySteps = [];
  for (let i = 1; i < xCenters.length; i += 1) xSteps.push(xCenters[i] - xCenters[i - 1]);
  for (let i = 1; i < yCenters.length; i += 1) ySteps.push(yCenters[i] - yCenters[i - 1]);
  const refined = median([...xSteps, ...ySteps].filter((d) => d > 3));
  if (refined) step = refined;

  minX = xCenters.length ? xCenters[0] : minX;
  maxX = xCenters.length ? xCenters[xCenters.length - 1] : maxX;
  minY = yCenters.length ? yCenters[0] : minY;
  maxY = yCenters.length ? yCenters[yCenters.length - 1] : maxY;
  visibleCols = Math.max(2, xCenters.length || Math.round((maxX - minX) / step) + 1);
  visibleRows = Math.max(2, yCenters.length || Math.round((maxY - minY) / step) + 1);

  const bestByPoint = new Map();
  for (const circle of circles) {
    const col = Math.round((circle.x - minX) / step);
    const row = Math.round((circle.y - minY) / step);
    if (col < 0 || row < 0) continue;

    const gx = minX + col * step;
    const gy = minY + row * step;
    const dist = Math.hypot(circle.x - gx, circle.y - gy);
    if (dist > step * 0.45) continue;

    const key = `${row},${col}`;
    const prev = bestByPoint.get(key);
    if (!prev || dist < prev.dist) {
      bestByPoint.set(key, {
        row,
        col,
        x: gx,
        y: gy,
        dist,
        r: circle.r,
      });
    }
  }

  return {
    step,
    minX,
    minY,
    maxX,
    maxY,
    visibleCols,
    visibleRows,
    points: [...bestByPoint.values()],
  };
}

function getActiveWarpGridOverride() {
  if (!state.puzzleMode) return null;

  let g = state.detectedPuzzleGrid;
  if (!g && state.rawStones.length) {
    const xs = state.rawStones.map((s) => s.imgX).filter((v) => Number.isFinite(v));
    const ys = state.rawStones.map((s) => s.imgY).filter((v) => Number.isFinite(v));
    if (xs.length >= 2 && ys.length >= 2) {
      const xSorted = [...new Set(xs.map((v) => Math.round(v)))].sort((a, b) => a - b);
      const ySorted = [...new Set(ys.map((v) => Math.round(v)))].sort((a, b) => a - b);
      const dx = [];
      const dy = [];
      for (let i = 1; i < xSorted.length; i += 1) {
        const d = xSorted[i] - xSorted[i - 1];
        if (d > 3) dx.push(d);
      }
      for (let i = 1; i < ySorted.length; i += 1) {
        const d = ySorted[i] - ySorted[i - 1];
        if (d > 3) dy.push(d);
      }
      const step = median([...dx, ...dy]);
      if (step) {
        g = {
          minX: Math.min(...xs),
          minY: Math.min(...ys),
          maxX: Math.max(...xs),
          maxY: Math.max(...ys),
          step,
          visibleCols: Math.max(2, Math.round((Math.max(...xs) - Math.min(...xs)) / step) + 1),
          visibleRows: Math.max(2, Math.round((Math.max(...ys) - Math.min(...ys)) / step) + 1),
        };
      }
    }
  }

  if (!g) return null;
  const cols = state.puzzleVisibleCols > 0 ? state.puzzleVisibleCols : g.visibleCols;
  const rows = state.puzzleVisibleRows > 0 ? state.puzzleVisibleRows : g.visibleRows;
  return {
    ...g,
    visibleCols: cols,
    visibleRows: rows,
  };
}

function renderWarpAndStoneMarkers(stones, step) {
  if (!state.warpedImageData) return;
  warpCtx.putImageData(state.warpedImageData, 0, 0);
  drawWarpGrid(getActiveWarpGridOverride());

  warpCtx.save();
  stones.forEach((stone) => {
    const x = Number.isFinite(stone.imgX) ? stone.imgX : (stone.imgCol ?? stone.col) * step;
    const y = Number.isFinite(stone.imgY) ? stone.imgY : (stone.imgRow ?? stone.row) * step;
    warpCtx.beginPath();
    warpCtx.arc(x, y, Math.max(3, step * 0.16), 0, Math.PI * 2);
    warpCtx.fillStyle = stone.color === "black" ? "rgba(13,13,13,0.78)" : "rgba(255,255,255,0.9)";
    warpCtx.fill();
    warpCtx.strokeStyle = "rgba(20,20,20,0.75)";
    warpCtx.lineWidth = 1;
    warpCtx.stroke();
  });
  warpCtx.restore();
}

function renderStoneTable(stones) {
  void stones;
}

function resolveAutoAnchor() {
  const m = state.drawMeta;
  const corners = state.activeCorners;
  if (!m || !corners || corners.length !== 4) return "center";

  const cx = corners.reduce((acc, p) => acc + p.x, 0) / 4;
  const cy = corners.reduce((acc, p) => acc + p.y, 0) / 4;
  const midX = m.offsetX + m.drawW / 2;
  const midY = m.offsetY + m.drawH / 2;
  const nx = (cx - midX) / m.drawW;
  const ny = (cy - midY) / m.drawH;

  if (Math.abs(nx) < 0.1 && Math.abs(ny) < 0.1) return "center";
  if (nx <= 0 && ny <= 0) return "tl";
  if (nx > 0 && ny <= 0) return "tr";
  if (nx <= 0 && ny > 0) return "bl";
  return "br";
}

function remapStonesToAnchor(stones, n, anchorMode) {
  if (!stones.length) return [];
  const ctx = getMappingContext(stones, n, anchorMode);
  return remapStonesWithContext(stones, n, ctx);
}

function getMappingContext(stones, n, anchorMode) {
  const anchor = anchorMode === "auto" ? resolveAutoAnchor() : anchorMode;
  const cols = stones.map((s) => s.imgCol ?? s.col);
  const rows = stones.map((s) => s.imgRow ?? s.row);
  let minCol = Math.min(...cols);
  let maxCol = Math.max(...cols);
  let minRow = Math.min(...rows);
  let maxRow = Math.max(...rows);
  let spanCol = Math.max(1, maxCol - minCol + 1);
  let spanRow = Math.max(1, maxRow - minRow + 1);

  if (state.puzzleMode && state.puzzleVisibleCols > 0 && state.puzzleVisibleRows > 0) {
    minCol = 0;
    minRow = 0;
    spanCol = state.puzzleVisibleCols;
    spanRow = state.puzzleVisibleRows;
  }

  const rot = ((state.rotation % 4) + 4) % 4;
  const rotatedSpanCol = rot % 2 === 0 ? spanCol : spanRow;
  const rotatedSpanRow = rot % 2 === 0 ? spanRow : spanCol;

  let offsetCol = 0;
  let offsetRow = 0;
  if (anchor === "tr" || anchor === "br") offsetCol = Math.max(0, n - rotatedSpanCol);
  if (anchor === "bl" || anchor === "br") offsetRow = Math.max(0, n - rotatedSpanRow);
  if (anchor === "center") {
    offsetCol = Math.max(0, Math.floor((n - rotatedSpanCol) / 2));
    offsetRow = Math.max(0, Math.floor((n - rotatedSpanRow) / 2));
  }

  return {
    n,
    rot,
    minCol,
    minRow,
    spanCol,
    spanRow,
    rotatedSpanCol,
    rotatedSpanRow,
    offsetCol,
    offsetRow,
    shiftX: state.shiftX,
    shiftY: state.shiftY,
  };
}

function mapLocalToBoard(localCol, localRow, ctx) {
  let rotatedCol = localCol;
  let rotatedRow = localRow;
  if (ctx.rot === 1) {
    rotatedCol = ctx.spanRow - 1 - localRow;
    rotatedRow = localCol;
  } else if (ctx.rot === 2) {
    rotatedCol = ctx.spanCol - 1 - localCol;
    rotatedRow = ctx.spanRow - 1 - localRow;
  } else if (ctx.rot === 3) {
    rotatedCol = localRow;
    rotatedRow = ctx.spanCol - 1 - localCol;
  }
  const col = Math.max(0, Math.min(ctx.n - 1, ctx.offsetCol + rotatedCol + ctx.shiftX));
  const row = Math.max(0, Math.min(ctx.n - 1, ctx.offsetRow + rotatedRow + ctx.shiftY));
  return { col, row };
}

function mapBoardToLocal(col, row, ctx) {
  const rotatedCol = col - ctx.offsetCol - ctx.shiftX;
  const rotatedRow = row - ctx.offsetRow - ctx.shiftY;
  if (
    rotatedCol < 0 ||
    rotatedRow < 0 ||
    rotatedCol > ctx.rotatedSpanCol - 1 ||
    rotatedRow > ctx.rotatedSpanRow - 1
  ) {
    return null;
  }

  let localCol = rotatedCol;
  let localRow = rotatedRow;
  if (ctx.rot === 1) {
    localCol = rotatedRow;
    localRow = ctx.spanRow - 1 - rotatedCol;
  } else if (ctx.rot === 2) {
    localCol = ctx.spanCol - 1 - rotatedCol;
    localRow = ctx.spanRow - 1 - rotatedRow;
  } else if (ctx.rot === 3) {
    localCol = ctx.spanCol - 1 - rotatedRow;
    localRow = rotatedCol;
  }

  if (localCol < 0 || localRow < 0 || localCol > ctx.spanCol - 1 || localRow > ctx.spanRow - 1) {
    return null;
  }
  return { col: localCol, row: localRow };
}

function remapStonesWithContext(stones, n, ctx) {
  return stones.map((stone) => {
    const imgCol = stone.imgCol ?? stone.col;
    const imgRow = stone.imgRow ?? stone.row;
    const localCol = imgCol - ctx.minCol;
    const localRow = imgRow - ctx.minRow;
    const board = mapLocalToBoard(localCol, localRow, ctx);
    return {
      ...stone,
      imgCol,
      imgRow,
      localCol,
      localRow,
      col: board.col,
      row: board.row,
      coord: pointToSgfCoord(board.col, board.row, n),
    };
  });
}

function applyPositionMapping() {
  if (!state.warpedImageData) {
    setStatus(extractStatus, "Run extraction first.");
    return;
  }

  const n = state.boardSize;
  const size = warpCanvas.width;
  const step = (size - 1) / (n - 1);
  const ctx = getMappingContext(state.rawStones, n, boardAnchorSelect.value);
  state.mappingContext = ctx;
  const mapped = remapStonesWithContext(state.rawStones, n, ctx);
  const edited = applyManualEdits(mapped, n);

  // Apply local-space manual overrides on top of mapped base stones.
  const editedMap = new Map(edited.map((s) => [`${s.localRow},${s.localCol}`, s]));
  for (const [key, color] of Object.entries(state.manualEdits)) {
    const [localRowStr, localColStr] = key.split(",");
    const localRow = Number(localRowStr);
    const localCol = Number(localColStr);
    if (!Number.isFinite(localRow) || !Number.isFinite(localCol)) continue;
    if (color === "empty") {
      editedMap.delete(key);
      continue;
    }
    const board = mapLocalToBoard(localCol, localRow, ctx);
    editedMap.set(key, {
      property: propertyForColor(color),
      color,
      imgCol: localCol + ctx.minCol,
      imgRow: localRow + ctx.minRow,
      localCol,
      localRow,
      col: board.col,
      row: board.row,
      coord: pointToSgfCoord(board.col, board.row, n),
      delta: 0,
      radius: 0,
    });
  }

  const mergedEdited = [...editedMap.values()].sort((a, b) => a.row - b.row || a.col - b.col);
  state.stones = mergedEdited;
  renderWarpAndStoneMarkers(state.rawStones, step);
  renderStoneTable(mergedEdited);
  drawSgfPreview(mergedEdited, n);

  const blackCount = mergedEdited.filter((s) => s.color === "black").length;
  const whiteCount = mergedEdited.filter((s) => s.color === "white").length;
  const anchorResolved = boardAnchorSelect.value === "auto" ? resolveAutoAnchor() : boardAnchorSelect.value;
  updateShiftLabel();
  setStatus(
    extractStatus,
    `Showing ${mergedEdited.length} stones (${blackCount} black, ${whiteCount} white), anchor=${anchorResolved}, shift=(${state.shiftX},${state.shiftY}), rot=${state.rotation * 90}deg.`
  );
}

function extractStones() {
  const warped = warpBoardFromCorners();
  if (!warped || !state.warpedImageData) {
    setStatus(extractStatus, "Need image + OpenCV ready before extraction.");
    return;
  }

  const n = state.boardSize;
  const size = warpCanvas.width;
  const boardStep = (size - 1) / (n - 1);
  preprocessWarpImage();
  const circleCandidates = detectCircleCandidates(boardStep);
  let points = circlesToIntersections(circleCandidates, n, boardStep);
  let samplingStep = boardStep;
  let puzzleInfo = null;

  if (state.puzzleMode) {
    const grid = estimatePuzzleGrid(circleCandidates, size);
    if (grid && grid.points.length) {
      points = grid.points;
      samplingStep = grid.step;
      puzzleInfo = grid;
      state.detectedPuzzleGrid = grid;
      setPuzzleVisibleGrid(grid.visibleCols, grid.visibleRows);
    } else if (!state.puzzleVisibleCols || !state.puzzleVisibleRows) {
      state.detectedPuzzleGrid = null;
      setPuzzleVisibleGrid(0, 0);
    }
  } else {
    state.detectedPuzzleGrid = null;
  }

  if (!points.length) {
    state.manualEdits = {};
    state.rawStones = [];
    state.stones = [];
    state.detectedPuzzleGrid = null;
    renderWarpAndStoneMarkers([], boardStep);
    renderStoneTable([]);
    drawSgfPreview([], n);
    setStatus(extractStatus, "No circles detected on intersections. Try crop, corner box, or different image.");
    return;
  }

  const blackThreshold = DEFAULT_BLACK_THRESHOLD;
  const whiteThreshold = DEFAULT_WHITE_THRESHOLD;
  const rCenter = Math.max(2, samplingStep * 0.34);
  const rRingInner = samplingStep * 0.48;
  const rRingOuter = samplingStep * 0.72;

  const stones = [];
  for (const point of points) {
    const centerMean = sampleCircleStats(state.warpedImageData, point.x, point.y, 0, rCenter);
    const ringMean = sampleCircleStats(state.warpedImageData, point.x, point.y, rRingInner, rRingOuter);
    const delta = Number((ringMean - centerMean).toFixed(2));
    const result = classifyStone(delta, blackThreshold, whiteThreshold);
    if (result.color === "empty") continue;
    const radius = point.r || estimateStoneRadius(state.warpedImageData, point.x, point.y, samplingStep, result.color);

    stones.push({
      property: result.property,
      color: result.color,
      imgCol: point.col,
      imgRow: point.row,
      imgX: point.x,
      imgY: point.y,
      col: point.col,
      row: point.row,
      coord: pointToSgfCoord(point.col, point.row, n),
      delta,
      radius: Number(radius.toFixed(2)),
    });
  }

  state.manualEdits = {};
  if (!state.puzzleMode) {
    setPuzzleVisibleGrid(0, 0);
  }
  state.rawStones = stones;
  if (stones.length) {
    applyPositionMapping();
  } else {
    state.stones = [];
    renderWarpAndStoneMarkers([], boardStep);
    renderStoneTable([]);
    drawSgfPreview([], n);
    setStatus(extractStatus, "Circles were found, but none passed black/white classification thresholds.");
  }

  const blackCount = stones.filter((s) => s.color === "black").length;
  const whiteCount = stones.filter((s) => s.color === "white").length;
  const puzzleText =
    state.puzzleMode && puzzleInfo
      ? ` Puzzle grid estimate: ~${puzzleInfo.visibleCols}x${puzzleInfo.visibleRows} visible intersections.`
      : "";
  setStatus(
    sgfStatus,
    `Circle scan found ${circleCandidates.length} circle candidates, ${points.length} on-grid hits, ${stones.length} classified stones (${blackCount} black, ${whiteCount} white). Cleanup=${state.preprocessMode}.${puzzleText}`
  );
}

function generateSgf() {
  const n = state.boardSize;
  const blackCoords = state.stones.filter((s) => s.color === "black").map((s) => s.coord);
  const whiteCoords = state.stones.filter((s) => s.color === "white").map((s) => s.coord);

  const gameName = (gameNameInput.value || "Imported position").replace(/]/g, "");
  const komi = (komiInput.value || "6.5").replace(/]/g, "");

  let sgf = `(;GM[1]FF[4]CA[UTF-8]AP[Image-to-SGF:1.0]SZ[${n}]GN[${gameName}]KM[${komi}]`;
  if (blackCoords.length) {
    sgf += `\nAB${blackCoords.map((c) => `[${c}]`).join("")}`;
  }
  if (whiteCoords.length) {
    sgf += `\nAW${whiteCoords.map((c) => `[${c}]`).join("")}`;
  }
  sgf += ")";

  sgfOutput.value = sgf;
  drawSgfPreview(state.stones, n);
  setStatus(
    sgfStatus,
    `SGF generated with ${blackCoords.length} black and ${whiteCoords.length} white setup stones.`
  );
}

function downloadSgf() {
  if (!sgfOutput.value.trim()) {
    setStatus(sgfStatus, "Generate SGF before download.");
    return;
  }

  const blob = new Blob([sgfOutput.value], { type: "application/x-go-sgf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "position.sgf";
  a.click();
  URL.revokeObjectURL(url);
}

function applyCropToImage() {
  if (!state.image || !state.cropRect || !state.drawMeta) {
    setStatus(cornerStatus, "Draw a crop rectangle first.");
    return;
  }

  const rect = normalizeRect(state.cropRect);
  if (rect.width < 8 || rect.height < 8) {
    setStatus(cornerStatus, "Crop area is too small.");
    return;
  }

  const topLeft = canvasToOriginal({ x: rect.x, y: rect.y });
  const bottomRight = canvasToOriginal({ x: rect.x + rect.width, y: rect.y + rect.height });
  const sx = Math.max(0, Math.floor(topLeft.x));
  const sy = Math.max(0, Math.floor(topLeft.y));
  const sw = Math.max(2, Math.floor(bottomRight.x - topLeft.x));
  const sh = Math.max(2, Math.floor(bottomRight.y - topLeft.y));

  const temp = document.createElement("canvas");
  temp.width = sw;
  temp.height = sh;
  const tctx = temp.getContext("2d");
  tctx.drawImage(state.image, sx, sy, sw, sh, 0, 0, sw, sh);

  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.imageLoaded = true;
    resetStateForNewImage();
    drawSourceImage();
    state.cropMode = false;
    updateCropModeUI();
    setStatus(cornerStatus, "Crop applied. Select corners or run auto-detect.");
  };
  img.src = temp.toDataURL("image/png");
}

function resetStateForNewImage() {
  state.corners = [];
  state.activeCorners = [];
  state.cropMode = false;
  state.cropRect = null;
  state.cropDragStart = null;
  state.isCropping = false;
  state.shiftX = 0;
  state.shiftY = 0;
  state.rotation = 0;
  state.manualEdits = {};
  state.hoverPoint = null;
  state.puzzleVisibleCols = 0;
  state.puzzleVisibleRows = 0;
  state.detectedPuzzleGrid = null;
  state.mappingContext = null;
  state.rawStones = [];
  state.stones = [];
  state.warpedImageData = null;

  clearCanvas(warpCtx, warpCanvas);
  drawSgfPreview([], state.boardSize);
  sgfOutput.value = "";
  setStatus(extractStatus, "Set corners (4 for full board, 2 for zoomed box), then extract stones.");
  setStatus(sgfStatus, "No SGF generated yet.");
  updateCropModeUI();
  updateShiftLabel();
  updateEditToolUI();
  updatePuzzleGridUI();
}

function loadImageFromBlob(blob, sourceLabel) {
  if (!blob || !blob.type.startsWith("image/")) {
    setStatus(cornerStatus, "Clipboard/file content is not an image.");
    return;
  }

  const imageUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(imageUrl);
    state.image = img;
    state.imageLoaded = true;
    resetStateForNewImage();
    drawSourceImage();
    setStatus(cornerStatus, `${sourceLabel} image loaded. Select corners or run auto-detect.`);
  };
  img.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    setStatus(cornerStatus, "Could not read image data.");
  };

  img.src = imageUrl;
}

imageInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  loadImageFromBlob(file, "Uploaded");
});

pasteZone.addEventListener("focus", () => {
  if (pasteZone.textContent.trim() === "Paste image here (Ctrl+V / Cmd+V)") {
    pasteZone.textContent = "";
  }
});

pasteZone.addEventListener("blur", () => {
  if (!pasteZone.textContent.trim()) {
    pasteZone.textContent = "Paste image here (Ctrl+V / Cmd+V)";
  }
});

pasteZone.addEventListener("paste", (event) => {
  const items = event.clipboardData?.items || [];
  const imageItem = [...items].find((item) => item.type.startsWith("image/"));
  if (!imageItem) {
    setStatus(cornerStatus, "Clipboard has no image. Copy an image first, then paste.");
    return;
  }

  event.preventDefault();
  const blob = imageItem.getAsFile();
  loadImageFromBlob(blob, "Pasted");
  pasteZone.textContent = "Paste image here (Ctrl+V / Cmd+V)";
});

boardSizeSelect.addEventListener("change", () => {
  state.boardSize = Number(boardSizeSelect.value);
  puzzleColsInput.max = String(state.boardSize);
  puzzleRowsInput.max = String(state.boardSize);
  if (state.puzzleVisibleCols || state.puzzleVisibleRows) {
    setPuzzleVisibleGrid(state.puzzleVisibleCols, state.puzzleVisibleRows);
  }
  setStatus(extractStatus, `Board size set to ${state.boardSize}x${state.boardSize}. Re-extract after changes.`);
});

puzzleModeSelect.addEventListener("change", () => {
  state.puzzleMode = puzzleModeSelect.value === "on";
  const modeText = state.puzzleMode ? "ON (partial-board grid estimate enabled)" : "OFF";
  if (!state.puzzleMode) {
    setPuzzleVisibleGrid(0, 0);
  }
  setStatus(extractStatus, `Puzzle mode ${modeText}. Re-extract to apply.`);
});

preprocessModeSelect.addEventListener("change", () => {
  state.preprocessMode = preprocessModeSelect.value;
  setStatus(extractStatus, `Line cleanup set to ${state.preprocessMode}. Re-extract to apply.`);
});

puzzleColsInput.addEventListener("change", () => {
  const cols = Number(puzzleColsInput.value);
  setPuzzleVisibleGrid(cols, state.puzzleVisibleRows || Number(puzzleRowsInput.value));
  if (state.puzzleMode && state.rawStones.length) applyPositionMapping();
});

puzzleRowsInput.addEventListener("change", () => {
  const rows = Number(puzzleRowsInput.value);
  setPuzzleVisibleGrid(state.puzzleVisibleCols || Number(puzzleColsInput.value), rows);
  if (state.puzzleMode && state.rawStones.length) applyPositionMapping();
});

sourceCanvas.addEventListener("click", (event) => {
  if (!state.imageLoaded) return;
  if (state.cropMode) {
    setStatus(cornerStatus, "Crop mode is enabled. Drag on the image, then apply crop.");
    return;
  }

  const { x, y } = getCanvasPointFromEvent(event);

  if (!isPointInsideImage(x, y)) {
    setStatus(cornerStatus, "Click inside the image area.");
    return;
  }

  if (state.corners.length === 4) {
    state.corners = [];
  }

  state.corners.push({ x, y });
  drawSourceImage();

  if (state.corners.length < 4) {
    setStatus(cornerStatus, `Corner ${state.corners.length} captured. You can continue to 4, or extract now in zoomed/boxed mode.`);
  } else {
    state.corners = orderedCorners(state.corners);
    drawSourceImage();
    setStatus(cornerStatus, "4 corners set. Proceed to extract stones.");
  }
});

sourceCanvas.addEventListener("mousedown", (event) => {
  if (!state.imageLoaded || !state.cropMode) return;
  const point = getCanvasPointFromEvent(event);
  if (!isPointInsideImage(point.x, point.y)) return;
  const clamped = clampPointToImage(point.x, point.y);
  state.cropDragStart = clamped;
  state.cropRect = { x1: clamped.x, y1: clamped.y, x2: clamped.x, y2: clamped.y };
  state.isCropping = true;
  drawSourceImage();
});

sourceCanvas.addEventListener("mousemove", (event) => {
  if (!state.imageLoaded || !state.cropMode || !state.isCropping || !state.cropDragStart) return;
  const point = getCanvasPointFromEvent(event);
  const clamped = clampPointToImage(point.x, point.y);
  state.cropRect = {
    x1: state.cropDragStart.x,
    y1: state.cropDragStart.y,
    x2: clamped.x,
    y2: clamped.y,
  };
  drawSourceImage();
});

sourceCanvas.addEventListener("mouseup", () => {
  if (!state.cropMode) return;
  state.isCropping = false;
});

sourceCanvas.addEventListener("mouseleave", () => {
  if (!state.cropMode) return;
  state.isCropping = false;
});

autoCornersBtn.addEventListener("click", () => {
  autoDetectCorners();
});

resetCornersBtn.addEventListener("click", () => {
  state.corners = [];
  state.activeCorners = [];
  state.shiftX = 0;
  state.shiftY = 0;
  state.rotation = 0;
  state.manualEdits = {};
  state.hoverPoint = null;
  state.puzzleVisibleCols = 0;
  state.puzzleVisibleRows = 0;
  state.detectedPuzzleGrid = null;
  state.mappingContext = null;
  state.rawStones = [];
  state.stones = [];
  state.warpedImageData = null;
  drawSourceImage();
  clearCanvas(warpCtx, warpCanvas);
  setStatus(cornerStatus, "Corners reset.");
  setStatus(extractStatus, "Set corners (4 for full board, 2 for zoomed box), then extract stones.");
  updateShiftLabel();
  updatePuzzleGridUI();
});

cropModeBtn.addEventListener("click", () => {
  if (!state.imageLoaded) {
    setStatus(cornerStatus, "Upload or paste an image first.");
    return;
  }
  state.cropMode = !state.cropMode;
  if (!state.cropMode) {
    state.cropRect = null;
    state.cropDragStart = null;
    state.isCropping = false;
    drawSourceImage();
  }
  updateCropModeUI();
  setStatus(
    cornerStatus,
    state.cropMode
      ? "Crop mode enabled. Drag on image, then click Apply crop."
      : "Crop mode disabled."
  );
});

applyCropBtn.addEventListener("click", () => {
  applyCropToImage();
});

cancelCropBtn.addEventListener("click", () => {
  state.cropRect = null;
  state.cropDragStart = null;
  state.isCropping = false;
  drawSourceImage();
  setStatus(cornerStatus, "Crop selection cleared.");
});

extractBtn.addEventListener("click", extractStones);
boardAnchorSelect.addEventListener("change", applyPositionMapping);
toolBlackBtn.addEventListener("click", () => setEditTool("black"));
toolWhiteBtn.addEventListener("click", () => setEditTool("white"));
toolEraseBtn.addEventListener("click", () => setEditTool("erase"));
sgfPreviewCanvas.addEventListener("click", (event) => {
  if (!state.warpedImageData || !state.mappingContext) return;
  const point = getPreviewBoardPoint(event);
  if (!point) return;

  const local = mapBoardToLocal(point.col, point.row, state.mappingContext);
  if (!local) return;
  const key = `${local.row},${local.col}`;
  if (state.editTool === "erase") {
    state.manualEdits[key] = "empty";
  } else {
    state.manualEdits[key] = state.editTool;
  }
  applyPositionMapping();
});
sgfPreviewCanvas.addEventListener("mousemove", (event) => {
  if (!state.warpedImageData) return;
  state.hoverPoint = getPreviewBoardPoint(event);
  drawSgfPreview(state.stones, state.boardSize);
});
sgfPreviewCanvas.addEventListener("mouseleave", () => {
  state.hoverPoint = null;
  drawSgfPreview(state.stones, state.boardSize);
});
shiftUpBtn.addEventListener("click", () => {
  state.shiftY -= 1;
  applyPositionMapping();
});
shiftDownBtn.addEventListener("click", () => {
  state.shiftY += 1;
  applyPositionMapping();
});
shiftLeftBtn.addEventListener("click", () => {
  state.shiftX -= 1;
  applyPositionMapping();
});
shiftRightBtn.addEventListener("click", () => {
  state.shiftX += 1;
  applyPositionMapping();
});
rotateBtn.addEventListener("click", () => {
  state.rotation = (state.rotation + 1) % 4;
  applyPositionMapping();
});
generateBtn.addEventListener("click", generateSgf);
downloadBtn.addEventListener("click", downloadSgf);

function waitForCv() {
  if (window.cv && typeof window.cv.Mat === "function") {
    state.cvReady = true;
    setStatus(cornerStatus, "OpenCV ready. Upload an image.");
  } else {
    setTimeout(waitForCv, 150);
  }
}

waitForCv();
drawSgfPreview([], state.boardSize);
updateCropModeUI();
updateShiftLabel();
updateEditToolUI();
puzzleColsInput.max = String(state.boardSize);
puzzleRowsInput.max = String(state.boardSize);
updatePuzzleGridUI();
