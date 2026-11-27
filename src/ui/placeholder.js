'use strict';

let activeId = null;
const msg = document.getElementById('msg');

window.portal.onState((state) => {
  activeId = state.activeId;
  const p = state.profiles.find((x) => x.id === activeId);
  msg.textContent = p ? `${p.name} is open in its own window.` : 'This tab is open in its own window.';
});
document.getElementById('focus').addEventListener('click', () => activeId && window.portal.activate(activeId));
document.getElementById('back').addEventListener('click', () => activeId && window.portal.bringBack(activeId));
window.portal.requestState();
