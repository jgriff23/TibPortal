'use strict';

const tabsEl = document.getElementById('tabs');
const addBtn = document.getElementById('add');
let state = { profiles: [], activeId: null, mode: 'tabs', hiddenInGrid: [], max: 10 };
const modeTabs = document.getElementById('mode-tabs');
const modeGrid = document.getElementById('mode-grid');
const pinBtn = document.getElementById('pin');
let editingId = null;
let dragId = null;
let renameStartedAt = 0;
let draft = null; // text typed so far, kept when the bar redraws mid-rename
let redrawing = false;
let lastClick = { id: null, time: 0 };

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function startRename(id) {
  editingId = id;
  draft = null;
  renameStartedAt = Date.now();
  // Pull keyboard focus back from the game so the name box can be typed in.
  window.portal.focusToolbar();
  render();
}

function finishRename(id, value, commit) {
  editingId = null;
  if (commit && value.trim()) {
    window.portal.rename(id, value).catch(() => render());
  } else {
    render();
  }
}

function render() {
  // Redraws (e.g. a game's title changing) replace the name box; that must
  // not count as the user clicking away.
  redrawing = true;
  tabsEl.replaceChildren();
  redrawing = false;
  const grid = state.mode === 'grid';
  modeTabs.classList.toggle('on', !grid);
  modeGrid.classList.toggle('on', grid);

  state.profiles.forEach((p, index) => {
    const inGrid = !state.hiddenInGrid.includes(p.id);
    const tab = el('div', {
      className: 'tab' + (p.id === state.activeId ? ' active' : '') + (grid && !inGrid ? ' off' : ''),
      title: `${p.name}${p.title ? ' · ' + p.title : ''}\nDouble-click to rename, right-click for options, drag to reorder.`,
      draggable: editingId !== p.id,
    });
    tab.setAttribute('role', 'tab');
    if (p.color) {
      const swatch = el('span', { className: 'swatch' });
      swatch.style.background = p.color;
      tab.append(swatch);
    }
    if (index < 10) tab.append(el('span', { className: 'key', textContent: String((index + 1) % 10) }));

    if (editingId === p.id) {
      const input = el('input', { value: draft ?? p.name, maxLength: 32 });
      input.addEventListener('input', () => { draft = input.value; });
      let done = false;
      const finish = (commit) => {
        if (done) return;
        done = true;
        finishRename(p.id, input.value, commit);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => {
        if (redrawing || !input.isConnected) return;
        // Switching tabs briefly moves focus to the game; don't close the
        // name box for that, only when the user really clicks away.
        if (Date.now() - renameStartedAt < 600) {
          window.portal.focusToolbar();
          setTimeout(() => input.focus(), 0);
          return;
        }
        finish(true);
      });
      tab.append(input);
      const restoring = draft !== null;
      queueMicrotask(() => {
        input.focus();
        if (restoring) input.setSelectionRange(input.value.length, input.value.length);
        else input.select();
      });
    } else {
      tab.append(el('span', { className: 'name', textContent: p.name }));
      if (p.attention) tab.append(el('span', { className: 'badge', title: 'Something changed in this session' }));
    }

    const reload = el('button', { className: 'icon', textContent: '⟳', title: 'Reload' });
    reload.addEventListener('click', (e) => { e.stopPropagation(); window.portal.reload(p.id); });
    const close = el('button', { className: 'icon close', textContent: '×', title: 'Delete profile' });
    close.addEventListener('click', (e) => { e.stopPropagation(); window.portal.remove(p.id); });
    if (p.muted || p.audible) {
      const sound = el('button', {
        className: 'icon sound' + (p.muted ? ' muted' : ''),
        textContent: p.muted ? '🔇' : '🔊',
        title: p.muted ? 'Unmute (Ctrl+M)' : 'Mute (Ctrl+M)',
      });
      sound.addEventListener('click', (e) => { e.stopPropagation(); window.portal.toggleMute(p.id); });
      tab.append(sound);
    }
    if (grid) {
      const eye = el('button', {
        className: 'icon eye' + (inGrid ? '' : ' off'),
        textContent: inGrid ? '◉' : '○',
        title: inGrid ? 'Hide from grid' : 'Show in grid',
      });
      eye.addEventListener('click', (e) => { e.stopPropagation(); window.portal.toggleInGrid(p.id); });
      tab.append(eye);
    }
    if (p.id === state.activeId && p.loaded) tab.append(reload);
    tab.append(close);

    tab.addEventListener('contextmenu', (e) => { e.preventDefault(); window.portal.menu(p.id); });
    // Detect double-clicks by profile, not by element: the first click
    // switches tabs and redraws the bar, so a plain dblclick never fires.
    tab.addEventListener('click', (e) => {
      if (editingId === p.id) return;
      const now = Date.now();
      if (lastClick.id === p.id && now - lastClick.time < 450) {
        lastClick = { id: null, time: 0 };
        startRename(p.id);
        return;
      }
      lastClick = { id: p.id, time: now };
      if (p.id !== state.activeId) window.portal.activate(p.id);
    });

    tab.addEventListener('dragstart', () => { dragId = p.id; tab.classList.add('dragging'); });
    tab.addEventListener('dragend', () => { dragId = null; tab.classList.remove('dragging'); });
    tab.addEventListener('dragover', (e) => e.preventDefault());
    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragId && dragId !== p.id) window.portal.move(dragId, index);
    });

    tabsEl.append(tab);
  });

  pinBtn.classList.toggle('on', !!state.alwaysOnTop);
  pinBtn.title = state.alwaysOnTop ? 'Stop keeping window on top' : 'Keep window on top';
  addBtn.disabled = state.profiles.length >= state.max;
  addBtn.title = addBtn.disabled ? `Maximum of ${state.max} profiles` : 'Add profile';
}

// Mouse wheel scrolls the tab strip sideways when it overflows.
tabsEl.addEventListener('wheel', (e) => {
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    tabsEl.scrollLeft += e.deltaY;
    e.preventDefault();
  }
}, { passive: false });

modeTabs.addEventListener('click', () => window.portal.setMode('tabs'));
modeGrid.addEventListener('click', () => window.portal.setMode('grid'));

pinBtn.addEventListener('click', () => window.portal.toggleAlwaysOnTop());

addBtn.addEventListener('click', async () => {
  const profile = await window.portal.add();
  if (profile) startRename(profile.id);
});

window.portal.onRename((id) => startRename(id));

window.portal.onState((next) => {
  state = next;
  render();
});

window.portal.requestState();
