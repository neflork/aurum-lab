import { HL_INTERVALS, type HLInterval } from './hyperliquid.ts';
import type { Bar } from './market-types.ts';

export function candleGaps(bars: Bar[], interval: HLInterval) {
  const step = HL_INTERVALS[interval];
  const gaps: { from: number; to: number; count: number }[] = [];
  for (let i = 1; i < bars.length; i++) {
    const from = Date.parse(bars[i - 1].time) + step;
    const to = Date.parse(bars[i].time) - step;
    if (from <= to) gaps.push({ from, to, count: (to - from) / step + 1 });
  }
  return gaps;
}

// Do not stitch a missing period into apparently consecutive training samples.
export function latestContinuousBars(bars: Bar[], interval: HLInterval) {
  const step = HL_INTERVALS[interval];
  let start = bars.length - 1;
  while (
    start > 0 &&
    Date.parse(bars[start].time) - Date.parse(bars[start - 1].time) === step
  )
    start--;
  return bars.slice(Math.max(start, bars.length - 5000));
}
