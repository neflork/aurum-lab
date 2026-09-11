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
) {
  const count = clamp(Math.round(requestedCount), 1, total);
  const end = clamp(requestedEnd ?? total, count, total);
  return { start: end - count, end, count };
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
