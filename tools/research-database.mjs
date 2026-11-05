import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  GOLD_COIN,
  HL_INTERVALS,
  normalizeCandleBatch,
} from '../lib/hyperliquid.ts';

export function openResearchDatabase(filename) {
  mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS research (
      id INTEGER PRIMARY KEY, identity TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL, interval TEXT NOT NULL, fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL, saved_at TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS candles (
      research_id INTEGER NOT NULL REFERENCES research(id), time TEXT NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      PRIMARY KEY (research_id, time)
    );
    CREATE TABLE IF NOT EXISTS application_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      latest_research_id INTEGER NOT NULL REFERENCES research(id)
    );
    CREATE TABLE IF NOT EXISTS market_candles (
      coin TEXT NOT NULL, interval TEXT NOT NULL, time TEXT NOT NULL,
      open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
      PRIMARY KEY (coin, interval, time)
    );
    CREATE TABLE IF NOT EXISTS market_series (
      coin TEXT NOT NULL, interval TEXT NOT NULL, initialized INTEGER NOT NULL,
      metadata TEXT NOT NULL, last_repair INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (coin, interval)
    );
    PRAGMA user_version=2;`);
  function marketHistory(interval) {
    if (!Object.hasOwn(HL_INTERVALS, interval))
      throw new Error('Недопустимый интервал.');
    const series = db
      .prepare('SELECT * FROM market_series WHERE coin=? AND interval=?')
      .get(GOLD_COIN, interval);
    if (!series) return null;
    const bars = db
      .prepare(`SELECT time,open,high,low,close FROM market_candles
      WHERE coin=? AND interval=? ORDER BY time`)
      .all(GOLD_COIN, interval);
    return {
      ...JSON.parse(series.metadata),
      bars,
      initialized: Boolean(series.initialized),
      lastRepair: series.last_repair,
    };
  }
  function mergeMarket(
    dataset,
    { initialized = true, repairedAt = 0, now = Date.now() } = {},
  ) {
    const { interval } = dataset;
    if (
      dataset.coin !== GOLD_COIN ||
      !Object.hasOwn(HL_INTERVALS, interval) ||
      !Number.isFinite(dataset.midPrice) ||
      dataset.midPrice <= 0 ||
      !Number.isFinite(Date.parse(dataset.fetchedAt))
    )
      throw new Error('Некорректный источник свечей.');
    const bars = normalizeCandleBatch(
      dataset.bars.map((b) => ({
        t: Date.parse(b.time),
        T: Date.parse(b.time) + HL_INTERVALS[interval] - 1,
        s: GOLD_COIN,
        i: interval,
        o: b.open,
        h: b.high,
        l: b.low,
        c: b.close,
      })),
      interval,
      now,
    );
    if (bars.length !== dataset.bars.length)
      throw new Error('Нельзя сохранять незакрытые свечи.');
    const metadata = {
      coin: dataset.coin,
      venue: dataset.venue,
      interval,
      fetchedAt: dataset.fetchedAt,
      midPrice: dataset.midPrice,
      priceType: dataset.priceType,
      instrumentType: dataset.instrumentType,
      endpoint: dataset.endpoint,
    };
    let added = 0,
      corrected = 0;
    const previous = db.prepare(
      'SELECT open,high,low,close FROM market_candles WHERE coin=? AND interval=? AND time=?',
    );
    const upsert = db.prepare(`INSERT INTO market_candles VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(coin,interval,time) DO UPDATE SET open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close`);
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const b of bars) {
        const old = previous.get(GOLD_COIN, interval, b.time);
        if (!old) added++;
        else if (['open', 'high', 'low', 'close'].some((k) => old[k] !== b[k]))
          corrected++;
        upsert.run(GOLD_COIN, interval, b.time, b.open, b.high, b.low, b.close);
      }
      db.prepare(`INSERT INTO market_series VALUES (?,?,?,?,?)
        ON CONFLICT(coin,interval) DO UPDATE SET
        initialized=MAX(market_series.initialized,excluded.initialized), metadata=excluded.metadata,
        last_repair=MAX(market_series.last_repair,excluded.last_repair)`).run(
        GOLD_COIN,
        interval,
        Number(initialized),
        JSON.stringify(metadata),
        repairedAt,
      );
      db.exec('COMMIT');
      return { added, corrected };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  // One-time migration: preserve existing genuine Hyperliquid histories.
  if (!db.prepare('SELECT 1 FROM market_series LIMIT 1').get()) {
    for (const row of db
      .prepare('SELECT payload FROM research ORDER BY id')
      .all()) {
      try {
        const saved = JSON.parse(row.payload);
        if (saved?.market) mergeMarket(saved.market, { initialized: false });
      } catch {
        /* Legacy research is never executed; only valid candle archives migrate. */
      }
    }
  }
  return {
    marketHistory,
    mergeMarket,
    close() {
      db.close();
    },
  };
}
