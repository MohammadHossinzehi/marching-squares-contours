import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseGrid, renderSvg } from '../bin/contour-svg.js';

const cli = fileURLToPath(new URL('../bin/contour-svg.js', import.meta.url));

test('parseGrid handles commas, whitespace, comments and missing values', () => {
  const g = parseGrid('# elevation\n1,2,3\n4 5 6\n7,,NaN\n');
  assert.equal(g.length, 3);
  assert.deepEqual(g[0], [1, 2, 3]);
  assert.deepEqual(g[1], [4, 5, 6]);
  assert.equal(g[2][0], 7);
  assert.ok(Number.isNaN(g[2][1]) && Number.isNaN(g[2][2]));
  assert.throws(() => parseGrid('1,2\n3'), TypeError);
});

test('renderSvg emits one path per contour with level metadata', () => {
  const grid = parseGrid('0,0,0,0\n0,4,4,0\n0,4,4,0\n0,0,0,0');
  const svg = renderSvg(grid, { levels: 3, scale: 10, simplify: 0, values: null, index: 0 });
  assert.match(svg, /^<svg /);
  const paths = svg.match(/<path /g) ?? [];
  assert.equal(paths.length, 3);
  assert.match(svg, /data-level="1"/);
  assert.match(svg, /Z"/);
});

test('CLI renders a demo and reads CSV from stdin', () => {
  const demo = execFileSync(process.execPath, [cli, '--demo', 'terrain', '--levels', '6', '--simplify', '0.2']).toString();
  assert.ok(demo.includes('</svg>'));
  assert.ok((demo.match(/<path /g) ?? []).length >= 6);
  const piped = execFileSync(process.execPath, [cli, '--values', '0.5'], { input: '0,0,0\n0,1,0\n0,0,0\n' }).toString();
  assert.equal((piped.match(/<path /g) ?? []).length, 1);
});

test('CLI reports bad options', () => {
  assert.throws(() => execFileSync(process.execPath, [cli, '--nope'], { stdio: 'pipe' }), /unknown option/);
});
