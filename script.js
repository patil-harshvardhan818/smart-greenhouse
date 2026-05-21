/* ════════════════════════════════════════════════════════════
   GreenCore OS — script.js
   Real-time sensor polling, device control, activity log, UI
   ════════════════════════════════════════════════════════════ */

const REFRESH_MS   = 5000;   // poll interval
const MAX_LOG      = 50;     // max log entries kept
const API_BASE     = "";     // same origin as Flask

/* ── State ──────────────────────────────────────────────────── */
let startTime     = Date.now();
let pollTimer     = null;
let logEntries    = [];
let lastSensorTs  = null;
let deviceState   = { pump: false, fan: false };
let connected     = false;

/* ── Sensor metadata ─────────────────────────────────────────── */
const SENSORS = [
  {
    key:    "temperature",
    max:    50,
    thresholds: [
      { max:18,  label:"Cold",    cls:"cold"   },
      { max:30,  label:"Normal",  cls:"normal" },
      { max:38,  label:"Warm",    cls:"warm"   },
      { max:999, label:"Hot!",    cls:"hot"    },
    ]
  },
  {
    key:    "humidity",
    max:    100,
    thresholds: [
      { max:30,  label:"Dry",     cls:"warn"   },
      { max:70,  label:"Optimal", cls:"ok"     },
      { max:999, label:"Humid",   cls:"info"   },
    ]
  },
  {
    key:    "soil_moisture",
    max:    100,
    thresholds: [
      { max:25,  label:"Dry — water!",  cls:"warn" },
      { max:65,  label:"Good",          cls:"ok"   },
      { max:999, label:"Saturated",     cls:"info" },
    ]
  },
  {
    key:    "light_intensity",
    max:    1200,
    thresholds: [
      { max:200,  label:"Dark",     cls:"info" },
      { max:700,  label:"Moderate", cls:"ok"   },
      { max:999,  label:"Bright",   cls:"ok"   },
      { max:9999, label:"Intense",  cls:"warn" },
    ]
  },
];

/* ── DOM helpers ─────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const clx = (el, ...cls) => el.classList.add(...cls);
const unc = (el, ...cls) => el.classList.remove(...cls);

/* ── Clock ───────────────────────────────────────────────────── */
function tickClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2,"0");
  const mm  = String(now.getMinutes()).padStart(2,"0");
  const ss  = String(now.getSeconds()).padStart(2,"0");
  $("navTime").textContent = `${hh}:${mm}:${ss}`;

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2,"0");
  const s = String(elapsed % 60).padStart(2,"0");
  $("hUptime").textContent = `${m}:${s}`;
}
setInterval(tickClock, 1000);
tickClock();

/* ── Connection indicator ────────────────────────────────────── */
function setConnected(ok) {
  connected = ok;
  const dot   = $("connDot");
  const label = $("connLabel");
  if (ok) {
    dot.className   = "conn-dot online";
    label.textContent = "Connected · ESP32";
  } else {
    dot.className   = "conn-dot error";
    label.textContent = "Disconnected";
  }
}

/* ── Log ─────────────────────────────────────────────────────── */
function addLog(msg, type = "") {
  const now  = new Date();
  const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
  logEntries.unshift({ time, msg, type });
  if (logEntries.length > MAX_LOG) logEntries.pop();
  renderLog();
}

function renderLog() {
  const box = $("logBox");
  if (logEntries.length === 0) {
    box.innerHTML = '<div class="log-empty">No events yet.</div>';
    return;
  }
  box.innerHTML = logEntries.map(e =>
    `<div class="log-entry">
       <span class="log-time">${e.time}</span>
       <span class="log-msg ${e.type}">${escHtml(e.msg)}</span>
     </div>`
  ).join("");
}

function clearLog() {
  logEntries = [];
  renderLog();
  addLog("Log cleared.", "");
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

/* ── Toast ───────────────────────────────────────────────────── */
function showToast(msg, type = "") {
  const wrap = $("toastWrap");
  const el   = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toastOut .3s ease forwards";
    setTimeout(() => el.remove(), 320);
  }, 2800);
}

/* ── Sensor card update ──────────────────────────────────────── */
function updateSensorCard(meta, val) {
  const valEl  = $(`val-${meta.key}`);
  const barEl  = $(`bar-${meta.key}`);
  const stEl   = $(`status-${meta.key}`);
  if (!valEl) return;

  const pct = Math.min(100, Math.round((val / meta.max) * 100));

  // Flash animation
  valEl.classList.remove("flash");
  void valEl.offsetWidth; // reflow
  valEl.classList.add("flash");

  valEl.textContent = typeof val === "number" && val % 1 !== 0
    ? val.toFixed(1)
    : Math.round(val);
  barEl.style.width = `${pct}%`;

  // Status label
  const t = meta.thresholds.find(t => val < t.max) || meta.thresholds.at(-1);
  stEl.textContent = t.label;
}

/* ── Device indicator update ─────────────────────────────────── */
function updateDeviceUI(device, isOn) {
  deviceState[device] = isOn;
  const card  = $(`card-${device}`);
  const ind   = $(`ind-${device}`);

  if (isOn) {
    clx(card, "active");
    clx(ind,  "on");
    ind.querySelector(".ind-text").textContent = "ONLINE";
  } else {
    unc(card, "active");
    unc(ind,  "on");
    ind.querySelector(".ind-text").textContent = "OFFLINE";
  }

  // Hero active count
  const count = Object.values(deviceState).filter(Boolean).length;
  $("hActive").textContent = count || "—";
}

/* ── Fetch sensor data ───────────────────────────────────────── */
async function fetchSensorData() {
  try {
    const res  = await fetch(`${API_BASE}/api/sensor-data`, { cache:"no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json.data;

    setConnected(true);

    // Check if timestamp changed (new data from ESP32)
    const newTs = data.timestamp;
    const isNew = newTs !== lastSensorTs;
    lastSensorTs = newTs;

    SENSORS.forEach(meta => {
      const val = data[meta.key];
      if (val !== undefined) updateSensorCard(meta, val);
    });

    // Sync device status
    if (json.devices) {
      Object.entries(json.devices).forEach(([d, on]) => updateDeviceUI(d, on));
    }

    if (isNew) {
      const t = new Date(newTs * 1000);
      addLog(`Sensor data received — Temp ${data.temperature}°C | Hum ${data.humidity}%`, "ok");
    }

  } catch(e) {
    setConnected(false);
    addLog(`Fetch error: ${e.message}`, "err");
  }
}

/* ── Device control ──────────────────────────────────────────── */
async function controlDevice(device, action) {
  const url = `${API_BASE}/api/${device}/${action}`;
  try {
    const res  = await fetch(url, { method:"POST", cache:"no-store" });
    const json = await res.json();

    if (json.status === "ok") {
      const isOn = action === "on";
      updateDeviceUI(device, isOn);
      const label = device === "pump" ? "Water Pump" : "Cooling Fan";
      addLog(`${label} turned ${isOn ? "ON" : "OFF"}.`, isOn ? "ok" : "warn");
      showToast(`${label} → ${isOn ? "ON" : "OFF"}`, isOn ? "success" : "error");
    } else {
      throw new Error(json.message || "Unknown error");
    }
  } catch(e) {
    addLog(`Control error (${device}/${action}): ${e.message}`, "err");
    showToast(`Error: ${e.message}`, "error");
  }
}

/* ── Demo simulation (auto-advance sensor data) ──────────────── */
async function simulateSensors() {
  try {
    await fetch(`${API_BASE}/api/simulate`, { method:"POST" });
  } catch(_) { /* offline; ignore */ }
}

/* ── Init & polling loop ─────────────────────────────────────── */
function startPolling() {
  fetchSensorData();                   // immediate first fetch
  pollTimer = setInterval(async () => {
    await simulateSensors();           // nudge values each cycle (demo mode)
    await fetchSensorData();
  }, REFRESH_MS);
}

/* Boot */
addLog("GreenCoreOS dashboard loaded.", "ok");
addLog("Starting sensor polling every 5s…", "");
startPolling();
