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
