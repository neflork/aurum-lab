export type PlotBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function visibleRange(
  total: number,
  requestedCount: number,
  requestedEnd: number | null,
  futureBars = 0,
) {
  const count = clamp(Math.round(requestedCount), 1, total);
  const end = clamp(
    requestedEnd ?? total,
    count,
    total + Math.max(0, Math.round(futureBars)),
  );
  return { start: end - count, end, count };
}

export function scaleTimeAt(
  total: number,
  start: number,
  count: number,
  nextCount: number,
  fraction: number,
) {
  const clampedCount = clamp(Math.round(nextCount), 40, Math.min(320, total));
  const anchor = start + clamp(fraction, 0, 1) * count;
  const nextStart = clamp(
    Math.round(anchor - clamp(fraction, 0, 1) * clampedCount),
    0,
    total - clampedCount,
  );
  return { count: clampedCount, end: nextStart + clampedCount };
}

export function priceViewport(
  rawLow: number,
  rawHigh: number,
  scale: number,
  offset: number,
) {
  const center = (rawHigh + rawLow) / 2 + offset;
  const halfRange = Math.max((rawHigh - rawLow) * 0.58, 0.01) * scale;
  return { low: center - halfRange, high: center + halfRange };
}

export function chartCursor(
  pointX: number,
  pointY: number,
  plot: PlotBox,
  start: number,
  count: number,
  low: number,
  high: number,
) {
  const x = clamp(pointX, plot.left, plot.width - plot.right);
  const y = clamp(pointY, plot.top, plot.height - plot.bottom);
  const plotWidth = plot.width - plot.left - plot.right;
  const plotHeight = plot.height - plot.top - plot.bottom;
  const localIndex = clamp(
    Math.floor(((x - plot.left) / plotWidth) * count),
    0,
    count - 1,
  );
  const price = high - ((y - plot.top) / plotHeight) * (high - low);
  return { x, y, index: start + localIndex, price };
}
