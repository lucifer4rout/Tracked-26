const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("path");

// The custom scheme Google/Supabase will hand control back to after login.
// Must match SUPABASE_REDIRECT_URL in app/script.js and the Redirect URL
// you add in Supabase's Auth → URL Configuration settings.
const PROTOCOL = "tracked26";

let mainWindow = null;

// ---------- Single instance lock ----------
// On Windows/Linux, opening a "tracked26://..." link launches a *second*
// copy of the app with the URL as an argv — we forward that URL to the
// already-running instance instead of opening a second window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const deepLinkUrl = argv.find(a => a.startsWith(`${PROTOCOL}://`));
    if (deepLinkUrl) handleDeepLink(deepLinkUrl);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#0b0d12",
    icon: path.join(__dirname, "build", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "app", "index.html"));

  // Any link the app tries to navigate to externally (e.g. if a stray
  // target=_blank shows up) should open in the system browser, not a
  // second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function handleDeepLink(url) {
  if (!url || !url.startsWith(`${PROTOCOL}://`)) return;
  if (mainWindow) {
    mainWindow.webContents.send("deep-link", url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

// ---------- Protocol registration ----------
// In a packaged app (electron-builder's "protocols" config, see
// package.json) this is handled by the OS installer. Calling it here too
// keeps `npm start` (unpackaged dev mode) working on Windows/Linux.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// macOS delivers the deep link via this event instead of argv.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.whenReady().then(() => {
  createWindow();

  // Windows/Linux: if THIS launch of the app was itself triggered by the
  // OS opening a tracked26://... link (cold start, not already running).
  const deepLinkUrl = process.argv.find(a => a.startsWith(`${PROTOCOL}://`));
  if (deepLinkUrl) {
    mainWindow.webContents.once("did-finish-load", () => handleDeepLink(deepLinkUrl));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Renderer asks the main process to open the Google OAuth page in the
// user's default browser, per OAuth-for-native-apps best practice (never
// embed a login form in the app's own webview).
ipcMain.on("open-external", (_event, url) => {
  shell.openExternal(url);
});