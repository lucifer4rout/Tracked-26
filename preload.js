const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,

  // Opens a URL in the user's system browser (used for the Google OAuth flow).
  openExternal: (url) => ipcRenderer.send("open-external", url),

  // Fires when the OS hands a tracked26://... deep link back to the app
  // (e.g. after completing Google sign-in).
  onDeepLink: (callback) => ipcRenderer.on("deep-link", (_event, url) => callback(url)),

  // Fires with auto-update lifecycle events from main.js:
  // { status: "checking" }
  // { status: "downloading", version }
  // { status: "progress", percent }
  // { status: "ready", version }
  // { status: "up-to-date" }
  // { status: "error", message }
  // { status: "dev-mode" }
  onUpdateStatus: (callback) => ipcRenderer.on("update-status", (_event, status) => callback(status)),

  // Lets the renderer trigger a manual "Check for updates" action.
  checkForUpdates: () => ipcRenderer.send("check-for-updates")
});