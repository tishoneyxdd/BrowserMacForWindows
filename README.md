# Safari for Windows (Electron)

A macOS Safari-like browser UI built for Windows using Electron.

## Project Overview
- Name: Safari for Windows
- Type: Desktop browser shell (Electron app)
- Main technologies: Electron, Node.js, HTML/CSS/JavaScript
- Main scripts: `main.js`, `preload.js`, `renderer.js`
- UI: Custom window controls, tab strip, address bar, bookmarks, history, downloads panel

## Features
- Browser window with custom titlebar (macOS style)
- Navigation: back, forward, reload, home
- Address bar (`#addressBar`) for URL/search input
- Bookmark toggle and bookmarks bar
- Tab management with `webview` instances
- Downloads management via `session.defaultSession.on('will-download')`
- File export for app data (JSON)
- External link handling (`shell.openExternal`)
- Full IPC bridge via `contextBridge` (`electronAPI`)
- App metadata (`app:get-version`)
- Dev mode: open DevTools when `NODE_ENV=development`

## Architecture
### `main.js`
- Creates `BrowserWindow` with `preload.js` and sandbox settings
- Handles main app state, downloads, and IPC channels
- Controls window actions (minimize/maximize/close)
- Provides IPC handles for he browser and download functions

### `preload.js`
- Uses `contextBridge.exposeInMainWorld` for secure API
- Exposes actions: window controls, app version, browser open external
- Emits events for download state changes

### `index.html` + `styles.css` + `renderer.js`
- Main UI structure and style (Safari-branded chrome)
- `renderer.js` manages frontend interactions: tabs, panels, address bar, state updates

## Install & run locally
1. Clone repo:
   ```bash
   git clone https://github.com/tishoneyxdd/BrowserMacForWindows
   cd BrowserMacForWindows
   ```
2. Install packages:
   ```bash
   npm install
   ```
3. Run app:
   ```bash
   npm start
   ```
4. Development mode:
   ```bash
   npm run dev
   ```

## Deployment
- Uses `electron-builder`:
  - `npm run build` creates Windows installer (NSIS)
- Config in `package.json` `build` section:
  - `appId: com.safari.windows`
  - `productName: Safari for Windows`
  - `win.target: nsis`
  - `icon: icon/app.ico`

## Useful file mapping
- `main.js`: Main process (window lifecycle / downloads / IPC)
- `preload.js`: Safe renderer API
- `renderer.js`: UI controller and event handlers
- `index.html`: App page markup
- `styles.css`: Safari-like visual design

