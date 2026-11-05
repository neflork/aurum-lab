import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreTerminal, validSavedPlan } from '../lib/terminal-state.ts';
const plan = {
  id: 'observed-1',
  name: 'Возврат',
  side: 'short',
  status: 'waiting',
  reason: 'Контекст',
  confirmation: 'Закрытие ниже 100',
  invalidation: 'Выше 105',
  entry: 100,
  stop: 105,
  target: 90,
  rr: 2,
  targetKind: 'structure',
  interval: '4h',
  created: '2026-11-05T10:00:00Z',
};
test('observed chart markers and timeframe survive the exact persisted state roundtrip', () => {
  const state = {
    plans: [plan],
    running: [plan],
    selected: plan,
    interval: '4h',
  };
  const restored = restoreTerminal(JSON.stringify(state), null);
  assert.deepEqual(restored, state);
});
test('legacy watch list restores a selected chart plan instead of only restoring its card', () => {
  const state = restoreTerminal(null, JSON.stringify([plan]));
  assert.deepEqual(state.selected, plan);
  assert.equal(state.interval, '4h');
});
test('explicitly hidden markers remain hidden on reload', () => {
  assert.equal(
    restoreTerminal(
      JSON.stringify({ running: [plan], selected: null, interval: '1h' }),
      null,
    ).selected,
    null,
  );
});
test('corrupt storage and invalid levels do not restore chart annotations', () => {
  assert.equal(validSavedPlan({ ...plan, stop: 95 }), false);
  assert.equal(validSavedPlan({ ...plan, interval: '1s' }), false);
  const restored = restoreTerminal('{broken', '[null,{}]');
  assert.deepEqual(restored.running, []);
  assert.equal(restored.selected, null);
});
