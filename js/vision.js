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
  state.warpPreviewCanvas = null;

  src.delete();
  dst.delete();
  srcTri.delete();
  dstTri.delete();
  M.delete();

  return true;
}

function renderWarpBaseImage() {
  if (!state.warpedImageData) {
    clearCanvas(warpCtx, warpCanvas);
    return;
  }
  warpCanvas.width = state.warpedImageData.width;
  warpCanvas.height = state.warpedImageData.height;
  warpCtx.putImageData(state.warpedImageData, 0, 0);
}

function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

function quadBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function imageBorderContactRatio(bounds, width, height) {
  const marginX = Math.max(6, width * 0.02);
  const marginY = Math.max(6, height * 0.02);
  let hits = 0;
  if (bounds.minX <= marginX) hits += 1;
  if (bounds.minY <= marginY) hits += 1;
  if (width - bounds.maxX <= marginX) hits += 1;
  if (height - bounds.maxY <= marginY) hits += 1;
  return hits / 4;
}

function detectBestContourQuad(src, edges, contours) {
  let bestContour = null;
  let bestScore = 0;
  let bestMeta = null;
  const imageArea = src.cols * src.rows;
  const minContourArea = imageArea * 0.08;

  for (let i = 0; i < contours.size(); i += 1) {
    const c = contours.get(i);
    const areaRaw = Math.abs(cv.contourArea(c));
    if (areaRaw < minContourArea) {
      c.delete();
      continue;
    }

    const hull = new cv.Mat();
    cv.convexHull(c, hull, false, true);
    const perimeter = cv.arcLength(hull, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(hull, approx, 0.02 * perimeter, true);

    if (approx.rows === 4 && cv.isContourConvex(approx)) {
      const area = Math.abs(cv.contourArea(approx));
      const rect = cv.boundingRect(approx);
      const extent = area / Math.max(1, rect.width * rect.height);
      const score = area * (0.75 + extent);
      if (score > bestScore) {
        if (bestContour) {
          bestContour.delete();
        }
        bestContour = approx.clone();
        bestScore = score;
        bestMeta = {
          area,
          areaRatio: area / imageArea,
          extent,
          score,
        };
      }
    }

    approx.delete();
    hull.delete();
    c.delete();
  }

  if (!bestContour) {
    return null;
  }

  const points = [];
  for (let i = 0; i < 4; i += 1) {
    points.push({
      x: bestContour.intPtr(i, 0)[0],
      y: bestContour.intPtr(i, 0)[1],
    });
  }
  bestContour.delete();
  const ordered = orderedCorners(points);
  const bounds = quadBounds(ordered);

  return {
    points: ordered,
    meta: {
      ...bestMeta,
      bounds,
      borderContactRatio: imageBorderContactRatio(bounds, src.cols, src.rows),
    },
  };
}

function extractEdgeFeaturePoints(edges) {
  const candidatePoints = [];
  if (typeof cv.goodFeaturesToTrack !== "function") {
    return candidatePoints;
  }

  const cornersMat = new cv.Mat();
  cv.goodFeaturesToTrack(edges, cornersMat, 160, 0.01, 8);
  for (let i = 0; i < cornersMat.rows; i += 1) {
    candidatePoints.push({
      x: cornersMat.data32F[i * 2],
      y: cornersMat.data32F[i * 2 + 1],
    });
  }
  cornersMat.delete();
  return candidatePoints;
}

function collectLineSegments(edges, width, height) {
  if (typeof cv.HoughLinesP !== "function") {
    return [];
  }

  const lines = new cv.Mat();
  const segments = [];
  const minDim = Math.min(width, height);
  cv.HoughLinesP(
    edges,
    lines,
    1,
    Math.PI / 180,
    70,
    Math.max(28, Math.round(minDim * 0.12)),
    Math.max(10, Math.round(minDim * 0.03))
  );

  for (let i = 0; i < lines.rows; i += 1) {
    const base = i * 4;
    const x1 = lines.data32S[base];
    const y1 = lines.data32S[base + 1];
    const x2 = lines.data32S[base + 2];
    const y2 = lines.data32S[base + 3];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    if (length < Math.max(22, minDim * 0.08)) continue;
    segments.push({ x1, y1, x2, y2, dx, dy, length });
  }

  lines.delete();
  return segments;
}

function clusterBoundaryLines(lines, interceptTolerance) {
  if (!lines.length) return [];

  const sorted = [...lines].sort((a, b) => a.intercept - b.intercept);
  const clusters = [];

  for (const line of sorted) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(line.intercept - last.intercept) > interceptTolerance) {
      clusters.push({
        interceptWeighted: line.intercept * line.length,
        slopeWeighted: line.slope * line.length,
        totalLength: line.length,
        lineCount: 1,
        minAlong: Math.min(line.alongA, line.alongB),
        maxAlong: Math.max(line.alongA, line.alongB),
      });
      continue;
    }

    last.interceptWeighted += line.intercept * line.length;
    last.slopeWeighted += line.slope * line.length;
    last.totalLength += line.length;
    last.lineCount += 1;
    last.minAlong = Math.min(last.minAlong, line.alongA, line.alongB);
    last.maxAlong = Math.max(last.maxAlong, line.alongA, line.alongB);
  }

  return clusters.map((cluster) => ({
    intercept: cluster.interceptWeighted / Math.max(1, cluster.totalLength),
    slope: cluster.slopeWeighted / Math.max(1, cluster.totalLength),
    totalLength: cluster.totalLength,
    lineCount: cluster.lineCount,
    span: cluster.maxAlong - cluster.minAlong,
  }));
}

function pickBoundaryPair(clusters, minCoverage) {
  const eligible = clusters
    .filter((cluster) => cluster.span >= minCoverage)
    .sort((a, b) => a.intercept - b.intercept);

  if (eligible.length < 2) return null;
  return {
    first: eligible[0],
    last: eligible[eligible.length - 1],
    all: eligible,
  };
}

function adjacentClusterSpacing(clusters) {
  if (!clusters || clusters.length < 3) return 0;
  const diffs = [];
  for (let i = 1; i < clusters.length; i += 1) {
    const diff = clusters[i].intercept - clusters[i - 1].intercept;
    if (diff > 3) {
      diffs.push(diff);
    }
  }
  return diffs.length ? median(diffs) : 0;
}

function findBestGridRun(clusters, minCoverage) {
  const eligible = clusters
    .filter((cluster) => cluster.span >= minCoverage)
    .sort((a, b) => a.intercept - b.intercept);
  if (eligible.length < 4) return null;

  const spacing = adjacentClusterSpacing(eligible);
  if (!spacing || !Number.isFinite(spacing)) return null;

  const tolerance = Math.max(4, spacing * 0.28);
  let best = null;

  for (let start = 0; start < eligible.length; start += 1) {
    const run = [eligible[start]];
    let totalLength = eligible[start].totalLength;
    let gaps = 0;

    for (let i = start + 1; i < eligible.length; i += 1) {
      const prev = run[run.length - 1];
      const next = eligible[i];
      const diff = next.intercept - prev.intercept;
      const steps = Math.max(1, Math.round(diff / spacing));
      const expected = steps * spacing;

      if (steps > 3 || Math.abs(diff - expected) > tolerance * steps) {
        if (diff > spacing * 3.5) {
          break;
        }
        continue;
      }

      run.push(next);
      totalLength += next.totalLength;
      gaps += Math.max(0, steps - 1);
    }

    if (run.length < 4) continue;
    const first = run[0];
    const last = run[run.length - 1];
    const coveredSpan = last.intercept - first.intercept;
    const score = run.length * 20 + totalLength * 0.015 - gaps * 6 + coveredSpan * 0.02;

    if (!best || score > best.score) {
      best = {
        spacing,
        tolerance,
        run,
        first,
        last,
        observedLines: run.length,
        coveredSpan,
        gaps,
        totalLength,
        score,
      };
    }
  }

  return best;
}

function intersectBoundaryLines(vertical, horizontal) {
  const denom = 1 - vertical.slope * horizontal.slope;
  if (Math.abs(denom) < 1e-5) return null;
  const x = (vertical.slope * horizontal.intercept + vertical.intercept) / denom;
  const y = horizontal.slope * x + horizontal.intercept;
  return { x, y };
}

function linesForDebug(clusters, axis, color, width = 1.8, dash = [8, 6]) {
  return (clusters || []).map((cluster) => ({
    axis,
    intercept: cluster.intercept,
    slope: cluster.slope,
    color,
    width,
    dash,
  }));
}

function buildRunFrames(run, axis, color, titlePrefix) {
  if (!run?.run?.length) return [];
  const frames = [];
  const acc = [];
  for (let i = 0; i < run.run.length; i += 1) {
    const cluster = run.run[i];
    acc.push({
      axis,
      intercept: cluster.intercept,
      slope: cluster.slope,
      color,
      width: 2.8,
      dash: [],
    });
    frames.push({
      label: `${titlePrefix}: ${i + 1} line${i === 0 ? "" : "s"} in evenly spaced run`,
      lines: [...acc],
      duration: 420,
    });
  }
  return frames;
}

function buildDetectionDebugFrames(contourCandidate, lineCandidate, detectionMethod) {
  const frames = [];
  const debug = lineCandidate?.debug;

  if (debug?.verticalClusters?.length) {
    frames.push({
      label: `Grid scan: detected ${debug.verticalClusters.length} vertical line families`,
      lines: linesForDebug(debug.verticalClusters, "vertical", "rgba(35, 118, 255, 0.55)", 1.6, [6, 8]),
      duration: 520,
    });
  }

  if (debug?.verticalRun) {
    frames.push(...buildRunFrames(debug.verticalRun, "vertical", "rgba(35, 118, 255, 0.95)", "Grid scan: expanding vertical run"));
  }

  if (debug?.horizontalClusters?.length) {
    frames.push({
      label: `Grid scan: detected ${debug.horizontalClusters.length} horizontal line families`,
      lines: linesForDebug(debug.horizontalClusters, "horizontal", "rgba(255, 132, 28, 0.55)", 1.6, [6, 8]),
      duration: 520,
    });
  }

  if (debug?.horizontalRun) {
    frames.push(...buildRunFrames(debug.horizontalRun, "horizontal", "rgba(255, 132, 28, 0.95)", "Grid scan: expanding horizontal run"));
  }

  if (contourCandidate?.points) {
    frames.push({
      label:
        detectionMethod === "grid-lines"
          ? "Contour candidate rejected"
          : "Contour candidate selected",
      quads: [{ points: contourCandidate.points, color: "rgba(196, 56, 56, 0.95)", width: 2.2 }],
      duration: 620,
    });
  }

  if (lineCandidate?.points) {
    frames.push({
      label:
        detectionMethod === "grid-lines"
          ? "Grid scan final frame selected"
          : "Grid scan final frame considered",
      quads: [{ points: lineCandidate.points, color: "rgba(22, 150, 93, 0.95)", width: 2.6 }],
      duration: 900,
    });
  }

  return frames;
}

function detectGridFrameQuad(edges, width, height) {
  const segments = collectLineSegments(edges, width, height);
  if (!segments.length) return null;

  const centerX = width / 2;
  const centerY = height / 2;
  const verticalLines = [];
  const horizontalLines = [];

  for (const segment of segments) {
    const angle = (Math.atan2(segment.dy, segment.dx) * 180) / Math.PI;
    const absAngle = Math.abs(angle);

    if (Math.abs(absAngle - 90) <= 18) {
      const slope = segment.dy === 0 ? 0 : segment.dx / segment.dy;
      const intercept = ((segment.x1 - slope * segment.y1) + (segment.x2 - slope * segment.y2)) / 2;
      verticalLines.push({
        intercept,
        slope,
        length: segment.length,
        alongA: segment.y1,
        alongB: segment.y2,
      });
    } else if (absAngle <= 18 || absAngle >= 162) {
      const slope = segment.dx === 0 ? 0 : segment.dy / segment.dx;
      const intercept = ((segment.y1 - slope * segment.x1) + (segment.y2 - slope * segment.x2)) / 2;
      horizontalLines.push({
        intercept,
        slope,
        length: segment.length,
        alongA: segment.x1,
        alongB: segment.x2,
      });
    }
  }

  const verticalClusters = clusterBoundaryLines(verticalLines, Math.max(8, width * 0.012));
  const horizontalClusters = clusterBoundaryLines(horizontalLines, Math.max(8, height * 0.012));
  const verticalRun = findBestGridRun(verticalClusters, height * 0.22);
  const horizontalRun = findBestGridRun(horizontalClusters, width * 0.22);
  const verticalPair = pickBoundaryPair(verticalClusters, height * 0.22);
  const horizontalPair = pickBoundaryPair(horizontalClusters, width * 0.22);

  const verticalSource = verticalRun || verticalPair;
  const horizontalSource = horizontalRun || horizontalPair;
  if (!verticalSource || !horizontalSource) return null;

  const leftLine = {
    intercept: verticalSource.first.intercept,
    slope: verticalSource.first.slope,
  };
  const rightLine = {
    intercept: verticalSource.last.intercept,
    slope: verticalSource.last.slope,
  };
  const topLine = {
    intercept: horizontalSource.first.intercept,
    slope: horizontalSource.first.slope,
  };
  const bottomLine = {
    intercept: horizontalSource.last.intercept,
    slope: horizontalSource.last.slope,
  };

  const corners = [
    intersectBoundaryLines(leftLine, topLine),
    intersectBoundaryLines(rightLine, topLine),
    intersectBoundaryLines(rightLine, bottomLine),
    intersectBoundaryLines(leftLine, bottomLine),
  ];

  if (corners.some((point) => !point)) {
    return null;
  }

  const clampedCorners = corners.map((point) => clampOriginalPoint(point, width, height));
  const area = polygonArea(clampedCorners);
  return {
    points: orderedCorners(clampedCorners),
    meta: {
      area,
      areaRatio: area / Math.max(1, width * height),
      verticalClusters: verticalPair?.all?.length || 0,
      horizontalClusters: horizontalPair?.all?.length || 0,
      verticalSpacing: Number((verticalRun?.spacing || adjacentClusterSpacing(verticalPair?.all || [] ) || 0).toFixed(2)),
      horizontalSpacing: Number((horizontalRun?.spacing || adjacentClusterSpacing(horizontalPair?.all || [] ) || 0).toFixed(2)),
      visibleVerticalLines: verticalRun?.observedLines || 0,
      visibleHorizontalLines: horizontalRun?.observedLines || 0,
      verticalGaps: verticalRun?.gaps || 0,
      horizontalGaps: horizontalRun?.gaps || 0,
      anchorX: Number(centerX.toFixed(1)),
      anchorY: Number(centerY.toFixed(1)),
    },
    debug: {
      verticalClusters,
      horizontalClusters,
      verticalRun,
      horizontalRun,
    },
  };
}

function autoDetectCorners(options = {}) {
  const { suppressStatus = false } = options;
  if (!state.cvReady || !state.image) {
    if (!suppressStatus) {
      setStatus(cornerStatus, "OpenCV not ready or image not loaded.");
    }
    return false;
  }

  const src = cv.imread(state.image);
  const gray = new cv.Mat();
  const denoised = new cv.Mat();
  const contrasted = new cv.Mat();
  const edgesRaw = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const morphKernel = cv.Mat.ones(3, 3, cv.CV_8U);

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.bilateralFilter(gray, denoised, 9, 75, 75, cv.BORDER_DEFAULT);
  if (typeof cv.createCLAHE === "function") {
    const clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(denoised, contrasted);
    clahe.delete();
  } else {
    denoised.copyTo(contrasted);
  }
  cv.Canny(contrasted, edgesRaw, 45, 140);
  cv.morphologyEx(edgesRaw, edges, cv.MORPH_CLOSE, morphKernel);
  cv.dilate(edges, edges, morphKernel, new cv.Point(-1, -1), 1);
  cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  const contourCandidate = detectBestContourQuad(src, edges, contours);
  const lineCandidate = detectGridFrameQuad(edges, src.cols, src.rows);

  let chosen = contourCandidate || lineCandidate;
  let detectionMethod = contourCandidate ? "contour" : lineCandidate ? "grid-lines" : "";

  state.detectionDebug = {
    method: detectionMethod || "none",
    frames: buildDetectionDebugFrames(contourCandidate, lineCandidate, detectionMethod),
  };
  state.detectionDebugFrameIndex = -1;

  if (!chosen) {
    if (!suppressStatus) {
      setStatus(cornerStatus, "Auto-detect failed. Click 4 corners manually.");
    }
  } else {
    const candidatePoints = extractEdgeFeaturePoints(edges);
    const orderedOriginal = orderedCorners(chosen.points);
    const refinedOriginal =
      detectionMethod === "grid-lines"
        ? orderedOriginal
        : refineCornersByQuadrants(candidatePoints, orderedOriginal);
    const expandFactor = detectionMethod === "grid-lines" ? 1.012 : 1.035;
    const expandedOriginal = expandCornersOutward(refinedOriginal, src.cols, src.rows, expandFactor);
    const points = expandedOriginal.map(originalToCanvas);
    state.corners = orderedCorners(points);
    drawSourceImage();

    if (!suppressStatus) {
      setStatus(
        cornerStatus,
        `Detected board border automatically using ${detectionMethod || "contour"} geometry. Review and adjust manually if needed.`
      );
    }
  }

  src.delete();
  gray.delete();
  denoised.delete();
  contrasted.delete();
  edgesRaw.delete();
  edges.delete();
  morphKernel.delete();
  contours.delete();
  hierarchy.delete();
  if (state.detectionDebug?.frames?.length) {
    playDetectionReplay();
  }
  return Boolean(state.corners.length === 4);
}

function drawWarpGrid(targetCtx = warpCtx, targetCanvas = warpCanvas, color = "rgba(24,24,24,0.65)") {
  if (!state.warpedImageData) return;

  const n = state.boardSize;
  const size = targetCanvas.width;
  const step = (size - 1) / (n - 1);

  targetCtx.save();
  targetCtx.strokeStyle = color;
  targetCtx.lineWidth = 1;

  for (let i = 0; i < n; i += 1) {
    const x = i * step;
    targetCtx.beginPath();
    targetCtx.moveTo(x, 0);
    targetCtx.lineTo(x, size);
    targetCtx.stroke();
  }

  for (let i = 0; i < n; i += 1) {
    const y = i * step;
    targetCtx.beginPath();
    targetCtx.moveTo(0, y);
    targetCtx.lineTo(size, y);
    targetCtx.stroke();
  }

  targetCtx.restore();
}

function maskToTransparentCanvas(maskMat, color) {
  const canvas = createOffscreenCanvas(maskMat.cols, maskMat.rows);
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(maskMat.cols, maskMat.rows);

  for (let i = 0; i < maskMat.data.length; i += 1) {
    const value = maskMat.data[i];
    const base = i * 4;
    img.data[base] = color.r;
    img.data[base + 1] = color.g;
    img.data[base + 2] = color.b;
    img.data[base + 3] = value > 0 ? Math.max(50, Math.min(255, value)) : 0;
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values, avg = mean(values)) {
  if (!values.length) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) * (value - avg), 0) / values.length;
  return Math.sqrt(variance);
}

function smoothSeries(values, radius = 2) {
  const out = new Array(values.length).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    const min = Math.max(0, i - radius);
    const max = Math.min(values.length - 1, i + radius);
    for (let j = min; j <= max; j += 1) {
      sum += values[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function sampleSeriesBand(values, center, radius) {
  const min = Math.max(0, Math.floor(center - radius));
  const max = Math.min(values.length - 1, Math.ceil(center + radius));
  let sum = 0;
  let count = 0;
  for (let i = min; i <= max; i += 1) {
    sum += values[i];
    count += 1;
  }
  return count ? sum / count : 0;
}

function buildWarpProjectionSeries() {
  if (!state.warpedImageData) return null;

  const { data, width, height } = state.warpedImageData;
  const cols = new Array(width).fill(0);
  const rows = new Array(height).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const darkness = 255 - brightness;
      cols[x] += darkness;
      rows[y] += darkness;
    }
  }

  for (let x = 0; x < width; x += 1) {
    cols[x] /= height;
  }
  for (let y = 0; y < height; y += 1) {
    rows[y] /= width;
  }

  return {
    cols: smoothSeries(cols, 2),
    rows: smoothSeries(rows, 2),
    width,
    height,
  };
}

function collectExpectedLineSamples(series, n) {
  const step = (series.length - 1) / Math.max(1, n - 1);
  const onRadius = Math.max(1, Math.min(7, Math.round(step * 0.12)));
  const offRadius = Math.max(1, Math.min(7, Math.round(step * 0.18)));
  const onSamples = [];
  const offSamples = [];

  for (let i = 0; i < n; i += 1) {
    onSamples.push(sampleSeriesBand(series, i * step, onRadius));
  }

  for (let i = 0; i < n - 1; i += 1) {
    offSamples.push(sampleSeriesBand(series, i * step + step * 0.5, offRadius));
  }

  return { onSamples, offSamples, step };
}

function scoreBoardSizeCandidate(n, projection) {
  const xSamples = collectExpectedLineSamples(projection.cols, n);
  const ySamples = collectExpectedLineSamples(projection.rows, n);
  const onSamples = [...xSamples.onSamples, ...ySamples.onSamples];
  const offSamples = [...xSamples.offSamples, ...ySamples.offSamples];
  const onMean = mean(onSamples);
  const offMean = mean(offSamples);
  const onStd = stddev(onSamples, onMean);
  const contrast = onMean - offMean;
  const normalizedContrast = contrast / Math.max(1, onMean);
  const stability = 1 - Math.min(1, onStd / Math.max(1, onMean));
  const score = normalizedContrast * 100 + stability * 18 + onMean * 0.04;

  return {
    boardSize: n,
    step: Number(xSamples.step.toFixed(2)),
    onMean: Number(onMean.toFixed(2)),
    offMean: Number(offMean.toFixed(2)),
    contrast: Number(contrast.toFixed(2)),
    stability: Number(stability.toFixed(3)),
    score: Number(score.toFixed(2)),
  };
}

function inferBoardSizeFromWarpedImage() {
  const projection = buildWarpProjectionSeries();
  if (!projection) return null;

  const candidates = [9, 13, 19].map((n) => scoreBoardSizeCandidate(n, projection));
  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const runnerUp = candidates[1];
  return {
    boardSize: best.boardSize,
    confidence: Number((best.score - (runnerUp?.score || 0)).toFixed(2)),
    candidates,
  };
}

function buildGridLayerCanvas() {
  if (!state.warpedImageData || !state.cvReady) return null;

  const src = cv.imread(getWarpPreviewCanvas());
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  const horizontal = new cv.Mat();
  const vertical = new cv.Mat();
  const merged = new cv.Mat();
  const cleaned = new cv.Mat();

  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.adaptiveThreshold(
    gray,
    binary,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    31,
    10
  );

  const step = (src.cols - 1) / Math.max(1, state.boardSize - 1);
  const hSize = Math.max(11, Math.round(step * 0.95));
  const vSize = Math.max(11, Math.round(step * 0.95));
  const hKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hSize, 1));
  const vKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vSize));
  cv.morphologyEx(binary, horizontal, cv.MORPH_OPEN, hKernel);
  cv.morphologyEx(binary, vertical, cv.MORPH_OPEN, vKernel);
  cv.bitwise_or(horizontal, vertical, merged);
  cv.dilate(
    merged,
    cleaned,
    cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2)),
    new cv.Point(-1, -1),
    1
  );

  const layerCanvas = maskToTransparentCanvas(cleaned, { r: 28, g: 95, b: 74 });

  src.delete();
  gray.delete();
  binary.delete();
  horizontal.delete();
  vertical.delete();
  merged.delete();
  cleaned.delete();
  hKernel.delete();
  vKernel.delete();

  return layerCanvas;
}

function buildStoneLayerCanvas() {
  if (!state.warpedImageData) return null;

  const size = state.warpedImageData.width;
  const n = state.boardSize;
  const step = (size - 1) / Math.max(1, n - 1);
  const circles = detectCircleCandidates(step);
  const points = circlesToIntersections(circles, n, step);
  const source = getWarpPreviewCanvas();
  const layerCanvas = createOffscreenCanvas(size, size);
  const ctx = layerCanvas.getContext("2d");

  for (const point of points) {
    const radius = Math.max(step * 0.34, Math.min(step * 0.58, point.r || step * 0.44));
    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(source, 0, 0);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(36, 33, 25, 0.35)";
    ctx.lineWidth = Math.max(1, step * 0.035);
    ctx.stroke();
  }

  return {
    canvas: layerCanvas,
    meta: {
      candidates: circles.length,
      intersections: points.length,
    },
  };
}

function refreshImageProcessingLayers() {
  if (!state.warpedImageData) {
    state.gridLayerCanvas = null;
    state.stoneLayerCanvas = null;
    state.imageProcessingMeta = null;
    updateImageProcessingPreviews();
    renderWarpBaseImage();
    return false;
  }

  state.gridLayerCanvas = buildGridLayerCanvas();
  const stoneLayer = buildStoneLayerCanvas();
  state.stoneLayerCanvas = stoneLayer?.canvas || null;
  state.imageProcessingMeta = {
    stoneCandidates: stoneLayer?.meta?.candidates || 0,
    stoneIntersections: stoneLayer?.meta?.intersections || 0,
    inferredBoardSize: state.boardSizeInference?.boardSize || null,
    inferenceConfidence: state.boardSizeInference?.confidence || 0,
  };

  updateImageProcessingPreviews();
  renderWarpBaseImage();
  drawWarpGrid();
  return true;
}

function processImageForBoard(options = {}) {
  const { forceRedetect = false, sourceLabel = "Loaded" } = options;

  if (!state.imageLoaded || !state.image || !state.cvReady) {
    state.autoProcessPending = true;
    return false;
  }

  state.autoProcessPending = false;

  let hasCorners = state.corners.length === 4;
  if (forceRedetect || !hasCorners) {
    hasCorners = autoDetectCorners({ suppressStatus: true });
  }

  if (!hasCorners) {
    state.warpedImageData = null;
    state.gridLayerCanvas = null;
    state.stoneLayerCanvas = null;
    state.imageProcessingMeta = null;
    state.boardSizeInference = null;
    updateImageProcessingPreviews();
    clearCanvas(warpCtx, warpCanvas);
    setStatus(cornerStatus, `${sourceLabel} image loaded, but board auto-detect missed. Click corners manually to continue.`);
    setStatus(extractStatus, "Image processing could not lock the board yet.");
    return false;
  }

  drawSourceImage();
  const warped = warpBoardFromCorners();
  if (!warped) {
    setStatus(cornerStatus, "Board border was found, but warping failed.");
    return false;
  }

  let inferenceNote = "";
  if (state.boardSizeMode === "auto") {
    const inferred = inferBoardSizeFromWarpedImage();
    state.boardSizeInference = inferred;
    if (inferred?.boardSize) {
      state.boardSize = inferred.boardSize;
      boardSizeSelect.value = "auto";
      inferenceNote = ` Inferred ${state.boardSize}x${state.boardSize} board.`;
    } else {
      inferenceNote = ` Board size inference failed; keeping ${state.boardSize}x${state.boardSize}.`;
    }
  } else {
    state.boardSizeInference = null;
    boardSizeSelect.value = String(state.boardSize);
  }

  refreshImageProcessingLayers();
  const meta = state.imageProcessingMeta || { stoneCandidates: 0, stoneIntersections: 0 };
  setStatus(
    cornerStatus,
    `Board border detected automatically.${inferenceNote} Grid and stone layers prepared from the warped board.`
  );
  setStatus(
    extractStatus,
    `Image processing ready for ${state.boardSize}x${state.boardSize}.${inferenceNote} Stone layer has ${meta.stoneIntersections} on-grid candidates from ${meta.stoneCandidates} circle hits. Extract stones to classify them.`
  );
  return true;
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

function confidenceFromDelta(delta, color, blackThreshold, whiteThreshold) {
  if (color === "black") {
    const margin = delta - blackThreshold;
    const scale = Math.max(6, blackThreshold * 0.55);
    return Math.max(0, Math.min(1, margin / scale));
  }
  if (color === "white") {
    const margin = -delta - whiteThreshold;
    const scale = Math.max(6, whiteThreshold * 0.55);
    return Math.max(0, Math.min(1, margin / scale));
  }
  return 0;
}

function rebalanceByConfidence(stones, minTotal = 31, imbalanceThreshold = 0.2) {
  if (!stones || stones.length < minTotal) {
    return { stones, removed: 0, dominant: "", initialImbalance: 0, finalImbalance: 0 };
  }

  let working = [...stones];
  const countByColor = (arr, color) => arr.filter((s) => s.color === color).length;
  const calcImbalance = (arr) => {
    const b = countByColor(arr, "black");
    const w = countByColor(arr, "white");
    const total = b + w;
    if (!total) return 0;
    return Math.abs(b - w) / total;
  };

  const initialImbalance = calcImbalance(working);
  if (initialImbalance < imbalanceThreshold) {
    return { stones: working, removed: 0, dominant: "", initialImbalance, finalImbalance: initialImbalance };
  }

  const initialBlack = countByColor(working, "black");
  const initialWhite = countByColor(working, "white");
  const dominant = initialBlack >= initialWhite ? "black" : "white";
  let removed = 0;

  while (working.length >= minTotal) {
    const imbalance = calcImbalance(working);
    if (imbalance < imbalanceThreshold) break;

    let weakestIdx = -1;
    let weakestConfidence = Number.POSITIVE_INFINITY;
    for (let i = 0; i < working.length; i += 1) {
      const stone = working[i];
      if (stone.color !== dominant) continue;
      const conf = Number.isFinite(stone.confidence) ? stone.confidence : 0;
      if (conf < weakestConfidence) {
        weakestConfidence = conf;
        weakestIdx = i;
      }
    }
    if (weakestIdx < 0) break;

    working.splice(weakestIdx, 1);
    removed += 1;
  }

  return {
    stones: working,
    removed,
    dominant,
    initialImbalance,
    finalImbalance: calcImbalance(working),
  };
}

function collectWhiteRescueStones(n, step, occupiedKeySet, whiteThreshold) {
  if (!state.warpedImageData) return { stones: [], meta: null };

  const rCore = Math.max(2, step * 0.22);
  const rRimInner = step * 0.34;
  const rRimOuter = step * 0.52;
  const rBgInner = step * 0.62;
  const rBgOuter = step * 0.82;
  const metrics = [];

  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      const key = `${row},${col}`;
      if (occupiedKeySet.has(key)) continue;

      const x = col * step;
      const y = row * step;
      const core = sampleCircleStats(state.warpedImageData, x, y, 0, rCore);
      const rim = sampleCircleStats(state.warpedImageData, x, y, rRimInner, rRimOuter);
      const bg = sampleCircleStats(state.warpedImageData, x, y, rBgInner, rBgOuter);
      const delta = Number((bg - core).toFixed(2));
      const rimDip = Number((((core + bg) / 2 - rim)).toFixed(2));
      metrics.push({ row, col, x, y, core, rim, bg, delta, rimDip });
    }
  }

  if (!metrics.length) return { stones: [], meta: null };

  const rimMedian = median(metrics.map((m) => m.rimDip));
  const rimThreshold = Math.max(6, rimMedian + 4);
  const weakWhiteDelta = Math.max(6, whiteThreshold * 0.45);
  const rescued = [];

  for (const m of metrics) {
    const weakWhite = -m.delta > weakWhiteDelta;
    const outlineWhite =
      m.core > 80 &&
      m.core >= m.bg - 10 &&
      m.rim <= m.core - 5 &&
      m.rim <= m.bg - 2 &&
      m.rimDip >= rimThreshold;
    if (!weakWhite && !outlineWhite) continue;

    const radius = estimateStoneRadius(state.warpedImageData, m.x, m.y, step, "white");
    const weakConfidence = Math.max(0, Math.min(1, (-m.delta - weakWhiteDelta) / Math.max(6, weakWhiteDelta)));
    const outlineConfidence = Math.max(0, Math.min(1, (m.rimDip - rimThreshold) / Math.max(4, rimThreshold * 0.45)));
    const confidence = Number(Math.max(weakConfidence, outlineConfidence).toFixed(3));
    rescued.push({
      property: "AW",
      color: "white",
      imgCol: m.col,
      imgRow: m.row,
      imgX: m.x,
      imgY: m.y,
      col: m.col,
      row: m.row,
      coord: pointToSgfCoord(m.col, m.row, n),
      delta: m.delta,
      radius: Number(radius.toFixed(2)),
      confidence,
      source: "white-rescue",
    });
  }

  return {
    stones: rescued,
    meta: {
      considered: metrics.length,
      rescued: rescued.length,
      rimMedian: Number(rimMedian.toFixed(2)),
      rimThreshold: Number(rimThreshold.toFixed(2)),
      weakWhiteDelta: Number(weakWhiteDelta.toFixed(2)),
    },
  };
}

function detectionModeLabel(mode = state.detectionMode) {
  return mode === "raw" ? "raw grayscale" : "preprocessed";
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

function preprocessGrayForCircleDetection(grayInput) {
  // Pipeline: edge-preserving denoise -> adaptive contrast -> sharpen.
  const denoised = new cv.Mat();
  const contrasted = new cv.Mat();
  const sharpened = new cv.Mat();
  const kernel = cv.matFromArray(3, 3, cv.CV_32F, [0, -1, 0, -1, 5, -1, 0, -1, 0]);

  cv.bilateralFilter(grayInput, denoised, 9, 75, 75, cv.BORDER_DEFAULT);

  if (typeof cv.createCLAHE === "function") {
    const clahe = cv.createCLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(denoised, contrasted);
    clahe.delete();
  } else {
    denoised.copyTo(contrasted);
  }

  cv.filter2D(contrasted, sharpened, cv.CV_8U, kernel, new cv.Point(-1, -1), 0, cv.BORDER_DEFAULT);

  denoised.delete();
  contrasted.delete();
  kernel.delete();
  return sharpened;
}

function detectCircleCandidatesFromGray(grayMat, step, roi = null) {
  const detectRoi = roi
    ? new cv.Rect(
        Math.max(0, Math.floor(roi.x)),
        Math.max(0, Math.floor(roi.y)),
        Math.max(1, Math.floor(roi.w)),
        Math.max(1, Math.floor(roi.h))
      )
    : null;
  const srcView = detectRoi ? grayMat.roi(detectRoi) : grayMat;
  const preprocessed =
    state.detectionMode === "preprocessed" ? preprocessGrayForCircleDetection(srcView) : null;
  const detectInput = preprocessed || srcView;
  const blur = new cv.Mat();
  cv.medianBlur(detectInput, blur, 5);

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
      const ox = detectRoi ? detectRoi.x : 0;
      const oy = detectRoi ? detectRoi.y : 0;
      const x = circles.data32F[i * 3] + ox;
      const y = circles.data32F[i * 3 + 1] + oy;
      const r = circles.data32F[i * 3 + 2];
      all.push({ x, y, r });
    }
    circles.delete();
  }

  if (detectRoi) {
    srcView.delete();
  }
  if (preprocessed) preprocessed.delete();
  blur.delete();
  return all;
}

function mergeCircleCandidates(all, step) {
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

function build19QuadrantRois(step, size) {
  const pad = step * 1.8;
  const span = step * 8;
  const starts = [
    { col: 0, row: 0 },
    { col: 10, row: 0 },
    { col: 0, row: 10 },
    { col: 10, row: 10 },
  ];

  return starts.map((s) => {
    const x0 = s.col * step - pad;
    const y0 = s.row * step - pad;
    const x = Math.max(0, x0);
    const y = Math.max(0, y0);
    const w = Math.min(size - x, span + pad * 2);
    const h = Math.min(size - y, span + pad * 2);
    return { x, y, w, h };
  });
}

function detectCircleCandidates(step) {
  const src = cv.imread(warpCanvas);
  const detectGray = new cv.Mat();
  cv.cvtColor(src, detectGray, cv.COLOR_RGBA2GRAY);
  const size = warpCanvas.width;
  const all = [];

  const base = detectCircleCandidatesFromGray(detectGray, step);
  all.push(...base);

  let tiledRaw = 0;
  if (state.boardSize === 19) {
    const rois = build19QuadrantRois(step, size);
    for (const roi of rois) {
      const partial = detectCircleCandidatesFromGray(detectGray, step, roi);
      tiledRaw += partial.length;
      all.push(...partial);
    }
  }

  src.delete();
  detectGray.delete();
  const merged = mergeCircleCandidates(all, step);
  state.lastDetectionMeta = {
    baseRaw: base.length,
    tiledRaw,
    merged: merged.length,
    usedQuadrants: state.boardSize === 19,
    mode: state.detectionMode,
  };

  return merged;
}

function buildDetectionGrayFromWarpedData() {
  if (!state.warpedImageData) return null;

  const temp = document.createElement("canvas");
  temp.width = state.warpedImageData.width;
  temp.height = state.warpedImageData.height;
  const tctx = temp.getContext("2d");
  tctx.putImageData(state.warpedImageData, 0, 0);

  const src = cv.imread(temp);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  if (state.detectionMode !== "preprocessed") {
    return gray;
  }

  const processed = preprocessGrayForCircleDetection(gray);
  gray.delete();
  return processed;
}

function renderDetectionModePreview() {
  if (!state.warpedImageData) return false;
  const detectionGray = buildDetectionGrayFromWarpedData();
  if (!detectionGray) return false;

  const rgba = new cv.Mat();
  cv.cvtColor(detectionGray, rgba, cv.COLOR_GRAY2RGBA);
  cv.imshow(warpCanvas, rgba);
  drawWarpGrid();

  detectionGray.delete();
  rgba.delete();
  return true;
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

function renderWarpAndStoneMarkers(stones, step) {
  if (!state.warpedImageData) return;
  warpCtx.putImageData(state.warpedImageData, 0, 0);
  drawWarpGrid();

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

function getMappingContext(stones, n) {
  const cols = stones.map((s) => s.imgCol ?? s.col);
  const rows = stones.map((s) => s.imgRow ?? s.row);
  let minCol = Math.min(...cols);
  let maxCol = Math.max(...cols);
  let minRow = Math.min(...rows);
  let maxRow = Math.max(...rows);
  let spanCol = Math.max(1, maxCol - minCol + 1);
  let spanRow = Math.max(1, maxRow - minRow + 1);

  const rot = ((state.rotation % 4) + 4) % 4;
  const rotatedSpanCol = rot % 2 === 0 ? spanCol : spanRow;
  const rotatedSpanRow = rot % 2 === 0 ? spanRow : spanCol;

  const offsetCol = Math.max(0, Math.floor((n - rotatedSpanCol) / 2));
  const offsetRow = Math.max(0, Math.floor((n - rotatedSpanRow) / 2));

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
  const buffer = ctx.n;
  if (
    rotatedCol < -buffer ||
    rotatedRow < -buffer ||
    rotatedCol > ctx.rotatedSpanCol - 1 + buffer ||
    rotatedRow > ctx.rotatedSpanRow - 1 + buffer
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
  const ctx = getMappingContext(state.rawStones, n);
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
  updateShiftLabel();
  setStatus(
    extractStatus,
    `Showing ${mergedEdited.length} stones (${blackCount} black, ${whiteCount} white), shift=(${state.shiftX},${state.shiftY}), rot=${state.rotation * 90}deg.`
  );
}

async function extractStones() {
  if (state.extracting) return;
  state.extracting = true;
  const warped = warpBoardFromCorners();
  if (!warped || !state.warpedImageData) {
    setStatus(extractStatus, "Need image + OpenCV ready before extraction.");
    state.extracting = false;
    return;
  }

  const n = state.boardSize;
  const size = warpCanvas.width;
  const boardStep = (size - 1) / (n - 1);
  const circleCandidates = detectCircleCandidates(boardStep);
  const points = circlesToIntersections(circleCandidates, n, boardStep);
  const samplingStep = boardStep;

  if (!points.length) {
    state.manualEdits = {};
    state.rawStones = [];
    state.stones = [];
    renderWarpAndStoneMarkers([], boardStep);
    renderStoneTable([]);
    drawSgfPreview([], n);
    setStatus(extractStatus, "No circles detected on intersections. Try crop, corner box, or different image.");
    state.extracting = false;
    return;
  }

  let blackThreshold = Math.max(1, Number(blackThresholdInput.value) || DEFAULT_BLACK_THRESHOLD);
  let whiteThreshold = Math.max(1, Number(whiteThresholdInput.value) || DEFAULT_WHITE_THRESHOLD);
  const autoBalance = Boolean(autoBalanceCheckbox?.checked);
  const rCenter = Math.max(2, samplingStep * 0.34);
  const rRingInner = samplingStep * 0.48;
  const rRingOuter = samplingStep * 0.72;

  function classifyPointsWithThresholds(blackT, whiteT) {
    const out = [];
    for (const point of points) {
      const centerMean = sampleCircleStats(state.warpedImageData, point.x, point.y, 0, rCenter);
      const ringMean = sampleCircleStats(state.warpedImageData, point.x, point.y, rRingInner, rRingOuter);
      const delta = Number((ringMean - centerMean).toFixed(2));
      const result = classifyStone(delta, blackT, whiteT);
      if (result.color === "empty") continue;
      const radius =
        point.r || estimateStoneRadius(state.warpedImageData, point.x, point.y, samplingStep, result.color);
      const confidence = Number(confidenceFromDelta(delta, result.color, blackT, whiteT).toFixed(3));

      out.push({
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
        confidence,
      });
    }
    return out;
  }

  let stones = [];
  let whiteRescueMeta = null;
  let confidenceRebalanceMeta = null;
  let autoBalanceNote = "";
  if (autoBalance) {
    setAutoBalanceBusy(true);
    const bump = 2;
    const maxLoops = 10;
    let loops = 0;
    let balanced = false;
    await nextFrame();
    while (loops < maxLoops) {
      loops += 1;
      stones = classifyPointsWithThresholds(blackThreshold, whiteThreshold);
      const blackCountLoop = stones.filter((s) => s.color === "black").length;
      const whiteCountLoop = stones.filter((s) => s.color === "white").length;
      const blackTooHigh = blackCountLoop > whiteCountLoop * 1.2;
      const whiteTooHigh = whiteCountLoop > blackCountLoop * 1.2;
      if (!blackTooHigh && !whiteTooHigh) {
        balanced = true;
        break;
      }
      if (blackTooHigh) {
        const next = Math.min(80, blackThreshold + bump);
        if (next === blackThreshold) break;
        blackThreshold = next;
      } else if (whiteTooHigh) {
        const next = Math.min(80, whiteThreshold + bump);
        if (next === whiteThreshold) break;
        whiteThreshold = next;
      }
      await nextFrame();
    }
    setAutoBalanceBusy(false);
    autoBalanceNote = balanced
      ? ` Auto-balance converged in ${loops} loop${loops === 1 ? "" : "s"}.`
      : ` Auto-balance stopped after ${loops} loop${loops === 1 ? "" : "s"}.`;
  } else {
    stones = classifyPointsWithThresholds(blackThreshold, whiteThreshold);
  }

  if (stones.length) {
    const occupied = new Set(stones.map((s) => `${s.imgRow},${s.imgCol}`));
    const whiteRescue = collectWhiteRescueStones(n, boardStep, occupied, whiteThreshold);
    whiteRescueMeta = whiteRescue.meta;
    if (whiteRescue.stones.length) {
      const byPoint = new Map(stones.map((s) => [`${s.imgRow},${s.imgCol}`, s]));
      for (const extra of whiteRescue.stones) {
        byPoint.set(`${extra.imgRow},${extra.imgCol}`, extra);
      }
      stones = [...byPoint.values()];
    }
  }

  if (autoBalance && stones.length > 30) {
    const rebalance = rebalanceByConfidence(stones, 31, 0.2);
    stones = rebalance.stones;
    confidenceRebalanceMeta = rebalance;
  }

  state.manualEdits = {};
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
  const det = state.lastDetectionMeta;
  const detectText =
    det && det.usedQuadrants
      ? `Detection (${detectionModeLabel(det.mode)}): base=${det.baseRaw}, tiled=${det.tiledRaw}, merged=${det.merged}. `
      : det
      ? `Detection (${detectionModeLabel(det.mode)}): base=${det.baseRaw}, merged=${det.merged}. `
      : "";
  const whiteRescueText =
    whiteRescueMeta && whiteRescueMeta.rescued > 0
      ? ` White rescue added ${whiteRescueMeta.rescued} candidates (rim threshold ${whiteRescueMeta.rimThreshold}).`
      : "";
  const confidenceRebalanceText =
    confidenceRebalanceMeta && confidenceRebalanceMeta.removed > 0
      ? ` Confidence rebalance removed ${confidenceRebalanceMeta.removed} low-confidence ${confidenceRebalanceMeta.dominant} stones (imbalance ${Math.round(confidenceRebalanceMeta.initialImbalance * 100)}% -> ${Math.round(confidenceRebalanceMeta.finalImbalance * 100)}%).`
      : "";
  setStatus(
    sgfStatus,
    `${detectText}Circle scan found ${circleCandidates.length} circle candidates, ${points.length} on-grid hits, ${stones.length} classified stones (${blackCount} black, ${whiteCount} white). Thresholds: B=${blackThreshold}, W=${whiteThreshold}.${autoBalanceNote}${whiteRescueText}${confidenceRebalanceText}`
  );
  state.extracting = false;
}
