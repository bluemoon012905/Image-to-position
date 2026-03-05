function setStatus(el, message) {
  el.textContent = message;
}

function updateShiftLabel() {
  if (shiftValue) {
    shiftValue.textContent = `Shift: x=${state.shiftX}, y=${state.shiftY}, rot=${state.rotation * 90}deg`;
  }
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

function getWarpPreviewCanvas() {
  if (!state.warpedImageData) return null;
  if (state.warpPreviewCanvas) return state.warpPreviewCanvas;

  const temp = document.createElement("canvas");
  temp.width = state.warpedImageData.width;
  temp.height = state.warpedImageData.height;
  const tctx = temp.getContext("2d");
  tctx.putImageData(state.warpedImageData, 0, 0);
  state.warpPreviewCanvas = temp;
  return temp;
}

function setShowImagePreview(enabled) {
  const next = Boolean(enabled);
  if (state.showImagePreview === next) return;
  state.showImagePreview = next;
  if (showImageBtn) {
    showImageBtn.classList.toggle("toggle-active", next);
  }
  drawSgfPreview(state.stones, state.boardSize);
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

function nextFrame() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

function setAutoBalanceBusy(isBusy) {
  if (autoBalanceSpinner) {
    autoBalanceSpinner.classList.toggle("hidden", !isBusy);
  }
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

  if (state.showImagePreview) {
    const warpPreview = getWarpPreviewCanvas();
    if (warpPreview) {
      ctx.save();
      ctx.globalAlpha = 0.78;
      ctx.drawImage(warpPreview, margin, margin, boardArea, boardArea);
      ctx.restore();
    }
  }

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

function clampOriginalPoint(point, width, height) {
  return {
    x: Math.max(0, Math.min(width - 1, point.x)),
    y: Math.max(0, Math.min(height - 1, point.y)),
  };
}

function expandCornersOutward(corners, width, height, factor = 1.035) {
  if (!corners || corners.length !== 4) return corners;
  const center = {
    x: corners.reduce((sum, p) => sum + p.x, 0) / 4,
    y: corners.reduce((sum, p) => sum + p.y, 0) / 4,
  };
  return corners.map((p) =>
    clampOriginalPoint(
      {
        x: center.x + (p.x - center.x) * factor,
        y: center.y + (p.y - center.y) * factor,
      },
      width,
      height
    )
  );
}

function refineCornersByQuadrants(candidatePoints, fallbackCorners) {
  if (!candidatePoints.length || !fallbackCorners || fallbackCorners.length !== 4) {
    return fallbackCorners;
  }

  const center = {
    x: fallbackCorners.reduce((sum, p) => sum + p.x, 0) / 4,
    y: fallbackCorners.reduce((sum, p) => sum + p.y, 0) / 4,
  };
  const avgFallbackDist =
    fallbackCorners.reduce((sum, p) => sum + Math.hypot(p.x - center.x, p.y - center.y), 0) / 4;
  const minDist = avgFallbackDist * 0.55;
  const picks = { tl: null, tr: null, br: null, bl: null };

  for (const p of candidatePoints) {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dist = Math.hypot(dx, dy);
    if (dist < minDist) continue;

    let quad = "";
    let dirScore = 0;
    if (dx <= 0 && dy <= 0) {
      quad = "tl";
      dirScore = -dx + -dy;
    } else if (dx >= 0 && dy <= 0) {
      quad = "tr";
      dirScore = dx + -dy;
    } else if (dx >= 0 && dy >= 0) {
      quad = "br";
      dirScore = dx + dy;
    } else {
      quad = "bl";
      dirScore = -dx + dy;
    }
    const score = dirScore + dist * 0.35;
    const current = picks[quad];
    if (!current || score > current.score) {
      picks[quad] = { point: p, score };
    }
  }

  if (!picks.tl || !picks.tr || !picks.br || !picks.bl) {
    return fallbackCorners;
  }

  return orderedCorners([picks.tl.point, picks.tr.point, picks.br.point, picks.bl.point]);
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

