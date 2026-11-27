'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileStore, gridLayout, resizePanes, clampZoom, SHAPES, MAX_PROFILES } = require('../src/profiles');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tibportal-')), 'profiles.json');
}

const area = { x: 0, y: 44, width: 1200, height: 756 };

test('fixed grid sizes give the right number of cells', () => {
  assert.strictEqual(gridLayout(6, area, 4, { shape: '3x2' }).cells.length, 6);
  assert.strictEqual(gridLayout(9, area, 4, { shape: '3x3' }).cells.length, 9);
  // More sessions than cells: only the first ones fit.
  assert.strictEqual(gridLayout(10, area, 4, { shape: '2x2' }).cells.length, 4);
  // Fewer sessions than cells leaves empty cells.
  const l = gridLayout(2, area, 4, { shape: '3x3' });
  assert.strictEqual(l.cells.length, 2);
  assert.strictEqual(l.cols, 3);
  assert.strictEqual(l.rowDividers.length, 2);
});

test('every shape fills the area exactly, with no overlap', () => {
  for (const shape of SHAPES) {
    for (let n = 1; n <= MAX_PROFILES; n++) {
      const { cells } = gridLayout(n, area, 4, { shape });
      for (const c of cells) {
        assert.ok(c.x >= area.x && c.y >= area.y && c.width > 0 && c.height > 0, `${shape} n=${n}`);
        assert.ok(c.x + c.width <= area.x + area.width && c.y + c.height <= area.y + area.height, `${shape} n=${n}`);
      }
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i], b = cells[j];
        assert.ok(!(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height), `${shape} n=${n}`);
      }
    }
  }
});

test('custom pane sizes are applied and dividers sit between panes', () => {
  const l = gridLayout(2, area, 4, { shape: '2x1', colSizes: [0.75, 0.25] });
  assert.ok(Math.abs(l.cells[0].width - 897) <= 1, String(l.cells[0].width));
  assert.strictEqual(l.colDividers[0], l.cells[0].x + l.cells[0].width + 2);
  // Sizes that don't match the shape are ignored.
  const even = gridLayout(4, area, 4, { shape: '2x2', colSizes: [0.2, 0.3, 0.5] });
  assert.strictEqual(even.cells[0].width, even.cells[1].width);
});

test('resizing panes keeps a minimum size', () => {
  assert.deepStrictEqual(resizePanes([0.5, 0.5], 0, 300, 1000).map((x) => Math.round(x * 100)), [30, 70]);
  assert.deepStrictEqual(resizePanes([0.5, 0.5], 0, 0, 1000).map((x) => Math.round(x * 100)), [10, 90]);
  const three = resizePanes([1 / 3, 1 / 3, 1 / 3], 1, 900, 1000);
  assert.ok(Math.abs(three.reduce((a, b) => a + b) - 1) < 1e-9);
});

test('zoom is clamped', () => {
  assert.strictEqual(clampZoom(5), 2);
  assert.strictEqual(clampZoom(0.01), 0.3);
  assert.strictEqual(clampZoom('x'), 1);
});

test('saved layouts restore order, grid size, pane sizes and pop-outs', () => {
  const file = tmpFile();
  const s = new ProfileStore(file);
  const a = s.add('A'); const b = s.add('B'); const c = s.add('C');
  s.setMode('grid'); s.setShape('3x1'); s.setPaneSizes([0.5, 0.25, 0.25], null);
  s.setPopout(c.id, { x: 10, y: 10, width: 800, height: 600 });
  s.saveLayout('Farming');
  s.move(a.id, 2); s.setMode('tabs'); s.setShape('2x2'); s.setPopout(c.id, null);
  const r = new ProfileStore(file);
  r.applyLayout('Farming');
  assert.deepStrictEqual(r.list().map((p) => p.name), ['A', 'B', 'C']);
  assert.strictEqual(r.view.mode, 'grid');
  assert.strictEqual(r.view.shape, '3x1');
  assert.strictEqual(Math.round(r.view.colSizes[0] * 100), 50);
  assert.ok(r.isPoppedOut(c.id));
  assert.deepStrictEqual(r.gridProfiles().map((p) => p.name), ['A', 'B']);
  assert.deepStrictEqual(r.listLayouts(), [{ name: 'Farming' }]);
  r.deleteLayout('Farming');
  assert.deepStrictEqual(r.listLayouts(), []);
});

test('export has no ids or logins and import adds fresh profiles', () => {
  const src = new ProfileStore(tmpFile());
  const a = src.add('Main'); src.add('Alt 1');
  src.update(a.id, { color: '#46a758', zoom: 0.8 });
  src.saveLayout('Both');
  const exported = JSON.parse(JSON.stringify(src.exportData()));
  assert.ok(!JSON.stringify(exported).includes(a.id));
  assert.deepStrictEqual(exported.layouts[0].order, [0, 1]);

  const dst = new ProfileStore(tmpFile());
  dst.add('Main');
  const result = dst.importData(exported);
  assert.deepStrictEqual(result, { added: 2, skipped: 0, layouts: 1 });
  assert.deepStrictEqual(dst.list().map((p) => p.name), ['Main', 'Main (2)', 'Alt 1']);
  assert.strictEqual(dst.list()[1].color, '#46a758');
  assert.strictEqual(dst.list()[1].zoom, 0.8);
  assert.notStrictEqual(dst.list()[1].id, a.id);
  dst.applyLayout('Both');
  assert.deepStrictEqual(dst.list().map((p) => p.name), ['Main (2)', 'Alt 1', 'Main']);
});

test('import respects the profile limit and rejects other files', () => {
  const dst = new ProfileStore(tmpFile());
  for (let i = 0; i < MAX_PROFILES - 1; i++) dst.add();
  const r = dst.importData({ app: 'TibPortal', format: 1, profiles: [{ name: 'X' }, { name: 'Y' }] });
  assert.deepStrictEqual(r, { added: 1, skipped: 1, layouts: 0 });
  assert.throws(() => dst.importData({ hello: 1 }), /isn't a TibPortal/);
});
