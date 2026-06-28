/**
 * settings.js — Thanzi Settings Panel
 *
 * Persisted under 'thanzi_settings' in localStorage.
 * Panel element: #settings-panel
 */
const ThanziSettings = (() => {
  'use strict';

  const SETTINGS_KEY     = 'thanzi_settings';
  const CUSTOM_WP_KEY    = 'thanzi_custom_wallpapers'; // { dark: dataURL|null, light: dataURL|null }

  // ── Thanzi built-in wallpaper catalogue ───────────────────────────────────
  // Files live at  wallpapers/dark_mode/  and  wallpapers/light_mode/
  // relative to the app root.
  const WALLPAPERS = {
    dark: [
      { id: 'dark_none',    file: null,                                                label: 'None'            },
      { id: 'dark_coffee',  file: 'wallpapers/dark_mode/dark_coffee_steam.jpg',        label: 'Coffee Steam'    },
      { id: 'dark_moonlit', file: 'wallpapers/dark_mode/dark_moonlit_forest.jpg',      label: 'Moonlit Forest'  },
      { id: 'dark_starry',  file: 'wallpapers/dark_mode/dark_starry_night_tree.jpg',   label: 'Starry Night'    },
      { id: 'dark_planets', file: 'wallpapers/dark_mode/dark_space_planets.jpg',       label: 'Space Planets'   },
      { id: 'dark_spices',  file: 'wallpapers/dark_mode/dark_spices_flatlay.jpg',      label: 'Spices'          },
      { id: 'dark_citrus',  file: 'wallpapers/dark_mode/dark_citrus_splash.jpg',       label: 'Citrus Splash'   },
      { id: 'dark_sunset',  file: 'wallpapers/dark_mode/dark_tropical_sunset.jpg',     label: 'Tropical Sunset' },
    ],
    light: [
      { id: 'light_none',       file: null,                                                    label: 'None'             },
      { id: 'light_vegetables', file: 'wallpapers/light_mode/light_flying_vegetables.jpg',     label: 'Flying Veggies'   },
      { id: 'light_collage',    file: 'wallpapers/light_mode/light_food_collage.jpg',          label: 'Food Collage'     },
      { id: 'light_splash',     file: 'wallpapers/light_mode/light_fruit_water_splash.jpg',    label: 'Fruit Splash'     },
      { id: 'light_waterfall',  file: 'wallpapers/light_mode/light_misty_waterfall.jpg',       label: 'Misty Waterfall'  },
      { id: 'light_wheat',      file: 'wallpapers/light_mode/light_golden_wheat_field.jpg',    label: 'Wheat Field'      },
      { id: 'light_candies',    file: 'wallpapers/light_mode/light_colorful_candies.jpg',      label: 'Candies'          },
      { id: 'light_burger',     file: 'wallpapers/light_mode/light_cheeseburger_closeup.jpg',  label: 'Cheeseburger'     },
      { id: 'light_doodle',     file: 'wallpapers/light_mode/light_blue_cartoon_doodle.jpg',   label: 'Cartoon Doodle'   },
    ],
  };

  const DEFAULTS = {
    theme:             'dark',
    units:             'metric',
    waterGoal:         2000,
    calorieGoalOffset: 0,
    aiResponses:       true,
    mealReminders:     false,
    waterReminders:    false,
    weeklyReport:      false,
    wallpaperDark:     'dark_none',   // built-in id  OR  'custom'
    wallpaperLight:    'light_none',  // built-in id  OR  'custom'
  };

  let _cfg         = { ...DEFAULTS };
  let _user        = null;
  let _customWp    = { dark: null, light: null }; // dataURL strings

  // ── Persistence ───────────────────────────────────────────────────────────

  function _load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) _cfg = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (e) { /* use defaults */ }

    try {
      const raw = localStorage.getItem(CUSTOM_WP_KEY);
      if (raw) _customWp = { ...{ dark: null, light: null }, ...JSON.parse(raw) };
    } catch (e) { /* ignore */ }
  }

  function _save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(_cfg)); } catch (e) { /* ignore */ }
  }

  function _saveCustomWp() {
    try { localStorage.setItem(CUSTOM_WP_KEY, JSON.stringify(_customWp)); } catch (e) { /* ignore */ }
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

  // ── Theme ─────────────────────────────────────────────────────────────────

  function _onThemeChange(value) {
    _cfg.theme = value;
    _save();
    document.documentElement.setAttribute('data-theme', value);
    try { localStorage.setItem('thanzi_theme', value); } catch (e) { /* ignore */ }
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.textContent = value === 'light' ? '🌙' : '☀️';
    _applyWallpaper();
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

  // ── Goal steppers ─────────────────────────────────────────────────────────

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

  // ── Wallpaper core ────────────────────────────────────────────────────────

  /**
   * Apply the currently saved wallpaper for the active theme to document.body.
   * Called on init, on theme switch, and whenever a wallpaper is chosen.
   */
  function _applyWallpaper() {
    const theme   = document.documentElement.getAttribute('data-theme') || 'dark';
    const cfgKey  = theme === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    const chosenId = _cfg[cfgKey] || DEFAULTS[cfgKey];
    const body    = document.body;

    let url = null;

    if (chosenId === 'custom') {
      // Use the stored dataURL for this mode
      url = _customWp[theme] || null;
    } else {
      const pool  = WALLPAPERS[theme === 'light' ? 'light' : 'dark'];
      const entry = pool.find(w => w.id === chosenId);
      url = entry ? entry.file : null;
    }

    if (url) {
      body.style.backgroundImage      = `url('${url}')`;
      body.style.backgroundSize       = 'cover';
      body.style.backgroundPosition   = 'center';
      body.style.backgroundAttachment = 'fixed';
      body.style.backgroundRepeat     = 'no-repeat';
    } else {
      body.style.backgroundImage = '';
    }
  }

  /**
   * Select a built-in wallpaper for a given mode ('dark'|'light').
   */
  function _selectBuiltin(mode, id) {
    const cfgKey = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    _cfg[cfgKey] = id;
    _save();
    _applyWallpaper();
    _refreshPicker(mode);
    const pool  = WALLPAPERS[mode];
    const entry = pool.find(w => w.id === id);
    _toast(`${mode === 'dark' ? '🌑 Dark' : '☀️ Light'} wallpaper: ${entry ? entry.label : 'None'}`);
  }

  /**
   * Open the system file-picker and let the user choose a custom image for mode.
   */
  function _pickCustomWallpaper(mode) {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;

      // 10 MB safety cap
      if (file.size > 10 * 1024 * 1024) {
        _toast('Image too large — max 10 MB');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataURL = e.target.result;
        _customWp[mode] = dataURL;
        _saveCustomWp();

        // Switch wallpaper setting to 'custom' for this mode
        const cfgKey = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
        _cfg[cfgKey] = 'custom';
        _save();
        _applyWallpaper();
        _refreshPicker(mode);
        _toast(`${mode === 'dark' ? '🌑 Dark' : '☀️ Light'} wallpaper: Your photo ✓`);
      };
      reader.readAsDataURL(file);
    });

    input.click();
  }

  /**
   * Remove the custom wallpaper for mode and revert to None.
   */
  function _removeCustomWallpaper(mode) {
    _customWp[mode] = null;
    _saveCustomWp();
    const cfgKey = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    _cfg[cfgKey] = mode === 'light' ? 'light_none' : 'dark_none';
    _save();
    _applyWallpaper();
    _refreshPicker(mode);
    _toast('Custom wallpaper removed');
  }

  /**
   * Re-render just the selection state of all thumbs for one mode —
   * avoids a full panel re-render.
   */
  function _refreshPicker(mode) {
    const cfgKey   = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    const chosenId = _cfg[cfgKey];

    // Built-in thumbs
    document.querySelectorAll(`.st-wp-thumb[data-mode="${mode}"]`).forEach(el => {
      el.classList.toggle('selected', el.dataset.id === chosenId);
    });

    // Custom thumb
    const customThumb = document.getElementById(`st-wp-custom-${mode}`);
    if (customThumb) {
      const hasCustom = !!_customWp[mode];
      customThumb.classList.toggle('selected', chosenId === 'custom');
      customThumb.style.backgroundImage = hasCustom ? `url('${_customWp[mode]}')` : '';

      // Show / hide the remove button
      const removeBtn = document.getElementById(`st-wp-custom-remove-${mode}`);
      if (removeBtn) removeBtn.style.display = hasCustom ? 'flex' : 'none';

      // Update label
      const label = customThumb.querySelector('.st-wp-label');
      if (label) label.textContent = hasCustom ? 'My Photo' : 'From Gallery';

      // Show/hide the camera icon (only when no photo set)
      const camIcon = customThumb.querySelector('.st-wp-cam-icon');
      if (camIcon) camIcon.style.display = hasCustom ? 'none' : 'flex';
    }
  }

  // ── Data management ───────────────────────────────────────────────────────

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

  function _renderWpSection(mode) {
    const cfgKey   = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    const chosenId = _cfg[cfgKey];
    const pool     = WALLPAPERS[mode];
    const hasCustom = !!_customWp[mode];
    const modeIcon  = mode === 'dark' ? '🌑' : '☀️';
    const modeLabel = mode === 'dark' ? 'Dark Mode' : 'Light Mode';

    const thumbsHTML = pool.map(w => `
      <button class="st-wp-thumb ${chosenId === w.id ? 'selected' : ''}"
              data-mode="${mode}" data-id="${w.id}"
              aria-label="${w.label}"
              style="${w.file ? `background-image:url('${w.file}')` : ''}">
        ${!w.file ? '<span class="st-wp-none-icon">✕</span>' : ''}
        <span class="st-wp-label">${w.label}</span>
      </button>
    `).join('');

    // Custom / gallery thumb — always shown at the end
    const customSelected = chosenId === 'custom';
    const customBg = hasCustom ? `background-image:url('${_customWp[mode]}')` : '';

    return `
      <div class="st-wp-section${mode === 'light' ? ' st-wp-section--last' : ''}">
        <div class="st-wp-section-label">
          <span class="st-wp-mode-icon">${modeIcon}</span>${modeLabel}
        </div>
        <div class="st-wp-scroll">
          ${thumbsHTML}

          <!-- Custom photo thumb -->
          <div class="st-wp-custom-wrap">
            <button id="st-wp-custom-${mode}"
                    class="st-wp-thumb st-wp-thumb--custom ${customSelected ? 'selected' : ''}"
                    aria-label="Upload custom wallpaper"
                    style="${customBg}">
              <span class="st-wp-cam-icon" style="display:${hasCustom ? 'none' : 'flex'}">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8
                           a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </span>
              <span class="st-wp-label">${hasCustom ? 'My Photo' : 'From Gallery'}</span>
            </button>
            <!-- Remove button — only shown when a custom photo exists -->
            <button id="st-wp-custom-remove-${mode}"
                    class="st-wp-remove-btn"
                    aria-label="Remove custom wallpaper"
                    style="display:${hasCustom ? 'flex' : 'none'}">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  function _render() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    const c     = _cfg;
    const email = _user ? (_user.email || '—') : '—';
    const name  = _user ? (_user.name  || '—') : '—';

    panel.innerHTML = `

      <!-- Page header -->
      <div class="st-page-header">
        <div class="st-page-title">Settings</div>
        <div class="st-page-sub">Customise Thanzi to fit your lifestyle</div>
      </div>

      <!-- ── WALLPAPER ────────────────────────────────────────────────────── -->
      <div class="st-card">
        <div class="st-card-header">
          <div class="st-card-icon">🖼️</div>
          <span class="st-card-title">Wallpaper</span>
        </div>
        ${_renderWpSection('dark')}
        ${_renderWpSection('light')}
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

    // ── Wallpaper: built-in thumbs ─────────────────────────────────────────
    document.querySelectorAll('.st-wp-thumb[data-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectBuiltin(btn.dataset.mode, btn.dataset.id);
      });
    });

    // ── Wallpaper: custom gallery buttons ──────────────────────────────────
    ['dark', 'light'].forEach(mode => {
      const customBtn = document.getElementById(`st-wp-custom-${mode}`);
      if (customBtn) {
        customBtn.addEventListener('click', () => _pickCustomWallpaper(mode));
      }

      const removeBtn = document.getElementById(`st-wp-custom-remove-${mode}`);
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          _removeCustomWallpaper(mode);
        });
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function refresh() {
    _load();
    try {
      if (typeof ThanziAuth !== 'undefined') {
        _user = await ThanziAuth.getUser();
      }
    } catch (e) { _user = null; }
    _render();
  }

  function init() {
    _load();
    _applyWallpaper();
  }

  return { init, refresh, get };
})();

document.addEventListener('DOMContentLoaded', ThanziSettings.init);
