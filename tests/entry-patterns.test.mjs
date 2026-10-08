import test from 'node:test';
import assert from 'node:assert/strict';
import { findEntryPatterns } from '../lib/entry-patterns.ts';

const bar = (i, open = 100, high = 101, low = 99, close = 100) => ({
  time: new Date(Date.UTC(2026, 0, 1, i)).toISOString(),
  open,
  high,
  low,
  close,
});
const base = () => Array.from({ length: 40 }, (_, i) => bar(i));

test('flat candles and insufficient history do not produce entry models', () => {
  assert.deepEqual(findEntryPatterns([]), []);
  assert.deepEqual(findEntryPatterns(base()), []);
});

test('sweep requires future confirmation and has correctly ordered long risk levels', () => {
  const bars = base();
  bars[12] = bar(12, 108, 118, 107, 112);
  bars[25] = bar(25, 97, 98, 94, 96);
  bars[39] = bar(39, 95, 101, 93, 100);
  const pattern = findEntryPatterns(bars).find(
    (item) => item.id === 'sweep-long',
  );
  assert.ok(pattern);
  assert.equal(pattern.status, 'waiting');
  assert.ok(pattern.stop < pattern.entry && pattern.entry < pattern.target);
  assert.equal(pattern.target, 118);
  assert.equal(pattern.targetKind, 'structure');
  assert.ok(pattern.rr >= 1.5);
});

test('short sweep mirrors long levels', () => {
  const bars = base();
  bars[12] = bar(12, 90, 91, 82, 88);
  bars[25] = bar(25, 103, 106, 102, 104);
  bars[39] = bar(39, 105, 107, 99, 100);
  const pattern = findEntryPatterns(bars).find(
    (item) => item.id === 'sweep-short',
  );
  assert.ok(pattern);
  assert.ok(pattern.target < pattern.entry && pattern.entry < pattern.stop);
  assert.equal(pattern.target, 82);
});

test('breakout and retest is confirmed only while the level holds', () => {
  const bars = base();
  bars[20] = bar(20, 102, 105, 101, 103);
  bars[37] = bar(37, 100, 107, 99, 106);
  bars[38] = bar(38, 106, 109, 106, 108);
  bars[39] = bar(39, 106, 109, 105, 108);
  const pattern = findEntryPatterns(bars).find(
    (item) => item.id === 'retest-long',
  );
  assert.ok(pattern);
  assert.equal(pattern.status, 'confirmed');
  assert.equal(pattern.entry, 108);
  assert.equal(pattern.targetKind, 'projection');
  bars[38] = bar(38, 106, 107, 103, 104);
  assert.equal(
    findEntryPatterns(bars).some((item) => item.id === 'retest-long'),
    false,
  );
});

test('a nearby resistance rejects a long entry with insufficient reward', () => {
  const bars = base();
  bars[12] = bar(12, 101, 103, 100, 102);
  bars[25] = bar(25, 97, 98, 94, 96);
  bars[39] = bar(39, 95, 101, 93, 100);
  assert.equal(
    findEntryPatterns(bars).some((item) => item.id === 'sweep-long'),
    false,
  );
});

test('trend pullback requires reversal past the previous candle extreme', () => {
  const bars = base();
  bars[4] = bar(4, 108, 112, 107, 110);
  bars[10] = bar(10, 96, 98, 94, 97);
  bars[20] = bar(20, 110, 120, 109, 115);
  bars[29] = bar(29, 99, 100, 97, 99);
  bars[37] = bar(37, 102, 103, 98, 100);
  bars[38] = bar(38, 100, 101, 98, 99);
  bars[39] = bar(39, 98, 103, 97, 102);
  assert.equal(
    findEntryPatterns(bars).find((item) => item.id === 'pullback-long')?.status,
    'confirmed',
  );
  bars[39] = bar(39, 98, 101, 97, 100);
  assert.equal(
    findEntryPatterns(bars).some((item) => item.id === 'pullback-long'),
    false,
  );
});
