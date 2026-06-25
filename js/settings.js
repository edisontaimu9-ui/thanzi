/**
 * settings.js — Thanzi Settings Panel
 *
 * Settings persisted in localStorage under 'thanzi_settings' (a JSON object).
 * Settings that affect live state (theme, units, water goal, calorie goal)
 * fire events / call into the appropriate module after saving.
 *
 * Keys stored:
 *   theme             'dark' | 'light'          (mirrors THEME_KEY in app.js)
 *   units             'metric' | 'imperial'
 *   waterGoal         number  (ml)
 *   calorieGoalOffset number  (kcal, added to plan-derived goal; default 0)
 *   aiResponses       boolean (enable / disable Thandizo AI)
 *   mealReminders     boolean
 *   waterReminders    boolean
 *
 * Panel element: #settings-panel
 */
const ThanziSettings = (() => {
  'use strict';

  const SETTINGS_KEY = 'thanzi_settings';

  const DEFAULTS = {
    theme:            'dark',
    units:            'metric',
    waterGoal:        2000,      // ml
    calorieGoalOffset: 0,        // kcal adjustment on top of plan
    aiResponses:      true,
    mealReminders:    false,
    waterReminders:   false,
  };

  let _cfg = { ...DEFAULTS };

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
    } catch (e) { /* ignore quota errors */ }
  }

  // ── Public getter (for other modules) ────────────────────────────────────

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
    _toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  // ── Water goal stepper ────────────────────────────────────────────────────

  function _updateWaterDisplay() {
    const el = document.getElementById('st-water-val');
    if (el) el.textContent = _cfg.waterGoal + ' ml';
  }

  function _stepWater(delta) {
    _cfg.waterGoal = Math.max(500, Math.min(5000, _cfg.waterGoal + delta));
    _updateWaterDisplay();
    _save();
    // Live-update dashboard water goal
    if (typeof ThanziApp !== 'undefined' && ThanziApp.setWaterGoal) {
      ThanziApp.setWaterGoal(_cfg.waterGoal);
    }
  }

  // ── Calorie offset stepper ────────────────────────────────────────────────

  function _updateCalDisplay() {
    const el = document.getElementById('st-cal-val');
    if (!el) return;
    const v = _cfg.calorieGoalOffset;
    el.textContent = (v >= 0 ? '+' : '') + v + ' kcal';
  }

  function _stepCal(delta) {
    _cfg.calorieGoalOffset = Math.max(-500, Math.min(500, _cfg.calorieGoalOffset + delta));
    _updateCalDisplay();
    _save();
  }

  // ── Toggle handler ────────────────────────────────────────────────────────

  function _onToggle(key, checked, label) {
    _cfg[key] = checked;
    _save();
    if (key === 'aiResponses') {
      _toast(checked ? 'Thandizo AI enabled' : 'Thandizo AI disabled');
    } else {
      _toast(label + (checked ? ' on' : ' off'));
    }
  }

  // ── Theme select ──────────────────────────────────────────────────────────

  function _onThemeChange(value) {
    _cfg.theme = value;
    _save();
    // Delegate to app.js theme system
    document.documentElement.setAttribute('data-theme', value);
    try { localStorage.setItem('thanzi_theme', value); } catch (e) { /* ignore */ }
    // Update the floating theme button icon
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = value === 'light' ? '🌙' : '☀️';
    _toast('Theme: ' + value.charAt(0).toUpperCase() + value.slice(1));
  }

  // ── Unit select ───────────────────────────────────────────────────────────

  function _onUnitChange(value) {
    _cfg.units = value;
    _save();
    _toast('Units: ' + (value === 'metric' ? 'Metric (kg / cm)' : 'Imperial (lb / ft)'));
  }

  // ── Clear data ────────────────────────────────────────────────────────────

  function _clearTodayLogs() {
    if (!confirm('Clear all food and water logs for today?')) return;
    const dateKey = new Date().toISOString().split('T')[0];
    // Remove keys that match today's log pattern
    Object.keys(localStorage).forEach(k => {
      if (k.includes('log_' + dateKey) || k.includes('thanzi_water_' + dateKey)) {
        localStorage.removeItem(k);
      }
    });
    // Reload dashboard state
    if (typeof ThanziApp !== 'undefined' && ThanziApp.refresh) ThanziApp.refresh();
    _toast('Today\'s logs cleared');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function _render() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    const c = _cfg;

    panel.innerHTML = `
      <div class="st-header">
        <div class="st-title">Settings</div>
        <div class="st-subtitle">Customise Thanzi to fit your lifestyle</div>
      </div>

      <!-- APPEARANCE -->
      <div class="st-section">
        <div class="st-section-label">Appearance</div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">🎨</span>
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
      </div>

      <!-- MEASUREMENTS -->
      <div class="st-section">
        <div class="st-section-label">Measurements</div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">📐</span>
            <div class="st-row-info">
              <div class="st-row-name">Units</div>
              <div class="st-row-desc">Weight &amp; height units</div>
            </div>
          </div>
          <select class="st-select" id="st-units-select">
            <option value="metric"   ${c.units === 'metric'   ? 'selected' : ''}>Metric</option>
            <option value="imperial" ${c.units === 'imperial' ? 'selected' : ''}>Imperial</option>
          </select>
        </div>
      </div>

      <!-- DAILY GOALS -->
      <div class="st-section">
        <div class="st-section-label">Daily Goals</div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">💧</span>
            <div class="st-row-info">
              <div class="st-row-name">Water Goal</div>
              <div class="st-row-desc">Daily fluid target</div>
            </div>
          </div>
          <div class="st-number-wrap">
            <button class="st-num-btn" id="st-water-minus" aria-label="Decrease water goal">−</button>
            <span class="st-num-val" id="st-water-val">${c.waterGoal} ml</span>
            <button class="st-num-btn" id="st-water-plus"  aria-label="Increase water goal">+</button>
          </div>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">🔥</span>
            <div class="st-row-info">
              <div class="st-row-name">Calorie Adjustment</div>
              <div class="st-row-desc">Fine-tune your plan target</div>
            </div>
          </div>
          <div class="st-number-wrap">
            <button class="st-num-btn" id="st-cal-minus" aria-label="Decrease calorie adjustment">−</button>
            <span class="st-num-val" id="st-cal-val">${(c.calorieGoalOffset >= 0 ? '+' : '') + c.calorieGoalOffset} kcal</span>
            <button class="st-num-btn" id="st-cal-plus"  aria-label="Increase calorie adjustment">+</button>
          </div>
        </div>
      </div>

      <!-- AI ASSISTANT -->
      <div class="st-section">
        <div class="st-section-label">AI Assistant</div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">🌿</span>
            <div class="st-row-info">
              <div class="st-row-name">Thandizo AI</div>
              <div class="st-row-desc">Enable AI nutrition responses</div>
            </div>
          </div>
          <label class="st-toggle" aria-label="Toggle Thandizo AI">
            <input type="checkbox" id="st-ai-toggle" ${c.aiResponses ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>
      </div>

      <!-- NOTIFICATIONS -->
      <div class="st-section">
        <div class="st-section-label">Reminders</div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">🍽️</span>
            <div class="st-row-info">
              <div class="st-row-name">Meal Reminders</div>
              <div class="st-row-desc">Nudge to log breakfast, lunch &amp; dinner</div>
            </div>
          </div>
          <label class="st-toggle" aria-label="Toggle meal reminders">
            <input type="checkbox" id="st-meal-remind" ${c.mealReminders ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">💦</span>
            <div class="st-row-info">
              <div class="st-row-name">Water Reminders</div>
              <div class="st-row-desc">Hourly hydration nudges</div>
            </div>
          </div>
          <label class="st-toggle" aria-label="Toggle water reminders">
            <input type="checkbox" id="st-water-remind" ${c.waterReminders ? 'checked' : ''}>
            <span class="st-toggle-track"></span>
          </label>
        </div>
      </div>

      <!-- DATA -->
      <div class="st-section">
        <div class="st-section-label">Data</div>

        <div class="st-row">
          <div class="st-row-left">
            <span class="st-row-icon">📊</span>
            <div class="st-row-info">
              <div class="st-row-name">Export Logs</div>
              <div class="st-row-desc">Download food diary as CSV</div>
            </div>
          </div>
          <button class="st-select" id="st-export-btn" style="cursor:pointer">Export</button>
        </div>
      </div>

      <!-- DANGER -->
      <div class="st-section">
        <div class="st-section-label">Danger Zone</div>
        <button class="st-danger-btn" id="st-clear-today-btn">
          <span>🗑️</span>
          <span>Clear Today's Logs</span>
        </button>
      </div>

      <div class="st-version">Thanzi — Know what you eat &nbsp;·&nbsp; v0.1.0</div>
    `;

    _bindEvents();
  }

  // ── Export logs as CSV ────────────────────────────────────────────────────

  function _exportCSV() {
    const rows = [['Date', 'Meal', 'Food', 'Quantity (g)', 'Calories (kcal)', 'Carbs (g)', 'Protein (g)', 'Fat (g)']];

    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith('thanzi_food_log_')) return;
      try {
        const logs = JSON.parse(localStorage.getItem(key)) || [];
        const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})$/);
        const date = dateMatch ? dateMatch[1] : key;
        logs.forEach(entry => {
          rows.push([
            date,
            entry.meal || '',
            entry.name || '',
            entry.quantity || '',
            entry.calories || '',
            entry.carbs || '',
            entry.protein || '',
            entry.fat || '',
          ]);
        });
      } catch (e) { /* skip malformed entries */ }
    });

    if (rows.length <= 1) { _toast('No logs to export yet'); return; }

    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'thanzi-logs.csv';
    a.click();
    URL.revokeObjectURL(url);
    _toast('Exported!');
  }

  // ── Bind events ───────────────────────────────────────────────────────────

  function _bindEvents() {
    // Theme
    document.getElementById('st-theme-select')
      .addEventListener('change', e => _onThemeChange(e.target.value));

    // Units
    document.getElementById('st-units-select')
      .addEventListener('change', e => _onUnitChange(e.target.value));

    // Water goal steppers (250 ml steps)
    document.getElementById('st-water-minus')
      .addEventListener('click', () => _stepWater(-250));
    document.getElementById('st-water-plus')
      .addEventListener('click', () => _stepWater(250));

    // Calorie offset steppers (50 kcal steps)
    document.getElementById('st-cal-minus')
      .addEventListener('click', () => _stepCal(-50));
    document.getElementById('st-cal-plus')
      .addEventListener('click', () => _stepCal(50));

    // Toggles
    document.getElementById('st-ai-toggle')
      .addEventListener('change', e => _onToggle('aiResponses', e.target.checked, 'Thandizo AI'));
    document.getElementById('st-meal-remind')
      .addEventListener('change', e => _onToggle('mealReminders', e.target.checked, 'Meal reminders'));
    document.getElementById('st-water-remind')
      .addEventListener('change', e => _onToggle('waterReminders', e.target.checked, 'Water reminders'));

    // Export
    document.getElementById('st-export-btn')
      .addEventListener('click', _exportCSV);

    // Clear today
    document.getElementById('st-clear-today-btn')
      .addEventListener('click', _clearTodayLogs);
  }

  // ── Refresh (called by drawer.js route) ──────────────────────────────────

  function refresh() {
    _load();
    _render();
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    _load();
  }

  return { init, refresh, get };
})();

document.addEventListener('DOMContentLoaded', ThanziSettings.init);
