/**
 * settings.js — Thanzi Settings Panel
 *
 * Persisted under 'thanzi_settings' in localStorage.
 * Panel element: #settings-panel
 */
const ThanziSettings = (() => {
  'use strict';

  const SETTINGS_KEY  = 'thanzi_settings';
  const CUSTOM_WP_KEY = 'thanzi_custom_wallpapers'; // { dark: dataURL|null, light: dataURL|null }

  // ── CSS-coded wallpaper catalogue ─────────────────────────────────────────
  // Every wallpaper is a CSS `background` value — no image files needed.
  // Themes: dark (#0f1117 base, #2d9e6b accent) / light (#f4f6f5 base, #1f8f5c accent)

  const WALLPAPERS = {
    dark: [
      {
        id: 'dark_none',
        label: 'None',
        css: '',
      },
      {
        id: 'dark_emerald_pulse',
        label: 'Emerald Pulse',
        // Deep radial glow from accent green — like a nutrition ring glowing
        css: `radial-gradient(ellipse 80% 60% at 50% 110%, #1a4d35 0%, #0f1117 65%)`,
        thumb: `radial-gradient(ellipse 80% 100% at 50% 120%, #1a4d35 0%, #0f1117 70%)`,
      },
      {
        id: 'dark_calorie_grid',
        label: 'Calorie Grid',
        // Subtle grid like a nutrition table
        css: `
          linear-gradient(rgba(45,158,107,.06) 1px, transparent 1px),
          linear-gradient(90deg, rgba(45,158,107,.06) 1px, transparent 1px),
          linear-gradient(180deg, #0f1117 0%, #111820 100%)
        `,
        cssSize: '40px 40px, 40px 40px, 100% 100%',
        thumb: `linear-gradient(rgba(45,158,107,.12) 1px, transparent 1px),
                linear-gradient(90deg, rgba(45,158,107,.12) 1px, transparent 1px),
                linear-gradient(180deg, #0f1117 0%, #111820 100%)`,
        thumbSize: '10px 10px, 10px 10px, 100% 100%',
      },
      {
        id: 'dark_deep_forest',
        label: 'Deep Forest',
        // Layered green mist — organic, leafy
        css: `
          radial-gradient(ellipse 60% 40% at 20% 80%, rgba(29,90,55,.55) 0%, transparent 60%),
          radial-gradient(ellipse 50% 35% at 80% 20%, rgba(22,68,42,.45) 0%, transparent 55%),
          linear-gradient(160deg, #0a0f0c 0%, #0f1a12 50%, #0f1117 100%)
        `,
        thumb: `
          radial-gradient(ellipse 60% 40% at 20% 80%, rgba(29,90,55,.55) 0%, transparent 60%),
          radial-gradient(ellipse 50% 35% at 80% 20%, rgba(22,68,42,.45) 0%, transparent 55%),
          linear-gradient(160deg, #0a0f0c 0%, #0f1a12 50%, #0f1117 100%)
        `,
      },
      {
        id: 'dark_macro_waves',
        label: 'Macro Waves',
        // Wavy stripes — macronutrient chart feel
        css: `
          repeating-linear-gradient(
            -45deg,
            transparent 0px,
            transparent 18px,
            rgba(45,158,107,.05) 18px,
            rgba(45,158,107,.05) 20px
          ),
          linear-gradient(180deg, #0f1117 0%, #13161f 100%)
        `,
        thumb: `
          repeating-linear-gradient(
            -45deg,
            transparent 0px, transparent 5px,
            rgba(45,158,107,.1) 5px, rgba(45,158,107,.1) 6px
          ),
          linear-gradient(180deg, #0f1117 0%, #13161f 100%)
        `,
      },
      {
        id: 'dark_midnight_bowl',
        label: 'Midnight Bowl',
        // Dark navy-to-black gradient, like an empty bowl in low light
        css: `
          radial-gradient(ellipse 70% 50% at 50% 85%, rgba(20,30,55,.8) 0%, transparent 70%),
          radial-gradient(ellipse 40% 30% at 50% 95%, rgba(45,158,107,.12) 0%, transparent 60%),
          linear-gradient(200deg, #0d0f1a 0%, #0f1117 40%, #080b10 100%)
        `,
        thumb: `
          radial-gradient(ellipse 70% 50% at 50% 85%, rgba(20,30,55,.8) 0%, transparent 70%),
          linear-gradient(200deg, #0d0f1a 0%, #0f1117 40%, #080b10 100%)
        `,
      },
      {
        id: 'dark_protein_dots',
        label: 'Protein Dots',
        // Dot matrix — molecule / nutrient scatter
        css: `
          radial-gradient(circle, rgba(45,158,107,.18) 1px, transparent 1px),
          radial-gradient(circle, rgba(45,158,107,.08) 1px, transparent 1px),
          linear-gradient(180deg, #0f1117 0%, #10141c 100%)
        `,
        cssSize: '30px 30px, 60px 60px, 100% 100%',
        cssPos: '0 0, 15px 15px, 0 0',
        thumb: `
          radial-gradient(circle, rgba(45,158,107,.25) 1px, transparent 1px),
          linear-gradient(180deg, #0f1117 0%, #10141c 100%)
        `,
        thumbSize: '8px 8px, 100% 100%',
      },
      {
        id: 'dark_aurora_greens',
        label: 'Aurora Greens',
        // Northern-lights feel in Thanzi greens
        css: `
          radial-gradient(ellipse 100% 40% at 50% 0%,   rgba(45,158,107,.22) 0%, transparent 70%),
          radial-gradient(ellipse 80%  30% at 80% 30%,  rgba(36,144,89,.15)  0%, transparent 60%),
          radial-gradient(ellipse 60%  25% at 20% 60%,  rgba(29,110,68,.12)  0%, transparent 55%),
          linear-gradient(180deg, #080d0a 0%, #0f1117 60%, #0c1210 100%)
        `,
        thumb: `
          radial-gradient(ellipse 100% 40% at 50% 0%,  rgba(45,158,107,.3) 0%, transparent 70%),
          linear-gradient(180deg, #080d0a 0%, #0f1117 100%)
        `,
      },
    ],

    light: [
      {
        id: 'light_none',
        label: 'None',
        css: '',
      },
      {
        id: 'light_fresh_mint',
        label: 'Fresh Mint',
        // Clean white to soft mint — like a healthy smoothie
        css: `linear-gradient(160deg, #f0faf5 0%, #e2f5eb 50%, #f4f6f5 100%)`,
        thumb: `linear-gradient(160deg, #f0faf5 0%, #cdeedd 50%, #f4f6f5 100%)`,
      },
      {
        id: 'light_citrus_zest',
        label: 'Citrus Zest',
        // Warm white to light lime — vitamin C vibes
        css: `
          radial-gradient(ellipse 70% 50% at 80% 20%, rgba(200,230,100,.35) 0%, transparent 60%),
          radial-gradient(ellipse 60% 40% at 20% 80%, rgba(180,220,80,.2)  0%, transparent 55%),
          linear-gradient(140deg, #fafff0 0%, #f4f6f5 100%)
        `,
        thumb: `
          radial-gradient(ellipse 70% 50% at 80% 20%, rgba(200,230,100,.5) 0%, transparent 60%),
          linear-gradient(140deg, #fafff0 0%, #f4f6f5 100%)
        `,
      },
      {
        id: 'light_nutrition_grid',
        label: 'Nutrition Grid',
        // Soft grid on white — nutrition label feel
        css: `
          linear-gradient(rgba(31,143,92,.07) 1px, transparent 1px),
          linear-gradient(90deg, rgba(31,143,92,.07) 1px, transparent 1px),
          #f4f6f5
        `,
        cssSize: '40px 40px, 40px 40px, 100% 100%',
        thumb: `
          linear-gradient(rgba(31,143,92,.15) 1px, transparent 1px),
          linear-gradient(90deg, rgba(31,143,92,.15) 1px, transparent 1px),
          #f4f6f5
        `,
        thumbSize: '10px 10px, 10px 10px, 100% 100%',
      },
      {
        id: 'light_sunrise_bowl',
        label: 'Sunrise Bowl',
        // Warm peach-to-white — açaí bowl / morning meal
        css: `
          radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,200,120,.4) 0%, transparent 65%),
          radial-gradient(ellipse 50% 30% at 90% 90%,  rgba(255,160,80,.15) 0%, transparent 55%),
          linear-gradient(180deg, #fffaf4 0%, #f4f6f5 100%)
        `,
        thumb: `
          radial-gradient(ellipse 80% 60% at 50% -10%, rgba(255,200,120,.5) 0%, transparent 70%),
          linear-gradient(180deg, #fffaf4 0%, #f4f6f5 100%)
        `,
      },
      {
        id: 'light_hydro_wave',
        label: 'Hydro Wave',
        // Water blue tints — hydration tracker feel
        css: `
          radial-gradient(ellipse 90% 50% at 50% 110%, rgba(52,152,219,.18) 0%, transparent 65%),
          radial-gradient(ellipse 60% 30% at 10% 30%,  rgba(52,152,219,.10) 0%, transparent 55%),
          linear-gradient(180deg, #f4f8ff 0%, #f4f6f5 60%, #eef4ff 100%)
        `,
        thumb: `
          radial-gradient(ellipse 90% 50% at 50% 110%, rgba(52,152,219,.25) 0%, transparent 65%),
          linear-gradient(180deg, #f4f8ff 0%, #f4f6f5 100%)
        `,
      },
      {
        id: 'light_garden_dots',
        label: 'Garden Dots',
        // Soft green dots — seeds, garden, organic
        css: `
          radial-gradient(circle, rgba(31,143,92,.14) 1.5px, transparent 1.5px),
          radial-gradient(circle, rgba(31,143,92,.07) 1px,   transparent 1px),
          #f4f6f5
        `,
        cssSize: '32px 32px, 64px 64px, 100% 100%',
        cssPos: '0 0, 16px 16px, 0 0',
        thumb: `
          radial-gradient(circle, rgba(31,143,92,.2) 1.5px, transparent 1.5px),
          #f4f6f5
        `,
        thumbSize: '8px 8px, 100% 100%',
      },
      {
        id: 'light_macro_stripe',
        label: 'Macro Stripe',
        // Diagonal candy stripes — macros chart colours, very subtle
        css: `
          repeating-linear-gradient(
            -55deg,
            transparent         0px,
            transparent         22px,
            rgba(31,143,92,.06) 22px,
            rgba(31,143,92,.06) 24px
          ),
          linear-gradient(180deg, #f9fdf9 0%, #f4f6f5 100%)
        `,
        thumb: `
          repeating-linear-gradient(
            -55deg,
            transparent 0px, transparent 5px,
            rgba(31,143,92,.12) 5px, rgba(31,143,92,.12) 6px
          ),
          linear-gradient(180deg, #f9fdf9 0%, #f4f6f5 100%)
        `,
      },
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
    wallpaperDark:     'dark_none',
    wallpaperLight:    'light_none',
  };

  let _cfg      = { ...DEFAULTS };
  let _user     = null;
  let _customWp = { dark: null, light: null };

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
    const v  = _cfg.calorieGoalOffset;
    if (el) el.textContent = (v >= 0 ? '+' : '') + v + ' kcal';
  }

  // ── Wallpaper ─────────────────────────────────────────────────────────────

  function _getEntry(mode, id) {
    return WALLPAPERS[mode].find(w => w.id === id) || WALLPAPERS[mode][0];
  }

  function _applyWallpaper() {
    const theme  = document.documentElement.getAttribute('data-theme') || 'dark';
    const cfgKey = theme === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    const id     = _cfg[cfgKey] || DEFAULTS[cfgKey];
    const body   = document.body;

    if (id === 'custom') {
      const url = _customWp[theme] || null;
      if (url) {
        body.style.backgroundImage      = `url('${url}')`;
        body.style.backgroundSize       = 'cover';
        body.style.backgroundPosition   = 'center';
        body.style.backgroundAttachment = 'fixed';
        body.style.backgroundRepeat     = 'no-repeat';
      } else {
        body.style.backgroundImage = '';
      }
      return;
    }

    const entry = _getEntry(theme, id);
    if (entry && entry.css) {
      body.style.backgroundImage      = entry.css;
      body.style.backgroundSize       = entry.cssSize  || 'auto';
      body.style.backgroundPosition   = entry.cssPos   || '0 0';
      body.style.backgroundAttachment = 'fixed';
      body.style.backgroundRepeat     = entry.cssSize  ? 'repeat, repeat, no-repeat' : 'no-repeat';
    } else {
      body.style.backgroundImage = '';
      body.style.backgroundSize  = '';
      body.style.backgroundPosition = '';
    }
  }

  function _selectBuiltin(mode, id) {
    const cfgKey = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    _cfg[cfgKey] = id;
    _save();
    _applyWallpaper();
    _refreshPicker(mode);
    const entry = _getEntry(mode, id);
    _toast(`${mode === 'dark' ? '🌑' : '☀️'} Wallpaper: ${entry.label}`);
  }

  function _pickCustomWallpaper(mode) {
    const input  = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';

    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { _toast('Image too large — max 10 MB'); return; }

      const reader  = new FileReader();
      reader.onload = (e) => {
        _customWp[mode] = e.target.result;
        _saveCustomWp();
        const cfgKey = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
        _cfg[cfgKey] = 'custom';
        _save();
        _applyWallpaper();
        _refreshPicker(mode);
        _toast(`${mode === 'dark' ? '🌑' : '☀️'} Wallpaper: Your photo ✓`);
      };
      reader.readAsDataURL(file);
    });

    input.click();
  }

  function _removeCustomWallpaper(mode) {
    _customWp[mode] = null;
    _saveCustomWp();
    const cfgKey = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    _cfg[cfgKey]  = mode === 'light' ? 'light_none' : 'dark_none';
    _save();
    _applyWallpaper();
    _refreshPicker(mode);
    _toast('Custom wallpaper removed');
  }

  function _refreshPicker(mode) {
    const cfgKey   = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    const chosenId = _cfg[cfgKey];

    document.querySelectorAll(`.st-wp-thumb[data-mode="${mode}"]`).forEach(el => {
      el.classList.toggle('selected', el.dataset.id === chosenId);
    });

    const customThumb = document.getElementById(`st-wp-custom-${mode}`);
    if (customThumb) {
      const hasCustom = !!_customWp[mode];
      customThumb.classList.toggle('selected', chosenId === 'custom');
      customThumb.style.backgroundImage = hasCustom ? `url('${_customWp[mode]}')` : '';
      const removeBtn = document.getElementById(`st-wp-custom-remove-${mode}`);
      if (removeBtn) removeBtn.style.display = hasCustom ? 'flex' : 'none';
      const label  = customThumb.querySelector('.st-wp-label');
      if (label)   label.textContent = hasCustom ? 'My Photo' : 'From Gallery';
      const camIcon = customThumb.querySelector('.st-wp-cam-icon');
      if (camIcon)  camIcon.style.display = hasCustom ? 'none' : 'flex';
    }
  }

  // ── Data management ───────────────────────────────────────────────────────

  function _exportCSV() {
    const rows = [['Date','Meal','Food','Qty (g)','kcal','Carbs (g)','Protein (g)','Fat (g)']];
    Object.keys(localStorage).forEach(key => {
      if (!key.startsWith('thanzi_food_log_')) return;
      try {
        const logs = JSON.parse(localStorage.getItem(key)) || [];
        const m    = key.match(/(\d{4}-\d{2}-\d{2})$/);
        const date = m ? m[1] : key;
        logs.forEach(e => rows.push([date, e.meal||'', e.name||'', e.quantity||'', e.calories||'', e.carbs||'', e.protein||'', e.fat||'']));
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
      if (k.includes('log_' + today) || k.includes('thanzi_water_' + today)) localStorage.removeItem(k);
    });
    if (typeof ThanziApp !== 'undefined' && ThanziApp.refresh) ThanziApp.refresh();
    _toast("Today's logs cleared");
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  function _renderWpSection(mode) {
    const cfgKey    = mode === 'light' ? 'wallpaperLight' : 'wallpaperDark';
    const chosenId  = _cfg[cfgKey];
    const pool      = WALLPAPERS[mode];
    const hasCustom = !!_customWp[mode];
    const modeIcon  = mode === 'dark' ? '🌑' : '☀️';
    const modeLabel = mode === 'dark' ? 'Dark Mode' : 'Light Mode';

    const thumbsHTML = pool.map(w => {
      const bg = w.thumb || w.css || '';
      const sz = w.thumbSize || (w.cssSize ? w.cssSize : 'auto');
      const pos = '0 0';
      const styleAttr = bg
        ? `background:${bg}; background-size:${sz}; background-position:${pos};`
        : '';
      return `
        <button class="st-wp-thumb ${chosenId === w.id ? 'selected' : ''}"
                data-mode="${mode}" data-id="${w.id}"
                aria-label="${w.label}"
                style="${styleAttr}">
          ${!bg ? '<span class="st-wp-none-icon">✕</span>' : ''}
          <span class="st-wp-label">${w.label}</span>
        </button>
      `;
    }).join('');

    const customSelected = chosenId === 'custom';
    const customBg = hasCustom ? `background-image:url('${_customWp[mode]}'); background-size:cover; background-position:center;` : '';

    return `
      <div class="st-wp-section${mode === 'light' ? ' st-wp-section--last' : ''}">
        <div class="st-wp-section-label">
          <span class="st-wp-mode-icon">${modeIcon}</span>${modeLabel}
        </div>
        <div class="st-wp-scroll">
          ${thumbsHTML}
          <div class="st-wp-custom-wrap">
            <button id="st-wp-custom-${mode}"
                    class="st-wp-thumb st-wp-thumb--custom ${customSelected ? 'selected' : ''}"
                    aria-label="Upload custom wallpaper"
                    style="${customBg}">
              <span class="st-wp-cam-icon" style="display:${hasCustom ? 'none' : 'flex'}">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="1.8"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </span>
              <span class="st-wp-label">${hasCustom ? 'My Photo' : 'From Gallery'}</span>
            </button>
            <button id="st-wp-custom-remove-${mode}"
                    class="st-wp-remove-btn"
                    aria-label="Remove custom wallpaper"
                    style="display:${hasCustom ? 'flex' : 'none'}">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function _render() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;

    const c     = _cfg;
    const email = _user ? (_user.email || '—') : '—';
    const name  = _user ? (_user.name  || '—') : '—';

    panel.innerHTML = `

      <div class="st-page-header">
        <div class="st-page-title">Settings</div>
        <div class="st-page-sub">Customise Thanzi to fit your lifestyle</div>
      </div>

      <!-- ── WALLPAPER ──────────────────────────────────────────────────── -->
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
            <div class="st-row-info"><div class="st-row-name">Name</div></div>
          </div>
          <span class="st-row-value">${name}</span>
        </div>
        <div class="st-row">
          <div class="st-row-left">
            <div class="st-row-icon">✉️</div>
            <div class="st-row-info"><div class="st-row-name">Email Address</div></div>
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

    // Built-in wallpaper thumbs
    document.querySelectorAll('.st-wp-thumb[data-id]').forEach(btn => {
      btn.addEventListener('click', () => _selectBuiltin(btn.dataset.mode, btn.dataset.id));
    });

    // Custom / gallery
    ['dark', 'light'].forEach(mode => {
      const customBtn = document.getElementById(`st-wp-custom-${mode}`);
      if (customBtn) customBtn.addEventListener('click', () => _pickCustomWallpaper(mode));

      const removeBtn = document.getElementById(`st-wp-custom-remove-${mode}`);
      if (removeBtn) removeBtn.addEventListener('click', e => {
        e.stopPropagation();
        _removeCustomWallpaper(mode);
      });
    });
  }

  // ── Public ────────────────────────────────────────────────────────────────

  async function refresh() {
    _load();
    try {
      if (typeof ThanziAuth !== 'undefined') _user = await ThanziAuth.getUser();
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
