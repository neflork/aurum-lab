import test from 'node:test';
import assert from 'node:assert/strict';
import {
  demoBars,
  parseCSV,
  barsCSV,
  defaults,
  research,
  trainModel,
  decision,
  strategies,
  backtest,
  validateConfig,
} from '../lib/engine.ts';

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-7, actual + ' != ' + expected);
const bar = (i, open, high, low, close) => ({
  time: new Date(Date.UTC(2024, 0, 1, i)).toISOString(),
  open,
  high,
  low,
  close,
});
const config = {
  ...defaults,
  capital: 10000,
  allocation: 50,
  spread: 0,
  slippage: 0,
  commission: 0,
  stop: 10,
  take: 20,
};

test('synthetic data roundtrips through CSV and remains deterministic', () => {
  const a = demoBars(300);
  assert.deepEqual(a, demoBars(300));
  assert.deepEqual(parseCSV(barsCSV(a)), a);
});
test('reject invalid CSV, duplicates, reversed candles and OHLC violations', () => {
  assert.throws(() => parseCSV('time,open,high,low,close\n'));
  const a = demoBars(300);
  a[10].time = a[9].time;
  assert.throws(() => parseCSV(barsCSV(a)), /время/);
  const b = demoBars(300);
  b[15].high = b[15].low - 1;
  assert.throws(() => parseCSV(barsCSV(b)), /OHLC/);
  assert.throws(
    () => parseCSV(barsCSV(demoBars(300)).replace('time,', 'date,')),
    /Заголовок/,
  );
});
test('timezone-free timestamps are interpreted as UTC and Unix seconds accepted', () => {
  const a = demoBars(300),
    csv = barsCSV(a).replaceAll('.000Z', '');
  assert.deepEqual(parseCSV(csv), a);
  const unix = barsCSV(a).replaceAll(/2024-[^,\n]+/g, (v) =>
    String(Date.parse(v) / 1000),
  );
  assert.deepEqual(parseCSV(unix), a);
});
test('finite parameter bounds enforced', () => {
  for (const capital of [NaN, Infinity, 0, -100])
    assert.throws(() => validateConfig({ ...defaults, capital }));
  assert.throws(() => validateConfig({ ...defaults, allocation: 101 }));
});
test('next-open execution and both sides of costs match hand calculation', () => {
  const c = { ...config, spread: 2, commission: 0.1 };
  const r = backtest(
    [bar(0, 80, 80, 80, 80), bar(1, 100, 106, 99, 105)],
    [1, 0],
    1,
    2,
    c,
  );
  assert.equal(r.trades.length, 1);
  near(r.trades[0].entry, 101);
  near(r.trades[0].exit, 104);
  const q = 5000 / 101.1;
  near(r.trades[0].pnl, q * (3 - 0.2));
  near(r.finalCapital, 10000 + q * (3 - 0.2));
  assert.equal(r.trades[0].entryTime, bar(1, 0, 0, 0, 0).time);
});
test('short side has correct adverse fill direction and PnL', () => {
  const r = backtest(
    [bar(0, 100, 100, 100, 100), bar(1, 100, 101, 94, 95)],
    [-1, 0],
    1,
    2,
    { ...config, spread: 2 },
  );
  near(r.trades[0].entry, 99);
  near(r.trades[0].exit, 96);
  near(r.trades[0].pnl, (5000 / 101) * 3);
});
test('stop wins when stop and take are touched in the same candle', () => {
  const r = backtest(
    [bar(0, 100, 100, 100, 100), bar(1, 100, 102, 98, 100)],
    [1, 0],
    1,
    2,
    { ...config, stop: 1, take: 1 },
  );
  near(r.trades[0].exit, 99);
  assert.match(r.trades[0].reason, /оба/);
  assert.ok(r.returnPct < 0);
});
test('gap through a stop executes at open without immediate reentry', () => {
  const bars = [
    bar(0, 100, 100, 100, 100),
    bar(1, 100, 100.5, 99.5, 100),
    bar(2, 95, 96, 94, 95),
  ];
  const r = backtest(bars, [1, 1, 0], 1, 3, { ...config, stop: 1, take: 5 });
  assert.equal(r.trades.length, 1);
  near(r.trades[0].exit, 95);
  assert.match(r.trades[0].reason, /разрыв/);
});
test('neutral signals preserve initial capital without fees', () => {
  const r = backtest(demoBars(300), Array(300).fill(0), 60, 300, defaults);
  assert.equal(r.finalCapital, defaults.capital);
  assert.equal(r.drawdownPct, 0);
  assert.equal(r.trades.length, 0);
  assert.equal(r.winRate, null);
});
test('features and technical decisions never read future prices', () => {
  const a = demoBars(300),
    b = structuredClone(a),
    m = trainModel(a, 180);
  for (let i = 151; i < b.length; i++)
    for (const key of ['open', 'high', 'low', 'close']) b[i][key] *= 3;
  for (const s of strategies)
    assert.equal(decision(a, 150, s, m), decision(b, 150, s, m));
});
test('model excludes labels and features outside training partition', () => {
  const a = demoBars(300),
    b = structuredClone(a);
  for (let i = 180; i < b.length; i++)
    for (const key of ['open', 'high', 'low', 'close']) b[i][key] *= 2;
  assert.deepEqual(trainModel(a, 180), trainModel(b, 180));
});
test('changing final test cannot change fitted model, validation ranking or winner', () => {
  const a = demoBars(600),
    b = structuredClone(a);
  for (let i = 480; i < b.length; i++)
    for (const key of ['open', 'high', 'low', 'close'])
      b[i][key] *= 1 + (i - 479) * 0.002;
  const r = research(a, defaults),
    s = research(b, defaults);
  assert.deepEqual(r.model, s.model);
  assert.deepEqual(r.candidates, s.candidates);
  assert.deepEqual(r.selected, s.selected);
  assert.ok(r.model.weights.some((w) => Math.abs(w) > 0.001));
  assert.equal(r.model.samples, 339);
});
test('flat market has no eligible strategies and no forced trade', () => {
  const bars = Array.from({ length: 300 }, (_, i) =>
    bar(i, 100, 100, 100, 100),
  );
  const r = research(bars, defaults);
  assert.equal(r.selected, null);
  assert.equal(r.test, null);
  assert.equal(r.admitted, false);
  assert.equal(r.latest.direction, 0);
});
test('a protective level already crossed at entry fills at current open, never at a better fictitious level', () => {
  const r = backtest(
    [bar(0, 100, 100, 100, 100), bar(1, 100, 101, 99, 100)],
    [1, 0],
    1,
    2,
    { ...config, spread: 10, stop: 1 },
  );
  near(r.trades[0].entry, 105);
  near(r.trades[0].exit, 95);
  assert.match(r.trades[0].reason, /при входе/);
});
test('reject calendar dates normalized by JavaScript instead of accepting fabricated days', () => {
  const csv = barsCSV(demoBars(300)).replace(
    '2024-01-02T00:00:00.000Z',
    '2024-02-31T00:00:00Z',
  );
  assert.throws(() => parseCSV(csv), /календарная дата/);
});
