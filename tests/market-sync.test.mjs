import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openResearchDatabase } from '../tools/research-database.mjs';
import { createMarketSync } from '../tools/market-sync.mjs';
import { normalizeCandleBatch } from '../lib/hyperliquid.ts';

const hour = 3600000,
  start = Date.UTC(2026, 9, 1);
const bar = (i) => ({
  time: new Date(start + i * hour).toISOString(),
  open: 2000,
  high: 2002,
  low: 1998,
  close: 2001,
});
const dataset = (bars, now) => ({
  bars,
  interval: '1h',
  coin: 'xyz:GOLD',
  venue: 'Hyperliquid / trade[XYZ]',
  fetchedAt: new Date(now).toISOString(),
  midPrice: 2001,
  priceType: 'trade',
  instrumentType: 'perpetual',
  endpoint: 'https://api.hyperliquid.xyz/info',
});
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aurum-candles-'));
  const path = join(dir, 'history.sqlite');
  const db = openResearchDatabase(path);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { db, path };
}

test('initial history is stored before analysis, then only a three-candle overlap and new candles are requested', async (t) => {
  const { db, path } = fixture(t);
  let now = start + 600 * hour + 1000;
  const calls = [];
  const sync = createMarketSync(db, {
    clock: () => now,
    load: async (interval, signal, range) => {
      calls.push(range);
      if (calls.length === 1)
        return dataset(
          Array.from({ length: 600 }, (_, i) => bar(i)),
          now,
        );
      const b = [bar(597), bar(598), bar(599), bar(600)];
      b[2].close = 2001.5;
      return dataset(b, now);
    },
  });
  const initial = await sync('1h');
  assert.equal(initial.bars.length, 600);
  assert.equal(initial.archive.added, 600);
  assert.equal(initial.archive.mode, 'initial');
  now += hour;
  const next = await sync('1h');
  assert.equal(calls[1].startTime, start + 597 * hour);
  assert.equal(next.archive.added, 1);
  assert.equal(next.archive.corrected, 1);
  assert.equal(next.archive.total, 601);
  assert.equal(next.bars[599].close, 2001.5);
  assert.equal(new Set(next.bars.map((b) => b.time)).size, 601);
  const reopened = openResearchDatabase(path);
  assert.equal(reopened.marketHistory('1h').bars.length, 601);
  assert.equal(reopened.marketHistory('15m'), null);
  reopened.close();
});

test('reachable gaps are requested and filled, and invalid batches never alter the archive', async (t) => {
  const { db } = fixture(t);
  const now = start + 600 * hour + 1000;
  db.mergeMarket(
    dataset(
      Array.from({ length: 600 }, (_, i) => bar(i)).filter((_, i) => i !== 100),
      now,
    ),
    { now },
  );
  let requested;
  const sync = createMarketSync(db, {
    clock: () => now,
    load: async (i, s, r) => {
      requested = r;
      return dataset(
        Array.from({ length: 501 }, (_, j) => bar(j + 99)),
        now,
      );
    },
  });
  const fixed = await sync('1h');
  assert.equal(requested.startTime, start + 99 * hour);
  assert.equal(fixed.archive.missing, 0);
  assert.equal(fixed.archive.total, 600);
  const corrupt = dataset([bar(599)], now);
  corrupt.bars[0].high = 1;
  assert.throws(() => db.mergeMarket(corrupt, { now }), /OHLC/);
  assert.equal(db.marketHistory('1h').bars.at(-1).high, 2002);
});

test('an unreachable gap remains visible and analysis uses only the continuous recent segment', async (t) => {
  const { db } = fixture(t);
  const now = start + 6000 * hour + 1000;
  db.mergeMarket(
    dataset(
      [
        ...Array.from({ length: 300 }, (_, i) => bar(i)),
        ...Array.from({ length: 600 }, (_, i) => bar(i + 5400)),
      ],
      now,
    ),
    { now },
  );
  const sync = createMarketSync(db, {
    clock: () => now,
    load: async () => dataset([bar(5997), bar(5998), bar(5999)], now),
  });
  const result = await sync('1h');
  assert.equal(result.archive.missing, 5100);
  assert.equal(result.bars.length, 600);
  assert.match(result.archive.warning, /отсутствует/);
  assert.equal(db.marketHistory('1h').bars.length, 900);
});

test('network failure returns a clearly stale archive; simultaneous requests share one load', async (t) => {
  const { db } = fixture(t);
  const now = start + 600 * hour + 1000;
  db.mergeMarket(
    dataset(
      Array.from({ length: 600 }, (_, i) => bar(i)),
      now,
    ),
    { now },
  );
  let count = 0;
  const sync = createMarketSync(db, {
    clock: () => now,
    load: async () => {
      count++;
      throw new Error('offline');
    },
  });
  const [a, b] = await Promise.all([sync('1h'), sync('1h')]);
  assert.equal(count, 1);
  assert.equal(a.archive.stale, true);
  assert.match(a.archive.warning, /offline/);
  assert.deepEqual(a, b);
});

test('delta batches accept a single closed candle, reject duplicates and discard an unfinished candle', () => {
  const now = start + 2 * hour;
  const row = (i) => ({
    t: start + i * hour,
    T: start + (i + 1) * hour - 1,
    s: 'xyz:GOLD',
    i: '1h',
    o: '2000',
    h: '2002',
    l: '1998',
    c: '2001',
  });
  assert.equal(normalizeCandleBatch([row(1), row(2)], '1h', now).length, 1);
  assert.throws(
    () => normalizeCandleBatch([row(1), row(1)], '1h', now),
    /время/,
  );
});
