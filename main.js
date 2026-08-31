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

// ---------- Startup splash ----------
let splashWindow = null;
let lastSplashStatus = null;

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

// Small helper used everywhere we touch mainWindow from an event handler
// that could fire after the window has already been destroyed (e.g. a
// second-instance event racing with an in-progress quit/auto-update
// relaunch). A plain `if (mainWindow)` check isn't enough: mainWindow can
// be non-null but already destroyed, and calling methods on a destroyed
// BrowserWindow throws "Object has been destroyed".
function isMainWindowUsable() {
  return !!mainWindow && !mainWindow.isDestroyed();
}

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
    if (isMainWindowUsable()) {
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

  // Clear the reference once the window is actually destroyed (real quit,
  // update install/relaunch, etc.) so later handlers never call methods
  // on a dead BrowserWindow — see isMainWindowUsable() above.
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Resolves once the main window's content is actually ready to paint.
// Used in app.whenReady() so the window is only shown once BOTH this and
// the startup update check have finished — whichever takes longer.
function mainWindowReady() {
  return new Promise((resolve) => {
    mainWindow.once("ready-to-show", resolve);
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
        if (!isMainWindowUsable()) return;
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
    if (!isMainWindowUsable()) return;
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });
}

// ---------- Startup splash window ----------
// A small window shown first on launch, like Discord/Slack: it runs the
// update check, shows progress if one's found, then either closes so the
// main window can appear (no update) or silently installs and relaunches
// (update found) — the main window is never shown mid-update.
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 320,
    height: 190,
    frame: false,
    resizable: false,
    movable: false,
    transparent: true,
    hasShadow: true,
    skipTaskbar: true,
    center: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "app", "splash-preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, "app", "splash.html"));

  // In case a status arrives before the splash page has finished loading
  // (quite possible — "checking" fires almost immediately), replay the
  // most recent one once it's ready instead of the page sitting blank.
  splashWindow.webContents.once("did-finish-load", () => {
    if (lastSplashStatus) setSplashStatus(lastSplashStatus);
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
  });
}

function setSplashStatus(status) {
  lastSplashStatus = status;
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("splash-status", status);
  }
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}

// Minimum time the splash stays up even on an instant "you're up to
// date" result — long enough to register as "it did something" rather
// than an unexplained flash, short enough to not feel like a delay.
const MIN_SPLASH_MS = 700;

// Runs the update check that gates the splash → main window handoff.
// Resolves once it's safe to show the main window (no update, dev mode,
// or the check/download failed) — resolving anyway on failure so a
// GitHub outage never blocks the app from opening. If an update IS found
// and downloaded, this deliberately never resolves: the app silently
// installs and relaunches instead (see the update-downloaded handler),
// and this whole sequence runs again from scratch on the new launch.
function runStartupUpdateCheck() {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const finish = () => {
      const waitMs = Math.max(0, MIN_SPLASH_MS - (Date.now() - startedAt));
      setTimeout(resolve, waitMs);
    };

    if (!app.isPackaged) {
      // No packaged app-update.yml / version metadata to check against
      // when running via `npm start`.
      setSplashStatus({ status: "dev-mode" });
      finish();
      return;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    setSplashStatus({ status: "checking" });

    const onProgress = (progress) => setSplashStatus({ status: "progress", percent: progress.percent });
    autoUpdater.on("download-progress", onProgress);

    autoUpdater.once("update-not-available", () => {
      autoUpdater.removeListener("download-progress", onProgress);
      setSplashStatus({ status: "up-to-date" });
      finish();
    });

    autoUpdater.once("error", (err) => {
      autoUpdater.removeListener("download-progress", onProgress);
      console.error("Startup update check failed:", err);
      setSplashStatus({ status: "error" });
      finish();
    });

    autoUpdater.once("update-available", (info) => {
      setSplashStatus({ status: "downloading", version: info.version });
    });

    autoUpdater.once("update-downloaded", (info) => {
      autoUpdater.removeListener("download-progress", onProgress);
      setSplashStatus({ status: "restarting", version: info.version });
      // Silent + automatic — no "Restart now / Later" prompt here, since
      // the main window was never shown yet, unlike updates found later
      // while the app is already open (see setupBackgroundAutoUpdater).
      setTimeout(() => {
        isQuitting = true;
        autoUpdater.quitAndInstall(true, true);
      }, 900);
    });

    // Safety net: never block startup indefinitely if something above
    // misbehaves (e.g. no "error" event fires for some edge-case failure).
    setTimeout(finish, 8000);

    autoUpdater.checkForUpdates().catch(err => {
      console.error("Startup update check failed to start:", err);
      setSplashStatus({ status: "error" });
      finish();
    });
  });
}

function handleDeepLink(url) {
  if (!url || !url.startsWith(`${PROTOCOL}://`)) return;
  if (isMainWindowUsable()) {
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
// The very first check, at launch, is handled separately by
// runStartupUpdateCheck() above (drives the splash window, installs
// silently with no prompt). This function covers everything AFTER
// startup — periodic checks while the app is left open, and manual
// checks triggered from the renderer — where the main window is already
// visible, so a "Restart now / Later" prompt makes sense.
function sendUpdateStatus(status) {
  if (isMainWindowUsable()) {
    mainWindow.webContents.send("update-status", status);
  }
}

function setupBackgroundAutoUpdater() {
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

    if (!isMainWindowUsable()) {
      // Window disappeared mid-download (e.g. user quit) — just let
      // autoInstallOnAppQuit handle it next launch instead of showing a
      // dialog attached to a dead window.
      return;
    }

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

  // The launch-time check already happened via runStartupUpdateCheck() —
  // this just keeps checking periodically in case the app is left open
  // for days.
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
    // Honored natively on macOS. On Windows/Linux the OS ignores it, so
    // we also pass our own --hidden flag below and check for it ourselves
    // via `startedHidden` at the top of this file / the macOS branch in
    // app.whenReady().
    openAsHidden: true,
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
    if (lastWidgetState && widgetWindow && !widgetWindow.isDestroyed()) {
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
    } else if (!widgetWindow.isDestroyed()) {
      widgetWindow.show();
    }
  } else if (widgetWindow && !widgetWindow.isDestroyed()) {
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
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide();
  if (isMainWindowUsable()) {
    mainWindow.webContents.send("widget-closed-externally");
  }
});

app.whenReady().then(async () => {
  // macOS reports a hidden login-item launch directly instead of via argv.
  if (process.platform === "darwin") {
    startedHidden = startedHidden || app.getLoginItemSettings().wasOpenedAsHidden;
  }

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

  createWindow();
  createTray();

  // Startup splash + update check. Skipped visually when this launch was
  // a hidden auto-start at login (see "Start on PC startup") — nothing
  // should flash on screen for that — but the update check itself still
  // runs silently either way, via runStartupUpdateCheck() below.
  if (!startedHidden) {
    createSplashWindow();
  }

  // Wait for BOTH the main window's content to actually be ready to
  // paint AND the update check to finish, whichever takes longer, before
  // showing anything. If an update is found and installed, this promise
  // never resolves — the app quits and relaunches instead (see
  // runStartupUpdateCheck), so nothing after this point runs.
  await Promise.all([runStartupUpdateCheck(), mainWindowReady()]);

  closeSplashWindow();
  if (!startedHidden && isMainWindowUsable()) {
    mainWindow.show();
  }

  // Persistent handlers for updates found later, while the app is
  // already open (periodic checks + manual "check for updates").
  setupBackgroundAutoUpdater();

  // Windows/Linux: if THIS launch of the app was itself triggered by the
  // OS opening a tracked26://... link (cold start, not already running).
  const deepLinkUrl = process.argv.find(a => a.startsWith(`${PROTOCOL}://`));
  if (deepLinkUrl && isMainWindowUsable()) {
    mainWindow.webContents.once("did-finish-load", () => handleDeepLink(deepLinkUrl));
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (isMainWindowUsable()) {
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