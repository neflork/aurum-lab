import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCandles, loadHyperliquid } from '../lib/hyperliquid.ts';
const start = Date.UTC(2024, 0, 1),
  hour = 3600000;
const candles = () =>
  Array.from({ length: 302 }, (_, i) => ({
    t: start + i * hour,
    T: start + (i + 1) * hour - 1,
    s: 'xyz:GOLD',
    i: '1h',
    o: '2000',
    h: '2002',
    l: '1998',
    c: '2001',
  }));
test('Hyperliquid adapter drops unfinished and future candles and sorts closed candles', () => {
  const rows = candles(),
    now = start + 301 * hour + 1000;
  const bars = normalizeCandles(rows.reverse(), '1h', now);
  assert.equal(bars.length, 301);
  assert.equal(bars[0].time, new Date(start).toISOString());
  assert.equal(bars.at(-1).time, new Date(start + 300 * hour).toISOString());
});
test('Hyperliquid adapter rejects wrong coin, interval, timestamps and short history', () => {
  for (const patch of [{ s: 'BTC' }, { i: '15m' }, { T: NaN }]) {
    const rows = candles();
    Object.assign(rows[0], patch);
    assert.throws(() => normalizeCandles(rows, '1h', start + 400 * hour));
  }
  assert.throws(
    () => normalizeCandles(candles().slice(0, 299), '1h', start + 400 * hour),
    /300/,
  );
});
test('Hyperliquid adapter rejects corrupt OHLC and duplicate timestamps', () => {
  const a = candles();
  a[10].h = '1';
  assert.throws(() => normalizeCandles(a, '1h', start + 400 * hour), /OHLC/);
  const b = candles();
  b[10] = { ...b[9] };
  assert.throws(() => normalizeCandles(b, '1h', start + 400 * hour), /время/);
});
test('Hyperliquid loader validates interval before making any network call', async () => {
  await assert.rejects(() => loadHyperliquid('fake'), /интервал/);
});
