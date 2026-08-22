const { app, BrowserWindow, shell, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
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

// ---------- Auto-update (GitHub Releases via electron-updater) ----------
function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", status);
  }
}

function setupAutoUpdater() {
  // Don't bother checking in dev — there's no packaged app-update.yml /
  // version metadata to compare against when running via `npm start`.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;         // download silently in the background
  autoUpdater.autoInstallOnAppQuit = true; // fallback: install on next natural quit even if the prompt is dismissed

  autoUpdater.on("checking-for-update", () => {
    sendUpdateStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateStatus({ status: "downloading", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    sendUpdateStatus({ status: "up-to-date" });
  });

  autoUpdater.on("error", (err) => {
    console.error("Auto-update error:", err);
    sendUpdateStatus({ status: "error", message: err.message });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateStatus({ status: "progress", percent: progress.percent });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    sendUpdateStatus({ status: "ready", version: info.version });

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      title: "Update ready",
      message: `Tracked 26 v${info.version} is ready to install.`,
      detail: "Restart now to apply the update, or it'll install automatically next time you quit."
    });

    if (response === 0) autoUpdater.quitAndInstall();
  });

  // Check on launch, then every few hours in case the app is left open for days.
  autoUpdater.checkForUpdates().catch(err => console.error("Initial update check failed:", err));
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(err => console.error("Periodic update check failed:", err));
  }, 4 * 60 * 60 * 1000);
}

// Renderer can also trigger a manual check (e.g. an "Check for updates" button in the profile drawer).
ipcMain.on("check-for-updates", () => {
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err => console.error("Manual update check failed:", err));
  } else {
    sendUpdateStatus({ status: "dev-mode" });
  }
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();

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