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
    this.data = { profiles: [], activeId: null, view: defaultView(), layouts: [], lastSeenVersion: null };
    this.existedBefore = fs.existsSync(filePath);
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.profiles)) {
        this.data.profiles = parsed.profiles
          .filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string')
          .slice(0, MAX_PROFILES)
          .map((p) => ({ color: null, muted: false, notify: true, zoom: 1, ...p }));
        this.data.activeId = parsed.activeId || null;
        this.data.view = { ...defaultView(), ...(parsed.view || {}) };
        this.data.layouts = Array.isArray(parsed.layouts) ? parsed.layouts.filter((l) => l && typeof l.name === 'string') : [];
        this.data.lastSeenVersion = parsed.lastSeenVersion || null;
      }
    } catch {
      // Missing or unreadable file: start empty.
    }
    const ids = new Set(this.data.profiles.map((p) => p.id));
    if (!['tabs', 'grid'].includes(this.data.view.mode)) this.data.view.mode = 'tabs';
    this.data.view.hiddenInGrid = (this.data.view.hiddenInGrid || []).filter((id) => ids.has(id));
    if (!isValidShape(this.data.view.shape)) this.data.view.shape = 'auto';
    this.data.view.popouts = Object.fromEntries(
      Object.entries(this.data.view.popouts || {}).filter(([id]) => ids.has(id)),
    );
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
      zoom: 1,
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
    delete this.data.view.popouts[id];
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
    if ('zoom' in patch) profile.zoom = clampZoom(patch.zoom);
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
    const v = this.data.view;
    return {
      ...v,
      hiddenInGrid: [...v.hiddenInGrid],
      popouts: { ...v.popouts },
      colSizes: v.colSizes ? [...v.colSizes] : null,
      rowSizes: v.rowSizes ? [...v.rowSizes] : null,
    };
  }

  setShape(shape) {
    if (!isValidShape(shape)) return;
    this.data.view.shape = shape;
    this.data.view.colSizes = null;
    this.data.view.rowSizes = null;
    this.save();
  }

  setPaneSizes(colSizes, rowSizes, { persist = true } = {}) {
    this.data.view.colSizes = colSizes ? normalizeSizes(colSizes) : null;
    this.data.view.rowSizes = rowSizes ? normalizeSizes(rowSizes) : null;
    if (persist) this.save();
  }

  setPopout(id, bounds) {
    if (!this.get(id)) return;
    if (bounds) this.data.view.popouts[id] = bounds;
    else delete this.data.view.popouts[id];
    this.save();
  }

  isPoppedOut(id) {
    return id in this.data.view.popouts;
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

  // Profiles shown in the grid, in order: not hidden and not popped out.
  gridProfiles() {
    const hidden = new Set(this.data.view.hiddenInGrid);
    return this.data.profiles
      .filter((p) => !hidden.has(p.id) && !this.isPoppedOut(p.id))
      .map((p) => ({ ...p }));
  }

  // ---- Saved layouts ----

  listLayouts() {
    return this.data.layouts.map((l) => ({ name: l.name }));
  }

  saveLayout(name) {
    const clean = ProfileStore.cleanName(name);
    if (!clean) throw new Error('Layout name cannot be empty.');
    const v = this.data.view;
    const layout = {
      name: clean,
      mode: v.mode,
      shape: v.shape,
      order: this.data.profiles.map((p) => p.id),
      hiddenInGrid: [...v.hiddenInGrid],
      colSizes: v.colSizes ? [...v.colSizes] : null,
      rowSizes: v.rowSizes ? [...v.rowSizes] : null,
      popouts: { ...v.popouts },
      activeId: this.data.activeId,
    };
    const i = this.data.layouts.findIndex((l) => l.name === clean);
    if (i >= 0) this.data.layouts[i] = layout;
    else this.data.layouts.push(layout);
    this.save();
    return { name: clean };
  }

  applyLayout(name) {
    const layout = this.data.layouts.find((l) => l.name === name);
    if (!layout) throw new Error('Layout not found.');
    const ids = new Set(this.data.profiles.map((p) => p.id));
    // Put the layout's accounts back in their saved positions; profiles
    // added since keep their place after them.
    const rank = new Map((layout.order || []).filter((id) => ids.has(id)).map((id, i) => [id, i]));
    this.data.profiles.sort((a, b) => (rank.has(a.id) ? rank.get(a.id) : 1e6) - (rank.has(b.id) ? rank.get(b.id) : 1e6));
    const v = this.data.view;
    v.mode = layout.mode === 'grid' ? 'grid' : 'tabs';
    v.shape = isValidShape(layout.shape) ? layout.shape : 'auto';
    v.hiddenInGrid = (layout.hiddenInGrid || []).filter((id) => ids.has(id));
    v.colSizes = layout.colSizes ? normalizeSizes(layout.colSizes) : null;
    v.rowSizes = layout.rowSizes ? normalizeSizes(layout.rowSizes) : null;
    v.popouts = Object.fromEntries(Object.entries(layout.popouts || {}).filter(([id]) => ids.has(id)));
    if (layout.activeId && ids.has(layout.activeId)) this.data.activeId = layout.activeId;
    this.save();
  }

  deleteLayout(name) {
    this.data.layouts = this.data.layouts.filter((l) => l.name !== name);
    this.save();
  }

  // ---- Import / export ----
  // Exports names, colors and settings only. Logins are never exported.

  exportData() {
    const index = new Map(this.data.profiles.map((p, i) => [p.id, i]));
    const mapIds = (ids) => (ids || []).filter((id) => index.has(id)).map((id) => index.get(id));
    return {
      app: 'TibPortal',
      format: 1,
      exportedAt: new Date().toISOString(),
      profiles: this.data.profiles.map((p) => ({
        name: p.name, color: p.color || null, muted: !!p.muted, notify: p.notify !== false, zoom: p.zoom || 1,
      })),
      layouts: this.data.layouts.map((l) => ({
        name: l.name,
        mode: l.mode,
        shape: l.shape,
        order: mapIds(l.order),
        hiddenInGrid: mapIds(l.hiddenInGrid),
        colSizes: l.colSizes || null,
        rowSizes: l.rowSizes || null,
      })),
    };
  }

  // Adds the file's profiles (and layouts) to the existing ones.
  // Returns { added, skipped, layouts }.
  importData(data) {
    if (!data || data.app !== 'TibPortal' || !Array.isArray(data.profiles)) {
      throw new Error("This file isn't a TibPortal profile export.");
    }
    const room = MAX_PROFILES - this.data.profiles.length;
    const incoming = data.profiles.filter((p) => p && ProfileStore.cleanName(p.name));
    const newIds = [];
    const taken = new Set(this.data.profiles.map((p) => p.name));
    incoming.slice(0, Math.max(0, room)).forEach((p) => {
      let name = ProfileStore.cleanName(p.name);
      for (let n = 2; taken.has(name); n++) name = ProfileStore.cleanName(`${ProfileStore.cleanName(p.name).slice(0, 27)} (${n})`);
      taken.add(name);
      const profile = {
        id: crypto.randomUUID(),
        name,
        color: Object.values(COLORS).includes(p.color) ? p.color : null,
        muted: !!p.muted,
        notify: p.notify !== false,
        zoom: clampZoom(p.zoom),
        createdAt: Date.now(),
      };
      this.data.profiles.push(profile);
      newIds.push(profile.id);
    });
    const idAt = (i) => newIds[i];
    let layouts = 0;
    if (newIds.length === incoming.length) {
      for (const l of Array.isArray(data.layouts) ? data.layouts : []) {
        const name = ProfileStore.cleanName(l && l.name);
        if (!name) continue;
        let unique = name;
        for (let n = 2; this.data.layouts.some((x) => x.name === unique); n++) unique = `${name} (${n})`;
        this.data.layouts.push({
          name: unique,
          mode: l.mode === 'grid' ? 'grid' : 'tabs',
          shape: isValidShape(l.shape) ? l.shape : 'auto',
          order: (l.order || []).map(idAt).filter(Boolean),
          hiddenInGrid: (l.hiddenInGrid || []).map(idAt).filter(Boolean),
          colSizes: l.colSizes ? normalizeSizes(l.colSizes) : null,
          rowSizes: l.rowSizes ? normalizeSizes(l.rowSizes) : null,
          popouts: {},
          activeId: null,
        });
        layouts++;
      }
    }
    if (!this.data.activeId && newIds[0]) this.data.activeId = newIds[0];
    this.save();
    return { added: newIds.length, skipped: incoming.length - newIds.length, layouts };
  }

  // ---- App version (for "What's new") ----

  get lastSeenVersion() {
    return this.data.lastSeenVersion;
  }

  setLastSeenVersion(version) {
    this.data.lastSeenVersion = version;
    this.save();
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
  return {
    mode: 'tabs',
    shape: 'auto',
    hiddenInGrid: [],
    colSizes: null,
    rowSizes: null,
    popouts: {},
    bounds: null,
    maximized: false,
    alwaysOnTop: false,
  };
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

function clampZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n)) * 100) / 100;
}

// Grid sizes offered in the Layout menu. 'auto' picks a shape for the
// number of sessions showing.
const SHAPES = ['auto', '2x1', '3x1', '2x2', '3x2', '4x2', '3x3', '5x2'];

function isValidShape(shape) {
  return SHAPES.includes(shape);
}

// Columns x rows for n grid cells, tuned for a wide window.
const AUTO_SHAPES = {
  1: [1, 1], 2: [2, 1], 3: [3, 1], 4: [2, 2], 5: [3, 2],
  6: [3, 2], 7: [4, 2], 8: [4, 2], 9: [3, 3], 10: [5, 2],
};

function shapeFor(n, shape) {
  if (shape && shape !== 'auto') {
    const [c, r] = shape.split('x').map(Number);
    return [c, r];
  }
  return AUTO_SHAPES[n] || [Math.ceil(Math.sqrt(n)), Math.ceil(n / Math.ceil(Math.sqrt(n)))];
}

const MIN_PANE = 0.1;

function normalizeSizes(sizes) {
  const nums = sizes.map((x) => Math.max(MIN_PANE, Number(x) || 0));
  const total = nums.reduce((a, b) => a + b, 0);
  return nums.map((x) => x / total);
}

// Lays out n sessions in a grid. Returns the cell rectangles (in order),
// the grid's columns and rows, and where the draggable dividers go.
// colSizes/rowSizes are fractions; they're used only when their length
// matches the grid's shape.
function gridLayout(n, area, gap = 2, { shape = 'auto', colSizes = null, rowSizes = null } = {}) {
  if (n <= 0) return { cells: [], cols: 0, rows: 0, colDividers: [], rowDividers: [] };
  const [cols, rows] = shapeFor(n, shape);
  const cf = colSizes && colSizes.length === cols ? normalizeSizes(colSizes) : Array(cols).fill(1 / cols);
  const rf = rowSizes && rowSizes.length === rows ? normalizeSizes(rowSizes) : Array(rows).fill(1 / rows);
  const usableW = area.width - gap * (cols - 1);
  const usableH = area.height - gap * (rows - 1);
  const xs = [];
  const ws = [];
  let x = area.x;
  for (let c = 0; c < cols; c++) {
    xs.push(x);
    ws.push(c === cols - 1 ? area.x + area.width - x : Math.round(usableW * cf[c]));
    x += ws[c] + gap;
  }
  const ys = [];
  const hs = [];
  let y = area.y;
  for (let r = 0; r < rows; r++) {
    ys.push(y);
    hs.push(r === rows - 1 ? area.y + area.height - y : Math.round(usableH * rf[r]));
    y += hs[r] + gap;
  }
  const cells = [];
  for (let i = 0; i < Math.min(n, cols * rows); i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    cells.push({ x: xs[c], y: ys[r], width: Math.max(0, ws[c]), height: Math.max(0, hs[r]) });
  }
  const colDividers = [];
  for (let c = 0; c < cols - 1; c++) colDividers.push(xs[c] + ws[c] + gap / 2);
  const rowDividers = [];
  for (let r = 0; r < rows - 1; r++) rowDividers.push(ys[r] + hs[r] + gap / 2);
  return { cells, cols, rows, colSizes: cf, rowSizes: rf, colDividers, rowDividers };
}

function gridCells(n, area, gap = 2, opts) {
  return gridLayout(n, area, gap, opts).cells;
}

// Moves the boundary after pane `index` to `position` (pixels along the
// axis, relative to the grid's start), keeping each pane at least MIN_PANE.
function resizePanes(sizes, index, position, length) {
  const out = [...sizes];
  const before = out.slice(0, index).reduce((a, b) => a + b, 0);
  const pair = out[index] + out[index + 1];
  let left = position / length - before;
  left = Math.min(pair - MIN_PANE, Math.max(MIN_PANE, left));
  out[index] = left;
  out[index + 1] = pair - left;
  return out;
}

function partitionFor(id) {
  return `persist:tib-${id}`;
}

module.exports = {
  ProfileStore, partitionFor, gridCells, gridLayout, resizePanes, clampZoom,
  SHAPES, COLORS, MAX_PROFILES, MAX_NAME_LENGTH,
};
