const state = {
  image: null,
  imageLoaded: false,
  boardSize: 19,
  corners: [],
  cvReady: false,
  warpedImageData: null,
  stones: [],
};

const sourceCanvas = document.getElementById("sourceCanvas");
const sourceCtx = sourceCanvas.getContext("2d");
const warpCanvas = document.getElementById("warpCanvas");
const warpCtx = warpCanvas.getContext("2d");

const imageInput = document.getElementById("imageInput");
const boardSizeSelect = document.getElementById("boardSizeSelect");
const autoCornersBtn = document.getElementById("autoCornersBtn");
const resetCornersBtn = document.getElementById("resetCornersBtn");
const extractBtn = document.getElementById("extractBtn");
const generateBtn = document.getElementById("generateBtn");
const downloadBtn = document.getElementById("downloadBtn");

const blackThresholdInput = document.getElementById("blackThreshold");
const whiteThresholdInput = document.getElementById("whiteThreshold");

const cornerStatus = document.getElementById("cornerStatus");
const extractStatus = document.getElementById("extractStatus");
const sgfStatus = document.getElementById("sgfStatus");
const stoneTableBody = document.getElementById("stoneTableBody");
const sgfOutput = document.getElementById("sgfOutput");
const gameNameInput = document.getElementById("gameName");
const komiInput = document.getElementById("komiInput");

const LETTERS = "abcdefghijklmnopqrstuvwxyz";

function setStatus(el, message) {
  el.textContent = message;
}

function clearCanvas(ctx, canvas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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

function orderedCorners(points) {
  const sumSorted = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const diffSorted = [...points].sort((a, b) => a.y - a.x - (b.y - b.x));

  const tl = sumSorted[0];
  const br = sumSorted[3];
  const tr = diffSorted[0];
  const bl = diffSorted[3];

  return [tl, tr, br, bl];
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
  if (!state.image || state.corners.length !== 4 || !state.cvReady) {
    return false;
  }

  const src = cv.imread(state.image);
  const dst = new cv.Mat();

  const canvasCorners = orderedCorners(state.corners);
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

function drawWarpGrid() {
  if (!state.warpedImageData) return;

  const n = state.boardSize;
  const size = warpCanvas.width;
  const step = (size - 1) / (n - 1);

  warpCtx.save();
  warpCtx.strokeStyle = "rgba(24,24,24,0.65)";
  warpCtx.lineWidth = 1;

  for (let i = 0; i < n; i += 1) {
    const x = i * step;
    warpCtx.beginPath();
    warpCtx.moveTo(x, 0);
    warpCtx.lineTo(x, size);
    warpCtx.stroke();

    const y = i * step;
    warpCtx.beginPath();
    warpCtx.moveTo(0, y);
    warpCtx.lineTo(size, y);
    warpCtx.stroke();
  }

  warpCtx.restore();
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
  const y = LETTERS[n - 1 - j];
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

function extractStones() {
  const warped = warpBoardFromCorners();
  if (!warped || !state.warpedImageData) {
    setStatus(extractStatus, "Need image + 4 corners + OpenCV ready before extraction.");
    return;
  }

  const n = state.boardSize;
  const size = warpCanvas.width;
  const step = (size - 1) / (n - 1);
  const rCenter = Math.max(2, step * 0.32);
  const rRingInner = step * 0.42;
  const rRingOuter = step * 0.66;

  const points = [];

  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      const x = col * step;
      const y = row * step;

      const centerMean = sampleCircleStats(state.warpedImageData, x, y, 0, rCenter);
      const ringMean = sampleCircleStats(state.warpedImageData, x, y, rRingInner, rRingOuter);
      const delta = ringMean - centerMean;

      points.push({
        x,
        y,
        row,
        col,
        coord: pointToSgfCoord(col, row, n),
        delta: Number(delta.toFixed(2)),
      });
    }
  }

  let bestBlackThreshold = 10;
  let bestWhiteThreshold = 10;
  let bestCount = -1;
  let bestBlackCount = 0;
  let bestWhiteCount = 0;

  for (let blackThreshold = 10; blackThreshold <= 90; blackThreshold += 1) {
    for (let whiteThreshold = 10; whiteThreshold <= 90; whiteThreshold += 1) {
      let stoneCount = 0;
      let blackCount = 0;
      let whiteCount = 0;

      for (const point of points) {
        const result = classifyStone(point.delta, blackThreshold, whiteThreshold);
        if (result.color !== "empty") {
          stoneCount += 1;
          if (result.color === "black") blackCount += 1;
          if (result.color === "white") whiteCount += 1;
        }
      }

      if (stoneCount > bestCount) {
        bestCount = stoneCount;
        bestBlackThreshold = blackThreshold;
        bestWhiteThreshold = whiteThreshold;
        bestBlackCount = blackCount;
        bestWhiteCount = whiteCount;
      }
    }
  }

  const stones = [];
  const markers = [];
  for (const point of points) {
    const result = classifyStone(point.delta, bestBlackThreshold, bestWhiteThreshold);
    if (result.color === "empty") continue;

    stones.push({
      coord: point.coord,
      property: result.property,
      color: result.color,
      col: point.col,
      row: point.row,
      delta: point.delta,
    });
    markers.push({ x: point.x, y: point.y, color: result.color });
  }

  blackThresholdInput.value = String(bestBlackThreshold);
  whiteThresholdInput.value = String(bestWhiteThreshold);
  state.stones = stones;

  warpCtx.putImageData(state.warpedImageData, 0, 0);
  drawWarpGrid();

  warpCtx.save();
  markers.forEach((m) => {
    warpCtx.beginPath();
    warpCtx.arc(m.x, m.y, Math.max(3, step * 0.16), 0, Math.PI * 2);
    warpCtx.fillStyle = m.color === "black" ? "rgba(13,13,13,0.78)" : "rgba(255,255,255,0.9)";
    warpCtx.fill();
    warpCtx.strokeStyle = "rgba(20,20,20,0.75)";
    warpCtx.lineWidth = 1;
    warpCtx.stroke();
  });
  warpCtx.restore();

  stoneTableBody.innerHTML = "";
  stones.forEach((stone) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${stone.coord}</td><td>${stone.property}[${stone.coord}]</td><td>${stone.color}</td>`;
    stoneTableBody.appendChild(tr);
  });

  setStatus(
    extractStatus,
    `Scanned all threshold pairs (10..90). Best hit: ${stones.length} stones (${bestBlackCount} black, ${bestWhiteCount} white) using black=${bestBlackThreshold}, white=${bestWhiteThreshold}.`
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

imageInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.imageLoaded = true;
    state.corners = [];
    state.stones = [];
    state.warpedImageData = null;

    drawSourceImage();
    clearCanvas(warpCtx, warpCanvas);
    stoneTableBody.innerHTML = "";

    setStatus(cornerStatus, "Image loaded. Select corners or run auto-detect.");
    setStatus(extractStatus, "Set 4 corners, then extract stones.");
    setStatus(sgfStatus, "No SGF generated yet.");
    sgfOutput.value = "";
  };

  img.src = URL.createObjectURL(file);
});

boardSizeSelect.addEventListener("change", () => {
  state.boardSize = Number(boardSizeSelect.value);
  setStatus(extractStatus, `Board size set to ${state.boardSize}x${state.boardSize}. Re-extract after changes.`);
});

sourceCanvas.addEventListener("click", (event) => {
  if (!state.imageLoaded) return;

  const rect = sourceCanvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * sourceCanvas.width) / rect.width;
  const y = ((event.clientY - rect.top) * sourceCanvas.height) / rect.height;

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
    setStatus(cornerStatus, `Corner ${state.corners.length}/4 captured.`);
  } else {
    state.corners = orderedCorners(state.corners);
    drawSourceImage();
    setStatus(cornerStatus, "4 corners set. Proceed to extract stones.");
  }
});

autoCornersBtn.addEventListener("click", () => {
  autoDetectCorners();
});

resetCornersBtn.addEventListener("click", () => {
  state.corners = [];
  state.warpedImageData = null;
  drawSourceImage();
  clearCanvas(warpCtx, warpCanvas);
  setStatus(cornerStatus, "Corners reset.");
  setStatus(extractStatus, "Set 4 corners, then extract stones.");
});

extractBtn.addEventListener("click", extractStones);
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
