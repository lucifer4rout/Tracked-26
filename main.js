const { app, BrowserWindow, shell, ipcMain, dialog, Tray, Menu, nativeImage, screen } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");

// The custom scheme Google/Supabase will hand control back to after login.
// Must match SUPABASE_REDIRECT_URL in app/script.js and the Redirect URL
// you add in Supabase's Auth → URL Configuration settings.
const PROTOCOL = "tracked26";

// True when the OS itself launched us at login (see the "Start on PC
// startup" setting below). On Windows/Linux we detect this via the
// --hidden flag we pass ourselves in app.setLoginItemSettings(); macOS
// reports it directly via getLoginItemSettings().wasOpenedAsHidden
// instead (computed once app is ready, see app.whenReady() below).
let startedHidden = process.argv.includes("--hidden");

let mainWindow = null;
let tray = null;

// ---------- Desktop widget state ----------
let widgetWindow = null;
let showDesktopWidget = false;
// Cached so a freshly-created widget window has something to render
// immediately on did-finish-load, instead of waiting for the main window
// to push a fresh update.
let lastWidgetState = null;

// Whether closing the window should minimize to the tray instead of quitting.
// Kept in sync with state.settings.minimizeToTray in the renderer via IPC
// (see the "set-minimize-to-tray" listener below). Defaults to true to
// match DEFAULT_STATE.settings.minimizeToTray in app/script.js.
let minimizeToTray = true;

// Set to true right before an intentional quit (Quit from tray menu, OS
// quit, before-quit) so the window's close handler doesn't intercept it.
let isQuitting = false;

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
      if (!mainWindow.isVisible()) mainWindow.show();
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
    // Created hidden always — we decide whether to actually show it once
    // ready, based on whether this launch came from "start on PC startup".
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "app", "index.html"));

  // Show once ready — unless this launch was auto-start at login, in
  // which case it should stay hidden in the tray until the user opens it.
  mainWindow.once("ready-to-show", () => {
    if (!startedHidden) mainWindow.show();
  });

  // Any link the app tries to navigate to externally (e.g. if a stray
  // target=_blank shows up) should open in the system browser, not a
  // second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // If "minimize to tray on close" is on, closing the window just hides
  // it instead of quitting the app. The tray icon (or its "Open" menu
  // item) brings it back; "Quit" from the tray menu sets isQuitting first.
  mainWindow.on("close", (event) => {
    if (!isQuitting && minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Loads the tray icon, checking the file actually exists and produced a
// real (non-empty) image before trusting it — nativeImage.createFromPath
// fails *silently* on a missing/bad file, which is what causes a blank
// tray slot instead of a crash or error.
function loadTrayIcon() {
  const candidates = process.platform === "win32"
    ? ["icon.ico", "icon.png"]
    : ["icon.png", "icon.ico"];

  for (const name of candidates) {
    const iconPath = path.join(__dirname, "build", name);
    if (!fs.existsSync(iconPath)) {
      console.warn(`[tray] icon not found at ${iconPath}`);
      continue;
    }
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) {
      console.warn(`[tray] icon at ${iconPath} loaded but is empty (corrupt or unsupported format)`);
      continue;
    }
    console.log(`[tray] using icon: ${iconPath}`);
    // macOS menu bar wants small icons; Windows/Linux tray can use it as-is too.
    return process.platform === "darwin" ? img.resize({ width: 18, height: 18 }) : img;
  }

  console.error(
    "[tray] No usable icon found in build/icon.png or build/icon.ico. " +
    "Falling back to a generated placeholder — add a real build/icon.png (at least 32x32, ideally 256x256) to fix this."
  );
  // Minimal generated fallback so the tray is never fully blank.
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAKUlEQVR4Xu3OMQEAAAgDoJvc6NpiA0ubOAAAAAAAAAAAAAAAAAAAADwG3TABZLPHRqcAAAAASUVORK5CYII="
  );
}

function createTray() {
  const trayIcon = loadTrayIcon();
  tray = new Tray(trayIcon);
  tray.setToolTip("Tracked 26");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open Tracked 26",
      click: () => {
        if (!mainWindow) return;
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: "separator" },
    {
      label: "Help",
      click: () => {
        shell.openExternal("https://tracked-26-website.pages.dev");
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);

  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });
}

function handleDeepLink(url) {
  if (!url || !url.startsWith(`${PROTOCOL}://`)) return;
  if (mainWindow) {
    mainWindow.webContents.send("deep-link", url);
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
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

    if (response === 0) {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    }
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

// Renderer tells us whenever the "Minimize to tray on close" setting
// changes (including once on startup, so this is correct even before the
// user opens Settings).
ipcMain.on("set-minimize-to-tray", (_event, value) => {
  minimizeToTray = !!value;
});

// Renderer tells us whenever "Start on PC startup" is toggled (including
// once on startup, to keep the OS-level login item in sync with the saved
// preference in case they diverged — e.g. the user reinstalled the app).
// This only actually registers with the OS in a packaged build: in dev
// mode it would register the Electron binary itself, launching a generic
// Electron shell at login instead of this app, which is more confusing
// than useful.
ipcMain.on("set-start-on-startup", (_event, value) => {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: !!value,
    // --hidden tells this same file (see `startedHidden` above) to skip
    // showing the window — it should only appear in the tray at login.
    args: value ? ["--hidden"] : []
  });
});

// ---------- Desktop widget (floating countdown clock) ----------

function createWidgetWindow() {
  if (widgetWindow) return;

  // Content needs roughly this much room: three clock cards (~108px each),
  // two ":" separators, and gaps between them, plus padding — and extra
  // margin on top of that for the cards' drop-shadows to not get clipped
  // by the window's own edge (the window has overflow:hidden).
  const WIDGET_WIDTH = 480;
  const WIDGET_HEIGHT = 190;

  widgetWindow = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    // NOT always-on-top: a true always-on-top window floats above every
    // app you focus, including your editor — which is what was covering
    // VS Code. Without this flag it behaves like a normal window: it
    // sits on the desktop and goes behind whatever you're actively using,
        // which is the actual "desktop widget" feel being asked for.
    alwaysOnTop: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "app", "widget-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Park it in the bottom-right of the primary display by default, clear
  // of this app's own topbar controls. It's draggable (see widget.css —
  // the whole card is -webkit-app-region: drag) so the user can move it
  // anywhere after that.
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  widgetWindow.setPosition(width - WIDGET_WIDTH - 20, height - WIDGET_HEIGHT - 20);

  widgetWindow.loadFile(path.join(__dirname, "app", "widget.html"));

  // A transparent window still captures mouse events across its ENTIRE
  // rectangle by default — including the empty padding around the clock
  // card — so without this it would block clicks to whatever sits behind
  // it on the desktop or in other windows. Start click-through; the
  // renderer (widget.js) tells us via "widget-set-interactive" when the
  // cursor is actually over the visible card, so dragging/closing still
  // works.
  widgetWindow.setIgnoreMouseEvents(true, { forward: true });

  // As soon as the widget's own page has loaded, hand it whatever state
  // we last received from the main window so it doesn't sit blank while
  // waiting for the next update.
  widgetWindow.webContents.once("did-finish-load", () => {
    if (lastWidgetState && widgetWindow) {
      widgetWindow.webContents.send("widget-state", lastWidgetState);
    }
  });

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
}

// Renderer (widget.js) reports whether the cursor is over the actual
// visible card (interactive) or the transparent margin around it.
ipcMain.on("widget-set-interactive", (_event, interactive) => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  }
});

// Renderer (main window) tells us to turn the floating widget on/off —
// fired once on startup to restore the saved preference, and again
// whenever the user flips the Settings toggle.
ipcMain.on("set-show-widget", (_event, value) => {
  showDesktopWidget = !!value;
  if (showDesktopWidget) {
    if (!widgetWindow) {
      createWidgetWindow();
    } else {
      widgetWindow.show();
    }
  } else if (widgetWindow) {
    widgetWindow.hide();
  }
});

// Renderer pushes fresh { examDate, theme, targetYear } whenever any of
// those change. Cache it so a widget window created later starts warm.
ipcMain.on("widget-state-update", (_event, data) => {
  lastWidgetState = data;
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send("widget-state", data);
  }
});

// The widget's own "✕" button was clicked — hide it and tell the main
// window so it can uncheck the Settings toggle to match reality.
ipcMain.on("widget-close-clicked", () => {
  showDesktopWidget = false;
  if (widgetWindow) widgetWindow.hide();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("widget-closed-externally");
  }
});

// ---------- Start on PC startup ----------

// Renderer tells us whenever the "Start on PC startup" setting changes
// (including once on startup, so this is correct even before the user
// opens Settings). openAsHidden is honored natively on macOS; on
// Windows/Linux it's ignored by the OS, so we pass our own --hidden flag
// and check for it ourselves in startedHidden above / the macOS branch
// in app.whenReady() below.
ipcMain.on("set-start-on-startup", (_event, value) => {
  app.setLoginItemSettings({
    openAtLogin: !!value,
    openAsHidden: true,
    args: ["--hidden"]
  });
});

app.whenReady().then(() => {
  // Removes the default File/Edit/View/Window/Help menu bar. On Windows
  // and Linux this hides it completely. On macOS the menu bar itself
  // can't be removed (it's part of the OS), so a minimal one is kept
  // there instead, just enough for Cmd+Q / Cmd+C / Cmd+V to still work.
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "quit" }
        ]
      },
      {
        label: "Edit",
        submenu: [
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" }
        ]
      }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // macOS reports a hidden login-item launch directly instead of via argv.
  if (process.platform === "darwin") {
    startedHidden = startedHidden || app.getLoginItemSettings().wasOpenedAsHidden;
  }

  createWindow();
  createTray();
  setupAutoUpdater();

  // Windows/Linux: if THIS launch of the app was itself triggered by the
  // OS opening a tracked26://... link (cold start, not already running).
  const deepLinkUrl = process.argv.find(a => a.startsWith(`${PROTOCOL}://`));
  if (deepLinkUrl) {
    mainWindow.webContents.once("did-finish-load", () => handleDeepLink(deepLinkUrl));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// Make sure a real quit (Cmd+Q, OS shutdown, etc.) isn't swallowed by the
// "minimize to tray" close-guard on the window.
app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // With tray mode on, the window is hidden rather than destroyed on close,
  // so this normally only fires on a genuine quit — safe to quit here too.
  if (process.platform !== "darwin") app.quit();
});

// Renderer asks the main process to open the Google OAuth page in the
// user's default browser, per OAuth-for-native-apps best practice (never
// embed a login form in the app's own webview).
ipcMain.on("open-external", (_event, url) => {
  shell.openExternal(url);
});