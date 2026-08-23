const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetAPI", {
  // Fires whenever the main app pushes fresh data: { examDate, theme, targetYear }
  onState: (callback) => ipcRenderer.on("widget-state", (_event, data) => callback(data)),

  // Widget's own "x" button — hides it and tells the main window to
  // uncheck the "Show desktop widget" toggle in Settings.
  close: () => ipcRenderer.send("widget-close-clicked"),

  // Tells main.js whether the cursor is currently over the visible clock
  // card (true) or the transparent margin around it (false), so the
  // window can be click-through everywhere except the actual card.
  setInteractive: (value) => ipcRenderer.send("widget-set-interactive", value)
});