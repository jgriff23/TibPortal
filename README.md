# TibPortal

A desktop app for running several [TibIdle](https://tibidle.com) sessions at once, each with its own saved login. You don't need incognito windows.

## Download (Windows)

Grab the latest build from the [Releases page](../../releases):

- **TibPortal-Setup-x.y.z.exe** installs TibPortal with Start menu and desktop shortcuts.
- **TibPortal-Portable-x.y.z.exe** runs without installing. Your profiles are stored in your user folder either way.

**Updates:** the installed version updates itself. It checks GitHub for a new release when it starts (and every few hours), downloads it in the background, and asks whether to restart. Restart now installs it silently and reopens TibPortal on its own. If you pick Later, it updates the next time you close TibPortal. The portable version can't replace itself, so it tells you when a new version is out and links to this page. Auto-update starts with v0.3.0, so install v0.3.0 once by hand.

The app isn't code-signed yet, so Windows SmartScreen may say "Windows protected your PC" the first time. Click **More info → Run anyway**.

## How it works

Each **profile** (for example "Main" or "Alt 1") gets its own separate browser storage: cookies, local storage and cache. Logins never clash between profiles, and every profile stays logged in between launches. You can have up to 10 profiles.

Each tab opens the game at [play.tibidle.com](https://play.tibidle.com) in **English** by default. You can still change the language inside the game, and each profile remembers its own choice.

Hidden sessions keep running at full speed, so idle progress continues while you look at another tab.

## Using it

- **+** adds a profile. Type a name and press Enter.
- **Click** a tab to switch to it.
- **Double-click** a tab to rename it.
- **Drag** tabs to reorder them.
- **⟳** reloads the current session.
- **Tabs / Grid** (top right) switches between one session at a time and all sessions side by side. The grid adjusts to how many sessions are showing (2 side by side, 2×2 for 4, up to 5×2 for 10).
- In grid view, **◉** on a tab hides or shows that profile in the grid. Click inside a grid cell to make it the active one (outlined in blue).
- **Layout ▾** picks a grid size (Auto, 2×1, 3×1, 2×2, 3×2, 4×2, 3×3 or 5×2). Drag the lines between grid panes to resize them, and double-click a line to even them out.
- **Saved layouts** (Layout ▾ → Save current layout…) remember the view, grid size, pane sizes, pop-out windows and which account sits where. Pick one from the Layout menu to switch back to it.
- **Open in its own window** (right-click a tab) pops a tab out, for example onto a second monitor. Close that window to bring the tab back. Pop-outs reopen where you left them.
- **Zoom** each tab separately with Ctrl+= / Ctrl+-, Ctrl+mouse wheel, or right-click → Zoom. Handy for small grid panes.
- **⋯ → Export profiles…** saves your profiles (names, colors, settings and saved layouts) to a file. **Import profiles…** adds them on another PC or for a friend. Logins are never included, so imported profiles start logged out.
- After an update, a **What's new** window lists the changes. You can reopen it from ⋯.
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
| Ctrl+= / Ctrl+- | Zoom the active tab in / out |
| Ctrl+Shift+0 | Reset the active tab's zoom |
| F11 | Full screen |

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm start      # run the app
npm test       # unit tests
```

Set `TIBPORTAL_URL` to point the app at a different page while testing.

### Building the .exe

```sh
npm run dist   # on Windows: writes the installer and portable .exe to dist/
```

GitHub Actions builds both on every push (download them from the run's **Artifacts**). Pushing a tag such as `v0.1.0` also publishes them to a GitHub Release:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

## Roadmap

1. ~~Core app with saved profiles~~
2. ~~Tabs and split grid view (up to 10 sessions)~~
3. ~~Polish: colors, mute, notifications, always-on-top, keyboard shortcuts~~
4. ~~Windows installer and portable .exe~~
5. Later: Linux builds (AppImage, .deb), code signing
