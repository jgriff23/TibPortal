'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileStore, partitionFor, MAX_PROFILES } = require('../src/profiles');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tibportal-'));
  return path.join(dir, 'profiles.json');
}

test('adds profiles with default names and persists them', () => {
  const file = tmpFile();
  const store = new ProfileStore(file);
  const a = store.add();
  const b = store.add();
  assert.strictEqual(a.name, 'Main');
  assert.strictEqual(b.name, 'Alt 1');
  assert.strictEqual(store.activeId, b.id);

  const reloaded = new ProfileStore(file);
  assert.deepStrictEqual(reloaded.list().map((p) => p.name), ['Main', 'Alt 1']);
  assert.strictEqual(reloaded.activeId, b.id);
});

test('enforces the profile limit', () => {
  const store = new ProfileStore(tmpFile());
  for (let i = 0; i < MAX_PROFILES; i++) store.add();
  assert.throws(() => store.add(), /at most/);
});

test('renames and rejects empty names', () => {
  const store = new ProfileStore(tmpFile());
  const p = store.add('Main');
  store.rename(p.id, '  My   Alt  ');
  assert.strictEqual(store.get(p.id).name, 'My Alt');
  assert.throws(() => store.rename(p.id, '   '), /empty/);
});

test('removing the active profile selects a neighbour', () => {
  const store = new ProfileStore(tmpFile());
  const a = store.add('A');
  const b = store.add('B');
  const c = store.add('C');
  store.setActive(b.id);
  store.remove(b.id);
  assert.strictEqual(store.activeId, c.id);
  store.remove(c.id);
  assert.strictEqual(store.activeId, a.id);
  store.remove(a.id);
  assert.strictEqual(store.activeId, null);
});

test('reorders profiles', () => {
  const store = new ProfileStore(tmpFile());
  const a = store.add('A');
  store.add('B');
  store.add('C');
  store.move(a.id, 2);
  assert.deepStrictEqual(store.list().map((p) => p.name), ['B', 'C', 'A']);
});

test('each profile gets its own persistent partition', () => {
  const store = new ProfileStore(tmpFile());
  const a = store.add();
  const b = store.add();
  assert.notStrictEqual(partitionFor(a.id), partitionFor(b.id));
  assert.match(partitionFor(a.id), /^persist:/);
});

test('survives a corrupt file', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{not json');
  const store = new ProfileStore(file);
  assert.deepStrictEqual(store.list(), []);
});

const { gridCells } = require('../src/profiles');

test('grid cells fill the area without overlapping', () => {
  const area = { x: 0, y: 44, width: 1280, height: 756 };
  for (let n = 1; n <= MAX_PROFILES; n++) {
    const cells = gridCells(n, area, 2);
    assert.strictEqual(cells.length, n);
    for (const c of cells) {
      assert.ok(c.x >= area.x && c.y >= area.y, `n=${n} inside top-left`);
      assert.ok(c.x + c.width <= area.x + area.width + 1, `n=${n} inside right`);
      assert.ok(c.y + c.height <= area.y + area.height + 1, `n=${n} inside bottom`);
    }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = cells[i], b = cells[j];
      const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      assert.ok(!overlap, `n=${n} cells ${i},${j} overlap`);
    }
  }
  assert.deepStrictEqual(gridCells(4, area, 0).map((c) => [c.x, c.y]), [[0, 44], [640, 44], [0, 422], [640, 422]]);
});

test('grid visibility and view mode persist', () => {
  const file = tmpFile();
  const store = new ProfileStore(file);
  const a = store.add('A');
  const b = store.add('B');
  store.setMode('grid');
  store.setShownInGrid(a.id, false);
  const reloaded = new ProfileStore(file);
  assert.strictEqual(reloaded.view.mode, 'grid');
  assert.deepStrictEqual(reloaded.gridProfiles().map((p) => p.id), [b.id]);
  reloaded.remove(a.id);
  assert.deepStrictEqual(reloaded.view.hiddenInGrid, []);
});
