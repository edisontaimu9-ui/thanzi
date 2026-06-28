/**
 * settings.js — Thanzi Settings Panel
 *
 * Persisted under 'thanzi_settings' in localStorage.
 * Panel element: #settings-panel
 */
const ThanziSettings = (() => {
  'use strict';

  const SETTINGS_KEY = 'thanzi_settings';

  const DEFAULTS = {
    theme:             'dark',
    units:             'metric',
    waterGoal:         2000,
    calorieGoalOffset: 0,
    aiResponses:       true,
    mealReminders:     false,
    waterReminders:    false,
    weeklyReport:      false,
  };

  let _cfg  = { ...DEFAULTS };
  let _user = null;

  // ── Persistence ───────────────────────────────────────────────────────────

  function _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) _cfg = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { /* use defaults */ }
  }

  function _save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(_cfg));
    } catch (e) { /* ignore */ }
  }

  function get(key) {
    return _cfg[key] !== undefined ? _cfg[key] : DEFAULTS[key];
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  let _toastTimer = null;

  function _toast(msg) {
    const el = document.getElementById('st-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  function _onThemeChange(value) {
    _cfg.theme = value;
    _save();
    document.documentElement.setAttribute('data-theme', value);
    try { localStorage.setItem('thanzi_theme', value); } catch (e) { /* ignore */ }
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = value === 'light' ? '🌙' : '☀️';
    _toast('Theme: ' + (value === 'light' ? 'Light' : 'Dark'));
  }

  function _onUnitChange(value) {
    _cfg.units = value;
    _save();
    _toast('Units: ' + (value === 'metric' ? 'Metric (kg / cm)' : 'Imperial (lb / ft)'));
  }

  function _onToggle(key, checked, onMsg, offMsg) {
    _cfg[key] = checked;
    _save();
    _toast(checked ? onMsg : offMsg);
  }

  function _stepWater(delta) {
    _cfg.waterGoal = Math.max(500, Math.min(5000, _cfg.waterGoal + delta));
    _save();
    const el = document.getElementById('st-water-val');
    if (el) el.textContent = _cfg.waterGoal + ' ml';
    if (typeof ThanziApp !== 'undefined' && ThanziApp.setWaterGoal) {
      ThanziApp.setWaterGoal(_cfg.waterGoal);
    }
  }

  function _stepCal(delta) {
    _cfg.calorieGoalOffset = Math.max(-500, Math.min(500, _cfg.calorieGoalOffset + delta));
    _save();
    const el = document.getElementById('st-cal-val');
    const v = _cfg.calorieGoalOffset;
    if (el) el.textContent = (v >= 0 ? '+' : '') + v + ' kcal';
  }

  function _exportCSV() {
    const rows = [['Date', 'Meal', 'Food', 'Qty (g)', 'kcal', 'Carbs (g)', 'Protein (g)', 'Fat (g)']];
    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith('thanzi_food_log_')) return;
      try {
        const logs = JSON.parse(localStorage.getItem(key)) || [];
        const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})$/);
        const date = dateMatch ? dateMatch[1] : key;
        logs.forEach(e => {
          rows.push([date, e.meal||'', e.name||'', e.quantity||'', e.calories||'', e.carbs||'', e.protein||'', e.fat||'']);
        });
      } catch (e) { /* skip */ }
    });
    if (rows.length <= 1) { _toast('No logs to export yet'); return; }
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'thanzi-food-log.csv'; a.click();
    URL.revokeObjectURL(url);
    _toast('Exported ✓');
  }

  function _clearTodayLogs() {
    if (!confirm('Clear all food and water logs for today? This cannot be undone.')) return;
    const today = new Date().toISOString().split('T')[0];
    Object.keys(localStorage).forEach(k => {
      if (k.includes('log_' + today) || k.includes('thanzi_water_' + today)) {
        localStorage.removeItem(k);
      }
    });
    if (typeof ThanziApp !== 'undefined' && ThanziApp.refresh) ThanziApp.refresh();
    _toast("Today's logs cleared");
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function _render() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    const c    = _cfg;
    const email = _user ? (_user.email || '—') : '—';
    const name  = _user ? (_user.name  || '—') : '—';

    panel.innerHTML = `

      <!-- Page header -->
      <div class="st-page-header">
        <div class="st-page-title">Settings</div>
        <div class="st-page-sub">Customise Thanzi to fit your lifestyle</div>
      </div>

      <!-- ── APPEARANCE ──────────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">🎨</div>
          <span class="st-card-title">Appearance</span>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">🌗</div>
            <div class="st-row-info">
              <div class="st-row-name">Theme</div>
              <div class="st-row-desc">App colour scheme</div>
            </div>
          </div>
          <select class="st-select" id="st-theme-select">
            <option value="dark"  ${c.theme === 'dark'  ? 'selected' : ''}>Dark</option>
            <option value="light" ${c.theme === 'light' ? 'selected' : ''}>Light</option>
          </select>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">📐</div>
            <div class="st-row-info">
              <div class="st-row-name">Unit System</div>
              <div class="st-row-desc">Weight &amp; height units</div>
            </div>
          </div>
          <select class="st-select" id="st-units-select">
            <option value="metric"   ${c.units === 'metric'   ? 'selected' : ''}>Metric</option>
            <option value="imperial" ${c.units === 'imperial' ? 'selected' : ''}>Imperial</option>
          </select>
        </div>
      </div>

      <!-- ── DAILY GOALS ─────────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">🎯</div>
          <span class="st-card-title">Daily Goals</span>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">💧</div>
            <div class="st-row-info">
              <div class="st-row-name">Water Goal</div>
              <div class="st-row-desc">Daily fluid target</div>
            </div>
          </div>
          <div class="st-stepper">
            <button class="st-step-btn" id="st-water-minus" aria-label="Decrease">−</button>
            <span class="st-step-val" id="st-water-val">${c.waterGoal} ml</span>
            <button class="st-step-btn" id="st-water-plus"  aria-label="Increase">+</button>
          </div>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">🔥</div>
            <div class="st-row-info">
              <div class="st-row-name">Calorie Adjustment</div>
              <div class="st-row-desc">Fine-tune your plan target</div>
            </div>
          </div>
          <div class="st-stepper">
            <button class="st-step-btn" id="st-cal-minus" aria-label="Decrease">−</button>
            <span class="st-step-val" id="st-cal-val">${(c.calorieGoalOffset >= 0 ? '+' : '') + c.calorieGoalOffset} kcal</span>
            <button class="st-step-btn" id="st-cal-plus"  aria-label="Increase">+</button>
          </div>
        </div>
      </div>

      <!-- ── AI ASSISTANT ────────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">🌿</div>
          <span class="st-card-title">AI Assistant</span>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">🤖</div>
            <div class="st-row-info">
              <div class="st-row-name">Thandizo AI</div>
              <div class="st-row-desc">AI-powered nutrition responses</div>
            </div>
          </div>
          <label class="st-toggle">
            <input type="checkbox" id="st-ai-toggle" ${c.aiResponses ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>
      </div>

      <!-- ── REMINDERS ───────────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">🔔</div>
          <span class="st-card-title">Reminders</span>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">🍽️</div>
            <div class="st-row-info">
              <div class="st-row-name">Meal Reminders</div>
              <div class="st-row-desc">Nudge to log meals on time</div>
            </div>
          </div>
          <label class="st-toggle">
            <input type="checkbox" id="st-meal-remind" ${c.mealReminders ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">💦</div>
            <div class="st-row-info">
              <div class="st-row-name">Water Reminders</div>
              <div class="st-row-desc">Hourly hydration nudges</div>
            </div>
          </div>
          <label class="st-toggle">
            <input type="checkbox" id="st-water-remind" ${c.waterReminders ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">📊</div>
            <div class="st-row-info">
              <div class="st-row-name">Weekly Report</div>
              <div class="st-row-desc">Receive a weekly nutrition summary</div>
            </div>
          </div>
          <label class="st-toggle">
            <input type="checkbox" id="st-weekly-report" ${c.weeklyReport ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>
      </div>

      <!-- ── ACCOUNT ─────────────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">🔐</div>
          <span class="st-card-title">Account &amp; Privacy</span>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">👤</div>
            <div class="st-row-info">
              <div class="st-row-name">Name</div>
            </div>
          </div>
          <span class="st-row-value">${name}</span>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">✉️</div>
            <div class="st-row-info">
              <div class="st-row-name">Email Address</div>
            </div>
          </div>
          <span class="st-row-value">${email}</span>
        </div>
      </div>

      <!-- ── DATA MANAGEMENT ─────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">📦</div>
          <span class="st-card-title">Data Management</span>
        </div>

        <button class="st-action-row" id="st-export-btn">
          <div class="st-row-icon">⬇️</div>
          <div class="st-row-info">
            <div class="st-row-name">Export Food Log</div>
            <div class="st-row-desc">Download your diary as CSV</div>
          </div>
          <span class="st-chevron">›</span>
        </button>

        <button class="st-danger-row" id="st-clear-today-btn">
          <div class="st-danger-icon">🗑️</div>
          <div class="st-row-info">
            <div class="st-danger-name">Clear Today's Logs</div>
            <div class="st-row-desc">Remove all food &amp; water entries for today</div>
          </div>
        </button>
      </div>

      <!-- Footer -->
      <div class="st-footer">
        <div class="st-footer-name">Thanzi</div>
        <div class="st-footer-ver">Know what you eat · v0.1.0</div>
      </div>
    `;

    _bindEvents();
  }

  // ── Bind events ───────────────────────────────────────────────────────────

  function _bindEvents() {
    document.getElementById('st-theme-select')
      .addEventListener('change', e => _onThemeChange(e.target.value));

    document.getElementById('st-units-select')
      .addEventListener('change', e => _onUnitChange(e.target.value));

    document.getElementById('st-water-minus')
      .addEventListener('click', () => _stepWater(-250));
    document.getElementById('st-water-plus')
      .addEventListener('click', () => _stepWater(250));

    document.getElementById('st-cal-minus')
      .addEventListener('click', () => _stepCal(-50));
    document.getElementById('st-cal-plus')
      .addEventListener('click', () => _stepCal(50));

    document.getElementById('st-ai-toggle')
      .addEventListener('change', e => _onToggle('aiResponses', e.target.checked, 'Thandizo AI on', 'Thandizo AI off'));

    document.getElementById('st-meal-remind')
      .addEventListener('change', e => _onToggle('mealReminders', e.target.checked, 'Meal reminders on', 'Meal reminders off'));

    document.getElementById('st-water-remind')
      .addEventListener('change', e => _onToggle('waterReminders', e.target.checked, 'Water reminders on', 'Water reminders off'));

    document.getElementById('st-weekly-report')
      .addEventListener('change', e => _onToggle('weeklyReport', e.target.checked, 'Weekly report on', 'Weekly report off'));

    document.getElementById('st-export-btn')
      .addEventListener('click', _exportCSV);

    document.getElementById('st-clear-today-btn')
      .addEventListener('click', _clearTodayLogs);
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  async function refresh() {
    _load();
    // Pull fresh user info each time the panel opens
    try {
      if (typeof ThanziAuth !== 'undefined') {
        _user = await ThanziAuth.getUser();
      }
    } catch (e) { _user = null; }
    _render();
  }

  function init() {
    _load();
  }

  return { init, refresh, get };
})();

document.addEventListener('DOMContentLoaded', ThanziSettings.init);
