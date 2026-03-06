(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.ExtractionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
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

  function rebalanceByConfidence(stones, minTotal, imbalanceThreshold) {
    const min = Number.isFinite(minTotal) ? minTotal : 31;
    const threshold = Number.isFinite(imbalanceThreshold) ? imbalanceThreshold : 0.2;
    if (!stones || stones.length < min) {
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
    if (initialImbalance < threshold) {
      return { stones: working, removed: 0, dominant: "", initialImbalance, finalImbalance: initialImbalance };
    }

    const initialBlack = countByColor(working, "black");
    const initialWhite = countByColor(working, "white");
    const dominant = initialBlack >= initialWhite ? "black" : "white";
    let removed = 0;

    while (working.length >= min) {
      const imbalance = calcImbalance(working);
      if (imbalance < threshold) break;

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

  function mergeWhiteRescueStones(baseStones, rescueStones) {
    const base = Array.isArray(baseStones) ? baseStones : [];
    const rescue = Array.isArray(rescueStones) ? rescueStones : [];
    if (!rescue.length) return [...base];

    const byPoint = new Map(base.map((s) => [`${s.imgRow},${s.imgCol}`, s]));
    for (const extra of rescue) {
      byPoint.set(`${extra.imgRow},${extra.imgCol}`, extra);
    }
    return [...byPoint.values()];
  }

  return {
    classifyStone,
    confidenceFromDelta,
    rebalanceByConfidence,
    mergeWhiteRescueStones,
  };
});
