/* ============================================================
   JEE 2027 Progress Tracker
   Data lives in localStorage by default. If you sign in with
   Google (via Supabase Auth), it's also synced to a Supabase
   table so you can pick up on another device.
   ============================================================ */

const STORAGE_KEY = "jee-tracker-state-v1";

/* ---------------- Supabase config ---------------- */
// TODO: paste your Supabase project's *anon/public* API key here.
// Find it in your Supabase dashboard: Project Settings → API → "anon public".
// This key is safe to expose in client-side code — it only works within
// the permissions your Row Level Security policies allow (see the SQL
// setup notes provided alongside this file).
const SUPABASE_URL = "https://jxrourlbqhfojxrfimff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4cm91cmxicWhmb2p4cmZpbWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzY3MTksImV4cCI6MjEwMjk1MjcxOX0.uA5lSZ0MxtX8Yxyyx265VfCSlDvC8vHHqF5TwTg6WQg";

// True when running inside the Electron shell (preload.js exposes this).
// The web build never has window.electronAPI, so this is always false there.
const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI;

// Where Google/Supabase should hand control back after sign-in.
// - Electron: a custom URL scheme the OS routes back into this app (see main.js).
// - Web: just come back to whatever page we're already on.
const SUPABASE_REDIRECT_URL = IS_ELECTRON ? "tracked26://auth-callback" : window.location.href;

const supabaseClient = (SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4cm91cmxicWhmb2p4cmZpbWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzY3MTksImV4cCI6MjEwMjk1MjcxOX0.uA5lSZ0MxtX8Yxyyx265VfCSlDvC8vHHqF5TwTg6WQg" && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // PKCE is required for the Electron deep-link flow (no client secret,
        // no tokens sitting exposed in a redirect URL) and works fine for the
        // web build too, so we use it everywhere.
        flowType: "pkce"
      }
    })
  : null;

const DEFAULT_STATE = {
  examDate: "2027-01-24",
  profile: null,  // { classLevel: "11"|"12"|"dropper1"|"dropper2", targetYear: 2027 } — null until onboarding completes
  theme: "system", // "light" | "dark" | "system"
  avatar: null,   // data URL string for the profile picture, or null
  updatedAt: 0,   // ms timestamp of the last local change — used to decide sync direction
  subjects: {
    Physics: [
      "Basic Mathematics", "Units & Measurements", "Motion In A Straight Line",
      "Motion In A Plane", "Laws Of Motion", "Work, Energy & Power",
      "Centre Of Mass & System Of Particles", "Rotational Motion",
      "Gravitation", "Mechanical Properties Of Solids", "Mechanical Properties Of Fluids",
      "Thermal Properties Of Matter", "Thermodynamics", "Kinetic Theory Of Gases",
      "Oscillations", "Waves", "Electrostatics", "Current Electricity",
      "Magnetic Effects Of Current", "Electromagnetic Induction", "Alternating Current",
      "Ray Optics", "Wave Optics", "Modern Physics", "Semiconductors"
    ],
    Chemistry: [
      "Mole Concept", "Atomic Structure", "Periodic Table", "Chemical Bonding",
      "States Of Matter", "Thermodynamics", "Equilibrium", "Redox Reactions",
      "Hydrogen", "s-Block Elements", "p-Block Elements", "Organic Chemistry Basics",
      "Hydrocarbons", "Environmental Chemistry", "Solid State", "Solutions",
      "Electrochemistry", "Chemical Kinetics", "Surface Chemistry", "d & f Block Elements",
      "Coordination Compounds", "Haloalkanes & Haloarenes", "Alcohols, Phenols & Ethers",
      "Aldehydes, Ketones & Carboxylic Acids", "Amines", "Biomolecules & Polymers"
    ],
    Maths: [
      "Sets, Relations & Functions", "Complex Numbers", "Quadratic Equations",
      "Sequences & Series", "Permutations & Combinations", "Binomial Theorem",
      "Matrices & Determinants", "Straight Lines", "Circles", "Conic Sections",
      "Limits, Continuity & Differentiability", "Differentiation",
      "Application Of Derivatives", "Indefinite Integration", "Definite Integration",
      "Area Under Curves", "Differential Equations", "Vectors", "3D Geometry",
      "Trigonometric Ratios & Identities", "Inverse Trigonometry", "Statistics",
      "Probability"
    ]
  },
  progress: {},   // "Subject::Chapter" -> { lectures, notes, shortNotes, revision, tests, status }
  heatmap: {},  // "YYYY-MM-DD" -> 0-4 intensity level
  months: [
    { name: "Aug", items: [
      { text: "Physics — Mechanics revision", done: false },
      { text: "Chemistry — Physical basics", done: false },
      { text: "Maths — Algebra foundation", done: false }
    ]},
    { name: "Sep", items: [
      { text: "Physics — Electrostatics start", done: false },
      { text: "Chemistry — Organic basics", done: false },
      { text: "Maths — Coordinate geometry", done: false }
    ]}
  ]
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    const base = structuredClone(DEFAULT_STATE);
    // Merge with defaults so older saved data (from before a feature like the
    // heatmap, theme, or avatar existed) doesn't crash the app when a field is missing.
    return {
      examDate: parsed.examDate ?? base.examDate,
      profile: parsed.profile ?? null,
      theme: parsed.theme ?? base.theme,
      avatar: parsed.avatar ?? null,
      updatedAt: parsed.updatedAt ?? 0,
      subjects: parsed.subjects ?? base.subjects,
      progress: parsed.progress ?? {},
      heatmap: parsed.heatmap ?? {},
      months: parsed.months ?? base.months
    };
  } catch (e) {
    console.error("Failed to load saved tracker state, starting fresh.", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to save tracker state.", e);
  }
}

let state = loadState();

function key(subject, chapter) { return `${subject}::${chapter}`; }

function getProgress(subject, chapter) {
  const k = key(subject, chapter);
  if (!state.progress[k]) {
    state.progress[k] = { lectures: false, notes: false, shortNotes: false, revision: false, tests: false };
  }
  return state.progress[k];
}

function computeStatus(p) {
  const flags = [p.lectures, p.notes, p.shortNotes, p.revision, p.tests];
  if (flags.every(f => f)) return "done";
  if (flags.some(f => f)) return "in-progress";
  return "not-started";
}

function statusLabel(s) {
  return { "done": "Done", "in-progress": "In Progress", "not-started": "Not Started" }[s];
}

function subjectCompletion(subject) {
  const chapters = state.subjects[subject];
  if (!chapters.length) return 0;
  const total = chapters.length * 5;
  let done = 0;
  chapters.forEach(ch => {
    const p = getProgress(subject, ch);
    done += [p.lectures, p.notes, p.shortNotes, p.revision, p.tests].filter(Boolean).length;
  });
  return Math.round((done / total) * 100);
}

/* ---------------- Theme ---------------- */
const systemThemeQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

function resolveTheme(theme) {
  if (theme === "system") {
    return systemThemeQuery && systemThemeQuery.matches ? "light" : "dark";
  }
  return theme;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", resolveTheme(theme));
}

function setTheme(theme) {
  state.theme = theme;
  saveState();
  applyTheme(theme);
  syncThemePills();
}

function syncThemePills() {
  document.querySelectorAll("#themePillGroup .pill").forEach(p => {
    p.classList.toggle("active", p.dataset.value === state.theme);
  });
}

// Keep things in sync if the OS-level theme changes while "system" is selected.
if (systemThemeQuery) {
  const handleSystemThemeChange = () => {
    if (state.theme === "system") applyTheme("system");
  };
  if (systemThemeQuery.addEventListener) {
    systemThemeQuery.addEventListener("change", handleSystemThemeChange);
  } else if (systemThemeQuery.addListener) {
    // Safari < 14 fallback
    systemThemeQuery.addListener(handleSystemThemeChange);
  }
}

document.querySelectorAll("#themePillGroup .pill").forEach(btn => {
  btn.addEventListener("click", () => setTheme(btn.dataset.value));
});

/* ---------------- Countdown ---------------- */
function tickCountdown() {
  const target = new Date(state.examDate + "T09:00:00");
  const now = new Date();
  let diff = target - now;
  if (diff < 0) diff = 0;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  document.getElementById("daysNum").textContent = String(days).padStart(3, "0");
  document.getElementById("hoursNum").textContent = String(hours).padStart(2, "0");
  document.getElementById("minsNum").textContent = String(mins).padStart(2, "0");
}

/* ---------------- Rendering: Dashboard ---------------- */
function renderOverviewGrid() {
  const grid = document.getElementById("overviewGrid");
  grid.innerHTML = "";
  Object.keys(state.subjects).forEach(subject => {
    const pct = subjectCompletion(subject);
    const card = document.createElement("div");
    card.className = "overview-card";
    card.innerHTML = `
      <div class="overview-card-head">
        <h3>${escapeHtml(subject)}</h3>
        <span class="overview-card-count">${state.subjects[subject].length} chapters</span>
      </div>
      <div class="overview-progress-bar"><div class="overview-progress-fill" style="width:${pct}%"></div></div>
      <div class="overview-progress-pct">${pct}% complete</div>
    `;
    card.addEventListener("click", () => switchView(subject));
    grid.appendChild(card);
  });
}

function renderMonths() {
  const grid = document.getElementById("targetsGrid");
  grid.innerHTML = "";
  state.months.forEach((month, mi) => {
    const card = document.createElement("div");
    card.className = "month-card";
    const itemsHtml = month.items.map((item, ii) => `
      <div class="month-item">
        <input type="checkbox" data-mi="${mi}" data-ii="${ii}" class="month-check" ${item.done ? "checked" : ""}>
        <input type="text" data-mi="${mi}" data-ii="${ii}" class="month-text" value="${escapeAttr(item.text)}">
      </div>
    `).join("");
    card.innerHTML = `
      <div class="month-card-head">
        <input class="month-name" data-mi="${mi}" value="${escapeAttr(month.name)}">
        <button class="month-remove" data-mi="${mi}" title="Remove month">✕</button>
      </div>
      ${itemsHtml}
      <button class="month-add-item" data-mi="${mi}">+ target</button>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll(".month-check").forEach(el => el.addEventListener("change", e => {
    const { mi, ii } = e.target.dataset;
    state.months[mi].items[ii].done = e.target.checked;
    saveState();
  }));
  grid.querySelectorAll(".month-text").forEach(el => el.addEventListener("input", e => {
    const { mi, ii } = e.target.dataset;
    state.months[mi].items[ii].text = e.target.value;
    saveState();
  }));
  grid.querySelectorAll(".month-name").forEach(el => el.addEventListener("input", e => {
    const { mi } = e.target.dataset;
    state.months[mi].name = e.target.value;
    saveState();
  }));
  grid.querySelectorAll(".month-remove").forEach(el => el.addEventListener("click", e => {
    const { mi } = e.target.dataset;
    state.months.splice(mi, 1);
    saveState();
    renderMonths();
  }));
  grid.querySelectorAll(".month-add-item").forEach(el => el.addEventListener("click", e => {
    const { mi } = e.target.dataset;
    state.months[mi].items.push({ text: "New target", done: false });
    saveState();
    renderMonths();
  }));
}

/* ---------------- Rendering: Subject view ---------------- */
function renderSubjectView(subject) {
  let view = document.getElementById(`view-${subject}`);
  if (!view) {
    const template = document.getElementById("subjectViewTemplate");
    view = template.cloneNode(true);
    view.id = `view-${subject}`;
    view.hidden = true;
    document.getElementById("subjectViews").appendChild(view);

    view.querySelector(".add-chapter-btn").addEventListener("click", () => {
      state.subjects[subject].push("New Chapter");
      saveState();
      renderSubjectView(subject);
    });
  }

  view.querySelector(".subject-title").textContent = subject;
  const pct = subjectCompletion(subject);
  view.querySelector(".subject-progress-fill").style.width = pct + "%";
  view.querySelector(".subject-progress-pct").textContent = pct + "%";

  const tbody = view.querySelector(".chapter-tbody");
  tbody.innerHTML = "";
  state.subjects[subject].forEach((chapter, idx) => {
    const p = getProgress(subject, chapter);
    const status = computeStatus(p);
    p.status = status;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-chapter"><input class="chapter-name" data-idx="${idx}" value="${escapeAttr(chapter)}"></td>
      <td><input type="checkbox" data-field="lectures" data-idx="${idx}" ${p.lectures ? "checked" : ""}></td>
      <td><input type="checkbox" data-field="notes" data-idx="${idx}" ${p.notes ? "checked" : ""}></td>
      <td><input type="checkbox" data-field="shortNotes" data-idx="${idx}" ${p.shortNotes ? "checked" : ""}></td>
      <td><input type="checkbox" data-field="revision" data-idx="${idx}" ${p.revision ? "checked" : ""}></td>
      <td><input type="checkbox" data-field="tests" data-idx="${idx}" ${p.tests ? "checked" : ""}></td>
      <td>
        <select class="status-select" data-status="${status}" disabled>
          <option>${statusLabel(status)}</option>
        </select>
      </td>
      <td><button class="row-remove" data-idx="${idx}" title="Remove chapter">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".chapter-name").forEach(el => el.addEventListener("input", e => {
    const idx = +e.target.dataset.idx;
    const oldName = state.subjects[subject][idx];
    const newName = e.target.value;
    // move progress data to new key
    const oldKey = key(subject, oldName);
    const newKey = key(subject, newName);
    if (state.progress[oldKey] && oldKey !== newKey) {
      state.progress[newKey] = state.progress[oldKey];
      delete state.progress[oldKey];
    }
    state.subjects[subject][idx] = newName;
    saveState();
  }));

  tbody.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", e => {
    const idx = +e.target.dataset.idx;
    const field = e.target.dataset.field;
    const chapter = state.subjects[subject][idx];
    const p = getProgress(subject, chapter);
    p[field] = e.target.checked;
    saveState();
    renderSubjectView(subject);
    renderOverviewGrid();
  }));

  tbody.querySelectorAll(".row-remove").forEach(el => el.addEventListener("click", e => {
    const idx = +e.target.dataset.idx;
    const chapter = state.subjects[subject][idx];
    delete state.progress[key(subject, chapter)];
    state.subjects[subject].splice(idx, 1);
    saveState();
    renderSubjectView(subject);
    renderOverviewGrid();
  }));
}

/* ---------------- Tabs / navigation ---------------- */
function renderTabs() {
  const nav = document.getElementById("subjectTabs");
  // Dashboard tab exists in the HTML already — just wire it up (once).
  const dashTab = nav.querySelector(".tab[data-view='dashboard']");
  if (dashTab && !dashTab.dataset.bound) {
    dashTab.addEventListener("click", () => switchView("dashboard"));
    dashTab.dataset.bound = "true";
  }
  nav.querySelectorAll(".tab:not([data-view='dashboard'])").forEach(t => t.remove());
  Object.keys(state.subjects).forEach(subject => {
    const btn = document.createElement("button");
    btn.className = "tab";
    btn.dataset.view = subject;
    btn.textContent = subject;
    btn.addEventListener("click", () => switchView(subject));
    nav.appendChild(btn);
  });
}

function switchView(viewName) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === viewName));
  document.getElementById("dashboardView").hidden = viewName !== "dashboard";
  Object.keys(state.subjects).forEach(subject => {
    const view = document.getElementById(`view-${subject}`);
    if (view) view.hidden = viewName !== subject;
  });
  if (viewName !== "dashboard") {
    if (!document.getElementById(`view-${viewName}`)) renderSubjectView(viewName);
    document.getElementById(`view-${viewName}`).hidden = false;
  }
  // little fade-in on whichever view just became visible
  const active = viewName === "dashboard"
    ? document.getElementById("dashboardView")
    : document.getElementById(`view-${viewName}`);
  active.classList.remove("view-enter");
  void active.offsetWidth; // restart animation
  active.classList.add("view-enter");
}

/* ---------------- Pixel-art study heatmap (year-long, by month) ---------------- */
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let selectedHeatmapMonth = new Date().getMonth(); // 0-11, defaults to the current month

function renderHeatmapMonthTabs() {
  const currentMonth = new Date().getMonth();
  const tabsEl = document.getElementById("heatmapMonthTabs");
  tabsEl.innerHTML = "";
  MONTH_NAMES.forEach((name, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "heatmap-month-tab"
      + (idx === selectedHeatmapMonth ? " active" : "")
      + (idx > currentMonth ? " is-future" : "");
    btn.textContent = name;
    btn.addEventListener("click", () => {
      selectedHeatmapMonth = idx;
      renderHeatmap();
    });
    tabsEl.appendChild(btn);
  });
}

function renderHeatmapCalendar() {
  const year = new Date().getFullYear();
  const month = selectedHeatmapMonth;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const weekdaysEl = document.getElementById("heatmapWeekdays");
  const daysEl = document.getElementById("heatmapDays");
  weekdaysEl.innerHTML = "";
  daysEl.innerHTML = "";

  ["S", "M", "T", "W", "T", "F", "S"].forEach(d => {
    const span = document.createElement("span");
    span.textContent = d;
    weekdaysEl.appendChild(span);
  });

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  for (let i = 0; i < startOffset; i++) {
    const pad = document.createElement("div");
    pad.className = "heatmap-day is-pad";
    daysEl.appendChild(pad);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month, d);
    const dateStr = fmtDate(dateObj);
    const isFuture = dateObj > today;
    const isPast = dateObj < today;
    const isToday = dateObj.getTime() === today.getTime();
    const level = isFuture ? -1 : (state.heatmap[dateStr] || 0);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "heatmap-day";
    if (isToday) cell.classList.add("is-today");
    if (isPast) cell.classList.add("is-locked");
    cell.dataset.level = level;
    cell.textContent = d;

    if (isFuture) {
      cell.title = "";
      cell.disabled = true;
      cell.classList.add("is-future");
    } else if (isPast) {
      cell.title = `${dateStr} — ${["No study logged", "Light", "Solid", "Great", "Deep focus"][level]} (locked — only today can be logged)`;
      cell.disabled = true;
    } else {
      // today — the only editable cell
      cell.title = `${dateStr} — ${["No study logged", "Light", "Solid", "Great", "Deep focus"][level]} (click to update)`;
      cell.addEventListener("click", () => {
        const next = (level + 1) % 5;
        state.heatmap[dateStr] = next;
        saveState();
        renderHeatmapCalendar();
      });
    }
    daysEl.appendChild(cell);
  }
}

function renderHeatmap() {
  renderHeatmapMonthTabs();
  renderHeatmapCalendar();
}

/* ---------------- Avatar (profile picture) ---------------- */
// Downscales the chosen image client-side before it's stored, so a big phone
// photo doesn't bloat localStorage — everything stays comfortably small.
function fileToResizedDataUrl(file, maxSize = 220) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        } else if (height >= width && height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.87));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderAvatar() {
  // A signed-in Google avatar (if we have one and the user hasn't set a
  // custom photo) takes priority over the fallback icon.
  const displayAvatar = state.avatar || currentGoogleAvatarUrl;
  const has = !!displayAvatar;

  const bigImg = document.getElementById("avatarImg");
  const bigFallback = document.getElementById("avatarFallback");
  bigImg.src = displayAvatar || "";
  bigImg.hidden = !has;
  bigFallback.style.display = has ? "none" : "";

  const triggerImg = document.getElementById("profileTriggerAvatarImg");
  const triggerFallback = document.getElementById("profileTriggerFallback");
  triggerImg.src = displayAvatar || "";
  triggerImg.hidden = !has;
  triggerFallback.style.display = has ? "none" : "";

  document.getElementById("avatarRemoveBtn").hidden = !state.avatar;
}

document.getElementById("avatarPickBtn").addEventListener("click", () => {
  document.getElementById("avatarFileInput").click();
});
document.getElementById("avatarUploadBtn").addEventListener("click", () => {
  document.getElementById("avatarFileInput").click();
});
document.getElementById("avatarFileInput").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ""; // allow re-selecting the same file later
  if (!file || !file.type.startsWith("image/")) return;
  try {
    state.avatar = await fileToResizedDataUrl(file);
    saveState();
    renderAvatar();
  } catch (err) {
    console.error("Failed to process the selected image.", err);
    alert("Sorry, that image couldn't be used. Try a different photo.");
  }
});
document.getElementById("avatarRemoveBtn").addEventListener("click", () => {
  state.avatar = null;
  saveState();
  renderAvatar();
});

/* ---------------- Auth + Sync (Google via Supabase) ----------------
   Sync is a simple last-write-wins: whichever side (this device or the
   Supabase row) has the more recent `updatedAt` timestamp wins, and its
   full state overwrites the other side. Good enough for one person using
   the tracker across a couple of their own devices. */

let currentSession = null;
let currentGoogleAvatarUrl = null;
let syncInFlight = false;

function setSyncNote(text, kind) {
  const note = document.getElementById("syncNote");
  note.textContent = text;
  note.classList.remove("is-error", "is-success");
  if (kind) note.classList.add(kind);
}

function renderSyncUI() {
  const accountEl = document.getElementById("syncAccount");
  const syncBtnLabel = document.getElementById("syncBtnLabel");
  const syncBtn = document.getElementById("syncBtn");

  if (!supabaseClient) {
    accountEl.hidden = true;
    syncBtnLabel.textContent = "Sync not configured";
    syncBtn.disabled = true;
    setSyncNote("Sync isn't set up yet on this deployment.");
    return;
  }

  if (currentSession) {
    const user = currentSession.user;
    const meta = user.user_metadata || {};
    currentGoogleAvatarUrl = meta.avatar_url || meta.picture || null;
    accountEl.hidden = false;
    document.getElementById("syncAccountName").textContent = meta.full_name || meta.name || user.email || "Signed in";
    document.getElementById("syncAccountAvatar").src = currentGoogleAvatarUrl || "";
    document.getElementById("syncAccountAvatar").style.visibility = currentGoogleAvatarUrl ? "visible" : "hidden";
    syncBtnLabel.textContent = "Sync now";
    syncBtn.disabled = false;
    setSyncNote("Synced to your Google account. Click sync anytime to push or pull the latest changes.");
  } else {
    currentGoogleAvatarUrl = null;
    accountEl.hidden = true;
    syncBtnLabel.textContent = "Sign in with Google to sync";
    syncBtn.disabled = false;
    setSyncNote("Sync saves your progress to your Google account so you can pick it up on another device.");
  }
  renderAvatar();
}

async function signInWithGoogle() {
  if (!supabaseClient) return;

  if (IS_ELECTRON) {
    // Desktop flow: get the Google auth URL from Supabase without letting
    // the client navigate anywhere itself (skipBrowserRedirect), then hand
    // it to the main process to open in the user's actual system browser.
    // Embedding an OAuth login form inside the app's own window is both
    // against Google's policy for native apps and worse for the user (no
    // way to verify they're really on a Google domain).
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: SUPABASE_REDIRECT_URL, skipBrowserRedirect: true }
    });
    if (error || !data?.url) {
      console.error("Google sign-in failed to start.", error);
      setSyncNote("Couldn't start Google sign-in. Try again.", "is-error");
      return;
    }
    window.electronAPI.openExternal(data.url);
    setSyncNote("Continue signing in in your browser…");
    return;
  }

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: SUPABASE_REDIRECT_URL }
  });
  if (error) {
    console.error("Google sign-in failed to start.", error);
    setSyncNote("Couldn't start Google sign-in. Try again.", "is-error");
  }
  // On success the browser navigates away to Google, then back here —
  // onAuthStateChange picks up the new session when the page reloads.
}

// Electron only: the OS hands the tracked26://auth-callback?code=... URL
// to main.js, which forwards it here. Exchange the code for a session —
// the PKCE code verifier was already stashed by signInWithOAuth() above,
// in this same renderer's storage.
async function handleElectronDeepLink(url) {
  if (!supabaseClient) return;
  let code, oauthError;
  try {
    const parsed = new URL(url);
    code = parsed.searchParams.get("code");
    oauthError = parsed.searchParams.get("error_description") || parsed.searchParams.get("error");
  } catch (e) {
    console.error("Malformed deep link URL.", e);
    return;
  }

  if (oauthError) {
    setSyncNote(`Sign-in failed: ${oauthError}`, "is-error");
    return;
  }
  if (!code) return;

  const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Failed to exchange code for session.", error);
    setSyncNote("Sign-in didn't complete. Try again.", "is-error");
    return;
  }
  // onAuthStateChange (registered in initAuth) fires SIGNED_IN from here
  // and triggers the sync automatically.
}

async function signOutOfGoogle() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentSession = null;
  renderSyncUI();
}

async function performSync() {
  if (!supabaseClient || syncInFlight) return;
  if (!currentSession) {
    signInWithGoogle();
    return;
  }
  syncInFlight = true;
  const btn = document.getElementById("syncBtn");
  btn.classList.add("is-checking");
  setSyncNote("Syncing…");

  try {
    const userId = currentSession.user.id;
    const { data: remoteRow, error: fetchError } = await supabaseClient
      .from("tracker_state")
      .select("state, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const remoteUpdatedAtMs = remoteRow ? new Date(remoteRow.updated_at).getTime() : 0;
    const localUpdatedAtMs = state.updatedAt || 0;

    if (remoteRow && remoteUpdatedAtMs > localUpdatedAtMs) {
      // Remote is newer — pull it down and re-render everything.
      state = { ...structuredClone(DEFAULT_STATE), ...remoteRow.state };
      saveState();
      applyTheme(state.theme);
      syncThemePills();
      document.getElementById("examDate").value = state.examDate;
      renderTabs();
      renderOverviewGrid();
      renderHeatmap();
      renderMonths();
      updateBrandYear();
      tickCountdown();
      renderAvatar();
      setSyncNote("Synced ✓ — pulled the newer copy from your account.", "is-success");
    } else {
      // Local is newer (or nothing remote yet) — push it up.
      const { error: upsertError } = await supabaseClient
        .from("tracker_state")
        .upsert({ user_id: userId, state, updated_at: new Date(state.updatedAt).toISOString() }, { onConflict: "user_id" });
      if (upsertError) throw upsertError;
      setSyncNote("Synced ✓ — your latest changes are saved to your account.", "is-success");
    }
  } catch (err) {
    console.error("Sync failed.", err);
    setSyncNote("Sync failed — check your connection and try again.", "is-error");
  } finally {
    btn.classList.remove("is-checking");
    syncInFlight = false;
  }
}

document.getElementById("syncBtn").addEventListener("click", () => {
  if (currentSession) {
    performSync();
  } else {
    signInWithGoogle();
  }
});
document.getElementById("syncSignOutBtn").addEventListener("click", signOutOfGoogle);

async function initAuth() {
  if (!supabaseClient) { renderSyncUI(); return; }

  if (IS_ELECTRON) {
    window.electronAPI.onDeepLink(handleElectronDeepLink);
  }

  const { data: { session } } = await supabaseClient.auth.getSession();
  currentSession = session;
  renderSyncUI();

  // If we just landed back from the Google OAuth redirect, auto-sync once.
  if (currentSession) performSync();

  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentSession = session;
    renderSyncUI();
    if (event === "SIGNED_IN") performSync();
  });
}

/* ---------------- Profile drawer (onboarding + editing) ---------------- */
const CLASS_YEAR_OFFSET = { "11": 2, "12": 1, "dropper1": 1, "dropper2": 1 };
let pendingClassLevel = null;

function populateTargetYearOptions(selectEl) {
  const currentYear = new Date().getFullYear();
  selectEl.innerHTML = "";
  for (let y = currentYear; y <= currentYear + 4; y++) {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = `JEE ${y}`;
    selectEl.appendChild(opt);
  }
}

function openProfileDrawer() {
  const drawer = document.getElementById("profileDrawer");
  const scrim = document.getElementById("profileScrim");
  const yearSelect = document.getElementById("targetYearSelect");
  const submitBtn = document.getElementById("onboardSubmit");
  populateTargetYearOptions(yearSelect);

  const pills = document.querySelectorAll("#classPillGroup .pill");
  pills.forEach(p => p.classList.remove("active"));

  const isEditing = !!state.profile;
  document.getElementById("drawerEyebrow").textContent = isEditing ? "YOUR PROFILE" : "SET UP YOUR TRACKER";
  document.getElementById("drawerHeading").textContent = isEditing ? "Your profile" : "Where are you starting from?";
  document.getElementById("drawerSub").textContent = isEditing
    ? "Update your photo, stage, target year, and theme anytime."
    : "This sets your exam countdown and personalizes the tracker.";
  document.getElementById("onboardSubmit").textContent = isEditing ? "Save Changes" : "Start Tracking";
  document.getElementById("drawerCloseBtn").hidden = !isEditing;

  if (state.profile) {
    pendingClassLevel = state.profile.classLevel;
    const match = document.querySelector(`#classPillGroup .pill[data-value="${state.profile.classLevel}"]`);
    if (match) match.classList.add("active");
    yearSelect.value = state.profile.targetYear;
    submitBtn.disabled = false;
  } else {
    pendingClassLevel = null;
    submitBtn.disabled = true;
  }

  syncThemePills();
  renderSyncUI();

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  scrim.classList.add("open");
}

function closeProfileDrawer() {
  // First-time setup is mandatory — no dismissing until a profile exists.
  if (!state.profile) return;
  document.getElementById("profileDrawer").classList.remove("open");
  document.getElementById("profileDrawer").setAttribute("aria-hidden", "true");
  document.getElementById("profileScrim").classList.remove("open");
}

function updateBrandYear() {
  if (state.profile && state.profile.targetYear) {
    document.getElementById("brandYear").textContent = state.profile.targetYear;
  }
}

document.querySelectorAll("#classPillGroup .pill").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#classPillGroup .pill").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    pendingClassLevel = btn.dataset.value;
    const suggested = new Date().getFullYear() + CLASS_YEAR_OFFSET[pendingClassLevel];
    document.getElementById("targetYearSelect").value = suggested;
    document.getElementById("onboardSubmit").disabled = false;
  });
});

document.getElementById("onboardSubmit").addEventListener("click", () => {
  if (!pendingClassLevel) return;
  const targetYear = +document.getElementById("targetYearSelect").value;
  state.profile = { classLevel: pendingClassLevel, targetYear };
  state.examDate = `${targetYear}-01-22`;
  saveState();
  document.getElementById("examDate").value = state.examDate;
  updateBrandYear();
  tickCountdown();
  // state.profile is now set, so the normal close path (which guards against
  // dismissing the mandatory first-run setup) will happily close it.
  closeProfileDrawer();
});

document.getElementById("profileTriggerBtn").addEventListener("click", openProfileDrawer);
document.getElementById("drawerCloseBtn").addEventListener("click", closeProfileDrawer);
document.getElementById("profileScrim").addEventListener("click", closeProfileDrawer);
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeProfileDrawer();
});

/* ---------------- Add subject / month ---------------- */
document.getElementById("addSubjectBtn").addEventListener("click", () => {
  const name = prompt("New subject name:");
  if (!name || !name.trim()) return;
  if (state.subjects[name]) { alert("That subject already exists."); return; }
  state.subjects[name] = [];
  saveState();
  renderTabs();
  renderOverviewGrid();
  switchView(name);
});

document.getElementById("addMonthBtn").addEventListener("click", () => {
  state.months.push({ name: "New", items: [] });
  saveState();
  renderMonths();
});

document.getElementById("examDate").addEventListener("change", e => {
  state.examDate = e.target.value;
  saveState();
  tickCountdown();
});

/* ---------------- Utils ---------------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ---------------- Init ---------------- */
document.getElementById("examDate").value = state.examDate;

// Run each init step independently — if one throws, the others (like the
// countdown clock) still run instead of the whole page silently freezing.
function safe(fn, label) {
  try { fn(); } catch (e) { console.error(`Init step failed: ${label}`, e); }
}
safe(() => applyTheme(state.theme), "applyTheme");
safe(renderAvatar, "renderAvatar");
safe(renderTabs, "renderTabs");
safe(renderOverviewGrid, "renderOverviewGrid");
safe(renderHeatmap, "renderHeatmap");
safe(renderMonths, "renderMonths");
safe(updateBrandYear, "updateBrandYear");
safe(tickCountdown, "tickCountdown");
setInterval(() => safe(tickCountdown, "tickCountdown interval"), 30000);
safe(() => switchView("dashboard"), "switchView");
safe(initAuth, "initAuth");

if (!state.profile) {
  safe(openProfileDrawer, "openProfileDrawer");
}