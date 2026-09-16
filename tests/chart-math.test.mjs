import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chartCursor,
  priceViewport,
  scaleTimeAt,
  visibleRange,
} from '../lib/chart-math.ts';

const plot = {
  left: 18,
  right: 78,
  top: 22,
  bottom: 38,
  width: 980,
  height: 440,
};

test('visible range clamps navigation and zoom to available bars', () => {
  assert.deepEqual(visibleRange(2000, 112, null), {
    start: 1888,
    end: 2000,
    count: 112,
  });
  assert.deepEqual(visibleRange(2000, 320, 100), {
    start: 0,
    end: 320,
    count: 320,
  });
});

test('visible range allows a bounded empty future area after the last bar', () => {
  assert.deepEqual(visibleRange(2000, 112, 2084, 84), {
    start: 1972,
    end: 2084,
    count: 112,
  });
  assert.deepEqual(visibleRange(2000, 112, 2400, 84), {
    start: 1972,
    end: 2084,
    count: 112,
  });
});

test('crosshair clamps edge positions and maps price/index', () => {
  const topLeft = chartCursor(-100, -100, plot, 500, 100, 4200, 4400);
  assert.equal(topLeft.index, 500);
  assert.equal(topLeft.price, 4400);
  const bottomRight = chartCursor(2000, 2000, plot, 500, 100, 4200, 4400);
  assert.equal(bottomRight.index, 599);
  assert.equal(bottomRight.price, 4200);
});

test('time scale keeps the candle under the pointer and clamps to history', () => {
  const centered = scaleTimeAt(2000, 900, 100, 50, 0.5);
  assert.deepEqual(centered, { count: 50, end: 975 });
  const leftEdge = scaleTimeAt(2000, 0, 100, 320, 0);
  assert.deepEqual(leftEdge, { count: 320, end: 320 });
  const rightEdge = scaleTimeAt(2000, 1900, 100, 320, 1);
  assert.deepEqual(rightEdge, { count: 320, end: 2000 });
});

test('price scale and vertical pan change viewport predictably', () => {
  const normal = priceViewport(100, 200, 1, 0);
  const zoomed = priceViewport(100, 200, 0.5, 0);
  const panned = priceViewport(100, 200, 1, 25);
  assert.ok(zoomed.high - zoomed.low < normal.high - normal.low);
  assert.equal(panned.low - normal.low, 25);
  assert.equal(panned.high - normal.high, 25);
});
