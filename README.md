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
- **×** deletes a profile and its saved login. Your game account is not affected.

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
2. Tabs and split grid view (up to 10 sessions)
3. Polish: colors, mute, notifications, always-on-top, keyboard shortcuts
4. Windows installer and portable .exe
