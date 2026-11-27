'use strict';

// Runs in each game tab before the page's own scripts.
//
// TibIdle defaults to Portuguese. The game keeps its language choice in
// localStorage under `tibidle:lang:v1`, so the first time a profile opens
// the game we set it to English. After that we leave it alone, so switching
// language inside the game still sticks.

const LANG_KEY = 'tibidle:lang:v1';
const MARKER_KEY = 'tibportal:default-lang-set:v1';

function gameDomain() {
  const arg = process.argv.find((a) => a.startsWith('--tibportal-game-domain='));
  return arg ? arg.split('=')[1] : 'tibidle.com';
}

try {
  const domain = gameDomain();
  const host = location.hostname;
  if (host === domain || host.endsWith('.' + domain)) {
    if (!localStorage.getItem(MARKER_KEY)) {
      localStorage.setItem(LANG_KEY, 'en');
      localStorage.setItem(MARKER_KEY, '1');
    }
  }
} catch {
  // Storage can be unavailable on error pages; nothing to do.
}

// ---- Death and idle alerts ----
//
// When a hunt, training or tower run ends, the game shows a summary panel
// whose header has the class `s-summary-eyebrow`. If the character died it
// also has `s-summary-eyebrow--death`. We only watch the page for that panel
// and tell TibPortal, which shows a desktop notification. Nothing here
// clicks or changes anything in the game.

const { ipcRenderer } = require('electron');

const EYEBROW = 's-summary-eyebrow';
const DEATH = 's-summary-eyebrow--death';
const QUIET_AFTER_LOAD_MS = 5000; // a summary already open on load isn't news

function watchForSummaries() {
  const loadedAt = Date.now();
  const seen = new WeakSet();

  const report = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (Date.now() - loadedAt < QUIET_AFTER_LOAD_MS) return;
    const body = node.closest('.s-summary-body') || node.parentElement;
    const title = body && body.querySelector('.s-summary-title');
    ipcRenderer.send('game-event', {
      kind: node.classList.contains(DEATH) ? 'death' : 'ended',
      text: (node.textContent || '').trim().slice(0, 120),
      where: ((title && title.textContent) || '').trim().slice(0, 120),
    });
  };

  const scan = (root) => {
    if (root.nodeType !== 1) return;
    if (root.classList.contains(EYEBROW)) report(root);
    for (const el of root.getElementsByClassName(EYEBROW)) report(el);
  };

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') scan(r.target);
      else for (const n of r.addedNodes) scan(n);
    }
  });
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class'],
  });
  scan(document.documentElement);
}

try {
  const domain = gameDomain();
  const host = location.hostname;
  if (host === domain || host.endsWith('.' + domain)) {
    if (document.documentElement) watchForSummaries();
    else document.addEventListener('DOMContentLoaded', watchForSummaries, { once: true });
  }
} catch (err) {
  console.warn('TibPortal alerts unavailable:', err);
}
