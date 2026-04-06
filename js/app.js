function generateSgf() {
  const n = state.boardSize;
  const blackCoords = state.stones.filter((s) => s.color === "black").map((s) => s.coord);
  const whiteCoords = state.stones.filter((s) => s.color === "white").map((s) => s.coord);

  const gameName = (gameNameInput.value || "Imported position").replace(/]/g, "");
  const komi = (komiInput.value || "6.5").replace(/]/g, "");
  const nextPlayer = nextPlayerSelect.value === "W" ? "W" : "B";

  let sgf = `(;GM[1]FF[4]CA[UTF-8]AP[Image-to-SGF:1.0]SZ[${n}]GN[${gameName}]KM[${komi}]PL[${nextPlayer}]`;
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
    processImageForBoard({ forceRedetect: true, sourceLabel: "Cropped" });
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
  state.mappingContext = null;
  state.rawStones = [];
  state.stones = [];
  state.warpedImageData = null;
  state.warpPreviewCanvas = null;
  state.gridLayerCanvas = null;
  state.stoneLayerCanvas = null;
  state.imageProcessingMeta = null;
  state.autoProcessPending = false;
  state.boardSizeInference = null;
  state.detectionDebug = null;
  state.detectionDebugFrameIndex = -1;
  state.showImagePreview = false;

  stopDetectionReplay();
  clearCanvas(warpCtx, warpCanvas);
  updateImageProcessingPreviews();
  drawSgfPreview([], state.boardSize);
  sgfOutput.value = "";
  setStatus(extractStatus, "Load an image to run image processing, then extract stones.");
  setStatus(sgfStatus, "No SGF generated yet.");
  updateCropModeUI();
  updateShiftLabel();
  updateEditToolUI();
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
    if (state.cvReady) {
      processImageForBoard({ forceRedetect: true, sourceLabel });
    } else {
      state.autoProcessPending = true;
      setStatus(cornerStatus, `${sourceLabel} image loaded. Waiting for OpenCV to process the board.`);
    }
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
  if (boardSizeSelect.value === "auto") {
    state.boardSizeMode = "auto";
  } else {
    state.boardSizeMode = "manual";
    state.boardSize = Number(boardSizeSelect.value);
  }
  if (state.imageLoaded) {
    processImageForBoard({ sourceLabel: "Board size updated" });
    if (state.boardSizeMode === "auto") {
      setStatus(extractStatus, "Board size set to auto. Image processing refreshed with inferred board size; re-extract stones to apply.");
    } else {
      setStatus(extractStatus, `Board size locked to ${state.boardSize}x${state.boardSize}. Image processing refreshed; re-extract stones to apply the new size.`);
    }
  } else {
    if (state.boardSizeMode === "auto") {
      setStatus(extractStatus, "Board size set to auto.");
    } else {
      setStatus(extractStatus, `Board size locked to ${state.boardSize}x${state.boardSize}.`);
    }
  }
});
blackThresholdInput.addEventListener("change", () => {
  const val = Math.max(1, Number(blackThresholdInput.value) || DEFAULT_BLACK_THRESHOLD);
  blackThresholdInput.value = String(val);
  setStatus(extractStatus, `Black threshold set to ${val}. Re-extract to apply.`);
});
whiteThresholdInput.addEventListener("change", () => {
  const val = Math.max(1, Number(whiteThresholdInput.value) || DEFAULT_WHITE_THRESHOLD);
  whiteThresholdInput.value = String(val);
  setStatus(extractStatus, `White threshold set to ${val}. Re-extract to apply.`);
});
autoBalanceCheckbox.addEventListener("change", () => {
  setStatus(
    extractStatus,
    `Auto balance ${autoBalanceCheckbox.checked ? "enabled" : "disabled"}. Re-extract to apply.`
  );
});
detectionModeSelect.addEventListener("change", () => {
  const selected = detectionModeSelect.value === "raw" ? "raw" : "preprocessed";
  state.detectionMode = selected;
  let previewShown = false;
  if (!state.warpedImageData && state.imageLoaded) {
    warpBoardFromCorners();
  }
  if (state.warpedImageData) {
    previewShown = renderDetectionModePreview();
  }
  setStatus(
    extractStatus,
    previewShown
      ? `Detection mode set to ${detectionModeLabel(selected)}. Showing detection preview on warped board; re-extract to update stones.`
      : `Detection mode set to ${detectionModeLabel(selected)}. Re-extract to apply.`
  );
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
    setStatus(cornerStatus, `Corner ${state.corners.length} captured. Continue until all 4 corners are set.`);
  } else {
    state.corners = orderedCorners(state.corners);
    drawSourceImage();
    processImageForBoard({ sourceLabel: "Manual corners" });
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
  processImageForBoard({ forceRedetect: true, sourceLabel: "Board re-detect" });
});
replayDetectionBtn?.addEventListener("click", () => {
  playDetectionReplay();
});

resetCornersBtn.addEventListener("click", () => {
  stopDetectionReplay();
  state.corners = [];
  state.activeCorners = [];
  state.shiftX = 0;
  state.shiftY = 0;
  state.rotation = 0;
  state.manualEdits = {};
  state.hoverPoint = null;
  state.mappingContext = null;
  state.rawStones = [];
  state.stones = [];
  state.warpedImageData = null;
  state.warpPreviewCanvas = null;
  state.gridLayerCanvas = null;
  state.stoneLayerCanvas = null;
  state.imageProcessingMeta = null;
  state.boardSizeInference = null;
  state.detectionDebug = null;
  state.detectionDebugFrameIndex = -1;
  state.showImagePreview = false;
  drawSourceImage();
  clearCanvas(warpCtx, warpCanvas);
  updateImageProcessingPreviews();
  setStatus(cornerStatus, "Board detection reset. Click corners manually or run board re-detect.");
  setStatus(extractStatus, "Image processing reset. Rebuild the board before extracting stones.");
  updateShiftLabel();
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
toolBlackBtn.addEventListener("click", () => setEditTool("black"));
toolWhiteBtn.addEventListener("click", () => setEditTool("white"));
toolEraseBtn.addEventListener("click", () => setEditTool("erase"));
showImageBtn.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (!state.warpedImageData) {
    setStatus(sgfStatus, "Run extraction first, then hold show image.");
    return;
  }
  setShowImagePreview(true);
});
showImageBtn.addEventListener("pointerup", () => {
  setShowImagePreview(false);
});
showImageBtn.addEventListener("pointerleave", () => {
  setShowImagePreview(false);
});
showImageBtn.addEventListener("pointercancel", () => {
  setShowImagePreview(false);
});
showImageBtn.addEventListener("blur", () => {
  setShowImagePreview(false);
});
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
    if (state.imageLoaded && state.autoProcessPending) {
      processImageForBoard({ forceRedetect: true, sourceLabel: "Loaded" });
    } else {
      setStatus(cornerStatus, "OpenCV ready. Upload an image.");
    }
  } else {
    setTimeout(waitForCv, 150);
  }
}

waitForCv();
updateImageProcessingPreviews();
drawSgfPreview([], state.boardSize);
updateCropModeUI();
updateShiftLabel();
updateEditToolUI();
blackThresholdInput.value = String(DEFAULT_BLACK_THRESHOLD);
whiteThresholdInput.value = String(DEFAULT_WHITE_THRESHOLD);
autoBalanceCheckbox.checked = true;
detectionModeSelect.value = state.detectionMode;
boardSizeSelect.value = state.boardSizeMode === "auto" ? "auto" : String(state.boardSize);
