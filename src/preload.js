'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portal', {
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  requestState: () => ipcRenderer.invoke('state:get'),
  add: (name) => ipcRenderer.invoke('profiles:add', name),
  rename: (id, name) => ipcRenderer.invoke('profiles:rename', id, name),
  remove: (id) => ipcRenderer.invoke('profiles:remove', id),
  activate: (id) => ipcRenderer.invoke('profiles:activate', id),
  move: (id, toIndex) => ipcRenderer.invoke('profiles:move', id, toIndex),
  setMode: (mode) => ipcRenderer.invoke('view:mode', mode),
  toggleInGrid: (id) => ipcRenderer.invoke('grid:toggle', id),
  reload: (id) => ipcRenderer.invoke('profiles:reload', id),
  menu: (id) => ipcRenderer.invoke('profiles:menu', id),
  toggleMute: (id) => ipcRenderer.invoke('profiles:mute', id),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('view:alwaysOnTop'),
  focusToolbar: () => ipcRenderer.invoke('toolbar:focus'),
  layoutMenu: () => ipcRenderer.invoke('menu:layout'),
  appMenu: () => ipcRenderer.invoke('menu:app'),
  bringBack: (id) => ipcRenderer.invoke('profiles:bringBack', id),
  submitPrompt: (kind, value) => ipcRenderer.invoke('prompt:submit', kind, value),
  onPrompt: (cb) => ipcRenderer.on('prompt', (_e, p) => cb(p)),
  onDivider: (cb) => ipcRenderer.on('divider', (_e, d) => cb(d)),
  divider: (phase, data) => ipcRenderer.send('divider', phase, data),
  onRename: (cb) => ipcRenderer.on('rename', (_e, id) => cb(id)),
});
