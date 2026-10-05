const STORAGE_KEY = "worklog-v1";
const DEFAULT_FIREBASE_URL =
  "https://worklog-be6e2-default-rtdb.europe-west1.firebasedatabase.app";
const DEFAULT_WORKSPACE_ID = "ddb6cf95-56d1-4eb5-a689-6d764fc9b3e4";

const els = {
  monthInput: document.getElementById("monthInput"),
  projectSelect: document.getElementById("projectSelect"),
  newProjectBtn: document.getElementById("newProjectBtn"),
  clock: document.getElementById("clock"),
  clockLabel: document.getElementById("clockLabel"),
  monthTotal: document.getElementById("monthTotal"),
  toggleBtn: document.getElementById("toggleBtn"),
  dayList: document.getElementById("dayList"),
  sessionCount: document.getElementById("sessionCount"),
  monthProjectFilter: document.getElementById("monthProjectFilter"),
  projectDialog: document.getElementById("projectDialog"),
  projectForm: document.getElementById("projectForm"),
  projectName: document.getElementById("projectName"),
  cancelProject: document.getElementById("cancelProject"),
  syncStatus: document.getElementById("syncStatus"),
};

function nowIso() {
  return new Date().toISOString();
}

function monthValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function emptyState() {
  return {
    projects: [{ id: crypto.randomUUID(), name: "Algemeen project" }],
    sessions: [],
    active: null,
    selectedProjectId: null,
    updatedAt: 0,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyState(), ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt storage */
  }
  return emptyState();
}

let state = loadState();
if (!state.selectedProjectId && state.projects[0]) {
  state.selectedProjectId = state.projects[0].id;
}

const firebaseBase = DEFAULT_FIREBASE_URL;
const cloudId = DEFAULT_WORKSPACE_ID;
let syncMessage = "";
let pushTimer = null;
let monthProjectFilter = "";
let syncing = false;

function snapshot() {
  return {
    projects: state.projects,
    sessions: state.sessions,
    active: state.active,
    selectedProjectId: state.selectedProjectId,
    updatedAt: state.updatedAt || 0,
  };
}

function applySnapshot(data) {
  state.projects = data.projects || emptyState().projects;
  state.sessions = data.sessions || [];
  state.active = data.active || null;
  state.selectedProjectId = data.selectedProjectId || state.projects[0]?.id;
  state.updatedAt = data.updatedAt || 0;
}

function saveLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
}

function saveState() {
  state.updatedAt = Date.now();
  saveLocal();
  queuePush();
  renderSync();
}

function cloudUrl() {
  return `${DEFAULT_FIREBASE_URL}/worklog/${DEFAULT_WORKSPACE_ID}.json`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatHours(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec} sec`;
  if (totalSec < 3600) {
    const minutes = Math.round(totalSec / 60);
    return `${minutes} min`;
  }
  const hours = ms / 3_600_000;
  return `${hours.toFixed(1).replace(".", ",")} uur`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("nl-NL", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function monthBounds(value) {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

function sessionDuration(session, at = Date.now()) {
  const start = new Date(session.start).getTime();
  const end = session.end ? new Date(session.end).getTime() : at;
  return Math.max(0, end - start);
}

function sessionsForMonth(value) {
  const { start, end } = monthBounds(value);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const live = [];

  for (const session of state.sessions) {
    const s = new Date(session.start).getTime();
    if (s >= startMs && s < endMs) live.push(session);
  }

  if (state.active) {
    const s = new Date(state.active.start).getTime();
    if (s >= startMs && s < endMs) {
      live.push({ ...state.active, end: null, live: true });
    }
  }

  return live.sort((a, b) => new Date(b.start) - new Date(a.start));
}

function projectName(id) {
  return state.projects.find((p) => p.id === id)?.name ?? "Onbekend project";
}

function renderProjects() {
  els.projectSelect.innerHTML = "";
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.projectSelect.append(option);
  }
  els.projectSelect.value = state.selectedProjectId;

  const previous = monthProjectFilter;
  els.monthProjectFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "Alle projecten";
  els.monthProjectFilter.append(all);
  for (const project of state.projects) {
    const option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    els.monthProjectFilter.append(option);
  }
  const stillExists = !previous || state.projects.some((p) => p.id === previous);
  monthProjectFilter = stillExists ? previous : "";
  els.monthProjectFilter.value = monthProjectFilter;
}

function renderClock() {
  const active = state.active;
  if (active) {
    const elapsed = Date.now() - new Date(active.start).getTime();
    els.clock.textContent = formatDuration(elapsed);
    els.clockLabel.textContent = `Bezig met ${projectName(active.projectId)}`;
    els.toggleBtn.textContent = "Stop klok";
    els.toggleBtn.classList.add("stop");
  } else {
    els.clock.textContent = "00:00:00";
    els.clockLabel.textContent = "Klaar om te starten";
    els.toggleBtn.textContent = "Start klok";
    els.toggleBtn.classList.remove("stop");
  }
}

function renderMonth() {
  const month = els.monthInput.value;
  const allSessions = sessionsForMonth(month);
  const sessions = monthProjectFilter
    ? allSessions.filter((session) => session.projectId === monthProjectFilter)
    : allSessions;
  const total = sessions.reduce((sum, session) => sum + sessionDuration(session), 0);
  const [year, monthNum] = month.split("-");
  const monthLabel = new Date(Number(year), Number(monthNum) - 1, 1).toLocaleDateString(
    "nl-NL",
    { month: "long", year: "numeric" }
  );

  const filterName = monthProjectFilter ? projectName(monthProjectFilter) : null;
  els.monthTotal.textContent = filterName
    ? `${formatHours(total)} voor ${filterName} in ${monthLabel}`
    : `${formatHours(total)} in ${monthLabel}`;
  els.sessionCount.textContent = `${sessions.length} sessie${sessions.length === 1 ? "" : "s"} · ${formatHours(total)}`;

  if (!sessions.length) {
    els.dayList.innerHTML = filterName
      ? `<p class="empty">Geen uren voor ${filterName} in deze maand.</p>`
      : `<p class="empty">Nog geen uren in deze maand. Zet de klok aan als je begint.</p>`;
    return;
  }

  const byDay = new Map();
  for (const session of sessions) {
    const key = new Date(session.start).toDateString();
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(session);
  }

  els.dayList.innerHTML = "";
  for (const items of byDay.values()) {
    const dayMs = items.reduce((sum, session) => sum + sessionDuration(session), 0);
    const wrap = document.createElement("article");
    wrap.className = "day";
    wrap.innerHTML = `
      <div class="day-head">
        <span>${formatDay(items[0].start)}</span>
        <span>${formatHours(dayMs)}</span>
      </div>
    `;
    for (const session of items) {
      const row = document.createElement("div");
      row.className = "session";
      const endLabel = session.end ? formatTime(session.end) : "nu";
      row.innerHTML = `
        <span>${projectName(session.projectId)}${session.live ? " · loopt" : ""}</span>
        <span>${formatTime(session.start)} – ${endLabel} · ${formatDuration(sessionDuration(session))}</span>
      `;
      wrap.append(row);
    }
    els.dayList.append(wrap);
  }
}

function renderSync() {
  els.syncStatus.textContent =
    syncMessage || "Zelfde uren op al je apparaten";
}

function render() {
  renderProjects();
  renderClock();
  renderMonth();
  renderSync();
}

async function pullCloud() {
  if (!cloudId || !firebaseBase || syncing) return;
  syncing = true;
  try {
    const res = await fetch(cloudUrl(), { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Ophalen mislukt");
    const remote = await res.json();
    if (!remote) {
      syncMessage = "Nog geen uren online. Nieuwe sessies worden bewaard.";
      renderSync();
      return;
    }
    if ((remote.updatedAt || 0) > (state.updatedAt || 0)) {
      applySnapshot(remote);
      saveLocal();
      render();
    }
    syncMessage = "Online gesynchroniseerd";
    renderSync();
  } catch {
    syncMessage = "Geen internet. Uren blijven lokaal tot de verbinding terug is.";
    renderSync();
  } finally {
    syncing = false;
  }
}

async function pushCloud() {
  if (!cloudId || !firebaseBase) return;
  try {
    const res = await fetch(cloudUrl(), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(snapshot()),
    });
    if (!res.ok) throw new Error("Opslaan mislukt");
    syncMessage = "Online opgeslagen";
    renderSync();
  } catch {
    syncMessage = "Online opslaan mislukt. Probeer het zo opnieuw.";
    renderSync();
  }
}

function queuePush() {
  if (!cloudId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushCloud, 400);
}

function startTimer() {
  if (state.active) return;
  if (!state.selectedProjectId) return;
  state.active = {
    id: crypto.randomUUID(),
    projectId: state.selectedProjectId,
    start: nowIso(),
  };
  saveState();
  render();
}

function stopTimer() {
  if (!state.active) return;
  state.sessions.push({
    ...state.active,
    end: nowIso(),
  });
  state.active = null;
  saveState();
  render();
}

els.monthInput.value = monthValue();

els.projectSelect.addEventListener("change", () => {
  state.selectedProjectId = els.projectSelect.value;
  saveState();
});

els.toggleBtn.addEventListener("click", () => {
  if (state.active) stopTimer();
  else startTimer();
});

els.newProjectBtn.addEventListener("click", () => {
  els.projectName.value = "";
  els.projectDialog.showModal();
  els.projectName.focus();
});

els.cancelProject.addEventListener("click", () => els.projectDialog.close());

els.projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = els.projectName.value.trim();
  if (!name) return;
  const project = { id: crypto.randomUUID(), name };
  state.projects.push(project);
  state.selectedProjectId = project.id;
  saveState();
  els.projectDialog.close();
  render();
});

els.monthInput.addEventListener("change", render);

els.monthProjectFilter.addEventListener("change", () => {
  monthProjectFilter = els.monthProjectFilter.value;
  renderMonth();
});

setInterval(() => {
  if (state.active) {
    renderClock();
    renderMonth();
  }
}, 1000);

setInterval(pullCloud, 12000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") pullCloud();
});

render();
pullCloud();
