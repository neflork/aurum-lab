import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, demoBars, research } from '../lib/engine.ts';
import { analyzeMarket } from '../lib/market-analysis.ts';
import { makeTradingSignal } from '../lib/trading-signal.ts';

test('signal stays WAIT while research is unavailable', () => {
  const bars = demoBars(400);
  const signal = makeTradingSignal(bars, null, analyzeMarket(bars));
  assert.equal(signal.label, 'WAIT');
  assert.equal(signal.stop, null);
  assert.equal(signal.take, null);
});

test('preferred eligible strategy remains selected on automatic research', () => {
  const bars = demoBars();
  const initial = research(bars, defaults);
  const eligible = initial.candidates.filter((candidate) => candidate.eligible);
  assert.ok(eligible.length > 1);
  const preferred = eligible[1].strategy.id;
  const refreshed = research(bars, defaults, preferred);
  assert.equal(refreshed.selected?.id, preferred);
});

test('actionable signals require two closes and an agreeing filter', () => {
  const bars = demoBars();
  const experiment = research(bars, defaults);
  const signal = makeTradingSignal(bars, experiment, analyzeMarket(bars));
  if (signal.side !== 'wait') {
    assert.equal(signal.confirmed, true);
    assert.ok(
      signal.modelVote === signal.strategyVote ||
        signal.structureVote === signal.strategyVote,
    );
    assert.ok(signal.stop);
    assert.ok(signal.take);
  }
});
