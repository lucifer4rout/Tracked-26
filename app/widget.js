/* ============================================================
   Tracked 26 — desktop widget renderer.
   Receives { examDate, theme, targetYear } pushed from the main
   app window (via main.js) and keeps its own countdown ticking.
   ============================================================ */

let examDate = null;

function applyTheme(theme) {
  // theme here is already resolved to "light" or "dark" by the main window
  // (it knows how to read prefers-color-scheme); default to dark if unset.
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
}

function tick() {
  if (!examDate) return;
  const target = new Date(examDate + "T09:00:00");
  const now = new Date();
  let diff = target - now;
  if (diff < 0) diff = 0;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  document.getElementById("wDays").textContent = String(days).padStart(3, "0");
  document.getElementById("wHours").textContent = String(hours).padStart(2, "0");
  document.getElementById("wMins").textContent = String(mins).padStart(2, "0");
}

if (window.widgetAPI) {
  window.widgetAPI.onState(data => {
    if (!data) return;
    if (data.examDate) examDate = data.examDate;
    applyTheme(data.theme);
    if (data.targetYear) {
      document.getElementById("widgetLabel").textContent = `TIME UNTIL JEE ${data.targetYear}`;
    }
    tick();
  });

  document.getElementById("widgetCloseBtn").addEventListener("click", () => {
    window.widgetAPI.close();
  });

  // The window is click-through by default (see main.js) so it never
  // blocks clicks to whatever's behind it. Only capture the mouse while
  // the cursor is actually over the visible card, so dragging and the
  // close button still work.
  const widgetRoot = document.getElementById("widgetRoot");
  widgetRoot.addEventListener("mouseenter", () => window.widgetAPI.setInteractive(true));
  widgetRoot.addEventListener("mouseleave", () => window.widgetAPI.setInteractive(false));
}

setInterval(tick, 1000);