const DARK_MODE_KEY = 'qi_site_dark_mode';

function setDarkMode(enabled) {
  if (document.body.classList.contains('housekeeping-page') || document.body.classList.contains('housekeeping-lists-page')) return;
  document.body.classList.toggle('dark-mode', enabled);
  try { localStorage.setItem(DARK_MODE_KEY, enabled ? 'true' : 'false'); } catch (error) {}
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? 'Dark Mode: On' : 'Dark Mode: Off';
  });
}

function toggleDarkMode() {
  setDarkMode(!document.body.classList.contains('dark-mode'));
}

try {
  if (!document.body.classList.contains('housekeeping-page') && !document.body.classList.contains('housekeeping-lists-page')) {
    setDarkMode(localStorage.getItem(DARK_MODE_KEY) === 'true');
  }
} catch (error) {
  setDarkMode(false);
}

document.addEventListener('click', event => {
  const toggle = event.target.closest('.site-nav-toggle');
  if (toggle) {
    const nav = toggle.closest('.site-nav');
    const links = nav && nav.querySelector('.site-nav-links');
    if (!links) return;
    const isOpening = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(isOpening));
    toggle.setAttribute('aria-label', isOpening ? 'Close navigation menu' : 'Open navigation menu');
    toggle.title = isOpening ? 'Close navigation menu' : 'Open navigation menu';
    links.hidden = !isOpening;
    return;
  }

  if (event.target.closest('.site-nav-links a')) {
    const nav = event.target.closest('.site-nav');
    const menuToggle = nav && nav.querySelector('.site-nav-toggle');
    if (menuToggle) {
      menuToggle.setAttribute('aria-expanded', 'false');
      menuToggle.setAttribute('aria-label', 'Open navigation menu');
      menuToggle.title = 'Open navigation menu';
    }
    return;
  }

  document.querySelectorAll('.site-nav-toggle[aria-expanded="true"]').forEach(menuToggle => {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
    menuToggle.title = 'Open navigation menu';
    const links = menuToggle.closest('.site-nav').querySelector('.site-nav-links');
    if (links) links.hidden = true;
  });
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.site-nav-toggle[aria-expanded="true"]').forEach(menuToggle => {
    menuToggle.setAttribute('aria-expanded', 'false');
    menuToggle.setAttribute('aria-label', 'Open navigation menu');
    menuToggle.title = 'Open navigation menu';
    const links = menuToggle.closest('.site-nav').querySelector('.site-nav-links');
    if (links) links.hidden = true;
  });
});

function parseDataActionArguments(element, event) {
  const raw = element.dataset.actionArgs;
  if (!raw) return [];
  return raw.split('|').map(argument => {
    if (argument === '$value') return event.target.value;
    if (argument === '$element') return event.target;
    if (argument === '$event') return event;
    if (argument === 'false') return false;
    if (argument === 'true') return true;
    return argument;
  });
}

document.addEventListener('click', event => {
  const element = event.target.closest('[data-action-click]');
  if (!element) return;
  const action = window[element.dataset.actionClick];
  if (typeof action === 'function') action(...parseDataActionArguments(element, event));
});

document.addEventListener('change', event => {
  const element = event.target.closest('[data-action-change]');
  if (!element) return;
  const action = window[element.dataset.actionChange];
  if (typeof action === 'function') action(...parseDataActionArguments(element, event));
});

document.addEventListener('submit', event => {
  const element = event.target.closest('[data-action-submit]');
  if (!element) return;
  event.preventDefault();
  const action = window[element.dataset.actionSubmit];
  if (typeof action === 'function') action(...parseDataActionArguments(element, event));
});

const STORAGE_KEY = 'attendance_records_v1';
const SHARED_DATA_FILENAME = 'Attendance_Tracker_Shared.json';
const SHARED_FOLDER_EVENT_KEY = 'attendance_shared_folder_updated';
const SHARED_DATA_MIGRATED_KEY = 'attendance_shared_data_migrated';
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

let saveDirHandle = null;
let sharedDataReady = false;
let sharedDataApplying = false;
let sharedDataDirty = false;
let sharedDataWriteTimer = null;
let sharedDataPollTimer = null;
let lastSharedDataText = '';

function scheduleSharedDataSave() {
  if (!saveDirHandle || !sharedDataReady || sharedDataApplying) return;
  sharedDataDirty = true;
  clearTimeout(sharedDataWriteTimer);
    sharedDataWriteTimer = setTimeout(async () => {
      sharedDataWriteTimer = null;
      try {
        await writeSharedDataNow();
      } catch (error) {
        console.error('Shared data save failed', error);
        if (sharedDataReady) {
          sharedDataWriteTimer = setTimeout(() => {
            sharedDataWriteTimer = null;
            scheduleSharedDataSave();
          }, 5000);
        }
      }
  }, 650);
}

  let sortState = { field: 'time', asc: false };

  function loadRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load records', e);
      return [];
    }
  }

  function saveRecords(records) {
    try {
      const serialized = JSON.stringify(records);
      if (localStorage.getItem(STORAGE_KEY) === serialized) return;
      localStorage.setItem(STORAGE_KEY, serialized);
      scheduleSharedDataSave();
    } catch (e) {
      console.error('Failed to save records', e);
    }
  }

  function pruneOld(records) {
    const cutoff = Date.now() - NINETY_DAYS_MS;
    return records.filter(r => r.timestamp >= cutoff);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  function showStatus(elId, message, type) {
    const el = document.getElementById(elId);
    el.textContent = message;
    el.className = 'status-msg ' + (type || '');
    if (message) {
      setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 3000);
    }
  }

  function addListenerIfPresent(id, eventName, handler) {
    const element = document.getElementById(id);
    if (element) element.addEventListener(eventName, handler);
  }

  /* ---------------- Notes (admin-editable) ---------------- */

  const NOTES_KEY = 'attendance_notes_v1';
  const ADMIN_USERNAME = 'Admin';
  const ADMIN_PASSWORD = 'Admin';
  const ADMIN_SESSION_KEY = 'attendance_admin_authenticated';
  // Password required to tick or untick the "Manager Approval" checkbox.
  // Currently the same as the admin password; change it here to use a
  // separate manager password.
  const MANAGER_PASSWORD = 'kirk';
  let isAdmin = false;
  try {
    isAdmin = sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
  } catch (e) {
    isAdmin = false;
  }

  function updateAdminAccessUi() {
    const loggedOut = document.getElementById('adminLoggedOut');
    const loggedIn = document.getElementById('adminLoggedIn');
    if (loggedOut) loggedOut.style.display = isAdmin && loggedIn ? 'none' : 'flex';
    if (loggedIn) loggedIn.style.display = isAdmin ? 'flex' : 'none';
  }

  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('Failed to load notes', e);
      return {};
    }
  }

  function saveNotes(notes) {
    try {
      const serialized = JSON.stringify(notes);
      if (localStorage.getItem(NOTES_KEY) === serialized) return;
      localStorage.setItem(NOTES_KEY, serialized);
      scheduleSharedDataSave();
    } catch (e) {
      console.error('Failed to save notes', e);
    }
  }

  // Keyed on the clock-in timestamp when one exists (stable even if that
  // clock-in later gets paired with a clock-out), otherwise the clock-out timestamp.
  function rowKey(row) {
    return row.name + '||' + (row.clockIn ? ('in:' + row.clockIn) : ('out:' + row.clockOut));
  }

  function attachNotes(rows) {
    const notes = loadNotes();
    rows.forEach(r => {
      r.key = rowKey(r);
      r.notes = notes[r.key] || '';
    });
    return rows;
  }

  function handleNoteChange(inputEl) {
    const key = inputEl.getAttribute('data-key');
    const notes = loadNotes();
    const val = inputEl.value.trim();
    if (val) {
      notes[key] = val;
    } else {
      delete notes[key];
    }
    saveNotes(notes);
  }

  function handleAdminLogin() {
    const userInput = document.getElementById('adminUser');
    const passInput = document.getElementById('adminPass');
    if (!userInput || !passInput) return;
    const user = userInput.value.trim();
    const pass = passInput.value;
    if (user === ADMIN_USERNAME && pass === ADMIN_PASSWORD) {
      isAdmin = true;
      try {
        sessionStorage.setItem(ADMIN_SESSION_KEY, 'true');
      } catch (e) {
        // Continue with the current page session if storage is unavailable.
      }
      updateAdminAccessUi();
      userInput.value = '';
      passInput.value = '';
      showStatus('adminStatus', '', '');
      if (!document.getElementById('recordsTable')) {
        window.location.href = 'hours-tracking.html';
        return;
      }
      renderTable();
    } else {
      showStatus('adminStatus', 'Incorrect username or password.', 'error');
    }
  }

  function handleAdminLogout() {
    isAdmin = false;
    try {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } catch (e) {
      // The current page still returns to the logged-out state.
    }
    updateAdminAccessUi();
    renderTable();
  }

  /* ---------------- Overtime alerts ---------------- */

  const OT_KEY = 'overtime_settings_v1';
  const DEFAULT_OT = { weeklyThreshold: 40, warnWithin: 5 };

  function loadOtSettings() {
    try {
      const raw = localStorage.getItem(OT_KEY);
      return raw ? Object.assign({}, DEFAULT_OT, JSON.parse(raw)) : Object.assign({}, DEFAULT_OT);
    } catch (e) {
      return Object.assign({}, DEFAULT_OT);
    }
  }

  function saveOtSettingsToStorage(s) {
    try {
      const serialized = JSON.stringify(s);
      if (localStorage.getItem(OT_KEY) === serialized) return;
      localStorage.setItem(OT_KEY, serialized);
      scheduleSharedDataSave();
    } catch (e) {
      console.error('Failed to save overtime settings', e);
    }
  }

  let otSettings = loadOtSettings();

  function populateOtInputs() {
    const thresholdInput = document.getElementById('otThreshold');
    const warnWithinInput = document.getElementById('otWarnWithin');
    if (!thresholdInput || !warnWithinInput) return;
    thresholdInput.value = otSettings.weeklyThreshold;
    warnWithinInput.value = otSettings.warnWithin;
  }

  function handleSaveOtSettings() {
    const threshold = parseFloat(document.getElementById('otThreshold').value);
    const warnWithin = parseFloat(document.getElementById('otWarnWithin').value);
    otSettings = {
      weeklyThreshold: isNaN(threshold) || threshold <= 0 ? DEFAULT_OT.weeklyThreshold : threshold,
      warnWithin: isNaN(warnWithin) || warnWithin < 0 ? DEFAULT_OT.warnWithin : warnWithin
    };
    saveOtSettingsToStorage(otSettings);
    showStatus('otSettingsStatus', 'Overtime settings saved.', 'success');
    renderOvertimeAlerts();
  }

  // Monday 00:00:00 (local time) of the week containing the given timestamp.
  function getMondayOfWeek(timestamp) {
    const d = new Date(timestamp);
    const day = d.getDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
  }

  function computeWeeklyHours(records, weekStartMs, weekEndMs) {
    const rows = buildDisplayRows(records).filter(r => r.clockIn && r.clockOut && !r.autoTimeout && r.clockIn >= weekStartMs && r.clockIn <= weekEndMs);
    const totals = new Map();
    rows.forEach(r => {
      const hrs = (r.clockOut - r.clockIn) / 3600000;
      totals.set(r.name, (totals.get(r.name) || 0) + hrs);
    });
    return totals;
  }

  /* ---------------- Currently clocked in ---------------- */

  const AUTO_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
  const AUTO_TIMEOUT_DESC = 'Timed Out at 12 Hours';

  // A person is "currently clocked in" when their single most recent record
  // (by timestamp) is a clock-in. This is intentionally independent of
  // buildDisplayRows()'s pairing window (used for shift-hours calculations)
  // so a clock-out - automatic or admin-triggered - always takes someone
  // off this list immediately, however long they'd been clocked in.
  function getOpenClockIns(records) {
    const latestByName = new Map();
    records.forEach(r => {
      const cur = latestByName.get(r.name);
      if (!cur || r.timestamp > cur.timestamp) {
        latestByName.set(r.name, r);
      }
    });
    const open = [];
    latestByName.forEach(r => {
      if (r.type === 'In') {
        open.push({ name: r.name, clockIn: r.timestamp });
      }
    });
    return open;
  }

  // Anyone open (per getOpenClockIns) for 12+ hours gets an automatic
  // clock-out record added, timestamped exactly 12 hours after their
  // clock-in. These records are flagged (autoTimeout) so their hours are
  // shown as "---" rather than treated as real worked time.
  // Adds the automatic clock-out records (in place) for anyone open 12+
  // hours. Returns true if it added any. Called by renderTable() on every
  // render, so any add/edit/delete in the table applies the rule at once
  // instead of waiting for the next timer tick.
  function applyAutoTimeouts(records) {
    const openRows = getOpenClockIns(records);
    const now = Date.now();
    let changed = false;

    openRows.forEach(r => {
      if (now - r.clockIn >= AUTO_TIMEOUT_MS) {
        records.push({
          id: generateId(),
          name: r.name,
          type: 'Out',
          description: AUTO_TIMEOUT_DESC,
          timestamp: r.clockIn + AUTO_TIMEOUT_MS,
          autoTimeout: true
        });
        changed = true;
      }
    });
    return changed;
  }

  // Timer entry point: renderTable() applies the timeouts itself, so this
  // just triggers a full refresh (table + Currently Clocked In + Overtime).
  function checkAutoTimeouts() {
    renderTable();
  }

  // The Clock Out dropdown mirrors the "Currently Clocked In" list, so
  // nobody can be clocked out before they have clocked in.
  function populateClockOutDropdown(openRows) {
    const sel = document.getElementById('outName');
    if (!sel) return;
    const names = openRows.map(r => r.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const sig = names.join('\u0001');
    if (sel.dataset.names === sig) return; // unchanged: keep the current selection/focus
    const previous = sel.value;
    sel.dataset.names = sig;
    sel.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = names.length ? 'Select your name' : 'No one is clocked in';
    sel.appendChild(placeholder);
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    });
    sel.value = names.includes(previous) ? previous : '';
    sel.disabled = names.length === 0;
  }

  function renderCurrentlyClockedIn() {
    const records = pruneOld(loadRecords());
    const rows = getOpenClockIns(records).sort((a, b) => a.clockIn - b.clockIn);
    populateClockOutDropdown(rows);

    renderCurrentWeekHours(records);
    renderPreviousWeekHours(records);

    const listEl = document.getElementById('currentlyInList');
    const countEl = document.getElementById('currentlyInCount');
    if (!listEl || !countEl) return;
    listEl.innerHTML = '';

    if (rows.length === 0) {
      listEl.innerHTML = '<div class="empty-note">No one is currently clocked in.</div>';
    } else {
      rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'alert-row';
        const inStr = new Date(r.clockIn).toLocaleString();
        const elapsedHrs = ((Date.now() - r.clockIn) / 3600000).toFixed(2);
        row.innerHTML = `<span><strong>${escapeHtml(r.name)}</strong> - in since ${inStr}</span><span class="badge badge-in">IN</span> <span>${elapsedHrs} h so far</span>`;
        listEl.appendChild(row);
      });
    }

    countEl.textContent = `${rows.length} currently clocked in`;
  }

  function renderCurrentWeekHours(records) {
    const weekStartMs = getMondayOfWeek(Date.now());
    const weekEndMs = weekStartMs + 7 * 24 * 60 * 60 * 1000 - 1;
    renderBusinessWeekHours(records, weekStartMs, weekEndMs, 'currentWeekRange', 'currentWeekHours', 'No completed shifts were recorded for the current business week.');
  }

  function renderPreviousWeekHours(records) {
    const weekEndMs = getMondayOfWeek(Date.now()) - 1;
    const weekStartMs = weekEndMs - 7 * 24 * 60 * 60 * 1000 + 1;
    renderBusinessWeekHours(records, weekStartMs, weekEndMs, 'previousWeekRange', 'previousWeekHours', 'No completed shifts were recorded for the previous business week.');
  }

  function renderBusinessWeekHours(records, weekStartMs, weekEndMs, rangeId, summaryId, emptyMessage) {
    const rangeEl = document.getElementById(rangeId);
    const summaryEl = document.getElementById(summaryId);
    if (!rangeEl || !summaryEl) return;

    const dateFormat = { month: 'short', day: 'numeric', year: 'numeric' };
    const weekStart = new Date(weekStartMs);
    const weekEnd = new Date(weekEndMs);
    rangeEl.textContent = `${weekStart.toLocaleDateString(undefined, dateFormat)} - ${weekEnd.toLocaleDateString(undefined, dateFormat)}`;

    const totals = Array.from(computeWeeklyHours(records, weekStartMs, weekEndMs).entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }));
    summaryEl.innerHTML = '';

    if (totals.length === 0) {
      summaryEl.innerHTML = `<div class="empty-note">${emptyMessage}</div>`;
      return;
    }

    const table = document.createElement('table');
    table.innerHTML = '<thead><tr><th>Employee</th><th>Hours</th></tr></thead>';
    const tbody = document.createElement('tbody');
    let combinedHours = 0;
    totals.forEach(([name, hours]) => {
      combinedHours += hours;
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      const hoursCell = document.createElement('td');
      nameCell.textContent = name;
      hoursCell.textContent = `${hours.toFixed(2)} h`;
      row.append(nameCell, hoursCell);
      tbody.appendChild(row);
    });
    const totalRow = document.createElement('tr');
    const totalLabel = document.createElement('th');
    const totalValue = document.createElement('th');
    totalLabel.textContent = 'Combined Total';
    totalValue.textContent = `${combinedHours.toFixed(2)} h`;
    totalRow.append(totalLabel, totalValue);
    tbody.appendChild(totalRow);
    table.appendChild(tbody);
    summaryEl.appendChild(table);
  }

  function renderOvertimeAlerts() {
    const alertsEl = document.getElementById('otAlertsList');
    const summaryEl = document.getElementById('otWeekSummary');
    if (!alertsEl || !summaryEl) return;

    const records = pruneOld(loadRecords());
    const now = Date.now();
    const weekStart = getMondayOfWeek(now);
    const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000 - 1;
    const totals = computeWeeklyHours(records, weekStart, weekEnd);

    const threshold = otSettings.weeklyThreshold;
    const warnWithin = otSettings.warnWithin;
    const entries = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);

    alertsEl.innerHTML = '';

    const alerts = entries.filter(([, hrs]) => hrs >= threshold - warnWithin);

    if (alerts.length === 0) {
      alertsEl.innerHTML = '<div class="empty-note">No overtime concerns for the current business week.</div>';
    } else {
      alerts.forEach(([name, hrs]) => {
        const over = hrs >= threshold;
        const row = document.createElement('div');
        row.className = 'alert-row ' + (over ? 'status-over' : 'status-warn');
        const badgeText = over ? 'OVER' : 'APPROACHING';
        const detail = over
          ? `${(hrs - threshold).toFixed(2)} h over ${threshold}h`
          : `${(threshold - hrs).toFixed(2)} h left before ${threshold}h`;
        row.innerHTML = `<span><strong>${escapeHtml(name)}</strong> - ${hrs.toFixed(2)} h this week</span><span class="badge">${badgeText}</span> <span>${detail}</span>`;
        alertsEl.appendChild(row);
      });
    }

    if (entries.length === 0) {
      summaryEl.innerHTML = '';
    } else {
      const rowsHtml = entries.map(([name, hrs]) =>
        `<tr><td>${escapeHtml(name)}</td><td>${hrs.toFixed(2)} h</td></tr>`
      ).join('');
      summaryEl.innerHTML = `<div>This week's hours (Mon-Sun, completed shifts only):</div><table><thead><tr><th>Name</th><th>Hours</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
    }
  }

  function generateId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Legacy records saved before this feature won't have an id yet - assign
  // one the first time they're loaded so edit/delete can target them.
  function ensureRecordIds(records) {
    let changed = false;
    records.forEach(r => {
      if (!r.id) { r.id = generateId(); changed = true; }
      // Records auto-timed-out before the flag existed (e.g. the old 16-hour
      // ones) are recognized by their description and flagged once.
      if (r.type === 'Out' && r.autoTimeout === undefined) {
        r.autoTimeout = /^Timed Out at \d+ Hours$/.test(r.description || '');
        changed = true;
      }
    });
    return changed;
  }

  function addRecord(name, type, description) {
    let records = loadRecords();
    records.push({
      id: generateId(),
      name: name,
      type: type,
      description: description || '',
      timestamp: Date.now()
    });
    records = pruneOld(records);
    saveRecords(records);
    renderTable();
  }

  // True if this name has a clock-in with no clock-out after it yet.
  function isNameCurrentlyClockedIn(name) {
    const target = name.trim().toLowerCase();
    const openRows = getOpenClockIns(pruneOld(loadRecords()));
    return openRows.some(r => r.name.trim().toLowerCase() === target);
  }

  function handleClockIn() {
    const nameInput = document.getElementById('inName');
    const name = nameInput.value.trim();
    if (!name) {
      showStatus('inStatus', 'Please select your name.', 'error');
      return;
    }
    if (isNameCurrentlyClockedIn(name)) {
      showStatus('inStatus', `${name} is already clocked in - clock out first.`, 'error');
      return;
    }
    addRecord(name, 'In', '');
    showStatus('inStatus', `Clocked in: ${name}`, 'success');
    nameInput.value = '';
    nameInput.focus();
  }

  function handleClockOut() {
    const nameInput = document.getElementById('outName');
    const descInput = document.getElementById('outDesc');
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    if (!name) {
      showStatus('outStatus', nameInput.disabled ? 'No one is currently clocked in.' : 'Please select your name.', 'error');
      return;
    }
    // Safety net: the dropdown only lists people who are clocked in, but
    // re-check against the stored records in case another tab changed things.
    if (!isNameCurrentlyClockedIn(name)) {
      showStatus('outStatus', `${name} isn't clocked in, so there is nothing to clock out.`, 'error');
      renderCurrentlyClockedIn();
      return;
    }
    addRecord(name, 'Out', description);
    showStatus('outStatus', `Clocked out: ${name}`, 'success');
    nameInput.value = '';
    descInput.value = '';
    nameInput.focus();
  }

  function setSort(field) {
    if (sortState.field === field) {
      sortState.asc = !sortState.asc;
    } else {
      sortState.field = field;
      sortState.asc = field === 'name';
    }
    renderTable();
  }

  function updateSortArrows() {
    const nameArrow = document.getElementById('arrow-name');
    const timeArrow = document.getElementById('arrow-time');
    if (nameArrow) nameArrow.textContent = '';
    if (timeArrow) timeArrow.textContent = '';
    const arrow = sortState.asc ? 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â²' : 'ÃƒÆ’Ã†â€™Ãƒâ€ Ã¢â‚¬â„¢ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¼';
    const activeArrow = document.getElementById('arrow-' + sortState.field);
    if (activeArrow) activeArrow.textContent = arrow;
  }

  const PAIRING_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

  // Combines each person's clock-in with the clock-out that follows it,
  // as long as the clock-out happens within 12 hours of that clock-in
  // (automatic time-out records are always paired with their clock-in).
  // Unmatched clock-ins or clock-outs are kept as their own row.
  function buildDisplayRows(records) {
    const byName = new Map();
    records.forEach(r => {
      if (!byName.has(r.name)) byName.set(r.name, []);
      byName.get(r.name).push(r);
    });

    const rows = [];
    byName.forEach((entries, name) => {
      entries = entries.slice().sort((a, b) => a.timestamp - b.timestamp);
      let pendingIn = null;

      entries.forEach(entry => {
        if (entry.type === 'In') {
          if (pendingIn) {
            // Earlier clock-in was never matched with a clock-out; keep it alone.
            rows.push({ name, clockIn: pendingIn.timestamp, clockOut: null, description: pendingIn.description || '', sortTime: pendingIn.timestamp, clockInId: pendingIn.id, clockOutId: null });
          }
          pendingIn = entry;
        } else {
          if (pendingIn && ((entry.timestamp - pendingIn.timestamp) <= PAIRING_WINDOW_MS || entry.autoTimeout)) {
            rows.push({
              name,
              clockIn: pendingIn.timestamp,
              clockOut: entry.timestamp,
              description: entry.description || pendingIn.description || '',
              sortTime: pendingIn.timestamp,
              clockInId: pendingIn.id,
              clockOutId: entry.id,
              autoTimeout: !!entry.autoTimeout
            });
            pendingIn = null;
          } else {
            if (pendingIn) {
              rows.push({ name, clockIn: pendingIn.timestamp, clockOut: null, description: pendingIn.description || '', sortTime: pendingIn.timestamp, clockInId: pendingIn.id, clockOutId: null });
              pendingIn = null;
            }
            rows.push({ name, clockIn: null, clockOut: entry.timestamp, description: entry.description || '', sortTime: entry.timestamp, clockInId: null, clockOutId: entry.id, autoTimeout: !!entry.autoTimeout });
          }
        }
      });

      if (pendingIn) {
        rows.push({ name, clockIn: pendingIn.timestamp, clockOut: null, description: pendingIn.description || '', sortTime: pendingIn.timestamp, clockInId: pendingIn.id, clockOutId: null });
      }
    });

    return rows;
  }

  function formatHours(row) {
    if (row.autoTimeout) return '---';
    if (row.clockIn && row.clockOut) {
      return ((row.clockOut - row.clockIn) / 3600000).toFixed(2);
    }
    return '';
  }

  function toDatetimeLocalValue(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // All admin edit/delete actions below re-check isAdmin before touching
  // storage, so they're inert if someone is logged out but a stale row is
  // still on screen.

  function handleAdminDeleteRow(clockInId, clockOutId) {
    requireAdmin('Delete Row', 'Enter your username and password to delete this row.', () => {
      if (!confirm('Delete this row? This cannot be undone.')) return;
      let records = loadRecords();
      records = records.filter(r => r.id !== clockInId && r.id !== clockOutId);
      saveRecords(records);
      renderTable();
    });
  }

  // ---- Shared plumbing for the admin edit handlers ----

  function findRowByRecordId(records, id) {
    if (!id) return null;
    return buildDisplayRows(records).find(r => r.clockInId === id || r.clockOutId === id) || null;
  }

  // A row's note is stored under a key built from its name and first
  // timestamp. When an edit changes that key, move the note with the row so
  // it doesn't get orphaned.
  function migrateNote(oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey) return;
    const notes = loadNotes();
    if (Object.prototype.hasOwnProperty.call(notes, oldKey)) {
      notes[newKey] = notes[oldKey];
      delete notes[oldKey];
      saveNotes(notes);
    }
  }

  // Loads the records, lets `mutate(records)` change them (it returns an
  // error message, or null when the edit is fine), saves, and re-renders.
  function commitAdminEdit(anyId, mutate) {
    const records = loadRecords();
    const before = findRowByRecordId(records, anyId);
    const oldKey = before ? rowKey(before) : null;
    const error = mutate(records);
    if (error) { alert(error); renderTable(); return; }
    saveRecords(records);
    const after = findRowByRecordId(records, anyId);
    if (oldKey && after) migrateNote(oldKey, rowKey(after));
    renderTable();
  }

  // Checks for creating the missing half of a shift (adding a clock-out to a
  // lone clock-in, or a clock-in to a lone clock-out).
  function validateNewShift(name, inTs, outTs, ignoreIds) {
    if (isNaN(inTs) || isNaN(outTs)) return 'Invalid date/time - no change made.';
    const limit = Date.now() + 60000;
    if (inTs > limit || outTs > limit) return 'That time is in the future - no change made.';
    if (outTs < inTs) return 'Clock Out must be after Clock In - no change made.';
    if (outTs - inTs > PAIRING_WINDOW_MS) {
      return `A shift can't be longer than ${PAIRING_WINDOW_MS / 3600000} hours - no change made.`;
    }
    const clash = loadRecords().some(r =>
      r.name === name && !ignoreIds.includes(r.id) && r.timestamp > inTs && r.timestamp < outTs);
    if (clash) return 'Another entry for this person falls inside that time span - no change made.';
    return null;
  }

  function createClockOut(records, inRec, outTs) {
    records.push({
      id: generateId(),
      name: inRec.name,
      type: 'Out',
      description: inRec.description || '', // keep any description typed on the open row
      timestamp: outTs,
      autoTimeout: false
    });
    inRec.description = '';
  }

  function createClockIn(records, outRec, inTs) {
    records.push({
      id: generateId(),
      name: outRec.name,
      type: 'In',
      description: '',
      timestamp: inTs
    });
  }

  // ---- Cell edit handlers (each one re-checks isAdmin) ----

  function handleAdminEditName(clockInId, clockOutId, newName) {
    if (!isAdmin) { renderTable(); return; }
    const trimmed = newName.trim();
    if (!trimmed) { renderTable(); return; }
    commitAdminEdit(clockInId || clockOutId, records => {
      records.forEach(r => {
        if (r.id === clockInId || r.id === clockOutId) r.name = trimmed;
      });
      return null;
    });
  }

  // The description lives on the clock-out record. A row that is still open
  // (clock-in only) keeps it on the clock-in record until a clock-out exists.
  function handleAdminEditDescription(clockInId, clockOutId, newDescription) {
    if (!isAdmin || !(clockInId || clockOutId)) { renderTable(); return; }
    commitAdminEdit(clockInId || clockOutId, records => {
      const outRec = clockOutId ? records.find(r => r.id === clockOutId) : null;
      const inRec = clockInId ? records.find(r => r.id === clockInId) : null;
      if (outRec) {
        outRec.description = newDescription;
        if (inRec) inRec.description = '';
      } else if (inRec) {
        inRec.description = newDescription;
      } else {
        return 'Record not found - no change made.';
      }
      return null;
    });
  }

  function handleAdminEditDateTime(id, inputEl) {
    if (!isAdmin || !id) { renderTable(); return; }
    const ts = new Date(inputEl.value).getTime();
    if (isNaN(ts)) { alert('Invalid date/time - no change made.'); renderTable(); return; }
    commitAdminEdit(id, records => {
      const problem = validateTimeEdit(id, ts);
      if (problem) return problem;
      const rec = records.find(r => r.id === id);
      if (!rec) return 'Record not found - no change made.';
      rec.timestamp = ts;
      if (rec.type === 'Out') rec.autoTimeout = false; // manually corrected, so real hours count
      return null;
    });
  }

  // Clock Out cell on a row that only has a clock-in: lets an editor fill it in.
  function handleAdminAddClockOut(clockInId, inputEl) {
    if (!isAdmin || !clockInId || !inputEl.value) { renderTable(); return; }
    const outTs = new Date(inputEl.value).getTime();
    commitAdminEdit(clockInId, records => {
      const inRec = records.find(r => r.id === clockInId);
      if (!inRec) return 'Record not found - no change made.';
      const problem = validateNewShift(inRec.name, inRec.timestamp, outTs, [clockInId]);
      if (problem) return problem;
      createClockOut(records, inRec, outTs);
      return null;
    });
  }

  // Clock In cell on a row that only has a clock-out: lets an editor fill it in.
  function handleAdminAddClockIn(clockOutId, inputEl) {
    if (!isAdmin || !clockOutId || !inputEl.value) { renderTable(); return; }
    const inTs = new Date(inputEl.value).getTime();
    commitAdminEdit(clockOutId, records => {
      const outRec = records.find(r => r.id === clockOutId);
      if (!outRec) return 'Record not found - no change made.';
      const problem = validateNewShift(outRec.name, inTs, outRec.timestamp, [clockOutId]);
      if (problem) return problem;
      createClockIn(records, outRec, inTs);
      return null;
    });
  }

  // Hours is derived from Clock In / Clock Out, so editing it moves the
  // Clock Out time (or, on a lone clock-out, creates the clock-in).
  function handleAdminEditHours(clockInId, clockOutId, inputEl) {
    if (!isAdmin) { renderTable(); return; }
    const raw = inputEl.value.trim();
    if (raw === '') { renderTable(); return; }
    const hrs = Number(raw);
    if (!isFinite(hrs) || hrs < 0) {
      alert('Hours must be a number that is 0 or more - no change made.');
      renderTable();
      return;
    }
    const ms = Math.round(hrs * 3600000);
    commitAdminEdit(clockInId || clockOutId, records => {
      const inRec = clockInId ? records.find(r => r.id === clockInId) : null;
      const outRec = clockOutId ? records.find(r => r.id === clockOutId) : null;
      if (inRec && outRec) {
        const newOut = inRec.timestamp + ms;
        const problem = validateTimeEdit(clockOutId, newOut);
        if (problem) return problem;
        outRec.timestamp = newOut;
        outRec.autoTimeout = false; // manually corrected, so real hours count
      } else if (inRec) {
        const newOut = inRec.timestamp + ms;
        const problem = validateNewShift(inRec.name, inRec.timestamp, newOut, [clockInId]);
        if (problem) return problem;
        createClockOut(records, inRec, newOut);
      } else if (outRec) {
        const newIn = outRec.timestamp - ms;
        const problem = validateNewShift(outRec.name, newIn, outRec.timestamp, [clockOutId]);
        if (problem) return problem;
        createClockIn(records, outRec, newIn);
      } else {
        return 'Record not found - no change made.';
      }
      return null;
    });
  }


  // Returns an error message if changing record `id` to `newTs` would leave
  // the table in a state the other sections can't reflect accurately (a
  // time in the future, a clock-out before its clock-in, or a shift longer
  // than the pairing window, which would split the line in two and drop the
  // shift from the overtime totals). Returns null if the edit is fine.
  function validateTimeEdit(id, newTs) {
    if (newTs > Date.now() + 60000) return 'That time is in the future - no change made.';
    const row = buildDisplayRows(pruneOld(loadRecords()))
      .find(r => r.clockInId === id || r.clockOutId === id);
    if (row && row.clockInId && row.clockOutId) {
      const inTs = id === row.clockInId ? newTs : row.clockIn;
      const outTs = id === row.clockOutId ? newTs : row.clockOut;
      if (outTs < inTs) return 'Clock Out must be after Clock In - no change made.';
      // Moving the clock-in of an auto-timed-out shift keeps its flag, so it
      // stays paired regardless of length; any other edit must fit the window.
      const staysTimedOut = row.autoTimeout && id === row.clockInId;
      if (!staysTimedOut && (outTs - inTs) > PAIRING_WINDOW_MS) {
        return `A shift can't be longer than ${PAIRING_WINDOW_MS / 3600000} hours - no change made.`;
      }
    }
    return null;
  }


  /* ---------------- Manager approval (password protected) ---------------- */

  // The approval flag lives on the row's primary record (its clock-in, or
  // the clock-out for a clock-out-only row), so it survives name/time edits.
  let pendingApproval = null;

  function requestApprovalToggle(event, recordId) {
    event.preventDefault(); // the box only changes after the password is accepted
    const rec = loadRecords().find(r => r.id === recordId);
    if (!rec) return;
    const makeApproved = !rec.approved;
    pendingApproval = { recordId, makeApproved };
    document.getElementById('approvalModalText').textContent =
      `${makeApproved ? 'Approve' : 'Remove approval for'}: ${rec.name}`;
    document.getElementById('approvalSubmitBtn').textContent = makeApproved ? 'Approve' : 'Remove Approval';
    document.getElementById('approvalPass').value = '';
    document.getElementById('approvalModalStatus').textContent = '';
    document.getElementById('approvalModalOverlay').style.display = 'flex';
    document.getElementById('approvalPass').focus();
  }

  function closeApprovalModal() {
    document.getElementById('approvalModalOverlay').style.display = 'none';
    document.getElementById('approvalPass').value = '';
    pendingApproval = null;
  }

  function submitApproval() {
    if (!pendingApproval) return;
    if (document.getElementById('approvalPass').value !== MANAGER_PASSWORD) {
      document.getElementById('approvalModalStatus').textContent = 'Incorrect password.';
      return;
    }
    const records = loadRecords();
    const rec = records.find(r => r.id === pendingApproval.recordId);
    if (rec) {
      rec.approved = pendingApproval.makeApproved;
      rec.approvedAt = pendingApproval.makeApproved ? Date.now() : null;
      saveRecords(records);
    }
    closeApprovalModal();
    renderTable();
  }

  addListenerIfPresent('approvalModalOverlay', 'click', e => {
    if (e.target.id === 'approvalModalOverlay') closeApprovalModal();
  });
  addListenerIfPresent('approvalPass', 'keydown', e => {
    if (e.key === 'Enter') submitApproval();
    if (e.key === 'Escape') closeApprovalModal();
  });

  function renderTable() {
    const table = document.getElementById('recordsTable');
    if (!table) {
      renderCurrentlyClockedIn();
      renderOvertimeAlerts();
      return;
    }
    table.classList.toggle('admin-mode', isAdmin);
    let records = pruneOld(loadRecords());
    ensureRecordIds(records);
    applyAutoTimeouts(records);
    saveRecords(records);

    let rows = buildDisplayRows(records);
    attachNotes(rows);
    const approvedIds = new Set(records.filter(x => x.approved).map(x => x.id));

    rows.sort((a, b) => {
      let cmp;
      if (sortState.field === 'name') {
        cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (cmp === 0) cmp = a.sortTime - b.sortTime;
      } else {
        cmp = a.sortTime - b.sortTime;
      }
      return sortState.asc ? cmp : -cmp;
    });

    const tbody = document.getElementById('recordsBody');
    tbody.innerHTML = '';

    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.className = 'empty-row';
      tr.innerHTML = '<td colspan="8">No attendance records yet.</td>';
      tbody.appendChild(tr);
    } else {
      rows.forEach(r => {
        const tr = document.createElement('tr');
        const hours = formatHours(r);

        const nameCell = isAdmin
          ? `<input type="text" class="notes-input" value="${escapeHtml(r.name)}" onchange="handleAdminEditName('${r.clockInId || ''}', '${r.clockOutId || ''}', this.value)">`
          : escapeHtml(r.name);

        const hoursText = hours === '---' ? '---' : (hours ? hours + ' h' : '');
        const dtInput = (id, handler, extra) =>
          `<input type="datetime-local" class="notes-input" value="${extra || ''}" onchange="${handler}">`;

        const inCell = isAdmin
          ? (r.clockIn
              ? dtInput(r.clockInId, `handleAdminEditDateTime('${r.clockInId}', this)`, toDatetimeLocalValue(r.clockIn))
              : `<input type="datetime-local" class="notes-input" value="" title="Add the missing clock-in time" onchange="handleAdminAddClockIn('${r.clockOutId}', this)">`)
          : (r.clockIn ? new Date(r.clockIn).toLocaleString() : '-');

        const outCell = isAdmin
          ? (r.clockOut
              ? dtInput(r.clockOutId, `handleAdminEditDateTime('${r.clockOutId}', this)`, toDatetimeLocalValue(r.clockOut))
              : `<input type="datetime-local" class="notes-input" value="" title="Add the missing clock-out time" onchange="handleAdminAddClockOut('${r.clockInId}', this)">`)
          : (r.clockOut ? new Date(r.clockOut).toLocaleString() : '-');

        const descCell = isAdmin
          ? `<input type="text" class="notes-input" value="${escapeHtml(r.description)}" placeholder="Description" onchange="handleAdminEditDescription('${r.clockInId || ''}', '${r.clockOutId || ''}', this.value)">`
          : escapeHtml(r.description);

        const hoursTitle = (r.clockInId && r.clockOutId)
          ? 'Changing the hours moves the Clock Out time'
          : 'Enter hours to add the missing clock-in/clock-out time';
        const hoursCell = isAdmin
          ? `<input type="text" inputmode="decimal" class="notes-input hours-input" value="${hours && hours !== '---' ? hours : ''}" placeholder="${hours === '---' ? '---' : 'Hours'}" title="${hoursTitle}" onchange="handleAdminEditHours('${r.clockInId || ''}', '${r.clockOutId || ''}', this)">`
          : hoursText;

        const notesCell = isAdmin
          ? `<input type="text" class="notes-input" data-key="${escapeHtml(r.key)}" value="${escapeHtml(r.notes)}" placeholder="Add a note" onchange="handleNoteChange(this)">`
          : escapeHtml(r.notes);

        const deleteCell = `<div class="row-actions"><button type="button" class="btn-delete-row" onclick="handleAdminDeleteRow('${r.clockInId || ''}', '${r.clockOutId || ''}')">Delete</button></div>`;

        const approvalId = r.clockInId || r.clockOutId;
        const isComplete = !!(r.clockInId && r.clockOutId);
        const approvalCell = isComplete
          ? `<input type="checkbox" class="approval-check" ${approvedIds.has(approvalId) ? 'checked' : ''} onclick="requestApprovalToggle(event, '${approvalId}')" title="Manager approval (password required)">`
          : `<input type="checkbox" class="approval-check" disabled title="Available once the shift has both a clock-in and clock-out">`;

        tr.innerHTML = `
          <td>${approvalCell}</td>
          <td>${nameCell}</td>
          <td class="type-in">${inCell}</td>
          <td class="type-out">${outCell}</td>
          <td>${descCell}</td>
          <td>${hoursCell}</td>
          <td>${notesCell}</td>
          <td>${deleteCell}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    document.getElementById('recordCount').textContent =
      `${rows.length} row${rows.length === 1 ? '' : 's'} in the last 90 days`;

    updateSortArrows();
    renderCurrentlyClockedIn();
    renderOvertimeAlerts();
  }

  // Keep table live across tabs/windows on the same browser
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) renderTable();
    if (e.key === SHARED_FOLDER_EVENT_KEY) restoreSaveFolder();
  });

  // Allow Enter key to submit each panel
  addListenerIfPresent('inName', 'keydown', e => {
    if (e.key === 'Enter') handleClockIn();
  });
  addListenerIfPresent('outName', 'keydown', e => {
    if (e.key === 'Enter') document.getElementById('outDesc').focus();
  });
  addListenerIfPresent('outDesc', 'keydown', e => {
    if (e.key === 'Enter') handleClockOut();
  });

  /* ---------------- Shared admin confirmation + per-row Add/Delete ---------------- */

  // Runs `action` straight away for a logged-in editor; otherwise asks for
  // the same username and password used by the admin clock-out button.
  let pendingAdminAction = null;

  function requireAdmin(title, text, action) {
    if (isAdmin) { action(); return; }
    pendingAdminAction = action;
    document.getElementById('adminAuthTitle').textContent = title;
    document.getElementById('adminAuthText').textContent = text;
    document.getElementById('adminAuthUser').value = '';
    document.getElementById('adminAuthPass').value = '';
    document.getElementById('adminAuthStatus').textContent = '';
    document.getElementById('adminAuthOverlay').style.display = 'flex';
    document.getElementById('adminAuthUser').focus();
  }

  function closeAdminAuthModal() {
    document.getElementById('adminAuthOverlay').style.display = 'none';
    document.getElementById('adminAuthPass').value = '';
    pendingAdminAction = null;
  }

  function submitAdminAuth() {
    const user = document.getElementById('adminAuthUser').value.trim();
    const pass = document.getElementById('adminAuthPass').value;
    if (user !== ADMIN_USERNAME || pass !== ADMIN_PASSWORD) {
      document.getElementById('adminAuthStatus').textContent = 'Incorrect username or password.';
      return;
    }
    const action = pendingAdminAction;
    closeAdminAuthModal();
    if (action) action();
  }

  addListenerIfPresent('adminAuthOverlay', 'click', e => {
    if (e.target.id === 'adminAuthOverlay') closeAdminAuthModal();
  });
  addListenerIfPresent('adminAuthOverlay', 'keydown', e => {
    if (e.key === 'Escape') closeAdminAuthModal();
    if (e.key === 'Enter' && e.target.id === 'adminAuthPass') submitAdminAuth();
    if (e.key === 'Enter' && e.target.id === 'adminAuthUser') document.getElementById('adminAuthPass').focus();
  });

  function deleteAbsence(id) {
    requireAdmin('Delete Absence', 'Enter your username and password to delete this absence.', () => {
      if (!confirm('Delete this absence? This cannot be undone.')) return;
      saveAbsences(loadAbsences().filter(a => a.id !== id));
      renderAbsences();
    });
  }

  // Makes sure a <select> has an option for `value` (e.g. a name edited into a row).
  function ensureOption(sel, value) {
    if (!Array.from(sel.options).some(o => o.value === value)) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      sel.appendChild(opt);
    }
  }

  function populateNameOptions(select) {
    const source = document.getElementById('inName');
    const options = source
      ? Array.from(source.options).map(option => ({ value: option.value, label: option.textContent }))
      : ['', 'Dan', 'Brandi', 'Courtney', 'Janine', 'Jessica', 'JJ', 'Monique', 'Nikki', 'Skittles', 'Stephanie', 'Other']
        .map(name => ({ value: name, label: name || 'Select a name' }));

    select.innerHTML = '';
    options.forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  // ---- Add Shift (adds a completed clock-in/clock-out pair) ----

  function openAddShiftModal(prefillName) {
    const sel = document.getElementById('addShiftName');
    populateNameOptions(sel);
    if (prefillName) {
      ensureOption(sel, prefillName);
      sel.value = prefillName;
    }
    ['addShiftIn', 'addShiftOut', 'addShiftDesc', 'addShiftUser', 'addShiftPass'].forEach(id => {
      document.getElementById(id).value = '';
    });
    // A logged-in editor has already proven who they are.
    document.getElementById('addShiftCreds').style.display = isAdmin ? 'none' : '';
    document.getElementById('addShiftStatus').textContent = '';
    document.getElementById('addShiftOverlay').style.display = 'flex';
    sel.focus();
  }

  function closeAddShiftModal() {
    document.getElementById('addShiftOverlay').style.display = 'none';
    document.getElementById('addShiftPass').value = '';
  }

  function submitAddShift() {
    const name = document.getElementById('addShiftName').value.trim();
    const inVal = document.getElementById('addShiftIn').value;
    const outVal = document.getElementById('addShiftOut').value;
    const desc = document.getElementById('addShiftDesc').value.trim();
    const status = document.getElementById('addShiftStatus');

    if (!name || !inVal || !outVal) {
      status.textContent = 'Please fill in the name, clock in and clock out.';
      return;
    }
    if (!isAdmin) {
      const user = document.getElementById('addShiftUser').value.trim();
      const pass = document.getElementById('addShiftPass').value;
      if (user !== ADMIN_USERNAME || pass !== ADMIN_PASSWORD) {
        status.textContent = 'Incorrect username or password.';
        return;
      }
    }
    const inTs = new Date(inVal).getTime();
    const outTs = new Date(outVal).getTime();
    const problem = validateNewShift(name, inTs, outTs, []);
    if (problem) {
      status.textContent = problem.replace(' - no change made.', '.');
      return;
    }
    let records = loadRecords();
    records.push({ id: generateId(), name, type: 'In', description: '', timestamp: inTs });
    records.push({ id: generateId(), name, type: 'Out', description: desc, timestamp: outTs, autoTimeout: false });
    records = pruneOld(records);
    saveRecords(records);
    closeAddShiftModal();
    renderTable();
  }

  addListenerIfPresent('addShiftOverlay', 'click', e => {
    if (e.target.id === 'addShiftOverlay') closeAddShiftModal();
  });
  addListenerIfPresent('addShiftOverlay', 'keydown', e => {
    if (e.key === 'Escape') closeAddShiftModal();
    if (e.key === 'Enter' && e.target.id === 'addShiftPass') submitAddShift();
  });

  /* ---------------- Absences ---------------- */

  const ABSENCES_KEY = 'attendance_absences_v1';

  function loadAbsences() {
    try {
      const raw = localStorage.getItem(ABSENCES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error('Failed to load absences', e);
      return [];
    }
  }

  function saveAbsences(list) {
    try {
      const serialized = JSON.stringify(list);
      if (localStorage.getItem(ABSENCES_KEY) === serialized) return;
      localStorage.setItem(ABSENCES_KEY, serialized);
      scheduleSharedDataSave();
    } catch (e) {
      console.error('Failed to save absences', e);
    }
  }

  // 'YYYY-MM-DD' -> local date text (avoids the UTC shift of new Date('YYYY-MM-DD')).
  function formatAbsenceDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString() : (str || '');
  }

  function renderAbsences() {
    const list = loadAbsences().slice().sort((a, b) =>
      (b.date || '').localeCompare(a.date || '') || (b.createdAt || 0) - (a.createdAt || 0));
    const tbody = document.getElementById('absencesBody');
    const countEl = document.getElementById('absenceCount');
    if (!tbody || !countEl) return;
    tbody.innerHTML = '';
    if (list.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No absences recorded yet.</td></tr>';
    } else {
      list.forEach(a => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(a.name)}</td>
          <td>${escapeHtml(formatAbsenceDate(a.date))}</td>
          <td>${escapeHtml(a.shift)}</td>
          <td>${escapeHtml(a.managementName)}</td>
          <td><div class="row-actions"><button type="button" class="btn-add-row" title="Add a new absence">Add</button><button type="button" class="btn-delete-row">Delete</button></div></td>`;
        tr.querySelector('.btn-add-row').addEventListener('click', () => openAbsenceModal(a.name));
        tr.querySelector('.btn-delete-row').addEventListener('click', () => deleteAbsence(a.id));
        tbody.appendChild(tr);
      });
    }
    countEl.textContent =
      `${list.length} absence${list.length === 1 ? '' : 's'} recorded`;
  }

  function openAbsenceModal(prefillName) {
    const sel = document.getElementById('absenceName');
    populateNameOptions(sel);
    if (prefillName) {
      ensureOption(sel, prefillName);
      sel.value = prefillName;
    }
    document.getElementById('absenceDate').value = formatDateOnly(new Date());
    ['absenceShift', 'absenceMgmtName', 'absenceUser', 'absencePass'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('absenceModalStatus').textContent = '';
    document.getElementById('absenceModalOverlay').style.display = 'flex';
    sel.focus();
  }

  function closeAbsenceModal() {
    document.getElementById('absenceModalOverlay').style.display = 'none';
    document.getElementById('absencePass').value = '';
  }

  function submitAbsence() {
    const name = document.getElementById('absenceName').value.trim();
    const date = document.getElementById('absenceDate').value;
    const shift = document.getElementById('absenceShift').value.trim();
    const mgmt = document.getElementById('absenceMgmtName').value.trim();
    const user = document.getElementById('absenceUser').value.trim();
    const pass = document.getElementById('absencePass').value;
    const status = document.getElementById('absenceModalStatus');

    if (!name || !date || !shift || !mgmt) {
      status.textContent = 'Please fill in the name, date, shift and management entry name.';
      return;
    }
    if (user !== ADMIN_USERNAME || pass !== ADMIN_PASSWORD) {
      status.textContent = 'Incorrect username or password.';
      return;
    }
    const list = loadAbsences();
    list.push({ id: generateId(), name, date, shift, managementName: mgmt, createdAt: Date.now() });
    saveAbsences(list);
    closeAbsenceModal();
    renderAbsences();
  }

  addListenerIfPresent('absenceModalOverlay', 'click', e => {
    if (e.target.id === 'absenceModalOverlay') closeAbsenceModal();
  });
  addListenerIfPresent('absenceModalOverlay', 'keydown', e => {
    if (e.key === 'Escape') closeAbsenceModal();
    if (e.key === 'Enter' && e.target.id === 'absencePass') submitAbsence();
  });
  window.addEventListener('storage', e => {
    if (e.key === ABSENCES_KEY) renderAbsences();
  });

  renderAbsences();

  /* ---------------- Resizable table columns (editor only) ---------------- */

  const COL_WIDTHS_KEY = 'attendance_col_widths_v1';
  const MIN_COL_WIDTH = 60;
  const COL_COUNT = 8;

  function loadColWidths() {
    try {
      const arr = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY) || 'null');
      if (Array.isArray(arr) && arr.length === COL_COUNT &&
          arr.every(n => typeof n === 'number' && isFinite(n) && n >= MIN_COL_WIDTH)) {
        return arr;
      }
    } catch (e) { /* fall through to default layout */ }
    return null;
  }

  function saveColWidths(widths) {
    try {
      if (widths) {
        const serialized = JSON.stringify(widths);
        if (localStorage.getItem(COL_WIDTHS_KEY) === serialized) return;
        localStorage.setItem(COL_WIDTHS_KEY, serialized);
      } else {
        if (localStorage.getItem(COL_WIDTHS_KEY) === null) return;
        localStorage.removeItem(COL_WIDTHS_KEY);
      }
      scheduleSharedDataSave();
    } catch (e) {
      console.error('Failed to save column widths', e);
    }
  }

  // widths = array of pixel widths, or null to go back to the automatic layout.
  function applyColWidths(widths) {
    const table = document.getElementById('recordsTable');
    if (!table) return;
    const cols = table.querySelectorAll('colgroup col');
    if (!widths) {
      cols.forEach(c => { c.style.width = ''; });
      table.style.tableLayout = '';
      table.style.width = '';
      table.classList.remove('fixed-cols');
      return;
    }
    cols.forEach((c, i) => { c.style.width = widths[i] + 'px'; });
    table.style.tableLayout = 'fixed';
    table.style.width = widths.reduce((a, b) => a + b, 0) + 'px';
    table.classList.add('fixed-cols');
  }

  function resetColumnWidths() {
    if (!isAdmin) return;
    saveColWidths(null);
    applyColWidths(null);
  }

  function initColumnResizers() {
    const table = document.getElementById('recordsTable');
    if (!table) return;
    table.querySelectorAll('.col-resizer').forEach((handle, idx) => {
      // Don't let a drag-release on the handle count as a click on the
      // (sortable) column title.
      handle.addEventListener('click', e => e.stopPropagation());

      handle.addEventListener('pointerdown', e => {
        if (!isAdmin) return;
        e.preventDefault();
        e.stopPropagation();

        // First drag: freeze the current automatic widths so only the dragged column moves.
        let widths;
        if (table.classList.contains('fixed-cols')) {
          widths = Array.from(table.querySelectorAll('colgroup col')).map(c => parseFloat(c.style.width));
        } else {
          widths = Array.from(table.querySelectorAll('thead th'))
            .map(th => Math.max(MIN_COL_WIDTH, Math.round(th.getBoundingClientRect().width)));
          applyColWidths(widths);
        }

        const startX = e.clientX;
        const startW = widths[idx];
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
        handle.classList.add('active');

        const onMove = ev => {
          widths[idx] = Math.max(MIN_COL_WIDTH, Math.round(startW + ev.clientX - startX));
          applyColWidths(widths);
        };
        const onUp = () => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onUp);
          handle.classList.remove('active');
          saveColWidths(widths);
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onUp);
      });
    });
  }

  updateAdminAccessUi();
  applyColWidths(loadColWidths());
  initColumnResizers();

  populateOtInputs();
  checkAutoTimeouts();
  renderTable();

  // Keep overtime alerts and the currently-clocked-in list reasonably fresh
  // even if no one interacts with the page for a while, and auto clock-out
  // anyone who's crossed the 12-hour mark.
  setInterval(() => {
    // The table is rebuilt on every refresh, so skip it while an editor is
    // typing in a cell (it refreshes again after they finish).
    const ae = document.activeElement;
    const editingCell = ae && ae.tagName === 'INPUT' && ae.type !== 'checkbox' &&
      ae.closest && ae.closest('#recordsBody');
    if (!editingCell) checkAutoTimeouts();
    renderCurrentlyClockedIn();
    renderOvertimeAlerts();
  }, 60000);

  /* ---------------- Auto-save to Excel ---------------- */

  const HANDLE_DB_NAME = 'attendanceTrackerHandles';
  const HANDLE_STORE = 'handles';
  const AUTOSAVE_HOUR = 10;   // 10 AM
  const AUTOSAVE_MINUTE = 0;
  function openHandleDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbGet(key) {
    const db = await openHandleDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const req = tx.objectStore(HANDLE_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function collectSharedData() {
    return {
      version: 1,
      updatedAt: Date.now(),
      records: loadRecords(),
      notes: loadNotes(),
      absences: loadAbsences(),
      overtimeSettings: loadOtSettings(),
      columnWidths: loadColWidths()
    };
  }

  function parseSharedData(text) {
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.absences)) {
      throw new Error('The shared data file has an unsupported format.');
    }
    return {
      version: 1,
      updatedAt: Number(data.updatedAt) || 0,
      records: data.records,
      notes: data.notes && typeof data.notes === 'object' ? data.notes : {},
      absences: data.absences,
      overtimeSettings: data.overtimeSettings || null,
      columnWidths: Array.isArray(data.columnWidths) ? data.columnWidths : null
    };
  }

  function mergeSharedData(remote, local) {
    const mergeById = (primary, secondary, fallbackKey) => {
      const merged = new Map();
      primary.concat(secondary).forEach(item => {
        const key = item.id || fallbackKey(item);
        if (!merged.has(key)) merged.set(key, item);
      });
      return Array.from(merged.values());
    };

    return {
      version: 1,
      updatedAt: Math.max(remote.updatedAt || 0, local.updatedAt || 0, Date.now()),
      records: mergeById(remote.records, local.records, item => `${item.name}|${item.type}|${item.timestamp}`),
      notes: Object.assign({}, local.notes, remote.notes),
      absences: mergeById(remote.absences, local.absences, item => `${item.name}|${item.date}|${item.createdAt}`),
      overtimeSettings: remote.overtimeSettings || local.overtimeSettings,
      columnWidths: remote.columnWidths || local.columnWidths
    };
  }

  function applySharedData(data) {
    sharedDataApplying = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data.records));
      localStorage.setItem(NOTES_KEY, JSON.stringify(data.notes));
      localStorage.setItem(ABSENCES_KEY, JSON.stringify(data.absences));
      if (data.overtimeSettings) localStorage.setItem(OT_KEY, JSON.stringify(data.overtimeSettings));
      else localStorage.removeItem(OT_KEY);
      if (data.columnWidths) localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(data.columnWidths));
      else localStorage.removeItem(COL_WIDTHS_KEY);
      otSettings = loadOtSettings();
    } finally {
      sharedDataApplying = false;
    }
    renderTable();
    renderAbsences();
    populateOtInputs();
    applyColWidths(loadColWidths());
  }

  async function readSharedDataFile() {
    const fileHandle = await saveDirHandle.getFileHandle(SHARED_DATA_FILENAME, { create: true });
    const file = await fileHandle.getFile();
    return file.text();
  }

  async function writeSharedDataFile(text) {
    const fileHandle = await saveDirHandle.getFileHandle(SHARED_DATA_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
  }

  function startSharedDataPolling() {
    clearInterval(sharedDataPollTimer);
    sharedDataPollTimer = setInterval(pollSharedDataFile, 4000);
  }

  async function connectSharedData(handle) {
    saveDirHandle = handle;
    const allowed = await ensurePermission(handle);
    if (!allowed) throw new Error('Read/write permission is required for the shared folder.');

    const currentText = await readSharedDataFile();
    let data = collectSharedData();
    if (currentText.trim()) {
      const remote = parseSharedData(currentText);
      data = localStorage.getItem(SHARED_DATA_MIGRATED_KEY) === 'true'
        ? remote
        : mergeSharedData(remote, data);
    }
    const serialized = JSON.stringify(data, null, 2);
    await writeSharedDataFile(serialized);
    localStorage.setItem(SHARED_DATA_MIGRATED_KEY, 'true');
    applySharedData(data);
    lastSharedDataText = serialized;
    sharedDataReady = true;
    sharedDataDirty = false;
    startSharedDataPolling();
    updateFolderStatus();
  }

  async function writeSharedDataNow() {
    if (!saveDirHandle || !sharedDataReady || sharedDataApplying) return;
    const allowed = await ensurePermission(saveDirHandle);
    if (!allowed) {
      sharedDataReady = false;
      updateFolderStatus();
      throw new Error('Shared-folder permission needs to be restored.');
    }

    const data = collectSharedData();
    const serialized = JSON.stringify(data, null, 2);
    await writeSharedDataFile(serialized);
    lastSharedDataText = serialized;
    sharedDataDirty = false;
    updateFolderStatus();
  }

  async function copyBrowserDataToJson() {
    if (!saveDirHandle || !sharedDataReady) {
      showStatus('exportStatus', 'Connect the shared folder before copying browser data.', 'error');
      return;
    }
    try {
      clearTimeout(sharedDataWriteTimer);
      sharedDataWriteTimer = null;
      const currentText = await readSharedDataFile();
      const local = collectSharedData();
      const data = currentText.trim()
        ? mergeSharedData(local, parseSharedData(currentText))
        : local;
      data.updatedAt = Date.now();
      const serialized = JSON.stringify(data, null, 2);
      await writeSharedDataFile(serialized);
      applySharedData(data);
      lastSharedDataText = serialized;
      sharedDataDirty = false;
      updateFolderStatus();
      showStatus('exportStatus', 'Browser data copied to the shared JSON file.', 'success');
    } catch (error) {
      showStatus('exportStatus', error.message || 'Could not copy browser data to JSON.', 'error');
    }
  }

  async function pollSharedDataFile() {
    if (!saveDirHandle || !sharedDataReady || sharedDataDirty || sharedDataWriteTimer) return;
    try {
      if (await saveDirHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        sharedDataReady = false;
        updateFolderStatus();
        return;
      }
      const text = await readSharedDataFile();
      if (!text.trim() || text === lastSharedDataText) return;
      const data = parseSharedData(text);
      applySharedData(data);
      lastSharedDataText = text;
    } catch (err) {
      console.error('Failed to read shared data file', err);
    }
  }

  function updateFolderStatus() {
    const el = document.getElementById('folderStatus');
    if (!el) return;
    el.textContent = sharedDataReady
      ? `Shared data connected: "${saveDirHandle.name}/${SHARED_DATA_FILENAME}". Google Drive for desktop syncs this file.`
      : saveDirHandle
        ? `Folder selected: "${saveDirHandle.name}". Reconnect it to enable shared data.`
        : 'No shared folder connected. Select the same Google Drive for desktop folder on each computer.';
  }

  async function chooseSaveFolder() {
    if (!('showDirectoryPicker' in window)) {
      alert('This browser does not support shared-folder access. Use Chrome or Edge with Google Drive for desktop.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      saveDirHandle = handle;
      sharedDataReady = false;
      sharedDataDirty = false;
      clearInterval(sharedDataPollTimer);
      await idbSet('saveDirHandle', handle);
      await connectSharedData(handle);
      localStorage.setItem(SHARED_FOLDER_EVENT_KEY, String(Date.now()));
      showStatus('exportStatus', 'Shared data file connected.', 'success');
    } catch (err) {
      console.log('Folder selection cancelled or failed', err);
      showStatus('exportStatus', err.message || 'Could not connect the shared folder.', 'error');
    }
  }

  async function restoreSaveFolder() {
    try {
      const handle = await idbGet('saveDirHandle');
      if (!handle) return;
      saveDirHandle = handle;
      updateFolderStatus();
      if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') {
        await connectSharedData(handle);
      }
    } catch (err) {
      console.log('No saved shared folder permission found', err);
    }
  }

  async function ensurePermission(handle) {
    const opts = { mode: 'readwrite' };
    try {
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      if ((await handle.requestPermission(opts)) === 'granted') return true;
    } catch (err) {
      console.error('Permission check failed', err);
    }
    return false;
  }

  function pad(n, len = 2) {
    return String(n).padStart(len, '0');
  }

  function buildFilename(date, label) {
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    // Note: colons (:) are not allowed in Windows filenames, so the time
    // portion uses a hyphen (HH-MM) instead of a colon (HH:MM).
    const base = `${yyyy}-${mm}-${dd}_${hh}-${min}`;
    const labelPart = label ? `_${label}` : '';
    return `${base}${labelPart}Attendance_Tracker.xlsx`;
  }

  function recordsToSheetRows(records) {
    const header = ['Name', 'Clock In', 'Clock Out', 'Description', 'Hours', 'Notes'];
    const rows = attachNotes(buildDisplayRows(records))
      .slice()
      .sort((a, b) => a.sortTime - b.sortTime)
      .map(r => [
        r.name,
        r.clockIn ? new Date(r.clockIn).toLocaleString() : '',
        r.clockOut ? new Date(r.clockOut).toLocaleString() : '',
        r.description || '',
        formatHours(r),
        r.notes || ''
      ]);
    return [header, ...rows];
  }

  /* ---------------- Minimal offline .xlsx writer ----------------
     No external library is used. This builds a valid .xlsx (which is a
     ZIP archive of XML parts) entirely by hand, so exporting works with
     no internet connection at all. */

  function crc32(bytes) {
    if (!crc32.table) {
      const table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ crc32.table[(crc ^ bytes[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function u16le(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
  function u32le(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  // Builds an uncompressed (STORE method) ZIP archive from a list of
  // { name, data(Uint8Array) } entries. No compression library needed.
  function buildZip(files) {
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    const modTime = 0;
    const modDate = 0x21; // Jan 1, 1980 - placeholder, doesn't affect usability

    files.forEach(file => {
      const nameBytes = encoder.encode(file.name);
      const data = file.data;
      const crc = crc32(data);

      const localHeader = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,
        ...u16le(20), ...u16le(0), ...u16le(0),
        ...u16le(modTime), ...u16le(modDate),
        ...u32le(crc), ...u32le(data.length), ...u32le(data.length),
        ...u16le(nameBytes.length), ...u16le(0)
      ]);
      localChunks.push(localHeader, nameBytes, data);

      const centralHeader = new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,
        ...u16le(20), ...u16le(20), ...u16le(0), ...u16le(0),
        ...u16le(modTime), ...u16le(modDate),
        ...u32le(crc), ...u32le(data.length), ...u32le(data.length),
        ...u16le(nameBytes.length), ...u16le(0), ...u16le(0),
        ...u16le(0), ...u16le(0), ...u32le(0), ...u32le(offset)
      ]);
      centralChunks.push(centralHeader, nameBytes);

      offset += localHeader.length + nameBytes.length + data.length;
    });

    const centralDirOffset = offset;
    const centralDirSize = centralChunks.reduce((sum, c) => sum + c.length, 0);

    const endRecord = new Uint8Array([
      0x50, 0x4b, 0x05, 0x06,
      ...u16le(0), ...u16le(0),
      ...u16le(files.length), ...u16le(files.length),
      ...u32le(centralDirSize), ...u32le(centralDirOffset),
      ...u16le(0)
    ]);

    const allChunks = [...localChunks, ...centralChunks, endRecord];
    const total = allChunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(total);
    let pos = 0;
    allChunks.forEach(c => { result.set(c, pos); pos += c.length; });
    return result;
  }

  function xmlEscape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function columnLetter(index) { // 0-based column index -> A, B, ... Z, AA, ...
    let n = index + 1;
    let letters = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      letters = String.fromCharCode(65 + rem) + letters;
      n = Math.floor((n - 1) / 26);
    }
    return letters;
  }

  function buildSheetXml(rowsData) {
    let rowsXml = '';
    rowsData.forEach((row, rIdx) => {
      const rowNum = rIdx + 1;
      let cellsXml = '';
      row.forEach((val, cIdx) => {
        const ref = columnLetter(cIdx) + rowNum;
        const text = (val === null || val === undefined) ? '' : String(val);
        cellsXml += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
      });
      rowsXml += `<row r="${rowNum}">${cellsXml}</row>`;
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
  }

  // Builds a complete, valid .xlsx file (as a Uint8Array) from a simple
  // array-of-arrays table, with no external dependency.
  function buildXlsxBytes(rowsData, sheetName) {
    const encoder = new TextEncoder();
    const safeSheetName = xmlEscape((sheetName || 'Sheet1').substring(0, 31));

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

    const sheetXml = buildSheetXml(rowsData);

    const files = [
      { name: '[Content_Types].xml', data: encoder.encode(contentTypes) },
      { name: '_rels/.rels', data: encoder.encode(rootRels) },
      { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
      { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
      { name: 'xl/styles.xml', data: encoder.encode(stylesXml) },
      { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheetXml) }
    ];

    return buildZip(files);
  }

  // Writes bytes/text either into the previously-chosen auto-save folder
  // (if one is set and permission is granted) or falls back to a normal
  // browser download. Shared by every export type (xlsx, CSV, PDF).
  async function writeOutputFile(data, filename, mimeType) {
    if (saveDirHandle) {
      const allowed = await ensurePermission(saveDirHandle);
      if (allowed) {
        try {
          const fileHandle = await saveDirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(data);
          await writable.close();
          return { saved: true, filename };
        } catch (err) {
          console.error('Save to folder failed, falling back to download', err);
        }
      }
    }
    const blob = (data instanceof Blob) ? data : new Blob([data], { type: mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return { saved: false, filename };
  }

  async function exportRecordsToXlsx(records, label, isAuto) {
    if (!records.length) {
      showStatus('exportStatus', 'No records found for that filter.', 'error');
      return;
    }
    const data = recordsToSheetRows(records);
    const wbout = buildXlsxBytes(data, 'Attendance');
    const filename = buildFilename(new Date(), label);
    const result = await writeOutputFile(wbout, filename, 'application/octet-stream');
    showStatus(
      'exportStatus',
      result.saved
        ? `Saved ${filename} to your chosen folder.`
        : `${isAuto ? 'Auto-saved' : 'Exported'} as download: ${filename}`,
      'success'
    );
  }

  async function exportToXlsx(isAuto) {
    const records = pruneOld(loadRecords());
    await exportRecordsToXlsx(records, '', isAuto);
  }

  /* ---------------- Filtered exports ---------------- */

  function formatDateOnly(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function filterRecordsByRange(records, startMs, endMs) {
    return records.filter(r => r.timestamp >= startMs && r.timestamp <= endMs);
  }

  // Returns the Monday 00:00:00 through Sunday 23:59:59.999 range
  // for the business week containing the given YYYY-MM-DD date string.
  function getBusinessWeekRange(dateStr) {
    const picked = new Date(dateStr + 'T00:00:00');
    const day = picked.getDay(); // 0 = Sunday ... 6 = Saturday
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(picked);
    monday.setDate(picked.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday.getTime(), end: sunday.getTime() };
  }

  async function exportBusinessWeek() {
    const dateVal = document.getElementById('weekPickerDate').value;
    if (!dateVal) {
      showStatus('exportStatus', 'Pick a date within the desired business week first.', 'error');
      return;
    }
    const { start, end } = getBusinessWeekRange(dateVal);
    const records = filterRecordsByRange(loadRecords(), start, end);
    const label = `Week_${formatDateOnly(new Date(start))}_to_${formatDateOnly(new Date(end))}`;
    await exportRecordsToXlsx(records, label, false);
  }

  async function exportDateRange() {
    const startVal = document.getElementById('rangeStart').value;
    const endVal = document.getElementById('rangeEnd').value;
    if (!startVal || !endVal) {
      showStatus('exportStatus', 'Pick both a start and end date first.', 'error');
      return;
    }
    const start = new Date(startVal + 'T00:00:00').getTime();
    const end = new Date(endVal + 'T23:59:59').getTime();
    if (start > end) {
      showStatus('exportStatus', 'Start date must be on or before the end date.', 'error');
      return;
    }
    const records = filterRecordsByRange(loadRecords(), start, end);
    const label = `Range_${startVal}_to_${endVal}`;
    await exportRecordsToXlsx(records, label, false);
  }

  async function exportLastNDays() {
    const n = parseInt(document.getElementById('daysSelect').value, 10);
    const end = Date.now();
    const start = end - n * 24 * 60 * 60 * 1000;
    const records = filterRecordsByRange(loadRecords(), start, end);
    const label = `Last${n}Days`;
    await exportRecordsToXlsx(records, label, false);
  }

  /* ---------------- Payroll export (CSV + offline PDF, no libraries) ---------------- */

  // Splits completed shifts in [rangeStart, rangeEnd] into their Mon-Sun
  // business weeks, sums hours per employee per week, and only then splits
  // each week's total into regular/overtime - this matches how weekly
  // overtime (FLSA-style, 40 hrs/week by default) is actually calculated,
  // even when the pay period itself spans more than one week.
  function computePayrollSummary(records, rangeStart, rangeEnd, weeklyThreshold) {
    const rows = buildDisplayRows(records).filter(r => r.clockIn && r.clockOut && !r.autoTimeout && r.clockIn >= rangeStart && r.clockIn <= rangeEnd);
    const byEmployeeWeek = new Map();
    rows.forEach(r => {
      const weekStart = getMondayOfWeek(r.clockIn);
      const key = r.name + '|' + weekStart;
      const hrs = (r.clockOut - r.clockIn) / 3600000;
      byEmployeeWeek.set(key, (byEmployeeWeek.get(key) || 0) + hrs);
    });

    const totals = new Map();
    byEmployeeWeek.forEach((hrs, key) => {
      const name = key.slice(0, key.lastIndexOf('|'));
      const regular = Math.min(hrs, weeklyThreshold);
      const overtime = Math.max(0, hrs - weeklyThreshold);
      const cur = totals.get(name) || { regular: 0, overtime: 0 };
      cur.regular += regular;
      cur.overtime += overtime;
      totals.set(name, cur);
    });

    return Array.from(totals.entries())
      .map(([name, t]) => ({ name, regular: t.regular, overtime: t.overtime, total: t.regular + t.overtime }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function csvEscape(val) {
    const str = val === undefined || val === null ? '' : String(val);
    if (/[",\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function buildPayrollCsv(summary, rangeStartStr, rangeEndStr) {
    const header = ['Employee Name', 'Pay Period Start', 'Pay Period End', 'Regular Hours', 'Overtime Hours', 'Total Hours'];
    const lines = [header.map(csvEscape).join(',')];
    summary.forEach(s => {
      lines.push([s.name, rangeStartStr, rangeEndStr, s.regular.toFixed(2), s.overtime.toFixed(2), s.total.toFixed(2)].map(csvEscape).join(','));
    });
    return lines.join('\r\n');
  }

  function getPayrollRangeInputs() {
    const startVal = document.getElementById('payrollStart').value;
    const endVal = document.getElementById('payrollEnd').value;
    if (!startVal || !endVal) {
      showStatus('exportStatus', 'Pick both a pay period start and end date.', 'error');
      return null;
    }
    const start = new Date(startVal + 'T00:00:00').getTime();
    const end = new Date(endVal + 'T23:59:59').getTime();
    if (start > end) {
      showStatus('exportStatus', 'Start date must be on or before the end date.', 'error');
      return null;
    }
    return { startVal, endVal, start, end };
  }

  async function exportPayrollCsv() {
    const range = getPayrollRangeInputs();
    if (!range) return;
    const summary = computePayrollSummary(loadRecords(), range.start, range.end, otSettings.weeklyThreshold);
    if (!summary.length) {
      showStatus('exportStatus', 'No completed shifts found in that pay period.', 'error');
      return;
    }
    const csv = buildPayrollCsv(summary, range.startVal, range.endVal);
    const filename = `Payroll_${range.startVal}_to_${range.endVal}.csv`;
    const result = await writeOutputFile(csv, filename, 'text/csv');
    showStatus('exportStatus', result.saved ? `Saved ${filename} to your chosen folder.` : `Downloaded ${filename}`, 'success');
  }

  /* -------- Minimal offline PDF writer (hand-built, no library) -------- */

  function pdfEscape(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/[^\x20-\x7E]/g, '?');
  }

  function buildPdfBytes(title, headers, rows) {
    const pageWidth = 612, pageHeight = 792, margin = 40;
    const usableWidth = pageWidth - margin * 2;
    const colWidth = usableWidth / headers.length;
    const rowHeight = 16;
    const rowsPerPage = Math.max(5, Math.floor((pageHeight - margin * 2 - 70) / rowHeight));

    const pages = [];
    for (let i = 0; i < rows.length; i += rowsPerPage) {
      pages.push(rows.slice(i, i + rowsPerPage));
    }
    if (pages.length === 0) pages.push([]);

    function buildPageContent(pageRows, pageNum, totalPages) {
      let y = pageHeight - margin;
      const lines = ['BT'];
      lines.push(`/F1 14 Tf 1 0 0 1 ${margin} ${y} Tm (${pdfEscape(title)}) Tj`);
      y -= 20;
      lines.push(`/F1 8 Tf 1 0 0 1 ${margin} ${y} Tm (Page ${pageNum} of ${totalPages}) Tj`);
      y -= 18;
      lines.push('/F1 9 Tf');
      headers.forEach((h, i) => {
        lines.push(`1 0 0 1 ${(margin + i * colWidth).toFixed(1)} ${y.toFixed(1)} Tm (${pdfEscape(h)}) Tj`);
      });
      y -= rowHeight;
      lines.push('/F1 8 Tf');
      pageRows.forEach(row => {
        row.forEach((val, i) => {
          const text = pdfEscape(val === undefined || val === null ? '' : String(val));
          lines.push(`1 0 0 1 ${(margin + i * colWidth).toFixed(1)} ${y.toFixed(1)} Tm (${text}) Tj`);
        });
        y -= rowHeight;
      });
      lines.push('ET');
      return lines.join('\n');
    }

    const objects = [];
    const pageObjNums = [];
    const contentObjNums = [];
    let nextObjNum = 4; // 1=catalog, 2=pages, 3=font
    pages.forEach(() => {
      pageObjNums.push(nextObjNum++);
      contentObjNums.push(nextObjNum++);
    });

    const catalogNum = 1, pagesNum = 2, fontNum = 3;
    objects[catalogNum] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
    objects[pagesNum] = `<< /Type /Pages /Kids [${pageObjNums.map(n => n + ' 0 R').join(' ')}] /Count ${pages.length} >>`;
    objects[fontNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

    pages.forEach((pageRows, idx) => {
      const content = buildPageContent(pageRows, idx + 1, pages.length);
      objects[pageObjNums[idx]] = `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentObjNums[idx]} 0 R >>`;
      objects[contentObjNums[idx]] = { stream: content };
    });

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    const totalObjNum = nextObjNum - 1;

    for (let n = 1; n <= totalObjNum; n++) {
      offsets[n] = pdf.length;
      const obj = objects[n];
      if (obj === undefined) continue;
      if (typeof obj === 'string') {
        pdf += `${n} 0 obj\n${obj}\nendobj\n`;
      } else {
        pdf += `${n} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
      }
    }

    const xrefStart = pdf.length;
    pdf += `xref\n0 ${totalObjNum + 1}\n0000000000 65535 f \n`;
    for (let n = 1; n <= totalObjNum; n++) {
      pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${totalObjNum + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
    return bytes;
  }

  async function exportPayrollPdf() {
    const range = getPayrollRangeInputs();
    if (!range) return;
    const summary = computePayrollSummary(loadRecords(), range.start, range.end, otSettings.weeklyThreshold);
    if (!summary.length) {
      showStatus('exportStatus', 'No completed shifts found in that pay period.', 'error');
      return;
    }
    const headers = ['Employee Name', 'Regular Hours', 'Overtime Hours', 'Total Hours'];
    const rows = summary.map(s => [s.name, s.regular.toFixed(2), s.overtime.toFixed(2), s.total.toFixed(2)]);
    const title = `Payroll Summary: ${range.startVal} to ${range.endVal}`;
    const pdfBytes = buildPdfBytes(title, headers, rows);
    const filename = `Payroll_${range.startVal}_to_${range.endVal}.pdf`;
    const result = await writeOutputFile(pdfBytes, filename, 'application/pdf');
    showStatus('exportStatus', result.saved ? `Saved ${filename} to your chosen folder.` : `Downloaded ${filename}`, 'success');
  }

  function todayKey(date) {
    return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  }

  function checkAutoSaveTime() {
    const now = new Date();
    if (now.getHours() === AUTOSAVE_HOUR && now.getMinutes() === AUTOSAVE_MINUTE) {
      const key = todayKey(now);
      const lastSaved = localStorage.getItem('lastAutoSaveDate');
      if (lastSaved !== key) {
        localStorage.setItem('lastAutoSaveDate', key);
        exportToXlsx(true);
      }
    }
  }

  restoreSaveFolder();
  setInterval(checkAutoSaveTime, 20000); // check every 20 seconds

(function (global) {
  const DB_NAME = 'qi-shared-tracker-folders';
  const STORE_NAME = 'handles';
  const POLL_INTERVAL_MS = 3000;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function getSavedHandle(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveHandle(key, handle) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(handle, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function serialize(value) {
    return JSON.stringify(value);
  }

  global.createSharedJsonSync = function (options) {
    const button = document.getElementById(options.buttonId);
    const status = document.getElementById(options.statusId);
    const migrationKey = `shared_json_migrated_${options.appKey}`;
    const baselineKey = `shared_json_baseline_${options.appKey}`;
    let directoryHandle = null;
    let connected = false;
    let busy = false;
    let pollTimer = null;
    let lastLocalText = '';
    let lastRemoteText = '';

    function setStatus(message, isError) {
      if (!status) return;
      status.textContent = message;
      status.classList.toggle('sync-error', !!isError);
    }

    function localData() {
      return options.getData();
    }

    async function ensurePermission(handle, request) {
      const permission = { mode: 'readwrite' };
      if (await handle.queryPermission(permission) === 'granted') return true;
      return request && await handle.requestPermission(permission) === 'granted';
    }

    async function readRemoteData() {
      const fileHandle = await directoryHandle.getFileHandle(options.fileName, { create: true });
      const file = await fileHandle.getFile();
      const text = await file.text();
      if (!text.trim()) return { text: '', data: null };
      const record = JSON.parse(text);
      if (record.version !== 1 || !record.data || !options.isValid(record.data)) {
        throw new Error(`${options.fileName} has an unsupported format.`);
      }
      return { text, data: record.data };
    }

    async function writeRemoteData(data) {
      const fileHandle = await directoryHandle.getFileHandle(options.fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data }, null, 2));
      await writable.close();
    }

    function updateConnectedStatus() {
      setStatus(`Connected to Google Drive folder "${directoryHandle.name}". Updates sync while this page is open.`, false);
      if (button) button.textContent = 'Reconnect Shared Folder';
    }

    function saveBaseline(local, remoteText) {
      lastLocalText = serialize(local);
      lastRemoteText = remoteText;
      localStorage.setItem(migrationKey, 'true');
      localStorage.setItem(baselineKey, lastLocalText);
    }

    async function connect(handle, requestPermission) {
      directoryHandle = handle;
      if (!await ensurePermission(handle, requestPermission)) {
        connected = false;
        setStatus('Read/write folder permission is required. Reconnect and allow access.', true);
        return;
      }

      const remote = await readRemoteData();
      const local = localData();
      const migrated = localStorage.getItem(migrationKey) === 'true';
      const baseline = localStorage.getItem(baselineKey);
      const hasLocalData = !options.hasLocalData || options.hasLocalData(local);
      const localChanged = migrated ? baseline === null || serialize(local) !== baseline : hasLocalData;
      const data = remote.data
        ? localChanged ? options.mergeData(remote.data, local) : remote.data
        : local;

      await options.setData(data);
      await writeRemoteData(data);
      saveBaseline(localData(), serialize(data));
      connected = true;
      clearInterval(pollTimer);
      pollTimer = setInterval(syncOnce, POLL_INTERVAL_MS);
      updateConnectedStatus();
    }

    async function syncOnce() {
      if (!connected || busy) return;
      busy = true;
      try {
        if (!await ensurePermission(directoryHandle, false)) {
          connected = false;
          clearInterval(pollTimer);
          setStatus('Google Drive permission expired. Reconnect the shared folder.', true);
          return;
        }

        const remote = await readRemoteData();
        const local = localData();
        const localText = serialize(local);
        const remoteText = remote.data ? serialize(remote.data) : '';
        const localChanged = localText !== lastLocalText;
        const remoteChanged = remoteText !== lastRemoteText;
        if (!localChanged && !remoteChanged) return;

        if (remote.data && remoteChanged && !localChanged) {
          await options.setData(remote.data);
          saveBaseline(localData(), remoteText);
          setStatus('Updated from the shared Google Drive file.', false);
          return;
        }

        const merged = remote.data ? options.mergeData(remote.data, local) : local;
        await options.setData(merged);
        await writeRemoteData(merged);
        saveBaseline(localData(), serialize(merged));
        updateConnectedStatus();
      } catch (error) {
        setStatus(error.message || 'Shared-file sync failed. Check folder access and try again.', true);
      } finally {
        busy = false;
      }
    }

    async function chooseFolder() {
      if (!('showDirectoryPicker' in global)) {
        setStatus('Use Chrome or Edge to connect a Google Drive for desktop folder.', true);
        return;
      }
      try {
        const handle = await global.showDirectoryPicker({ id: `qi-shared-${options.appKey}`, mode: 'readwrite' });
        await saveHandle(options.appKey, handle);
        await connect(handle, true);
      } catch (error) {
        if (error.name !== 'AbortError') setStatus(error.message || 'Could not connect the Google Drive folder.', true);
      }
    }

    async function start() {
      try {
        const handle = await getSavedHandle(options.appKey);
        if (!handle) return;
        directoryHandle = handle;
        if (await ensurePermission(handle, false)) await connect(handle, false);
        else setStatus('Previously selected Google Drive folder needs permission. Reconnect it to continue.', false);
      } catch (error) {
        setStatus(error.message || 'Could not restore the shared folder.', true);
      }
    }

    function disconnect() {
      connected = false;
      clearInterval(pollTimer);
      pollTimer = null;
    }

    if (button) button.addEventListener('click', chooseFolder);
    global.addEventListener('beforeunload', disconnect);

    return { start, connect: chooseFolder, connectHandle: handle => connect(handle, true), disconnect, sync: syncOnce, isConnected: () => connected };
  };
})(window);

const HOUSEKEEPER_OPTIONS_KEY = 'housekeeping_dropdown_values_v1';
const DEFAULT_HOUSEKEEPER_OPTIONS = ['1', '2', '3', '4', '5', '6', '7'];

function loadHousekeeperOptions() {
  try {
    const saved = JSON.parse(localStorage.getItem(HOUSEKEEPER_OPTIONS_KEY) || 'null');
    if (Array.isArray(saved)) {
      const options = [...new Set(saved.map(value => String(value).trim()).filter(Boolean))];
      if (options.length) return options;
    }
  } catch (error) {}
  return DEFAULT_HOUSEKEEPER_OPTIONS.slice();
}

function storeHousekeeperOptions(options) {
  const values = [...new Set(options.map(value => String(value).trim()).filter(Boolean))];
  localStorage.setItem(HOUSEKEEPER_OPTIONS_KEY, JSON.stringify(values));
  return values;
}

function mergeHousekeepingSyncData(remote, local) {
  const dates = new Set([...Object.keys(remote.log || {}), ...Object.keys(local.log || {})]);
  const log = {};
  dates.forEach(date => {
    log[date] = Object.assign({}, remote.log && remote.log[date] || {}, local.log && local.log[date] || {});
  });
  return {
    rooms: Object.assign({}, remote.rooms || {}, local.rooms || {}),
    log,
    housekeepers: local.housekeepers || remote.housekeepers || DEFAULT_HOUSEKEEPER_OPTIONS.slice()
  };
}

function setHousekeepingSyncData(value) {
  localStorage.setItem('hk_log_v2', JSON.stringify(value.rooms || {}));
  localStorage.setItem('hk_saved_log_v1', JSON.stringify(value.log || {}));
  storeHousekeeperOptions(value.housekeepers || DEFAULT_HOUSEKEEPER_OPTIONS);
}

function renderHousekeeperListEditor(options) {
  const rows = document.getElementById('housekeeping-list-rows');
  if (!rows) return;
  rows.innerHTML = options.map((value, index) =>
    `<tr><td><input class="housekeeping-list-value" aria-label="Dropdown value ${index + 1}" value="${escapeHtml(value)}"></td><td><button type="button" data-action-click="removeHousekeeperListOption" data-action-args="${index}">Remove</button></td></tr>`
  ).join('');
}

function loginHousekeepingListEditor() {
  const username = document.getElementById('housekeeping-list-username').value.trim();
  const password = document.getElementById('housekeeping-list-password').value;
  const status = document.getElementById('housekeeping-list-login-status');
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    status.textContent = 'Username or password is incorrect.';
    return;
  }
  document.getElementById('housekeeping-list-login').hidden = true;
  document.getElementById('housekeeping-list-editor').hidden = false;
  document.getElementById('housekeeping-list-password').value = '';
  renderHousekeeperListEditor(loadHousekeeperOptions());
  if (window.housekeepingListSharedSync) window.housekeepingListSharedSync.start();
}

function currentHousekeeperListEditorValues() {
  return Array.from(document.querySelectorAll('.housekeeping-list-value'), input => input.value);
}

function addHousekeeperListOption() {
  renderHousekeeperListEditor(currentHousekeeperListEditorValues().concat(''));
  const inputs = document.querySelectorAll('.housekeeping-list-value');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeHousekeeperListOption(index) {
  const values = currentHousekeeperListEditorValues();
  values.splice(Number(index), 1);
  renderHousekeeperListEditor(values);
}

async function saveHousekeeperOptions() {
  const status = document.getElementById('housekeeping-list-status');
  try {
    const values = storeHousekeeperOptions(currentHousekeeperListEditorValues());
    renderHousekeeperListEditor(values);
    if (window.housekeepingListSharedSync && window.housekeepingListSharedSync.isConnected()) {
      await window.housekeepingListSharedSync.sync();
      status.textContent = 'Dropdown values saved and synced.';
    } else {
      status.textContent = 'Dropdown values saved in this browser. Connect the shared folder to sync across devices.';
    }
  } catch (error) {
    status.textContent = error.message;
  }
}

function logoutHousekeeperListEditor() {
  if (window.housekeepingListSharedSync) window.housekeepingListSharedSync.disconnect();
  document.getElementById('housekeeping-list-editor').hidden = true;
  document.getElementById('housekeeping-list-login').hidden = false;
  document.getElementById('housekeeping-list-username').value = '';
  document.getElementById('housekeeping-list-password').value = '';
  document.getElementById('housekeeping-list-login-status').textContent = '';
}

if (document.body.classList.contains('housekeeping-lists-page')) {
  window.housekeepingListSharedSync = createSharedJsonSync({
    appKey: 'housekeeping',
    fileName: 'Housekeeping_Tracker_Shared.json',
    buttonId: 'housekeeping-list-sync-connect',
    statusId: 'housekeeping-list-status',
    hasLocalData: value => Object.keys(value.rooms || {}).length > 0 || Object.keys(value.log || {}).length > 0 || JSON.stringify(value.housekeepers || DEFAULT_HOUSEKEEPER_OPTIONS) !== JSON.stringify(DEFAULT_HOUSEKEEPER_OPTIONS),
    getData: () => ({
      rooms: JSON.parse(localStorage.getItem('hk_log_v2') || '{}'),
      log: JSON.parse(localStorage.getItem('hk_saved_log_v1') || '{}'),
      housekeepers: loadHousekeeperOptions()
    }),
    isValid: value => value && typeof value.rooms === 'object' && typeof value.log === 'object' && (!value.housekeepers || Array.isArray(value.housekeepers)),
    mergeData: mergeHousekeepingSyncData,
    setData: value => {
      setHousekeepingSyncData(value);
      renderHousekeeperListEditor(loadHousekeeperOptions());
    }
  });
}

if (document.body.classList.contains('housekeeping-page')) {
(function () {
function rng(a,b){var r=[];for(var i=a;i<=b;i+=2)r.push(i);return r}
var SECTIONS=[
 ["Quality 1st Floor - Even",rng(100,126)],
 ["Quality 1st Floor - Odd",rng(101,127)],
 ["Quality 2nd Floor - Even",rng(200,226)],
 ["Quality 2nd Floor - Odd",rng(201,227)],
 ["Econo 1st Floor",rng(128,158)],
 ["Econo 2nd Floor",rng(228,252)]
];
var KEY="hk_log_v2", LKEY="hk_saved_log_v1", data={}, LOG={};
var HK=loadHousekeeperOptions();
window.addEventListener("storage",function(event){
  if(event.key!==HOUSEKEEPER_OPTIONS_KEY)return;
  HK=loadHousekeeperOptions();
  var app=document.getElementById("app");
  if(app&&!app.classList.contains("hide")){build();names();stats()}
});
function sel(v,n){var l=HK.indexOf(v)<0&&v?HK.concat([v]):HK;
  return '<select data-f="n" aria-label="Housekeeper for room '+n+'"><option value="">Select</option>'+l.map(function(x){return '<option value="'+esc(x)+'"'+(x==v?' selected':'')+'>'+esc(x)+'</option>'}).join("")+'</select>'}
function $(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function today(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2)}
function load(){try{data=JSON.parse(localStorage.getItem(KEY)||"{}")||{}}catch(e){data={}}
  try{LOG=JSON.parse(localStorage.getItem(LKEY)||"{}")||{}}catch(e){LOG={}}}
function saveLog(){try{localStorage.setItem(LKEY,JSON.stringify(LOG))}catch(e){}}
function msg(t){document.querySelectorAll(".smsg").forEach(function(s){s.textContent=t})}
function doSave(){
  var D=$("gd").value||today(),fresh=[],skip=0;
  Object.keys(data).forEach(function(n){var r=data[n];if(!r.n)return;if((LOG[D]||{})[n])skip++;else fresh.push(n)});
  if(!fresh.length&&!skip){msg("Nothing to save. Enter a housekeeper name for at least one room.");return}
  if(!confirm("Save "+fresh.length+" room(s) to the log? Saved entries are locked and cannot be changed."))return;
  var at=new Date().toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
  fresh.forEach(function(n){var r=data[n];(LOG[D]=LOG[D]||{})[n]={n:r.n,at:at}});
  saveLog();data={};save();build();names();stats();$("sd").value=D;sumRender();
  msg("Saved "+fresh.length+" room(s) for "+D+" at "+at+"."+(skip?" "+skip+" already locked for that date, so they were not changed.":"")+" See the Daily summary tab.");
  window.scrollTo(0,0);
}
document.addEventListener("click",function(e){if(e.target.closest("[data-save]"))doSave()});
function save(){try{localStorage.setItem(KEY,JSON.stringify(data))}catch(e){}}

$("lf").addEventListener("submit",function(e){
  e.preventDefault();
  if($("u").value.trim()==="hk"&&$("p").value==="hk"){
    try{sessionStorage.setItem("hk_in","1")}catch(x){}
    enter();
  }else $("err").textContent="Username or password is incorrect. Try again.";
});
function enter(){
  $("login").classList.add("hide");$("app").classList.remove("hide");
  load();$("sd").value=today();$("gd").value=today();build();names();stats();sumRender();
  if(window.housekeepingSharedSync)window.housekeepingSharedSync.start();
}
$("out").onclick=function(){
  if(window.housekeepingSharedSync)window.housekeepingSharedSync.disconnect();
  try{sessionStorage.removeItem("hk_in")}catch(e){}
  $("app").classList.add("hide");$("login").classList.remove("hide");$("p").value="";$("err").textContent="";
};
function tab(w){
  $("v-log").classList.toggle("hide",w!="log");$("v-sum").classList.toggle("hide",w!="sum");$("v-avg").classList.toggle("hide",w!="avg");
  $("t-log").setAttribute("aria-selected",w=="log");$("t-sum").setAttribute("aria-selected",w=="sum");$("t-avg").setAttribute("aria-selected",w=="avg");
  if(w=="sum")sumRender();if(w=="avg")avgRender();
}
$("t-log").onclick=function(){tab("log")};
$("t-sum").onclick=function(){tab("sum")};
$("t-avg").onclick=function(){tab("avg")};

var NOTE='';
function tfmt(m){var h=Math.floor(m/60),x=m%60,p=h>=12?'PM':'AM';h=h%12||12;return h+':'+('0'+x).slice(-2)+' '+p}
function dur(m){return Math.floor(m/60)+' h '+('0'+(m%60)).slice(-2)+' min'}
function attendance(d){
  return HK.map(function(h,i){var s=450+(i*7)%30,e=s+480+((i*11)%40);return {n:h,i:s,o:e}})}
function avgRender(){
  if(!$('avd').value)$('avd').value=today();
  var d=$('avd').value,day=LOG[d]||{},cnt={};
  Object.keys(day).forEach(function(n){var h=day[n].n;cnt[h]=(cnt[h]||0)+1});
  $('avgnote').textContent=NOTE+(Object.keys(day).length?'':' No rooms are saved for this date yet.');
  var T=0,R=0,html='';
  attendance(d).forEach(function(a){var m=a.o-a.i,c=cnt[a.n]||0;T+=m;R+=c;html+='<tr><td><b>'+esc(a.n)+'</b></td><td>'+tfmt(a.i)+'</td><td>'+tfmt(a.o)+'</td><td>'+dur(m)+'</td><td>'+c+'</td><td>'+(c?(m/c).toFixed(1)+' min':'\u2013')+'</td></tr>'});
  html+='<tr><td><b>All</b></td><td></td><td></td><td>'+dur(T)+'</td><td>'+R+'</td><td>'+(R?(T/R).toFixed(1)+' min':'\u2013')+'</td></tr>';
  $('ab').innerHTML=html;
}
$('avd').onchange=avgRender;

function build(){
  var h="";
  SECTIONS.forEach(function(s,si){
    h+='<section class="sec" data-si="'+si+'"><h3>'+s[0]+'<small id="c'+si+'"></small></h3><div class="wrap"><table><thead><tr><th>Room</th><th>Housekeeper</th><th></th></tr></thead><tbody>';
    s[1].forEach(function(n){
      var r=data[n]||{};
      h+='<tr data-r="'+n+'" class="'+(r.n?"done":"")+'"><td class="rm">'+n+'</td><td>'+sel(r.n||"",n)+'</td><td><button class="x" data-x="1" aria-label="Clear room '+n+'">Clear</button></td></tr>';
    });
    h+='</tbody></table></div></section>';
  });
  $("secs").innerHTML=h;
}
function names(){
  var seen={};Object.keys(data).forEach(function(n){if(data[n].n)seen[data[n].n]=1});
  Object.keys(LOG).forEach(function(d){Object.keys(LOG[d]).forEach(function(n){seen[LOG[d][n].n]=1})});
  $("names").innerHTML=Object.keys(seen).sort().map(function(x){return '<option value="'+esc(x)+'">'}).join("");
}
function stats(){
  var total=0,done=0;
  SECTIONS.forEach(function(s,si){
    var d=0;s[1].forEach(function(n){if(data[n]&&data[n].n)d++});
    total+=s[1].length;done+=d;$("c"+si).textContent=d+" / "+s[1].length+" logged";
  });
  $("prog").textContent=done+" of "+total+" rooms logged";
}
function rowOf(el){return el.closest("tr[data-r]")}
$("secs").addEventListener("input",function(e){
  var tr=rowOf(e.target);if(!tr)return;
  var n=tr.dataset.r,f=e.target.dataset.f,r=data[n]||(data[n]={n:""});
  if(f=="n"){r.n=e.target.value.trim();tr.classList.toggle("done",!!r.n);if(!r.n)delete data[n];}
  save();stats();
});
$("secs").addEventListener("change",function(e){if(e.target.dataset.f=="n")names();});
$("secs").addEventListener("click",function(e){
  var b=e.target.closest("[data-x]");if(!b)return;
  var tr=rowOf(b),n=tr.dataset.r;delete data[n];
  tr.querySelector('[data-f="n"]').value="";
  tr.classList.remove("done");save();stats();names();
});
$("clr").onclick=function(){
  if(!confirm("Clear every room's housekeeper and date?"))return;
  data={};save();build();names();stats();
};

function sumRender(){
  var d=$("sd").value||today(),by={};
  var day=LOG[d]||{};Object.keys(day).forEach(function(n){var r=day[n];(by[r.n]=by[r.n]||[]).push(+n)});
  var ks=Object.keys(by).sort();
  var tot=Object.keys(day).length;
  $("lk").textContent=tot?"Locked log: "+tot+" rooms saved for this date.":"";
  $("stb").innerHTML=ks.length?ks.map(function(k){
    return '<tr><td><b>'+esc(k)+'</b></td><td>'+by[k].length+'</td><td>'+by[k].sort(function(a,b){return a-b}).join(", ")+'</td></tr>';
  }).join(""):'<tr><td colspan="3" class="note">No saved log for this date. Enter rooms on the Room log tab and press Save to log.</td></tr>';
}
$("sd").onchange=sumRender;

window.housekeepingSharedSync=createSharedJsonSync({
  appKey:"housekeeping",
  fileName:"Housekeeping_Tracker_Shared.json",
  buttonId:"hk-sync-connect",
  statusId:"hk-sync-status",
  hasLocalData:function(value){return Object.keys(value.rooms||{}).length>0||Object.keys(value.log||{}).length>0||JSON.stringify(value.housekeepers||DEFAULT_HOUSEKEEPER_OPTIONS)!==JSON.stringify(DEFAULT_HOUSEKEEPER_OPTIONS)},
  getData:function(){return {rooms:data,log:LOG,housekeepers:HK}},
  isValid:function(value){return value&&typeof value.rooms==="object"&&typeof value.log==="object"&&(!value.housekeepers||Array.isArray(value.housekeepers))},
  mergeData:mergeHousekeepingSyncData,
  setData:function(value){
    data=value.rooms||{};LOG=value.log||{};HK=storeHousekeeperOptions(value.housekeepers||DEFAULT_HOUSEKEEPER_OPTIONS);
    try{localStorage.setItem(KEY,JSON.stringify(data));localStorage.setItem(LKEY,JSON.stringify(LOG))}catch(e){}
    build();names();stats();sumRender();avgRender();
  }
});

try{if(sessionStorage.getItem("hk_in")==="1")enter()}catch(e){}
})();
}

if (document.body.classList.contains('housekeeping-lists-page')) {
  function renderHousekeeperListEditor(options) {
    const rows = document.getElementById('housekeeping-list-rows');
    if (!rows) return;
    rows.innerHTML = options.map((value, index) =>
      `<tr><td><input class="housekeeping-list-value" aria-label="Dropdown value ${index + 1}" value="${escapeHtml(value)}"></td><td><button type="button" data-action-click="removeHousekeeperListOption" data-action-args="${index}">Remove</button></td></tr>`
    ).join('');
  }

  function loginHousekeepingListEditor() {
    const username = document.getElementById('housekeeping-list-username').value.trim();
    const password = document.getElementById('housekeeping-list-password').value;
    const status = document.getElementById('housekeeping-list-login-status');
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      status.textContent = 'Username or password is incorrect.';
      return;
    }
    document.getElementById('housekeeping-list-login').hidden = true;
    document.getElementById('housekeeping-list-editor').hidden = false;
    document.getElementById('housekeeping-list-password').value = '';
    renderHousekeeperListEditor(loadHousekeeperOptions());
    window.housekeepingListSharedSync.start();
  }

  function currentHousekeeperListEditorValues() {
    return Array.from(document.querySelectorAll('.housekeeping-list-value'), input => input.value);
  }

  function addHousekeeperListOption() {
    renderHousekeeperListEditor(currentHousekeeperListEditorValues().concat(''));
    const inputs = document.querySelectorAll('.housekeeping-list-value');
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function removeHousekeeperListOption(index) {
    const values = currentHousekeeperListEditorValues();
    values.splice(Number(index), 1);
    renderHousekeeperListEditor(values);
  }

  async function saveHousekeeperOptions() {
    const status = document.getElementById('housekeeping-list-status');
    try {
      const values = storeHousekeeperOptions(currentHousekeeperListEditorValues());
      renderHousekeeperListEditor(values);
      if (window.housekeepingListSharedSync.isConnected()) {
        await window.housekeepingListSharedSync.sync();
        status.textContent = 'Dropdown values saved and synced.';
      } else {
        status.textContent = 'Dropdown values saved in this browser. Connect the shared folder to sync across devices.';
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function logoutHousekeeperListEditor() {
    window.housekeepingListSharedSync.disconnect();
    document.getElementById('housekeeping-list-editor').hidden = true;
    document.getElementById('housekeeping-list-login').hidden = false;
    document.getElementById('housekeeping-list-username').value = '';
    document.getElementById('housekeeping-list-password').value = '';
    document.getElementById('housekeeping-list-login-status').textContent = '';
  }

  window.housekeepingListSharedSync = createSharedJsonSync({
    appKey: 'housekeeping',
    fileName: 'Housekeeping_Tracker_Shared.json',
    buttonId: 'housekeeping-list-sync-connect',
    statusId: 'housekeeping-list-status',
    hasLocalData: value => Object.keys(value.rooms || {}).length > 0 || Object.keys(value.log || {}).length > 0 || JSON.stringify(value.housekeepers || DEFAULT_HOUSEKEEPER_OPTIONS) !== JSON.stringify(DEFAULT_HOUSEKEEPER_OPTIONS),
    getData: () => ({
      rooms: JSON.parse(localStorage.getItem('hk_log_v2') || '{}'),
      log: JSON.parse(localStorage.getItem('hk_saved_log_v1') || '{}'),
      housekeepers: loadHousekeeperOptions()
    }),
    isValid: value => value && typeof value.rooms === 'object' && typeof value.log === 'object' && (!value.housekeepers || Array.isArray(value.housekeepers)),
    mergeData: mergeHousekeepingSyncData,
    setData: value => {
      setHousekeepingSyncData(value);
      renderHousekeeperListEditor(loadHousekeeperOptions());
    }
  });
  Object.assign(window, { loginHousekeepingListEditor, addHousekeeperListOption, removeHousekeeperListOption, saveHousekeeperOptions, logoutHousekeeperListEditor });
}

if (document.body.classList.contains('cash-inventory-page')) {
(function () {
const denominations=[["$100 bills",100],["$50 bills",50],["$20 bills",20],["$10 bills",10],["$5 bills",5],["$1 bills",1],["Quarters",.25],["Dimes",.10],["Nickels",.05]];
const defaults=[0,0,4,0,16,33,16,20,20];
const key='cashInventoryWebsiteV1';
let state=load();
function load(){try{let s=JSON.parse(localStorage.getItem(key));if(s){delete s.safeGeneral;s.log=(s.log||[]).filter(l=>!`${l.action||''} ${l.detail||''}`.toLowerCase().includes('general fund')).map(l=>({...l,action:String(l.action||'').replace(/safe \(paid-out fund\)/gi,'Safe'),detail:String(l.detail||'').replace(/safe \(paid-out fund\)/gi,'Safe')}));localStorage.setItem(key,JSON.stringify(s));return s}}catch(e){}return {drawer:{standard:defaults.slice(),actual:Array(9).fill('')},safe:{standard:defaults.slice(),actual:Array(9).fill('')},movements:[],log:[]}}
function persist(){localStorage.setItem(key,JSON.stringify(state));render()}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n)||0)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function titleCase(value){return String(value).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase())}
function formatPageText(){let walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode(node){return node.parentElement?.closest('script,style')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT}});while(walker.nextNode())walker.currentNode.nodeValue=titleCase(walker.currentNode.nodeValue);document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(el=>['placeholder','aria-label','title'].forEach(attr=>{if(el.hasAttribute(attr))el.setAttribute(attr,titleCase(el.getAttribute(attr)))}))}
function sum(arr){return arr.reduce((a,v,i)=>a+(Number(v)||0)*denominations[i][1],0)}
function log(action,detail){state.log.unshift({time:new Date().toISOString(),action,detail})}
function makeRows(which){return denominations.map((d,i)=>`<tr><td>${d[0]}</td><td class="num">${money(d[1])}</td><td class="num"><input class="entry" aria-label="${which} ${d[0]} standard count" type="number" min="0" step="1" value="${esc(state[which].standard[i])}" onchange="editCount('${which}','standard',${i},this.value)"></td><td class="num money">${money((Number(state[which].standard[i])||0)*d[1])}</td><td class="num"><input class="entry" aria-label="${which} ${d[0]} actual count" type="number" min="0" step="1" placeholder="-" value="${esc(state[which].actual[i])}" onchange="editCount('${which}','actual',${i},this.value)"></td><td class="num money">${state[which].actual[i]===''?'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â':money((Number(state[which].actual[i])||0)*d[1])}</td></tr>`).join('')+`<tr class="otherrow"><td>Other denominations</td><td colspan="5"><input class="fieldInput" class="other-denominations-input" placeholder="Optional notes (such as $2 coins, rolled coins)" value="${esc(state[which].other||'')}" onchange="editOther('${which}',this.value)"></td></tr>`}
function editCount(which,type,i,val){state[which][type][i]=val===''?'':Math.max(0,Number(val)||0);log('Count edited',`${which==='drawer'?'Cash drawer':'Safe'} Ãƒâ€šÃ‚Â· ${type==='standard'?'standard':'actual'} count Ãƒâ€šÃ‚Â· ${denominations[i][0]} = ${val===''?'blank':val}`);persist()}
function editOther(which,val){state[which].other=val;log('Notes edited',`${which==='drawer'?'Cash drawer':'Safe'} Ãƒâ€šÃ‚Â· other denominations notes updated`);persist()}
function saveCounts(which){log('Inventory saved',`${which==='drawer'?'Cash drawer':'Safe'} saved. Actual total: ${money(sum(state[which].actual))}. Standard total: ${money(sum(state[which].standard))}.`);localStorage.setItem(key,JSON.stringify(state));render();alert(titleCase('Counts saved and change logged.'))}
function resetActual(which){if(!confirm(titleCase('Clear all actual counts for '+(which==='drawer'?'the cash drawer':'the safe')+'?')))return;state[which].actual=Array(9).fill('');log('Actual counts cleared',which==='drawer'?'Cash drawer actual counts cleared':'Safe actual counts cleared');persist()}
function render(){['drawer','safe'].forEach(w=>{document.getElementById(w+'Rows').innerHTML=makeRows(w);document.getElementById(w+'Standard').textContent=money(sum(state[w].standard));document.getElementById(w+'Actual').textContent=money(sum(state[w].actual))});document.getElementById('drawerStat').textContent=money(sum(state.drawer.actual));document.getElementById('safeStat').textContent=money(sum(state.safe.actual));document.getElementById('logStat').textContent=state.log.length;
document.getElementById('movementRows').innerHTML=state.movements.length?state.movements.map(m=>`<tr><td>${esc(m.date)}</td><td>${esc(m.reason)}</td><td>${esc(m.by||'ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â')}</td><td><span class="tag">${esc(m.type)}</span></td>${denominations.map((d,i)=>`<td class="num">${Number(m.counts?.[i])||0}</td>`).join('')}<td class="num money">${money(m.total)}</td></tr>`).join(''):'<tr><td colspan="14" class="empty">No cash movements recorded yet.</td></tr>';
document.getElementById('logEntries').innerHTML=state.log.length?state.log.map(l=>`<div class="log-item"><div class="log-top"><strong>${esc(l.action)}</strong><span class="log-time">${new Date(l.time).toLocaleString()}</span></div><div>${esc(l.detail)}</div></div>`).join(''):'<div class="empty">No changes logged yet. Saved edits will appear here.</div>';formatPageText()}
function initMoveInputs(){document.getElementById('moveInputs').innerHTML=denominations.map((d,i)=>`<div class="field"><label for="mv${i}">${d[0]} (${money(d[1])})</label><input id="mv${i}" type="number" min="0" step="1" value="0"></div>`).join('');document.getElementById('moveDate').value=new Date().toISOString().slice(0,10)}
function saveMovement(){let reason=document.getElementById('moveReason').value.trim();if(!reason){alert(titleCase('Please enter a reason for this movement.'));return}let counts=denominations.map((d,i)=>Number(document.getElementById('mv'+i).value)||0);let total=sum(counts);if(!counts.some(n=>n>0)){alert(titleCase('Enter at least one denomination count.'));return}let m={date:document.getElementById('moveDate').value||new Date().toISOString().slice(0,10),reason,by:document.getElementById('moveBy').value.trim(),type:document.getElementById('moveType').value,counts,total:(document.getElementById('moveType').value==='Withdrawal'?-1:1)*total};state.movements.unshift(m);log('Cash movement recorded',`${m.type}: ${money(Math.abs(m.total))} Ãƒâ€šÃ‚Â· ${m.reason} Ãƒâ€šÃ‚Â· ${m.date} Ãƒâ€šÃ‚Â· handled by ${m.by||'not specified'}`);persist();clearMovement();alert(titleCase('Movement saved and change logged.'))}
function clearMovement(){document.getElementById('moveReason').value='';document.getElementById('moveBy').value='';document.querySelectorAll('#moveInputs input').forEach(x=>x.value=0)}
async function exportLog(){if(!state.log.length){alert(titleCase('There are no changes to export yet.'));return}try{if(!window.XLSX){await new Promise((resolve,reject)=>{let s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})}let rows=[['Timestamp','Action','Details'],...state.log.map(l=>[new Date(l.time),l.action,l.detail])];let ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=[{wch:25},{wch:28},{wch:90}];let wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Change Log');XLSX.writeFile(wb,'cash-inventory-change-log.xlsx')}catch(e){alert(titleCase('Could not load the XLSX export library. Please check your internet connection and try again.'))}}
function download(content,name,type){let a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href)}
document.querySelectorAll('.tabs button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b));['inventory','movement','history'].forEach(id=>document.getElementById(id).classList.toggle('hidden',id!==b.dataset.tab))}));
initMoveInputs();render();
function cashHasLocalData(value){
	return (value.log||[]).length>0||(value.movements||[]).length>0||['drawer','safe'].some(which=>{
		let counts=value[which];
		return counts&&(counts.other||JSON.stringify(counts.standard)!==JSON.stringify(defaults)||counts.actual.some(item=>item!==''&&Number(item)!==0));
  });
}
function mergeCashEntries(remote,local){
  let entries=new Map();
  [...(remote||[]),...(local||[])].forEach(item=>{
    let id=item.id||JSON.stringify(item);
    if(!entries.has(id))entries.set(id,item);
  });
  return [...entries.values()].sort((a,b)=>String(b.time||'').localeCompare(String(a.time||'')));
}
window.cashInventorySharedSync=createSharedJsonSync({
	appKey:'cash-inventory',
	fileName:'Cash_Inventory_Shared.json',
	buttonId:'cash-sync-connect',
	statusId:'cash-sync-status',
	getData:()=>state,
	hasLocalData:cashHasLocalData,
	isValid:value=>value&&value.drawer&&value.safe&&Array.isArray(value.movements)&&Array.isArray(value.log),
	mergeData:(remote,local)=>({
		...remote,
		...local,
		drawer:local.drawer||remote.drawer,
		safe:local.safe||remote.safe,
		movements:mergeCashEntries(remote.movements,local.movements),
		log:mergeCashEntries(remote.log,local.log)
	}),
	setData:value=>{state=value;localStorage.setItem(key,JSON.stringify(state));render()}
});
window.cashInventorySharedSync.start();
Object.assign(window,{editCount,editOther,saveCounts,resetActual,saveMovement,clearMovement,exportLog});
})();
}
