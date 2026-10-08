import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, demoBars, research } from '../lib/engine.ts';
import {
  loadResearchSnapshot,
  saveResearchSnapshot,
  researchMatches,
  RESEARCH_CACHE_KEY,
} from '../lib/research-cache.ts';

const bars = demoBars(400);
const experiment = research(bars, defaults);
const market = {
  bars,
  coin: 'xyz:GOLD',
  venue: 'Hyperliquid / trade[XYZ]',
  interval: '15m',
  fetchedAt: new Date().toISOString(),
  midPrice: bars.at(-1).close,
  priceType: 'trade',
  instrumentType: 'perpetual',
  endpoint: 'https://api.hyperliquid.xyz/info',
};
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

test('completed research, timeframe and signal inputs survive a page reload', () => {
  const storage = memory();
  assert.equal(saveResearchSnapshot(storage, { market, experiment }), true);
  const loaded = loadResearchSnapshot(storage);
  assert.deepEqual(loaded, { market, experiment });
  assert.equal(researchMatches(loaded.experiment, bars, defaults), true);
  assert.equal(loaded.market.interval, '15m');
});

test('changed candles or settings require new research', () => {
  const changed = bars.map((b) => ({ ...b }));
  changed.at(-1).close += 0.01;
  assert.equal(researchMatches(experiment, changed, defaults), false);
  assert.equal(
    researchMatches(experiment, bars, { ...defaults, stop: 1 }),
    false,
  );
  assert.equal(researchMatches(null, bars, defaults), false);
});

test('invalid, outdated or mismatched snapshots are ignored', () => {
  const storage = memory();
  for (const mutate of [
    (value) => {
      value.schema = 0;
    },
    (value) => {
      value.experiment.version = 'old';
    },
    (value) => {
      value.experiment.model.weights = [];
    },
    (value) => {
      value.market.bars[0].close = -1;
    },
    (value) => {
      value.experiment.fingerprint = 'mismatch';
    },
    (value) => {
      value.market.interval = 'unknown';
    },
    (value) => {
      value.experiment.test = {};
    },
  ]) {
    saveResearchSnapshot(storage, { market, experiment });
    const value = JSON.parse(storage.getItem(RESEARCH_CACHE_KEY));
    mutate(value);
    storage.setItem(RESEARCH_CACHE_KEY, JSON.stringify(value));
    assert.equal(loadResearchSnapshot(storage), null);
  }
  storage.setItem(RESEARCH_CACHE_KEY, '{broken');
  assert.equal(loadResearchSnapshot(storage), null);
});

test('storage failures never stop live analysis or research', () => {
  const storage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('quota');
    },
  };
  assert.equal(loadResearchSnapshot(storage), null);
  assert.equal(saveResearchSnapshot(storage, { market, experiment }), false);
});
