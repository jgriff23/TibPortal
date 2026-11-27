'use strict';

const bar = document.getElementById('bar');
let info = null;

window.portal.onDivider((d) => {
  info = d;
  document.body.className = d.kind;
});

bar.addEventListener('pointerdown', (e) => {
  if (!info || e.button !== 0) return;
  bar.setPointerCapture(e.pointerId);
  bar.classList.add('dragging');
  window.portal.divider('start', { kind: info.kind, index: info.index });
});

bar.addEventListener('pointermove', (e) => {
  if (!bar.classList.contains('dragging')) return;
  window.portal.divider('move', { screenX: e.screenX, screenY: e.screenY });
});

function end(e) {
  if (!bar.classList.contains('dragging')) return;
  bar.classList.remove('dragging');
  try { bar.releasePointerCapture(e.pointerId); } catch {}
  window.portal.divider('end', {});
}
bar.addEventListener('pointerup', end);
bar.addEventListener('pointercancel', end);
bar.addEventListener('dblclick', () => window.portal.divider('reset', {}));
