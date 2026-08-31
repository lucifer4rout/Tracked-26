/* ============================================================
   JEE 2027 Progress Tracker
   Data lives in localStorage by default. If you sign in with
   Google (via Supabase Auth), it's also synced to a Supabase
   table so you can pick up on another device.
   ============================================================ */

const STORAGE_KEY = "jee-tracker-state-v1";

/* ---------------- Supabase config ---------------- */
const SUPABASE_URL = "https://jxrourlbqhfojxrfimff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4cm91cmxicWhmb2p4cmZpbWZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNzY3MTksImV4cCI6MjEwMjk1MjcxOX0.uA5lSZ0MxtX8Yxyyx265VfCSlDvC8vHHqF5TwTg6WQg";

// True when running inside the Electron shell (preload.js exposes this).
// The web build never has window.electronAPI, so this is always false there.
const IS_ELECTRON = typeof window !== "undefined" && !!window.electronAPI;

// Where Google/Supabase should hand control back after sign-in.
// - Electron: a custom URL scheme the OS routes back into this app (see main.js).
// - Web: just come back to whatever page we're already on.
const SUPABASE_REDIRECT_URL = IS_ELECTRON ? "tracked26://auth-callback" : window.location.href;

const supabaseClient = (SUPABASE_ANON_KEY && window.supabase)
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
  settings: {
    minimizeToTray: true,      // Electron only — ignored on web
    showDesktopWidget: false,  // Electron only — ignored on web
    startOnStartup: false      // Electron only — ignored on web
  },
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
  progress: {},   // "Subject::Chapter" -> { lectures, notes, shortNotes, revision, tests, status, lastRevisedDate }
  dashboardChecklist: {}, // "Subject::Chapter" -> boolean — quick-glance checklist shown on the Dashboard, independent of the lectures/notes/etc. progress tracking
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
  ],
  testLog: [],      // [{ id, date, subject, topic, score, maxScore }] — mock/practice test scores
  completions: [],  // [{ date, subject, chapter, field }] — log of check-offs, used for streak/weekly stats
  nextTestSyllabus: { Physics: [], Chemistry: [], Maths: [] },  // subject -> chapter names checked for the upcoming test
  nextTestDate: null,   // "YYYY-MM-DD" of the upcoming test, or null if unset
  nextTestName: ""      // optional label for the upcoming test, e.g. "FIITJEE AITS 3"
};

// Shared by loadState() and the backup-restore flow, so both fill in
// missing fields (from before a feature existed) the same way.
function normalizeState(parsed) {
  const base = structuredClone(DEFAULT_STATE);
  parsed = parsed || {};
  return {
    examDate: parsed.examDate ?? base.examDate,
    profile: parsed.profile ?? null,
    theme: parsed.theme ?? base.theme,
    settings: { ...base.settings, ...(parsed.settings || {}) },
    avatar: parsed.avatar ?? null,
    updatedAt: parsed.updatedAt ?? 0,
    subjects: parsed.subjects ?? base.subjects,
    progress: parsed.progress ?? {},
    dashboardChecklist: parsed.dashboardChecklist ?? {},
    heatmap: parsed.heatmap ?? {},
    months: parsed.months ?? base.months,
    testLog: parsed.testLog ?? [],
    completions: parsed.completions ?? [],
    nextTestSyllabus: parsed.nextTestSyllabus ?? {},
    nextTestDate: parsed.nextTestDate ?? null,
    nextTestName: parsed.nextTestName ?? ""
  };
}

// Every subject needs its own array in nextTestSyllabus, even ones added
// after the syllabus feature shipped (or restored from an older backup).
function getSyllabus(subject) {
  if (!state.nextTestSyllabus[subject]) state.nextTestSyllabus[subject] = [];
  return state.nextTestSyllabus[subject];
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    console.error("Failed to load saved tracker state, starting fresh.", e);
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState(bumpTimestamp = true) {
  // Normally every save should look "newest" so it wins the next sync.
  // The one exception is a local data reset (see clearLocalData) — that
  // should look OLDER than whatever's in the cloud, so the next sync
  // pulls the real data back down instead of pushing the empty reset up
  // and overwriting it.
  if (bumpTimestamp) state.updatedAt = Date.now();
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
    state.progress[k] = { lectures: false, notes: false, shortNotes: false, revision: false, tests: false, lastRevisedDate: null };
  }
  // Backward compat: older saved data won't have this field yet.
  if (state.progress[k].lastRevisedDate === undefined) state.progress[k].lastRevisedDate = null;
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

/* ---------------- Dashboard checklist (quick-glance, separate from progress tracking) ---------------- */
function isDashChecked(subject, chapter) {
  return !!state.dashboardChecklist[key(subject, chapter)];
}

function setDashChecked(subject, chapter, on) {
  state.dashboardChecklist[key(subject, chapter)] = on;
  saveState();
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
  pushWidgetState();
}

function syncThemePills() {
  document.querySelectorAll("#themePillGroup .pill").forEach(p => {
    p.classList.toggle("active", p.dataset.value === state.theme);
  });
}

// Keep things in sync if the OS-level theme changes while "system" is selected.
if (systemThemeQuery) {
  const handleSystemThemeChange = () => {
    if (state.theme === "system") {
      applyTheme("system");
      pushWidgetState();
    }
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

/* ---------------- Next Test dashboard card ---------------- */
// Renders the "Next Test" summary panel on the Dashboard, driven by
// state.nextTestDate / state.nextTestName (set from the Next Test tab).
function renderNextTestPanel() {
  const body = document.getElementById("nextTestBody");
  if (!body) return;

  if (!state.nextTestDate) {
    body.innerHTML = `
      <p class="next-test-empty">No test scheduled yet. Set a date from the <strong>Next Test</strong> tab.</p>
    `;
    return;
  }

  const days = daysUntil(state.nextTestDate);
  let dayLabel;
  if (days > 1) dayLabel = `${days} days left`;
  else if (days === 1) dayLabel = "Tomorrow";
  else if (days === 0) dayLabel = "Today";
  else dayLabel = `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;

  // Flatten { subject: [chapters] } into a single list of { subject, chapter }
  // entries, in subject order, so the checklist below can render them.
  const syllabusEntries = [];
  Object.keys(state.nextTestSyllabus || {}).forEach(subject => {
    (state.nextTestSyllabus[subject] || []).forEach(chapter => {
      syllabusEntries.push({ subject, chapter });
    });
  });
  const chapterCount = syllabusEntries.length;
  const checkedCount = syllabusEntries.filter(({ subject, chapter }) => isDashChecked(subject, chapter)).length;
  const syllabusHint = chapterCount
    ? `${checkedCount} of ${chapterCount} chapter${chapterCount === 1 ? "" : "s"} checked`
    : "No chapters marked yet";

  const multiSubject = new Set(syllabusEntries.map(e => e.subject)).size > 1;
  const checklistHtml = chapterCount
    ? `
      <div class="next-test-checklist" id="nextTestChecklist">
        ${syllabusEntries.map(({ subject, chapter }) => {
          const checked = isDashChecked(subject, chapter);
          return `
            <label class="checklist-row${checked ? " is-checked" : ""}">
              <input type="checkbox" data-subject="${escapeAttr(subject)}" data-chapter="${escapeAttr(chapter)}" ${checked ? "checked" : ""}>
              <span class="checklist-chapter-name">${escapeHtml(chapter)}</span>
              ${multiSubject ? `<span class="checklist-subject-tag">${escapeHtml(subject)}</span>` : ""}
            </label>
          `;
        }).join("")}
      </div>
    `
    : "";

  body.innerHTML = `
    <div class="next-test-info">
      <span class="next-test-name">${escapeHtml(state.nextTestName || "Upcoming Test")}</span>
      <span class="next-test-date">${escapeHtml(formatNiceDate(state.nextTestDate))}</span>
    </div>
    <div class="next-test-countdown${days < 0 ? " is-past" : ""}">${escapeHtml(dayLabel)}</div>
    <div class="next-test-syllabus-hint">${escapeHtml(syllabusHint)}</div>
    ${checklistHtml}
  `;

  body.querySelectorAll(".next-test-checklist input[type='checkbox']").forEach(el => {
    el.addEventListener("change", e => {
      const { subject, chapter } = e.target.dataset;
      setDashChecked(subject, chapter, e.target.checked);
      renderNextTestPanel();
    });
  });
}

document.getElementById("goToNextTestBtn")?.addEventListener("click", () => switchView("nextTest"));

document.getElementById("nextTestDateInput")?.addEventListener("change", e => {
  state.nextTestDate = e.target.value || null;
  saveState();
  renderNextTestPanel();
});

document.getElementById("nextTestNameInput")?.addEventListener("input", e => {
  state.nextTestName = e.target.value;
  saveState();
  renderNextTestPanel();
});

/* ---------------- Small utils ---------------- */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Whole-day difference between today and a "YYYY-MM-DD" string (positive = future).
function daysUntil(dateStr) {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

function formatNiceDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function todayStr() { return fmtDate(new Date()); }

/* ---------------- Toast / undo ----------------
   Generic toast with an optional action button. Used to give a short
   "Undo" window after a confirmed delete, without building a full
   notification stack — only one toast is shown at a time. */
let toastTimeoutId = null;

function showToast(message, actionLabel, actionFn, duration = 6000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  clearTimeout(toastTimeoutId);
  container.innerHTML = "";

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <span class="toast-msg">${escapeHtml(message)}</span>
    ${actionFn ? `<button type="button" class="toast-action">${escapeHtml(actionLabel || "Undo")}</button>` : ""}
    <button type="button" class="toast-dismiss" aria-label="Dismiss">✕</button>
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("show"));

  function remove() {
    toast.classList.remove("show");
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 200);
  }
  if (actionFn) {
    toast.querySelector(".toast-action").addEventListener("click", () => {
      actionFn();
      remove();
    });
  }
  toast.querySelector(".toast-dismiss").addEventListener("click", remove);
  toastTimeoutId = setTimeout(remove, duration);
}

/* ---------------- Completion log (for streaks + weekly summary) ---------------- */
function logCompletion(subject, chapter, field) {
  state.completions.push({ date: todayStr(), subject, chapter, field });
  pruneCompletions();
}

// Keep only the last ~90 days of completions — plenty for any weekly/monthly
// view, and keeps localStorage from growing forever.
function pruneCompletions() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = fmtDate(cutoff);
  state.completions = state.completions.filter(c => c.date >= cutoffStr);
}

function computeStreak() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Today only counts once it's actually been logged — otherwise every
  // streak would look "broken" first thing each morning. If today isn't
  // logged yet, just start counting from yesterday instead.
  if (!(state.heatmap[fmtDate(d)] > 0)) {
    d.setDate(d.getDate() - 1);
  }
  let streak = 0;
  while ((state.heatmap[fmtDate(d)] || 0) > 0) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderWeeklySummary() {
  const panel = document.getElementById("weeklySummaryPanel");
  if (!panel) return;

  const streak = computeStreak();

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 6); // last 7 days, including today
  const weekAgoStr = fmtDate(weekAgo);
  const todayS = todayStr();

  const weekCompletions = state.completions.filter(c => c.date >= weekAgoStr && c.date <= todayS);
  const byField = { lectures: 0, notes: 0, shortNotes: 0, revision: 0, tests: 0 };
  weekCompletions.forEach(c => { if (byField[c.field] !== undefined) byField[c.field]++; });
  const totalItems = Object.values(byField).reduce((a, b) => a + b, 0);

  const fieldLabels = { lectures: "lectures", notes: "notes", shortNotes: "short notes", revision: "revisions", tests: "tests" };
  const breakdown = Object.entries(byField)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${fieldLabels[k]}`)
    .join(" · ") || "nothing logged yet";

  let daysStudied = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if ((state.heatmap[fmtDate(d)] || 0) > 0) daysStudied++;
  }

  panel.innerHTML = `
    <div class="weekly-stat">
      <span class="weekly-stat-num">${streak}</span>
      <span class="weekly-stat-label">day streak</span>
    </div>
    <div class="weekly-stat">
      <span class="weekly-stat-num">${daysStudied}/7</span>
      <span class="weekly-stat-label">days studied this week</span>
    </div>
    <div class="weekly-stat weekly-stat-wide">
      <span class="weekly-stat-num">${totalItems}</span>
      <span class="weekly-stat-label">items completed this week — ${escapeHtml(breakdown)}</span>
    </div>
  `;
}

/* ---------------- Revision nudges ---------------- */
function getOverdueRevisions() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results = [];
  Object.keys(state.subjects).forEach(subject => {
    state.subjects[subject].forEach(chapter => {
      const p = getProgress(subject, chapter);
      if (p.revision && p.lastRevisedDate) {
        const revisedDate = new Date(p.lastRevisedDate + "T00:00:00");
        const days = Math.floor((today - revisedDate) / (1000 * 60 * 60 * 24));
        if (days >= 20) results.push({ subject, chapter, days });
      }
    });
  });
  results.sort((a, b) => b.days - a.days);
  return results;
}

function renderRevisionNudges() {
  const section = document.getElementById("revisionNudgesPanel");
  const list = document.getElementById("revisionNudgesList");
  if (!section || !list) return;

  const overdue = getOverdueRevisions();
  if (!overdue.length) {
    section.hidden = true;
    list.innerHTML = "";
    return;
  }
  section.hidden = false;
  list.innerHTML = overdue.slice(0, 8).map(o => `
    <button type="button" class="nudge-row" data-subject="${escapeAttr(o.subject)}">
      <span class="nudge-chapter">${escapeHtml(o.chapter)}</span>
      <span class="nudge-subject">${escapeHtml(o.subject)}</span>
      <span class="nudge-days">${o.days}d ago</span>
    </button>
  `).join("");
  list.querySelectorAll(".nudge-row").forEach(el => el.addEventListener("click", () => {
    switchView(el.dataset.subject);
  }));
}

/* ---------------- Mock tests ---------------- */
function populateTestSubjectOptions() {
  const sel = document.getElementById("testSubjectSelect");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="Full Test">Full Test</option>` +
    Object.keys(state.subjects).map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
}

function renderMockTestList() {
  const listEl = document.getElementById("mockTestList");
  if (!listEl) return;
  const sorted = [...state.testLog].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    listEl.innerHTML = `<p class="mock-test-empty">No test scores logged yet — add your first one above.</p>`;
    return;
  }
  listEl.innerHTML = sorted.slice(0, 12).map(t => {
    const pct = t.maxScore > 0 ? Math.round((t.score / t.maxScore) * 100) : 0;
    return `
      <div class="mock-test-row">
        <span class="mock-test-date">${escapeHtml(t.date)}</span>
        <span class="mock-test-subject">${escapeHtml(t.subject)}${t.topic ? " · " + escapeHtml(t.topic) : ""}</span>
        <span class="mock-test-score">${t.score}/${t.maxScore} <span class="mock-test-pct">(${pct}%)</span></span>
        <button type="button" class="mock-test-remove" data-id="${escapeAttr(t.id)}" title="Remove entry" aria-label="Remove entry">✕</button>
      </div>
    `;
  }).join("");
  listEl.querySelectorAll(".mock-test-remove").forEach(el => el.addEventListener("click", e => {
    removeTestEntryWithUndo(e.currentTarget.dataset.id);
  }));
}

function renderMockTestChart() {
  const svgEl = document.getElementById("mockTestChart");
  const emptyEl = document.getElementById("mockTestChartEmpty");
  if (!svgEl || !emptyEl) return;

  const sorted = [...state.testLog].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) {
    svgEl.innerHTML = "";
    svgEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  svgEl.hidden = false;
  emptyEl.hidden = true;

  const W = 600, H = 160, PAD = 24;
  const points = sorted.map((t, i) => {
    const x = PAD + (sorted.length === 1 ? 0 : (i / (sorted.length - 1)) * (W - PAD * 2));
    const pct = t.maxScore > 0 ? Math.max(0, Math.min(100, (t.score / t.maxScore) * 100)) : 0;
    const y = H - PAD - (pct / 100) * (H - PAD * 2);
    return { x, y, pct, date: t.date };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const dots = points.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" class="mock-test-dot"><title>${escapeHtml(p.date)} — ${Math.round(p.pct)}%</title></circle>`
  ).join("");

  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("preserveAspectRatio", "none");
  svgEl.innerHTML = `
    <line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" class="mock-test-axis" />
    <path d="${pathD}" class="mock-test-line" fill="none" />
    ${dots}
  `;
}

function renderMockTests() {
  populateTestSubjectOptions();
  renderMockTestList();
  renderMockTestChart();
}

function removeTestEntryWithUndo(id) {
  const idx = state.testLog.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (!confirm("Remove this test entry?")) return;
  const removed = state.testLog[idx];
  state.testLog.splice(idx, 1);
  saveState();
  renderMockTests();
  showToast("Test entry removed.", "Undo", () => {
    state.testLog.splice(idx, 0, removed);
    saveState();
    renderMockTests();
  });
}

// Prevent Enter-to-submit from reloading the page — this "form" is really
// just a grouped set of inputs, submission is handled by addTestBtn below.
document.getElementById("mockTestForm").addEventListener("submit", e => e.preventDefault());

document.getElementById("addTestBtn").addEventListener("click", () => {
  const dateInput = document.getElementById("testDateInput");
  const topicInput = document.getElementById("testTopicInput");
  const scoreInput = document.getElementById("testScoreInput");
  const maxScoreInput = document.getElementById("testMaxScoreInput");

  const date = dateInput.value || todayStr();
  const subject = document.getElementById("testSubjectSelect").value;
  const topic = topicInput.value.trim();
  const score = parseFloat(scoreInput.value);
  const maxScore = parseFloat(maxScoreInput.value);

  if (isNaN(score) || isNaN(maxScore) || maxScore <= 0 || score < 0) {
    alert("Enter a valid score and a max score greater than 0.");
    return;
  }

  state.testLog.push({ id: uid(), date, subject, topic, score, maxScore });
  saveState();
  topicInput.value = "";
  scoreInput.value = "";
  maxScoreInput.value = "";
  renderMockTests();
});

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

/* ---------------- Rendering: Monthly targets ---------------- */
// Set right before renderMonths() re-draws the grid, so the newly-added
// month name / target input gets focused once it exists in the DOM.
let pendingFocus = null;

function removeMonthWithUndo(mi) {
  const month = state.months[mi];
  if (!month) return;
  if (!confirm(`Remove "${month.name || "this month"}" and all its targets?`)) return;
  const removedMonth = month;
  const removedIndex = mi;
  state.months.splice(mi, 1);
  saveState();
  renderMonths();
  showToast("Month removed.", "Undo", () => {
    state.months.splice(removedIndex, 0, removedMonth);
    saveState();
    renderMonths();
  });
}

function removeMonthItemWithUndo(mi, ii) {
  const month = state.months[mi];
  if (!month || !month.items[ii]) return;
  if (!confirm("Remove this target?")) return;
  const removedItem = month.items[ii];
  month.items.splice(ii, 1);
  saveState();
  renderMonths();
  showToast("Target removed.", "Undo", () => {
    if (state.months[mi]) {
      state.months[mi].items.splice(ii, 0, removedItem);
      saveState();
      renderMonths();
    }
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
        <input type="text" data-mi="${mi}" data-ii="${ii}" class="month-text" value="${escapeAttr(item.text)}" placeholder="What's the target?">
        <button type="button" class="month-item-remove" data-mi="${mi}" data-ii="${ii}" title="Remove target" aria-label="Remove target">✕</button>
      </div>
    `).join("");
    card.innerHTML = `
      <div class="month-card-head">
        <input class="month-name" data-mi="${mi}" value="${escapeAttr(month.name)}" placeholder="Name this month">
        <button class="month-remove" data-mi="${mi}" title="Remove month" aria-label="Remove month">✕</button>
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

  grid.querySelectorAll(".month-text").forEach(el => {
    el.addEventListener("input", e => {
      const { mi, ii } = e.target.dataset;
      state.months[mi].items[ii].text = e.target.value;
      saveState();
    });
    // Enter confirms the name — same as clicking away, just faster.
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    });
    // Leaving it blank falls back to a default rather than silently
    // keeping an empty, unlabeled target.
    el.addEventListener("blur", e => {
      const { mi, ii } = e.target.dataset;
      if (!e.target.value.trim()) {
        state.months[mi].items[ii].text = "New target";
        e.target.value = "New target";
        saveState();
      }
    });
  });

  grid.querySelectorAll(".month-name").forEach(el => {
    el.addEventListener("input", e => {
      const { mi } = e.target.dataset;
      state.months[mi].name = e.target.value;
      saveState();
    });
    el.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); e.target.blur(); }
    });
    el.addEventListener("blur", e => {
      const { mi } = e.target.dataset;
      if (!e.target.value.trim()) {
        state.months[mi].name = "Untitled";
        e.target.value = "Untitled";
        saveState();
      }
    });
  });

  grid.querySelectorAll(".month-remove").forEach(el => el.addEventListener("click", e => {
    removeMonthWithUndo(+e.currentTarget.dataset.mi);
  }));

  grid.querySelectorAll(".month-item-remove").forEach(el => el.addEventListener("click", e => {
    const { mi, ii } = e.currentTarget.dataset;
    removeMonthItemWithUndo(+mi, +ii);
  }));

  grid.querySelectorAll(".month-add-item").forEach(el => el.addEventListener("click", e => {
    const { mi } = e.target.dataset;
    state.months[mi].items.push({ text: "", done: false });
    saveState();
    pendingFocus = { type: "item", mi: +mi, ii: state.months[mi].items.length - 1 };
    renderMonths();
  }));

  // Focus + select whatever was just added, so naming it is immediate —
  // pressing Enter (or clicking away) confirms it.
  if (pendingFocus) {
    const pf = pendingFocus;
    pendingFocus = null;
    requestAnimationFrame(() => {
      let el;
      if (pf.type === "month") {
        el = grid.querySelector(`.month-name[data-mi="${pf.mi}"]`);
      } else {
        el = grid.querySelector(`.month-text[data-mi="${pf.mi}"][data-ii="${pf.ii}"]`);
      }
      if (el) { el.focus(); if (el.select) el.select(); }
    });
  }
}

/* ---------------- Rendering: Subject view ---------------- */
function removeChapterWithUndo(subject, idx) {
  const chapter = state.subjects[subject][idx];
  if (chapter === undefined) return;
  if (!confirm(`Remove chapter "${chapter}"? This also deletes its tracked progress.`)) return;

  const removedProgress = state.progress[key(subject, chapter)];
  const removedDashChecked = state.dashboardChecklist[key(subject, chapter)];
  const picked = getSyllabus(subject);
  const pickedIdx = picked.indexOf(chapter);
  const wasPicked = pickedIdx !== -1;
  if (wasPicked) picked.splice(pickedIdx, 1);
  state.subjects[subject].splice(idx, 1);
  delete state.progress[key(subject, chapter)];
  delete state.dashboardChecklist[key(subject, chapter)];
  saveState();
  renderSubjectView(subject);
  renderOverviewGrid();
  renderWeeklySummary();
  renderRevisionNudges();

  showToast(`"${chapter}" removed.`, "Undo", () => {
    state.subjects[subject].splice(idx, 0, chapter);
    if (removedProgress) state.progress[key(subject, chapter)] = removedProgress;
    if (removedDashChecked) state.dashboardChecklist[key(subject, chapter)] = removedDashChecked;
    if (wasPicked) getSyllabus(subject).push(chapter);
    saveState();
    renderSubjectView(subject);
    renderOverviewGrid();
    renderWeeklySummary();
    renderRevisionNudges();
  });
}

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
      <td><button class="row-remove" data-idx="${idx}" title="Remove chapter" aria-label="Remove chapter">✕</button></td>
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
    if (state.dashboardChecklist[oldKey] !== undefined && oldKey !== newKey) {
      state.dashboardChecklist[newKey] = state.dashboardChecklist[oldKey];
      delete state.dashboardChecklist[oldKey];
    }
    const picked = getSyllabus(subject);
    const pickedIdx = picked.indexOf(oldName);
    if (pickedIdx !== -1) picked[pickedIdx] = newName;
    state.subjects[subject][idx] = newName;
    saveState();
  }));

  tbody.querySelectorAll("input[type=checkbox]").forEach(el => el.addEventListener("change", e => {
    const idx = +e.target.dataset.idx;
    const field = e.target.dataset.field;
    const chapter = state.subjects[subject][idx];
    const p = getProgress(subject, chapter);
    const wasChecked = p[field];
    p[field] = e.target.checked;

    if (field === "revision") {
      p.lastRevisedDate = e.target.checked ? todayStr() : null;
    }
    if (e.target.checked && !wasChecked) {
      logCompletion(subject, chapter, field);
    }

    saveState();
    renderSubjectView(subject);
    renderOverviewGrid();
    renderWeeklySummary();
    renderRevisionNudges();
  }));

  tbody.querySelectorAll(".row-remove").forEach(el => el.addEventListener("click", e => {
    const idx = +e.currentTarget.dataset.idx;
    removeChapterWithUndo(subject, idx);
  }));
}

/* ---------------- Tabs / navigation ---------------- */
function renderTabs() {
  const nav = document.getElementById("subjectTabs");
  // Dashboard and Next Test tabs exist in the HTML already — just wire
  // them up (once); only the per-subject tabs get rebuilt below.
  ["dashboard", "nextTest"].forEach(viewName => {
    const tab = nav.querySelector(`.tab[data-view='${viewName}']`);
    if (tab && !tab.dataset.bound) {
      tab.addEventListener("click", () => switchView(viewName));
      tab.dataset.bound = "true";
    }
  });
  nav.querySelectorAll(".tab:not([data-view='dashboard']):not([data-view='nextTest'])").forEach(t => t.remove());
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
  document.getElementById("nextTestView").hidden = viewName !== "nextTest";
  const isSubjectView = viewName !== "dashboard" && viewName !== "nextTest";
  Object.keys(state.subjects).forEach(subject => {
    const view = document.getElementById(`view-${subject}`);
    if (view) view.hidden = viewName !== subject;
  });
  if (isSubjectView) {
    if (!document.getElementById(`view-${viewName}`)) renderSubjectView(viewName);
    document.getElementById(`view-${viewName}`).hidden = false;
  }
  if (viewName === "nextTest") renderSyllabusView();

  // little fade-in on whichever view just became visible
  const active = viewName === "dashboard"
    ? document.getElementById("dashboardView")
    : viewName === "nextTest"
      ? document.getElementById("nextTestView")
      : document.getElementById(`view-${viewName}`);
  active.classList.remove("view-enter");
  void active.offsetWidth; // restart animation
  active.classList.add("view-enter");
}

/* ---------------- Next Test syllabus ---------------- */
let currentSyllabusSubject = null;

// Keeps the "Next Test" tab's date/name fields in sync with state —
// called whenever that tab renders, and whenever state is reloaded
// wholesale (sync pull, backup restore, local data clear), same pattern
// as the examDate input elsewhere in this file.
function syncNextTestInputs() {
  const dateInput = document.getElementById("nextTestDateInput");
  const nameInput = document.getElementById("nextTestNameInput");
  if (dateInput) dateInput.value = state.nextTestDate || "";
  if (nameInput) nameInput.value = state.nextTestName || "";
}

function renderSyllabusView() {
  syncNextTestInputs();

  const subjects = Object.keys(state.subjects);
  if (!subjects.length) return;
  if (!currentSyllabusSubject || !subjects.includes(currentSyllabusSubject)) {
    currentSyllabusSubject = subjects[0];
  }

  const tabsEl = document.getElementById("syllabusSubjectTabs");
  tabsEl.innerHTML = "";
  subjects.forEach(subject => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "syllabus-subject-tab" + (subject === currentSyllabusSubject ? " active" : "");
    btn.textContent = subject;
    btn.addEventListener("click", () => {
      currentSyllabusSubject = subject;
      renderSyllabusView();
    });
    tabsEl.appendChild(btn);
  });

  renderSyllabusList();
}

function renderSyllabusList() {
  const subject = currentSyllabusSubject;
  const listEl = document.getElementById("syllabusList");
  const countEl = document.getElementById("syllabusCount");
  const chapters = state.subjects[subject] || [];
  const picked = getSyllabus(subject);

  if (!chapters.length) {
    listEl.innerHTML = `<p class="syllabus-empty">No chapters in ${escapeHtml(subject)} yet — add some from the ${escapeHtml(subject)} tab.</p>`;
    countEl.textContent = "";
    return;
  }

  listEl.innerHTML = "";
  chapters.forEach(chapter => {
    const status = computeStatus(getProgress(subject, chapter));
    const checked = picked.includes(chapter);

    const row = document.createElement("label");
    row.className = "syllabus-row" + (checked ? " is-checked" : "");
    row.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""}>
      <span class="syllabus-chapter-name">${escapeHtml(chapter)}</span>
      <span class="syllabus-status" data-status="${status}">${statusLabel(status)}</span>
    `;
    row.querySelector("input").addEventListener("change", e => {
      toggleSyllabusChapter(subject, chapter, e.target.checked);
    });
    listEl.appendChild(row);
  });

  countEl.textContent = `${picked.length} of ${chapters.length} selected`;
}

function toggleSyllabusChapter(subject, chapter, on) {
  const picked = getSyllabus(subject);
  const idx = picked.indexOf(chapter);
  if (on && idx === -1) picked.push(chapter);
  if (!on && idx !== -1) picked.splice(idx, 1);
  saveState();
  renderSyllabusList();
  renderNextTestPanel();
}

document.getElementById("syllabusSelectAllBtn").addEventListener("click", () => {
  const subject = currentSyllabusSubject;
  if (!subject) return;
  state.nextTestSyllabus[subject] = [...state.subjects[subject]];
  saveState();
  renderSyllabusList();
  renderNextTestPanel();
});

document.getElementById("syllabusClearAllBtn").addEventListener("click", () => {
  const subject = currentSyllabusSubject;
  if (!subject) return;
  state.nextTestSyllabus[subject] = [];
  saveState();
  renderSyllabusList();
  renderNextTestPanel();
});

/* ---------------- Pixel-art study heatmap (year-long, by month) ---------------- */
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
      const label = `${dateStr} — ${["No study logged", "Light", "Solid", "Great", "Deep focus"][level]} (locked — only today can be logged)`;
      cell.title = label;
      cell.setAttribute("aria-label", label);
      cell.disabled = true;
    } else {
      // today — the only editable cell
      const label = `${dateStr} — ${["No study logged", "Light", "Solid", "Great", "Deep focus"][level]} (click to update)`;
      cell.title = label;
      cell.setAttribute("aria-label", label);
      cell.addEventListener("click", () => {
        const next = (level + 1) % 5;
        state.heatmap[dateStr] = next;
        saveState();
        renderHeatmapCalendar();
        renderWeeklySummary();
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
  const deleteCloudRow = document.getElementById("deleteCloudRow");
  const importCloudBtn = document.getElementById("importCloudBtn");

  if (!supabaseClient) {
    accountEl.hidden = true;
    syncBtnLabel.textContent = "Sync not configured";
    syncBtn.disabled = true;
    if (deleteCloudRow) deleteCloudRow.hidden = true;
    if (importCloudBtn) importCloudBtn.hidden = true;
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
    if (deleteCloudRow) deleteCloudRow.hidden = false; // only relevant once there's a cloud row to delete
    if (importCloudBtn) importCloudBtn.hidden = false;
    setSyncNote("Synced to your Google account. Click sync anytime to push or pull the latest changes.");
  } else {
    currentGoogleAvatarUrl = null;
    accountEl.hidden = true;
    syncBtnLabel.textContent = "Sign in with Google to sync";
    syncBtn.disabled = false;
    if (deleteCloudRow) deleteCloudRow.hidden = true;
    if (importCloudBtn) importCloudBtn.hidden = true;
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

// Counts meaningful "this device actually has progress on it" signals —
// checked chapter boxes, heatmap entries, logged tests, completions, and
// done monthly targets. Used to guard against an empty/near-empty device
// (fresh install, or right after Clear Local Data) silently overwriting
// real cloud progress just because its save timestamp happens to be the
// most recent one.
function dataFootprint(s) {
  if (!s) return 0;
  let count = 0;
  if (s.progress) {
    Object.values(s.progress).forEach(p => {
      if (p.lectures) count++;
      if (p.notes) count++;
      if (p.shortNotes) count++;
      if (p.revision) count++;
      if (p.tests) count++;
    });
  }
  if (s.heatmap) count += Object.keys(s.heatmap).length;
  if (Array.isArray(s.testLog)) count += s.testLog.length;
  if (Array.isArray(s.completions)) count += s.completions.length;
  if (Array.isArray(s.months)) {
    s.months.forEach(m => (m.items || []).forEach(it => { if (it.done) count++; }));
  }
  return count;
}

// Adopts a state object (from a sync pull or an explicit cloud import)
// as the current local state and re-renders every part of the UI that
// depends on it. Shared by performSync's pull branch and importFromCloud
// so the two stay in sync instead of drifting apart over time.
function applyLoadedState(rawState) {
  state = normalizeState(rawState);
  saveState();
  applyTheme(state.theme);
  syncThemePills();
  document.getElementById("examDate").value = state.examDate;
  syncNextTestInputs();
  renderTabs();
  renderOverviewGrid();
  renderHeatmap();
  renderMonths();
  renderWeeklySummary();
  renderRevisionNudges();
  renderMockTests();
  renderNextTestPanel();
  updateBrandYear();
  tickCountdown();
  renderAvatar();
  if (IS_ELECTRON && window.electronAPI.setMinimizeToTray) {
    window.electronAPI.setMinimizeToTray(state.settings.minimizeToTray);
  }
  if (IS_ELECTRON && window.electronAPI.setShowWidget) {
    window.electronAPI.setShowWidget(state.settings.showDesktopWidget);
    applyShowWidgetToUI();
  }
  if (IS_ELECTRON && window.electronAPI.setStartOnStartup) {
    window.electronAPI.setStartOnStartup(state.settings.startOnStartup);
    applyStartOnStartupToUI();
  }
  pushWidgetState();
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

    // Safety net: if this device looks empty (no checked chapters, no
    // heatmap, nothing logged) but the cloud has real progress, always
    // pull — never push. Without this, a fresh install or a just-cleared
    // device can end up with a save timestamp that's technically "newer"
    // than the cloud (e.g. from completing onboarding) and silently wipe
    // real synced data purely because of that timestamp race.
    const localLooksEmpty = dataFootprint(state) === 0;
    const remoteHasData = dataFootprint(remoteRow?.state) > 0;
    const shouldPull = remoteRow && (remoteUpdatedAtMs > localUpdatedAtMs || (localLooksEmpty && remoteHasData));

    if (shouldPull) {
      applyLoadedState(remoteRow.state);
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

// Explicit, unconditional pull — ignores timestamps entirely and always
// replaces local with whatever's in the cloud. This is the "I know local
// is empty/wrong, just give me my real data back" button, distinct from
// Sync's automatic (timestamp + footprint guarded) direction-picking.
async function importFromCloud() {
  if (!supabaseClient || !currentSession) return;

  const confirmed = confirm(
    "Import your saved progress from the cloud?\n\n" +
    "This replaces everything on this device with your cloud copy. " +
    "Any local changes not already synced will be lost."
  );
  if (!confirmed) return;

  const btn = document.getElementById("importCloudBtn");
  btn.disabled = true;
  setSyncNote("Importing from cloud…");

  try {
    const userId = currentSession.user.id;
    const { data: remoteRow, error } = await supabaseClient
      .from("tracker_state")
      .select("state, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;

    if (!remoteRow) {
      setSyncNote("No cloud data found for this account yet.", "is-error");
      return;
    }

    applyLoadedState(remoteRow.state);
    setSyncNote("Imported from cloud ✓", "is-success");
  } catch (err) {
    console.error("Import from cloud failed.", err);
    setSyncNote("Import failed — check your connection and try again.", "is-error");
  } finally {
    btn.disabled = false;
  }
}

const importCloudBtnEl = document.getElementById("importCloudBtn");
if (importCloudBtnEl) importCloudBtnEl.addEventListener("click", importFromCloud);

document.getElementById("syncBtn").addEventListener("click", () => {
  if (currentSession) {
    performSync();
  } else {
    signInWithGoogle();
  }
});
document.getElementById("syncSignOutBtn").addEventListener("click", signOutOfGoogle);

/* ---------------- Danger zone: clear local / delete cloud data ---------------- */

// Wipes everything stored on THIS device — localStorage, in-memory state,
// the widget's cached view of it — and resets the UI back to the
// mandatory first-run onboarding. Deliberately does not touch Supabase:
// this is a "start over on this device" action, not an account deletion.
function clearLocalData() {
  const confirmed = confirm(
    "Erase all local data and settings on this device?\n\n" +
    "This deletes your progress, heatmap, targets, and profile stored " +
    "here. It can't be undone. Anything already synced to your account " +
    "is not affected."
  );
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEY);
  state = structuredClone(DEFAULT_STATE);
  // Deliberately look "older" than anything in the cloud (epoch 0), so
  // if the person is signed in and hits Sync afterward, the sync logic
  // sees the cloud copy as newer and pulls it back down — instead of
  // treating this reset as "the latest change" and pushing an empty
  // state up over their real synced data.
  state.updatedAt = 0;
  saveState(false);

  applyTheme(state.theme);
  syncThemePills();
  document.getElementById("examDate").value = state.examDate;
  syncNextTestInputs();
  renderTabs();
  renderOverviewGrid();
  renderHeatmap();
  renderMonths();
  renderNextTestPanel();
  updateBrandYear();
  tickCountdown();
  renderAvatar();
  pushWidgetState();
  if (IS_ELECTRON && window.electronAPI.setMinimizeToTray) {
    window.electronAPI.setMinimizeToTray(state.settings.minimizeToTray);
  }
  if (IS_ELECTRON && window.electronAPI.setShowWidget) {
    window.electronAPI.setShowWidget(state.settings.showDesktopWidget);
  }
  if (IS_ELECTRON && window.electronAPI.setStartOnStartup) {
    window.electronAPI.setStartOnStartup(state.settings.startOnStartup);
  }

  setSyncNote("Local data cleared.", "is-success");
  // state.profile is now null, so this reopens the mandatory setup flow —
  // closeProfileDrawer()'s own guard means it can't be dismissed until
  // it's filled in again, same as a genuine first run.
  openProfileDrawer();
}

// Deletes the signed-in user's row from the tracker_state table in
// Supabase. Requires being signed in — RLS policies mean this can only
// ever delete the caller's own row (see the "Users can delete their own
// tracker state" policy). This does NOT delete the underlying Google/
// Supabase auth account itself, only the synced app data.
async function deleteCloudData() {
  if (!supabaseClient || !currentSession) return;

  const confirmed = confirm(
    "Permanently delete your synced data from your Google account?\n\n" +
    "This can't be undone. This device's local copy is not affected."
  );
  if (!confirmed) return;

  const btn = document.getElementById("deleteCloudDataBtn");
  btn.disabled = true;
  setSyncNote("Deleting cloud data…");

  try {
    const userId = currentSession.user.id;
    const { error } = await supabaseClient
      .from("tracker_state")
      .delete()
      .eq("user_id", userId);
    if (error) throw error;
    setSyncNote("Cloud data deleted.", "is-success");
  } catch (err) {
    console.error("Failed to delete cloud data.", err);
    setSyncNote("Couldn't delete cloud data — check your connection and try again.", "is-error");
  } finally {
    btn.disabled = false;
  }
}

const clearLocalDataBtnEl = document.getElementById("clearLocalDataBtn");
if (clearLocalDataBtnEl) clearLocalDataBtnEl.addEventListener("click", clearLocalData);
const deleteCloudDataBtnEl = document.getElementById("deleteCloudDataBtn");
if (deleteCloudDataBtnEl) deleteCloudDataBtnEl.addEventListener("click", deleteCloudData);

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

/* ---------------- Backup: export / import ---------------- */
function setBackupNote(text, kind) {
  const note = document.getElementById("backupNote");
  if (!note) return;
  note.textContent = text;
  note.classList.remove("is-error", "is-success");
  if (kind) note.classList.add(kind);
}

document.getElementById("exportBackupBtn").addEventListener("click", () => {
  try {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tracked26-backup-${todayStr()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBackupNote("Backup downloaded ✓", "is-success");
  } catch (e) {
    console.error("Backup export failed.", e);
    setBackupNote("Couldn't create the backup file.", "is-error");
  }
});

document.getElementById("importBackupBtn").addEventListener("click", () => {
  document.getElementById("backupFileInput").click();
});

document.getElementById("backupFileInput").addEventListener("change", async e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.subjects) {
      throw new Error("This file doesn't look like a Tracked 26 backup.");
    }
    if (!confirm("Restoring this backup will replace all current data on this device. Continue?")) return;

    state = normalizeState(parsed);
    saveState();

    applyTheme(state.theme);
    syncThemePills();
    document.getElementById("examDate").value = state.examDate;
    syncNextTestInputs();
    renderTabs();
    renderOverviewGrid();
    renderHeatmap();
    renderMonths();
    renderWeeklySummary();
    renderRevisionNudges();
    renderMockTests();
    renderNextTestPanel();
    updateBrandYear();
    tickCountdown();
    renderAvatar();
    pushWidgetState();

    setBackupNote("Backup restored ✓", "is-success");
  } catch (err) {
    console.error("Backup import failed.", err);
    setBackupNote(err.message || "Couldn't read that backup file.", "is-error");
  }
});

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
  setBackupNote("Keep a local copy of your progress — handy if you're not signed in, or switching browsers or devices.");

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
  pushWidgetState();
  // state.profile is now set, so the normal close path (which guards against
  // dismissing the mandatory first-run setup) will happily close it.
  closeProfileDrawer();
});

document.getElementById("profileTriggerBtn").addEventListener("click", openProfileDrawer);
document.getElementById("drawerCloseBtn").addEventListener("click", closeProfileDrawer);
document.getElementById("profileScrim").addEventListener("click", closeProfileDrawer);

/* ---------------- Settings drawer ---------------- */
function applyMinimizeToTrayToUI() {
  document.getElementById("minimizeToTrayToggle").checked = !!state.settings.minimizeToTray;
}

function applyShowWidgetToUI() {
  document.getElementById("showWidgetToggle").checked = !!state.settings.showDesktopWidget;
}

function applyStartOnStartupToUI() {
  document.getElementById("startOnStartupToggle").checked = !!state.settings.startOnStartup;
}

function openSettingsDrawer() {
  document.getElementById("trayToggleField").hidden = !IS_ELECTRON;
  document.getElementById("widgetToggleField").hidden = !IS_ELECTRON;
  document.getElementById("startupToggleField").hidden = !IS_ELECTRON;
  document.getElementById("settingsWebNote").hidden = IS_ELECTRON;
  applyMinimizeToTrayToUI();
  applyShowWidgetToUI();
  applyStartOnStartupToUI();

  document.getElementById("settingsDrawer").classList.add("open");
  document.getElementById("settingsDrawer").setAttribute("aria-hidden", "false");
  document.getElementById("settingsScrim").classList.add("open");
}

function closeSettingsDrawer() {
  document.getElementById("settingsDrawer").classList.remove("open");
  document.getElementById("settingsDrawer").setAttribute("aria-hidden", "true");
  document.getElementById("settingsScrim").classList.remove("open");
}

document.getElementById("settingsTriggerBtn").addEventListener("click", openSettingsDrawer);
document.getElementById("settingsCloseBtn").addEventListener("click", closeSettingsDrawer);
document.getElementById("settingsScrim").addEventListener("click", closeSettingsDrawer);

document.getElementById("minimizeToTrayToggle").addEventListener("change", e => {
  state.settings.minimizeToTray = e.target.checked;
  saveState();
  if (IS_ELECTRON && window.electronAPI.setMinimizeToTray) {
    window.electronAPI.setMinimizeToTray(state.settings.minimizeToTray);
  }
});

// ---------- Desktop widget toggle ----------
document.getElementById("showWidgetToggle").addEventListener("change", e => {
  state.settings.showDesktopWidget = e.target.checked;
  saveState();
  if (IS_ELECTRON && window.electronAPI.setShowWidget) {
    window.electronAPI.setShowWidget(e.target.checked);
    if (e.target.checked) pushWidgetState();
  }
});

// ---------- Start on PC startup toggle ----------
document.getElementById("startOnStartupToggle").addEventListener("change", e => {
  state.settings.startOnStartup = e.target.checked;
  saveState();
  if (IS_ELECTRON && window.electronAPI.setStartOnStartup) {
    window.electronAPI.setStartOnStartup(state.settings.startOnStartup);
  }
});

// Pushes the current examDate/theme/targetYear into the floating widget
// window, if it's Electron and the widget is (or is about to be) on.
// Call this any time one of those three values changes.
function pushWidgetState() {
  if (!IS_ELECTRON || !window.electronAPI.sendWidgetState) return;
  window.electronAPI.sendWidgetState({
    examDate: state.examDate,
    theme: resolveTheme(state.theme),
    targetYear: state.profile ? state.profile.targetYear : null
  });
}

// If the widget's own "✕" was clicked, its Settings toggle should reflect
// that it's now off.
if (IS_ELECTRON && window.electronAPI.onWidgetClosedExternally) {
  window.electronAPI.onWidgetClosedExternally(() => {
    state.settings.showDesktopWidget = false;
    saveState();
    applyShowWidgetToUI();
  });
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeProfileDrawer();
    closeSettingsDrawer();
  }
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
  populateTestSubjectOptions();
  switchView(name);
});

document.getElementById("addMonthBtn").addEventListener("click", () => {
  state.months.push({ name: "", items: [] });
  saveState();
  pendingFocus = { type: "month", mi: state.months.length - 1 };
  renderMonths();
});

document.getElementById("examDate").addEventListener("change", e => {
  state.examDate = e.target.value;
  saveState();
  tickCountdown();
  pushWidgetState();
});

/* ---------------- Init ---------------- */
document.getElementById("examDate").value = state.examDate;
syncNextTestInputs();
if (document.getElementById("testDateInput")) {
  document.getElementById("testDateInput").value = todayStr();
}

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
safe(renderWeeklySummary, "renderWeeklySummary");
safe(renderRevisionNudges, "renderRevisionNudges");
safe(renderMockTests, "renderMockTests");
safe(renderNextTestPanel, "renderNextTestPanel");
safe(updateBrandYear, "updateBrandYear");
safe(tickCountdown, "tickCountdown");
setInterval(() => safe(tickCountdown, "tickCountdown interval"), 30000);
safe(() => switchView("dashboard"), "switchView");
safe(initAuth, "initAuth");
safe(() => {
  if (IS_ELECTRON && window.electronAPI.setMinimizeToTray) {
    window.electronAPI.setMinimizeToTray(state.settings.minimizeToTray);
  }
}, "syncMinimizeToTray");
safe(() => {
  if (IS_ELECTRON && window.electronAPI.setShowWidget) {
    window.electronAPI.setShowWidget(state.settings.showDesktopWidget);
    if (state.settings.showDesktopWidget) pushWidgetState();
  }
}, "syncShowWidget");
safe(() => {
  if (IS_ELECTRON && window.electronAPI.setStartOnStartup) {
    window.electronAPI.setStartOnStartup(state.settings.startOnStartup);
  }
}, "syncStartOnStartup");

if (!state.profile) {
  safe(openProfileDrawer, "openProfileDrawer");
}