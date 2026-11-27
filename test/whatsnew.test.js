'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { compareVersions, notesBetween, shouldShowWhatsNew } = require('../src/whatsnew');

const log = [
  { version: '0.4.0', notes: ['d'] },
  { version: '0.3.0', notes: ['c'] },
  { version: '0.2.0', notes: ['b'] },
];

test('compares versions numerically', () => {
  assert.strictEqual(compareVersions('0.10.0', '0.9.0'), 1);
  assert.strictEqual(compareVersions('1.0.0', '1.0.0'), 0);
  assert.strictEqual(compareVersions('0.3.0', '0.4.0'), -1);
});

test('collects notes for every version skipped', () => {
  assert.deepStrictEqual(notesBetween('0.2.0', '0.4.0', log).map((e) => e.version), ['0.4.0', '0.3.0']);
  assert.deepStrictEqual(notesBetween(null, '0.4.0', log).map((e) => e.version), ['0.4.0']);
});

test('shows only after an update', () => {
  assert.strictEqual(shouldShowWhatsNew({ lastSeen: null, current: '0.4.0', isFirstRun: true }), false);
  assert.strictEqual(shouldShowWhatsNew({ lastSeen: null, current: '0.4.0', isFirstRun: false }), true);
  assert.strictEqual(shouldShowWhatsNew({ lastSeen: '0.3.0', current: '0.4.0', isFirstRun: false }), true);
  assert.strictEqual(shouldShowWhatsNew({ lastSeen: '0.4.0', current: '0.4.0', isFirstRun: false }), false);
});
