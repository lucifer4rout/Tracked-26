const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  openExternal: (url) => ipcRenderer.send("open-external", url),
  onDeepLink: (callback) => ipcRenderer.on("deep-link", (_event, url) => callback(url))
});