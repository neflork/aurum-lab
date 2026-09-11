import test from "node:test";
import assert from "node:assert/strict";
import { chartCursor, visibleRange } from "../lib/chart-math.ts";

const plot = {
  left: 18,
  right: 78,
  top: 22,
  bottom: 38,
  width: 980,
  height: 440,
};

test("visible range clamps navigation and zoom to available bars", () => {
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

test("crosshair clamps edge positions and maps price/index", () => {
  const topLeft = chartCursor(-100, -100, plot, 500, 100, 4200, 4400);
  assert.equal(topLeft.index, 500);
  assert.equal(topLeft.price, 4400);
  const bottomRight = chartCursor(2000, 2000, plot, 500, 100, 4200, 4400);
  assert.equal(bottomRight.index, 599);
  assert.equal(bottomRight.price, 4200);
});
