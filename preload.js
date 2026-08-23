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
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),

  // Tells the main process whether closing the window should minimize
  // to the tray (true) or quit normally (false). Called once on startup
  // and again whenever the user toggles it in Settings.
  setMinimizeToTray: (value) => ipcRenderer.send("set-minimize-to-tray", value),

  // Registers (or removes) Tracked 26 as an OS login item. When true, the
  // app launches automatically at PC startup, hidden in the tray — the
  // main window won't pop open on its own. Called once on startup and
  // again whenever the user toggles it in Settings.
  setStartOnStartup: (value) => ipcRenderer.send("set-start-on-startup", value),

  // ---------- Desktop widget (floating countdown clock) ----------

  // Turns the floating widget window on/off. Called once on startup
  // (to restore the saved preference) and again whenever the user
  // flips "Show desktop widget" in Settings.
  setShowWidget: (value) => ipcRenderer.send("set-show-widget", value),

  // Pushes the latest { examDate, theme, targetYear } into the widget
  // window. Call this whenever any of those values change, and once
  // right after turning the widget on.
  sendWidgetState: (data) => ipcRenderer.send("widget-state-update", data),

  // Fires if the widget's own "✕" button was clicked, so the main
  // window can un-check the Settings toggle to match reality.
  onWidgetClosedExternally: (callback) => ipcRenderer.on("widget-closed-externally", () => callback())
});