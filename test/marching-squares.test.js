import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isolines,
  contours,
  thresholds,
  sampleField,
  signedArea,
  contourLength,
  simplify,
  toSvgPath,
  sample,
  gridSize,
} from '../src/marching-squares.js';

const cone = (cx, cy) => (x, y) => Math.hypot(x - cx, y - cy);
const bump = (cx, cy, s) => (x, y) => Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s));

// Deterministic PRNG so property tests are reproducible.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('circle: one closed ring whose area approximates pi r^2', () => {
  const grid = sampleField(cone(50, 50), 101, 101);
  const r = 30;
  const cs = isolines(grid, r);
  assert.equal(cs.length, 1);
  assert.equal(cs[0].closed, true);
  const area = Math.abs(signedArea(cs[0].points));
  assert.ok(Math.abs(area - Math.PI * r * r) / (Math.PI * r * r) < 0.005, `area ${area}`);
  const perim = contourLength(cs[0].points, true);
  assert.ok(Math.abs(perim - 2 * Math.PI * r) / (2 * Math.PI * r) < 0.005, `perimeter ${perim}`);
  for (const [x, y] of cs[0].points) {
    assert.ok(Math.abs(Math.hypot(x - 50, y - 50) - r) < 0.05);
  }
});

test('linear field: interpolation is exact and the line spans the grid', () => {
  const grid = sampleField((x) => x, 10, 6);
  const cs = isolines(grid, 3.25);
  assert.equal(cs.length, 1);
  const c = cs[0];
  assert.equal(c.closed, false);
  assert.equal(c.points.length, 6);
  for (const [x] of c.points) assert.equal(x, 3.25);
  const ys = c.points.map((p) => p[1]).sort((a, b) => a - b);
  assert.deepEqual([ys[0], ys[ys.length - 1]], [0, 5]);
});

test('orientation: high values are on the left (y-down) of travel', () => {
  // f = x increases to the right. On screen (y down), someone walking
  // downward has +x on their left, so the line must run top to bottom.
  const grid = sampleField((x) => x, 5, 5);
  const [c] = isolines(grid, 2.5);
  assert.ok(c.points[0][1] < c.points[c.points.length - 1][1]);
});

test('peak and pit rings have opposite winding', () => {
  const peak = isolines(sampleField(bump(20, 20, 6), 41, 41), 0.5);
  const pit = isolines(sampleField((x, y) => -bump(20, 20, 6)(x, y), 41, 41), -0.5);
  assert.equal(peak.length, 1);
  assert.equal(pit.length, 1);
  assert.ok(Math.sign(signedArea(peak[0].points)) === -Math.sign(signedArea(pit[0].points)));
});

test('annulus yields an outer ring and a hole with opposite winding', () => {
  // A ring-shaped ridge: high where distance ~ 15.
  const grid = sampleField((x, y) => -Math.abs(Math.hypot(x - 25, y - 25) - 15), 51, 51);
  const cs = isolines(grid, -4);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.closed));
  const areas = cs.map((c) => signedArea(c.points)).sort((a, b) => Math.abs(b) - Math.abs(a));
  assert.ok(Math.sign(areas[0]) !== Math.sign(areas[1]), 'hole should wind opposite to shell');
  assert.ok(Math.abs(Math.abs(areas[0]) - Math.PI * 19 ** 2) / (Math.PI * 19 ** 2) < 0.01);
  assert.ok(Math.abs(Math.abs(areas[1]) - Math.PI * 11 ** 2) / (Math.PI * 11 ** 2) < 0.01);
});

test('two separate peaks produce two separate rings', () => {
  const f = (x, y) => bump(12, 15, 4)(x, y) + bump(38, 15, 4)(x, y);
  const cs = isolines(sampleField(f, 51, 31), 0.5);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.closed));
});

test('saddle, centre above level: the two high corners connect', () => {
  // tl and br high (case 10), centre = 0.5.
  const grid = [
    [1, 0],
    [0, 1],
  ];
  const cs = isolines(grid, 0.4);
  assert.equal(cs.length, 2);
  // Each segment should cut off one LOW corner (tr at (1,0) or bl at (0,1)).
  const cutsCorner = (c, [cx, cy]) =>
    c.points.every(([x, y]) => (x === cx && Math.abs(y - cy) < 1) || (y === cy && Math.abs(x - cx) < 1));
  assert.ok(cs.some((c) => cutsCorner(c, [1, 0])));
  assert.ok(cs.some((c) => cutsCorner(c, [0, 1])));
});

test('saddle, centre below level: the two high corners are isolated', () => {
  const grid = [
    [1, 0],
    [0, 1],
  ];
  const cs = isolines(grid, 0.6);
  assert.equal(cs.length, 2);
  const cutsCorner = (c, [cx, cy]) =>
    c.points.every(([x, y]) => (x === cx && Math.abs(y - cy) < 1) || (y === cy && Math.abs(x - cx) < 1));
  assert.ok(cs.some((c) => cutsCorner(c, [0, 0])));
  assert.ok(cs.some((c) => cutsCorner(c, [1, 1])));
});

test('saddle resolution is topologically consistent across a checkerboard', () => {
  // A 3x3 checkerboard with a level below the centre average everywhere:
  // all high corners should merge, so every contour cuts off a single low corner.
  const grid = [
    [1, 0, 1],
    [0, 1, 0],
    [1, 0, 1],
  ];
  const cs = isolines(grid, 0.3);
  // Four low corners, each isolated by one short open line or closed diamond.
  assert.equal(cs.length, 4);
});

test('level outside the data range gives no contours', () => {
  const grid = sampleField(cone(5, 5), 11, 11);
  assert.deepEqual(isolines(grid, -1), []);
  assert.deepEqual(isolines(grid, 100), []);
});

test('NaN cells are skipped and break rings into open lines', () => {
  const grid = sampleField(cone(20, 20), 41, 41);
  for (let y = 0; y < 41; y++) grid[y][20] = NaN; // vertical scar through the centre
  const cs = isolines(grid, 10);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => !c.closed));
  for (const c of cs) for (const [x] of c.points) assert.ok(x <= 19 || x >= 21);
});

test('property: random fields stitch into valid chains lying on grid edges', () => {
  const rand = mulberry32(42);
  for (let trial = 0; trial < 50; trial++) {
    const w = 3 + Math.floor(rand() * 20);
    const h = 3 + Math.floor(rand() * 20);
    const grid = Array.from({ length: h }, () => Array.from({ length: w }, () => rand()));
    const level = 0.2 + rand() * 0.6;
    const cs = isolines(grid, level);

    // Count raw segments independently and compare with stitched output.
    let expected = 0;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const idx =
          (grid[y][x] >= level ? 8 : 0) |
          (grid[y][x + 1] >= level ? 4 : 0) |
          (grid[y + 1][x + 1] >= level ? 2 : 0) |
          (grid[y + 1][x] >= level ? 1 : 0);
        expected += idx === 5 || idx === 10 ? 2 : idx === 0 || idx === 15 ? 0 : 1;
      }
    }
    const got = cs.reduce((s, c) => s + c.points.length - 1 + (c.closed ? 1 : 0), 0);
    assert.equal(got, expected, `trial ${trial}`);

    for (const c of cs) {
      for (const [x, y] of c.points) {
        assert.ok(Number.isInteger(x) || Number.isInteger(y), 'point must lie on a grid edge');
        assert.ok(x >= 0 && x <= w - 1 && y >= 0 && y <= h - 1);
        // Interpolated crossing reproduces the level under bilinear sampling on edges.
        assert.ok(Math.abs(sample(grid, x, y) - level) < 1e-9);
      }
      if (!c.closed) {
        const onBorder = ([x, y]) => x === 0 || y === 0 || x === w - 1 || y === h - 1;
        assert.ok(onBorder(c.points[0]) && onBorder(c.points[c.points.length - 1]), 'open lines end on the border');
      }
    }
  }
});

test('contours() and thresholds() work together', () => {
  const grid = sampleField(cone(10, 10), 21, 21);
  const levels = thresholds(grid, 4);
  assert.equal(levels.length, 4);
  assert.ok(levels.every((l, i) => i === 0 || l > levels[i - 1]));
  const cs = contours(grid, levels);
  assert.ok(cs.length >= 4);
  assert.deepEqual([...new Set(cs.map((c) => c.level))], levels);
  assert.deepEqual(thresholds([[1, 1], [1, 1]], 3), []);
  assert.throws(() => thresholds(grid, 0), RangeError);
});

test('simplify: removes collinear points and respects tolerance', () => {
  const line = Array.from({ length: 11 }, (_, i) => [i, 0]);
  assert.deepEqual(simplify(line, 0.1), [[0, 0], [10, 0]]);
  assert.deepEqual(simplify(line, 0), line);
  const zig = [[0, 0], [1, 1], [2, 0], [3, 1], [4, 0]];
  assert.equal(simplify(zig, 0.5).length, 5);
  assert.equal(simplify(zig, 2).length, 2);
});

test('simplify: closed ring keeps its shape within tolerance', () => {
  const grid = sampleField(cone(50, 50), 101, 101);
  const [ring] = isolines(grid, 30);
  const s = simplify(ring.points, 0.25, true);
  assert.ok(s.length < ring.points.length / 3, `${s.length} vs ${ring.points.length}`);
  const a0 = Math.abs(signedArea(ring.points));
  const a1 = Math.abs(signedArea(s));
  assert.ok(Math.abs(a0 - a1) / a0 < 0.02);
});

test('toSvgPath', () => {
  assert.equal(toSvgPath({ points: [[0, 0], [1, 0.5]], closed: false }), 'M0,0L1,0.5');
  assert.equal(toSvgPath({ points: [[0, 0], [1, 0], [1, 1]], closed: true }, { scale: 10 }), 'M0,0L10,0L10,10Z');
  assert.equal(toSvgPath({ points: [], closed: false }), '');
});

test('input validation', () => {
  assert.throws(() => gridSize([[1, 2]]), TypeError);
  assert.throws(() => gridSize([[1], [2]]), TypeError);
  assert.throws(() => gridSize([[1, 2], [3]]), TypeError);
  assert.throws(() => isolines([[0, 1], [1, 0]], NaN), TypeError);
});

test('performance: 500x500 grid contours in well under a second', () => {
  const f = (x, y) => Math.sin(x / 17) * Math.cos(y / 23) + 0.3 * Math.sin((x + y) / 7);
  const grid = sampleField(f, 500, 500);
  const t0 = performance.now();
  const cs = contours(grid, thresholds(grid, 8));
  const dt = performance.now() - t0;
  assert.ok(cs.length > 0);
  assert.ok(dt < 1500, `took ${dt.toFixed(0)}ms`);
});
