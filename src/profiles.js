'use strict';

// Profile storage. Each profile has a stable id that names its own
// persistent browser partition, so logins never mix between profiles.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_PROFILES = 10;
const MAX_NAME_LENGTH = 32;

// Tab colors offered in the right-click menu.
const COLORS = {
  none: null,
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#f5d90a',
  green: '#46a758',
  teal: '#12a594',
  blue: '#3e63dd',
  purple: '#8e4ec6',
  pink: '#d6409f',
};

class ProfileStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { profiles: [], activeId: null, view: defaultView() };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.profiles)) {
        this.data.profiles = parsed.profiles
          .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
          .slice(0, MAX_PROFILES)
          .map((p) => ({ color: null, muted: false, notify: true, ...p }));
        this.data.activeId = parsed.activeId || null;
        this.data.view = { ...defaultView(), ...(parsed.view || {}) };
      }
    } catch {
      // Missing or unreadable file: start empty.
    }
    const ids = new Set(this.data.profiles.map((p) => p.id));
    if (!['tabs', 'grid'].includes(this.data.view.mode)) this.data.view.mode = 'tabs';
    this.data.view.hiddenInGrid = (this.data.view.hiddenInGrid || []).filter((id) => ids.has(id));
    if (!this.get(this.data.activeId)) {
      this.data.activeId = this.data.profiles[0] ? this.data.profiles[0].id : null;
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  list() {
    return this.data.profiles.map((p) => ({ ...p }));
  }

  get(id) {
    return this.data.profiles.find((p) => p.id === id) || null;
  }

  get activeId() {
    return this.data.activeId;
  }

  static cleanName(name) {
    const cleaned = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
    return cleaned;
  }

  nextDefaultName() {
    const names = new Set(this.data.profiles.map((p) => p.name));
    if (!names.has('Main')) return 'Main';
    for (let i = 1; ; i++) {
      if (!names.has(`Alt ${i}`)) return `Alt ${i}`;
    }
  }

  add(name) {
    if (this.data.profiles.length >= MAX_PROFILES) {
      throw new Error(`You can have at most ${MAX_PROFILES} profiles.`);
    }
    const profile = {
      id: crypto.randomUUID(),
      name: ProfileStore.cleanName(name) || this.nextDefaultName(),
      color: null,
      muted: false,
      notify: true,
      createdAt: Date.now(),
    };
    this.data.profiles.push(profile);
    this.data.activeId = profile.id;
    this.save();
    return { ...profile };
  }

  rename(id, name) {
    const profile = this.get(id);
    if (!profile) throw new Error('Profile not found.');
    const cleaned = ProfileStore.cleanName(name);
    if (!cleaned) throw new Error('Profile name cannot be empty.');
    profile.name = cleaned;
    this.save();
    return { ...profile };
  }

  remove(id) {
    const index = this.data.profiles.findIndex((p) => p.id === id);
    if (index === -1) return false;
    this.data.profiles.splice(index, 1);
    this.data.view.hiddenInGrid = this.data.view.hiddenInGrid.filter((h) => h !== id);
    if (this.data.activeId === id) {
      const next = this.data.profiles[Math.min(index, this.data.profiles.length - 1)];
      this.data.activeId = next ? next.id : null;
    }
    this.save();
    return true;
  }

  move(id, toIndex) {
    const from = this.data.profiles.findIndex((p) => p.id === id);
    if (from === -1) return;
    const [p] = this.data.profiles.splice(from, 1);
    const to = Math.max(0, Math.min(toIndex, this.data.profiles.length));
    this.data.profiles.splice(to, 0, p);
    this.save();
  }

  // Per-profile settings: color, muted, notify.
  update(id, patch) {
    const profile = this.get(id);
    if (!profile) throw new Error('Profile not found.');
    if ('color' in patch) {
      profile.color = Object.values(COLORS).includes(patch.color) ? patch.color : null;
    }
    if ('muted' in patch) profile.muted = !!patch.muted;
    if ('notify' in patch) profile.notify = !!patch.notify;
    this.save();
    return { ...profile };
  }

  setActive(id) {
    if (!this.get(id)) return;
    this.data.activeId = id;
    this.save();
  }

  // ---- View settings (tabs/grid, window placement) ----

  get view() {
    return { ...this.data.view, hiddenInGrid: [...this.data.view.hiddenInGrid] };
  }

  setMode(mode) {
    if (!['tabs', 'grid'].includes(mode)) return;
    this.data.view.mode = mode;
    this.save();
  }

  setShownInGrid(id, shown) {
    if (!this.get(id)) return;
    const hidden = new Set(this.data.view.hiddenInGrid);
    if (shown) hidden.delete(id);
    else hidden.add(id);
    this.data.view.hiddenInGrid = [...hidden];
    this.save();
  }

  gridProfiles() {
    const hidden = new Set(this.data.view.hiddenInGrid);
    return this.data.profiles.filter((p) => !hidden.has(p.id)).map((p) => ({ ...p }));
  }

  setAlwaysOnTop(on) {
    this.data.view.alwaysOnTop = !!on;
    this.save();
  }

  setWindowState(bounds, maximized) {
    this.data.view.bounds = bounds;
    this.data.view.maximized = !!maximized;
    this.save();
  }
}

function defaultView() {
  return { mode: 'tabs', hiddenInGrid: [], bounds: null, maximized: false, alwaysOnTop: false };
}

// Columns x rows for n grid cells, tuned for a wide window.
const GRID_SHAPES = {
  1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2],
  6: [3, 2], 7: [4, 2], 8: [4, 2], 9: [3, 3], 10: [5, 2],
};

function gridCells(n, area, gap = 2) {
  if (n <= 0) return [];
  const [cols, rows] = GRID_SHAPES[n] || [Math.ceil(Math.sqrt(n)), Math.ceil(n / Math.ceil(Math.sqrt(n)))];
  const cells = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    // Centre a short last row.
    const inRow = row === rows - 1 ? n - cols * (rows - 1) : cols;
    const col = i % cols;
    const cellW = (area.width - gap * (cols - 1)) / cols;
    const cellH = (area.height - gap * (rows - 1)) / rows;
    const offset = ((cols - inRow) * (cellW + gap)) / 2;
    cells.push({
      x: Math.round(area.x + offset + col * (cellW + gap)),
      y: Math.round(area.y + row * (cellH + gap)),
      width: Math.max(0, Math.round(cellW)),
      height: Math.max(0, Math.round(cellH)),
    });
  }
  return cells;
}

function partitionFor(id) {
  return `persist:tib-${id}`;
}

module.exports = { ProfileStore, partitionFor, gridCells, COLORS, MAX_PROFILES, MAX_NAME_LENGTH };
