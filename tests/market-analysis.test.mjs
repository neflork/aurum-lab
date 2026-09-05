import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedPivots, analyzeMarket } from '../lib/market-analysis.ts';

const bar = (index, open, high, low, close) => ({
  time: new Date(Date.UTC(2025, 0, 1, index)).toISOString(),
  open,
  high,
  low,
  close,
});

test('pivot is only confirmed after the configured right-hand candles', () => {
  const bars = [
    bar(0, 9, 10, 8, 9),
    bar(1, 10, 11, 9, 10),
    bar(2, 11, 12, 10, 11),
    bar(3, 13, 15, 12, 14),
    bar(4, 12, 13, 11, 12),
    bar(5, 11, 12, 10, 11),
    bar(6, 10, 11, 9, 10),
  ];
  const pivot = confirmedPivots(bars, 3).find((item) => item.kind === 'high');
  assert.deepEqual(pivot, { index: 3, detectedAt: 6, price: 15, kind: 'high' });
  assert.equal(confirmedPivots(bars.slice(0, 6), 3).length, 0);
});

test('higher highs and higher lows form an upward structure', () => {
  const bars = Array.from({ length: 28 }, (_, index) =>
    bar(index, 100, 101, 99, 100),
  );
  bars[4] = bar(4, 106, 110, 105, 108);
  bars[9] = bar(9, 96, 98, 94, 97);
  bars[15] = bar(15, 112, 116, 111, 114);
  bars[21] = bar(21, 99.5, 100, 97, 99.8);
  assert.equal(analyzeMarket(bars).trend, 'up');
});

test('wick beyond a known high with close below is described as return, not manipulation', () => {
  const bars = Array.from({ length: 18 }, (_, index) =>
    bar(index, 100, 101, 99, 100),
  );
  bars[4] = bar(4, 104, 110, 103, 107);
  bars[10] = bar(10, 106, 112, 105, 108);
  bars[11] = bar(11, 108, 111, 106, 109);
  const event = analyzeMarket(bars).events.find(
    (item) => item.kind === 'reclaim-down',
  );
  assert.ok(event);
  assert.match(event.detail, /не доказательство манипуляции/);
});

test('future candles cannot change an event computed for an earlier prefix', () => {
  const bars = Array.from({ length: 30 }, (_, index) =>
    bar(index, 100, 101, 99, 100),
  );
  bars[4] = bar(4, 104, 110, 103, 107);
  bars[12] = bar(12, 109, 113, 108, 112);
  const prefix = analyzeMarket(bars.slice(0, 18)).events;
  const changed = structuredClone(bars);
  for (let i = 18; i < changed.length; i++)
    changed[i] = bar(i, 500, 600, 400, 550);
  assert.deepEqual(
    analyzeMarket(changed).events.filter((event) => event.index < 18),
    prefix,
  );
});
