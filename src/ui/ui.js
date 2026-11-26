'use strict';

const tabsEl = document.getElementById('tabs');
const addBtn = document.getElementById('add');
let state = { profiles: [], activeId: null, max: 10 };
let editingId = null;
let dragId = null;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function startRename(id) {
  editingId = id;
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
  tabsEl.replaceChildren();
  state.profiles.forEach((p, index) => {
    const tab = el('div', {
      className: 'tab' + (p.id === state.activeId ? ' active' : ''),
      title: 'Double-click to rename. Drag to reorder.',
      draggable: editingId !== p.id,
    });
    tab.setAttribute('role', 'tab');

    if (editingId === p.id) {
      const input = el('input', { value: p.name, maxLength: 32 });
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
      input.addEventListener('blur', () => finish(true));
      tab.append(input);
      queueMicrotask(() => { input.focus(); input.select(); });
    } else {
      tab.append(el('span', { className: 'name', textContent: p.name }));
      tab.addEventListener('dblclick', () => startRename(p.id));
    }

    const reload = el('button', { className: 'icon', textContent: '⟳', title: 'Reload' });
    reload.addEventListener('click', (e) => { e.stopPropagation(); window.portal.reload(p.id); });
    const close = el('button', { className: 'icon', textContent: '×', title: 'Delete profile' });
    close.addEventListener('click', (e) => { e.stopPropagation(); window.portal.remove(p.id); });
    if (p.id === state.activeId && p.loaded) tab.append(reload);
    tab.append(close);

    tab.addEventListener('click', () => {
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

  addBtn.disabled = state.profiles.length >= state.max;
  addBtn.title = addBtn.disabled ? `Maximum of ${state.max} profiles` : 'Add profile';
}

addBtn.addEventListener('click', async () => {
  const profile = await window.portal.add();
  startRename(profile.id);
});

window.portal.onState((next) => {
  state = next;
  render();
});

window.portal.requestState();
