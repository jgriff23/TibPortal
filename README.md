# TibPortal

A desktop app for running several [TibIdle](https://tibidle.com) sessions at once, each with its own saved login. You don't need incognito windows.

## How it works

Each **profile** (for example "Main" or "Alt 1") gets its own separate browser storage: cookies, local storage and cache. Logins never clash between profiles, and every profile stays logged in between launches. You can have up to 10 profiles.

Hidden sessions keep running at full speed, so idle progress continues while you look at another tab.

## Using it

- **+** adds a profile. Type a name and press Enter.
- **Click** a tab to switch to it.
- **Double-click** a tab to rename it.
- **Drag** tabs to reorder them.
- **⟳** reloads the current session.
- **Tabs / Grid** (top right) switches between one session at a time and all sessions side by side. The grid adjusts to how many sessions are showing (2 side by side, 2×2 for 4, up to 5×2 for 10).
- In grid view, **◉** on a tab hides or shows that profile in the grid. Click inside a grid cell to make it the active one (outlined in blue).
- **Right-click** a tab for more options: rename, color, mute, desktop notifications, show in grid, reload, delete.
- **🔊 / 🔇** appears on a tab that is playing sound or muted. Click it to toggle mute.
- An **orange dot** on a tab means something changed in that session (its page title changed or it played a sound) since you last looked. If the TibPortal window isn't focused, you also get a desktop notification (at most once every 30 seconds per profile) and the taskbar icon flashes.
- **📌** keeps the window on top of other windows.
- The app remembers the view mode, which profiles are in the grid, and the window size and position.
- **×** deletes a profile and its saved login. Your game account is not affected.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+1 … Ctrl+9, Ctrl+0 | Jump to profile 1–10 |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous session |
| Ctrl+G | Switch between tabs and grid |
| Ctrl+T | Add a profile |
| Ctrl+M | Mute or unmute the active session |
| F5 or Ctrl+R | Reload the active session |
| F11 | Full screen |

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm start      # run the app
npm test       # unit tests
```

Set `TIBPORTAL_URL` to point the app at a different page while testing.

## Roadmap

1. ~~Core app with saved profiles~~
2. ~~Tabs and split grid view (up to 10 sessions)~~
3. ~~Polish: colors, mute, notifications, always-on-top, keyboard shortcuts~~
4. Windows installer and portable .exe
