const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splashAPI", {
  // Fires with { status, version?, percent?, message? } as the startup
  // update check progresses. See main.js's runStartupUpdateCheck() for
  // the full set of status values this can send.
  onStatus: (callback) => ipcRenderer.on("splash-status", (_event, status) => callback(status))
});