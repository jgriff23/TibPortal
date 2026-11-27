'use strict';

// Shown in the "What's new" popup after an update. Newest first.
module.exports = [
  {
    version: '0.4.1',
    notes: ['Updates install silently now. After you click Restart now, TibPortal installs the update and reopens by itself, with no installer wizard.'],
  },
  {
    version: '0.4.0',
    notes: [
      'More grid sizes: pick 2×1, 3×1, 2×2, 3×2, 4×2, 3×3 or 5×2 from the Layout menu, or leave it on Auto.',
      'Resize grid panes by dragging the lines between them. Double-click a line to even them out again.',
      'Pop a tab out into its own window (right-click the tab), for example to put it on a second monitor.',
      'Saved layouts remember the view, grid size, pane sizes, pop-outs and which account sits where.',
      'Zoom each tab separately: Ctrl+= and Ctrl+-, Ctrl+mouse wheel, or right-click the tab. Ctrl+Shift+0 resets.',
      'Export your profiles to a file and import them on another PC or share them with a friend. Logins are never included.',
      'This "What\'s new" window after each update.',
    ],
  },
  {
    version: '0.3.0',
    notes: ['The installed app now updates itself.'],
  },
  {
    version: '0.2.0',
    notes: ['TibIdle opens in English by default.'],
  },
  {
    version: '0.1.0',
    notes: ['First release: profiles with separate logins, tabs and grid view.'],
  },
];
