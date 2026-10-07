const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cam', {
  getCatalog: () => ipcRenderer.invoke('catalog:get'),
  getText: (url) => ipcRenderer.invoke('proxy:text', url),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  openWidget: () => ipcRenderer.invoke('widget:open'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  setWidgetPin: (mode) => ipcRenderer.invoke('widget:pin', mode),
  openMain: () => ipcRenderer.invoke('widget:openMain'),
});
