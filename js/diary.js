/**
 * diary.js — Thanzi Diary Panel
 *
 * Follows the same IIFE / module pattern as settings.js / exercise.js.
 * Reads the user's nutrition plan (from ThanziApp / localStorage 'thanzi_profile_<uid>')
 * plus today's food log totals (pushed in via ThanziDiary.updateFromLogs(logs), called
 * from log.js's _syncDashboard) and today's exercise log (localStorage 'thanzi_exercise_logs',
 * written by exercise.js) to render:
 *
 *   1. Energy Summary  — remaining-kcal ring + BMR/Baseline/Exercise breakdown + totals table
 *   2. Consumed ring   — consumed kcal + macro breakdown
 *   3. Expenditure ring— BMR + Baseline + Exercise
 *   4. Food Diversity insight card
 *   5. Nutrient Targets sub-page (from Diary settings)
 *   6. Empty-state tooltip pointing at the bottom-nav Log button
 *
 * Storage keys:
 *   'thanzi_diary_prefs'            — { displayMode: 'target'|'balance' }
 *   'thanzi_nutrient_targets'       — { [nutrientId]: number }  (user edits)
 *   'thanzi_nutrient_pins'          — [nutrientId, ...]         (highlighted picks)
 *   'thanzi_food_history_<uid>'     — { [ISO date]: [{ id, name, group }] } best-effort
 *                                       diversity history; falls back gracefully if absent.
 *
 * Panel element : #diary-panel        (shown via nav-diary)
 * Sub-panel     : #nutrient-targets-panel (shown from Diary settings gear)
 */
const ThanziDiary = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────
  const PREFS_KEY   = 'thanzi_diary_prefs';
  const TARGETS_KEY = 'thanzi_nutrient_targets';
  const PINS_KEY    = 'thanzi_nutrient_pins';
  const EXERCISE_KEY = 'thanzi_exercise_logs';

  const RING_CIRCUMFERENCE = 314; // matches r=50 ring used across the app

  const FOOD_GROUPS = [
    { id: 'fruits',     label: 'Fruits',     color: 'var(--orange)' },
    { id: 'vegetables', label: 'Vegetables', color: 'var(--accent)' },
    { id: 'grains',     label: 'Grains',     color: '#c9a227' },
    { id: 'protein',    label: 'Protein',    color: 'var(--blue)' },
    { id: 'dairy',      label: 'Dairy',      color: 'var(--purple)' },
  ];

  /**
   * Nutrient catalogue for the Nutrient Targets page.
   * Values are sane adult defaults; users can edit any of them.
   */
  const NUTRIENT_CATALOGUE = {
    general: {
      label: 'General', icon: '🎯',
      items: [
        { id: 'kcal',    name: 'Calories',      unit: 'kcal', default: 2000 },
        { id: 'carbs',   name: 'Carbohydrates', unit: 'g',    default: 250 },
        { id: 'protein', name: 'Protein',       unit: 'g',    default: 100 },
        { id: 'fat',     name: 'Fat',           unit: 'g',    default: 65 },
        { id: 'fiber',   name: 'Fiber',         unit: 'g',    default: 30 },
        { id: 'water',   name: 'Water',         unit: 'ml',   default: 2500 },
      ],
    },
    vitamins: {
      label: 'Vitamins', icon: '🍊',
      items: [
        { id: 'vit_a',  name: 'Vitamin A',  unit: 'µg', default: 900 },
        { id: 'vit_c',  name: 'Vitamin C',  unit: 'mg', default: 90 },
        { id: 'vit_d',  name: 'Vitamin D',  unit: 'IU', default: 600 },
        { id: 'vit_e',  name: 'Vitamin E',  unit: 'mg', default: 15 },
        { id: 'vit_k',  name: 'Vitamin K',  unit: 'µg', default: 120 },
        { id: 'vit_b12', name: 'Vitamin B12', unit: 'µg', default: 2.4 },
        { id: 'folate', name: 'Folate',     unit: 'µg', default: 400 },
      ],
    },
    minerals: {
      label: 'Minerals', icon: '⛰️',
      items: [
        { id: 'calcium',   name: 'Calcium',   unit: 'mg', default: 1000 },
        { id: 'iron',      name: 'Iron',      unit: 'mg', default: 8 },
        { id: 'magnesium', name: 'Magnesium', unit: 'mg', default: 400 },
        { id: 'potassium', name: 'Potassium', unit: 'mg', default: 3400 },
        { id: 'zinc',      name: 'Zinc',      unit: 'mg', default: 11 },
        { id: 'sodium',    name: 'Sodium',    unit: 'mg', default: 2300 },
      ],
    },
    carbohydrates: {
      label: 'Carbohydrates', icon: '🌾',
      items: [
        { id: 'total_carbs', name: 'Total Carbohydrates', unit: 'g', default: 250 },
        { id: 'sugar',       name: 'Sugar',               unit: 'g', default: 50 },
        { id: 'fiber_carb',  name: 'Dietary Fiber',       unit: 'g', default: 30 },
        { id: 'net_carbs',   name: 'Net Carbs',           unit: 'g', default: 220 },
      ],
    },
    lipids: {
      label: 'Lipids', icon: '🥑',
      items: [
        { id: 'total_fat',   name: 'Total Fat',      unit: 'g', default: 65 },
        { id: 'saturated',   name: 'Saturated Fat',  unit: 'g', default: 20 },
        { id: 'unsaturated', name: 'Unsaturated Fat', unit: 'g', default: 40 },
        { id: 'cholesterol', name: 'Cholesterol',    unit: 'mg', default: 300 },
      ],
    },
    protein: {
      label: 'Protein', icon: '🍗',
      items: [
        { id: 'total_protein', name: 'Total Protein', unit: 'g', default: 100 },
        { id: 'protein_per_kg', name: 'Protein per kg body weight', unit: 'g/kg', default: 1.2 },
      ],
    },
  };

  // ── State ──────────────────────────────────────────────────────────────
  let _plan   = null;   // ThanziNutrition.generate() output, read from localStorage
  let _totals = { kcal: 0, carbs: 0, protein: 0, fat: 0 }; // today's consumed totals
  let _hasLoggedToday = false;
  let _prefs  = { displayMode: 'target' };
  let _targets = {};
  let _pins    = [];
  let _openCategory = null;

  // ── Storage helpers ────────────────────────────────────────────────────

  function _loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      _prefs = raw ? Object.assign({ displayMode: 'target' }, JSON.parse(raw)) : { displayMode: 'target' };
    } catch (e) { _prefs = { displayMode: 'target' }; }
  }

  function _savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(_prefs)); } catch (e) { /* ignore */ }
  }

  function _loadTargets() {
    try {
      const raw = localStorage.getItem(TARGETS_KEY);
      _targets = raw ? JSON.parse(raw) : {};
    } catch (e) { _targets = {}; }
  }

  function _saveTargets() {
    try { localStorage.setItem(TARGETS_KEY, JSON.stringify(_targets)); } catch (e) { /* ignore */ }
  }

  function _loadPins() {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      _pins = raw ? JSON.parse(raw) : [];
    } catch (e) { _pins = []; }
  }

  function _savePins() {
    try { localStorage.setItem(PINS_KEY, JSON.stringify(_pins)); } catch (e) { /* ignore */ }
  }

  function _nutrientDefault(id) {
    for (const catKey in NUTRIENT_CATALOGUE) {
      const found = NUTRIENT_CATALOGUE[catKey].items.find(i => i.id === id);
      if (found) return found;
    }
    return null;
  }

  function _nutrientValue(id) {
    if (_targets[id] !== undefined) return _targets[id];
    const def = _nutrientDefault(id);
    return def ? def.default : 0;
  }

  function _loadPlan() {
    try {
      const uid = _currentUid();
      if (!uid) { _plan = null; return; }
      const raw = localStorage.getItem('thanzi_profile_' + uid);
      _plan = raw ? JSON.parse(raw) : null;
    } catch (e) { _plan = null; }
  }

  function _currentUid() {
    // ThanziApp doesn't expose the current user id publicly; fall back to
    // scanning localStorage for the first thanzi_profile_ key, which is the
    // same approach used implicitly elsewhere (single logged-in user per device).
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('thanzi_profile_')) return k.replace('thanzi_profile_', '');
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function _todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function _exerciseKcalToday() {
    try {
      const raw = localStorage.getItem(EXERCISE_KEY);
      if (!raw) return { kcal: 0, logged: false };
      const logs = JSON.parse(raw) || {};
      const today = logs[_todayISO()] || [];
      if (!today.length) return { kcal: 0, logged: false };
      const kcal = today.reduce((a, i) => a + (i.calories || 0), 0);
      return { kcal, logged: true };
    } catch (e) { return { kcal: 0, logged: false }; }
  }

  // ── Derived energy figures ─────────────────────────────────────────────

  function _energyFigures() {
    const bmr = _plan ? (_plan.assessment?.bmr_kcal || 0) : 0;
    const eer = _plan ? (_plan.energy?.eer_kcal || _plan.assessment?.eer_kcal || 0) : 0;
    const baseline = Math.max(0, eer - bmr);
    const ex = _exerciseKcalToday();
    const target = _plan ? (_plan.energy?.target_kcal || eer) : 2000;

    // Expenditure above baseline = exercise kcal (activity beyond the
    // baseline/EER estimate already used to set the target).
    const expenditureAboveBaseline = ex.kcal;
    const totalTarget = target + expenditureAboveBaseline;
    const consumed = Math.round(_totals.kcal);
    const remaining = totalTarget - consumed;

    return {
      bmr, eer, baseline, exerciseKcal: ex.kcal, exerciseLogged: ex.logged,
      target, expenditureAboveBaseline, totalTarget, consumed, remaining,
      totalExpenditure: bmr + baseline + ex.kcal,
    };
  }

  // ── Rendering: rings ────────────────────────────────────────────────────

  function _ringSVG(id, size = 160, r = 50) {
    return `
      <div class="ring-container" style="width:${size}px;height:${size}px">
        <svg class="ring" viewBox="0 0 120 120" style="width:${size}px;height:${size}px">
          <circle class="ring-bg" cx="60" cy="60" r="${r}"/>
          <circle class="ring-fill" id="${id}" cx="60" cy="60" r="${r}"/>
        </svg>
        <div class="ring-text" id="${id}-text"></div>
      </div>`;
  }

  function _setRing(id, value, max, opts = {}) {
    const ring = document.getElementById(id);
    const text = document.getElementById(id + '-text');
    if (!ring) return;
    const pct = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
    const offset = RING_CIRCUMFERENCE - pct * RING_CIRCUMFERENCE;
    ring.style.strokeDashoffset = offset;
    if (opts.color) ring.style.stroke = opts.color;
    if (text) {
      text.innerHTML = `<span>${opts.big}</span><small>${opts.small || ''}</small>`;
    }
  }

  // ── Section 1: Energy Summary ──────────────────────────────────────────

  function _renderEnergySummary(fig) {
    const totalExp = fig.totalExpenditure || 1;
    const bmrPct = Math.round((fig.bmr / totalExp) * 100);
    const basePct = Math.round((fig.baseline / totalExp) * 100);

    const remainingLabel = _prefs.displayMode === 'balance'
      ? (fig.remaining >= 0 ? `+${fig.remaining}` : `${fig.remaining}`)
      : `${Math.max(fig.remaining, 0)}`;

    return `
    <div class="dy-card">
      <div class="dy-card-title">🔥 Energy Summary</div>

      <div class="dy-breakdown">
        <div class="dy-breakdown-row">
          <div class="dy-breakdown-left">
            <span class="dy-breakdown-dot bmr"></span>
            <span class="dy-breakdown-label">BMR</span>
          </div>
          <div class="dy-breakdown-right">
            <span class="dy-breakdown-kcal">${fig.bmr} kcal</span>
            <span class="dy-breakdown-pct">${bmrPct}%</span>
          </div>
        </div>
        <div class="dy-breakdown-row">
          <div class="dy-breakdown-left">
            <span class="dy-breakdown-dot baseline"></span>
            <span class="dy-breakdown-label">Baseline Activity</span>
          </div>
          <div class="dy-breakdown-right">
            <span class="dy-breakdown-kcal">${fig.baseline} kcal</span>
            <span class="dy-breakdown-pct">${basePct}%</span>
          </div>
        </div>
        <div class="dy-breakdown-row">
          <div class="dy-breakdown-left">
            <span class="dy-breakdown-dot exercise"></span>
            <span class="dy-breakdown-label">Exercise</span>
          </div>
          <div class="dy-breakdown-right">
            ${fig.exerciseLogged
              ? `<span class="dy-breakdown-kcal">+${fig.exerciseKcal} kcal</span>`
              : `<span class="dy-breakdown-pending">Added when logged</span>`}
          </div>
        </div>
      </div>

      <div class="dy-ring-wrap">
        ${_ringSVG('diary-energy-ring')}
        <div class="dy-ring-caption">
          <strong id="diary-energy-ring-caption-val">${remainingLabel}</strong> kcal
          ${_prefs.displayMode === 'balance' ? (fig.remaining >= 0 ? 'under' : 'over') : 'remaining'}
        </div>
      </div>

      <div class="dy-table">
        <div class="dy-table-row">
          <span class="dy-table-label">Energy Target</span>
          <span class="dy-table-value">${fig.target} kcal</span>
        </div>
        <div class="dy-table-row">
          <span class="dy-table-label">Expenditure Above Baseline</span>
          <span class="dy-table-value pos">+${fig.expenditureAboveBaseline} kcal</span>
        </div>
        <div class="dy-table-row">
          <span class="dy-table-label">Total Target</span>
          <span class="dy-table-value">${fig.totalTarget} kcal</span>
        </div>
        <div class="dy-table-row">
          <span class="dy-table-label">Consumed</span>
          <span class="dy-table-value neg">&minus;${fig.consumed} kcal</span>
        </div>
        <div class="dy-table-row dy-table-row--total">
          <span class="dy-table-label">Remaining</span>
          <span class="dy-table-value">${fig.remaining} kcal</span>
        </div>
      </div>

      <div class="dy-pref">
        <div class="dy-pref-title">Display Preference</div>
        <label class="dy-pref-option ${_prefs.displayMode === 'target' ? 'checked' : ''}" data-mode="target">
          <span class="dy-pref-radio"></span>
          <span class="dy-pref-text">
            <span class="dy-pref-name">Target</span>
            <span class="dy-pref-explainer">Shows kcal remaining until you reach today's total target.</span>
          </span>
        </label>
        <label class="dy-pref-option ${_prefs.displayMode === 'balance' ? 'checked' : ''}" data-mode="balance">
          <span class="dy-pref-radio"></span>
          <span class="dy-pref-text">
            <span class="dy-pref-name">Balance</span>
            <span class="dy-pref-explainer">Shows your running balance — positive means under target, negative means over.</span>
          </span>
        </label>
      </div>
    </div>`;
  }

  // ── Section 2: Consumed Ring ───────────────────────────────────────────

  function _macroCell(name, key, grams, kcalPerG, goalG) {
    if (!_hasLoggedToday) {
      return `
      <div class="dy-macro-cell" data-macro="${key}">
        <div class="dy-macro-name">${name}</div>
        <div class="dy-macro-pending">Added when logged</div>
      </div>`;
    }
    const kcal = Math.round(grams * kcalPerG);
    const pct = goalG > 0 ? Math.round((grams / goalG) * 100) : 0;
    return `
    <div class="dy-macro-cell" data-macro="${key}">
      <div class="dy-macro-name">${name}</div>
      <span class="dy-macro-grams">${grams}g</span>
      <span class="dy-macro-kcal">${kcal} kcal</span>
      <span class="dy-macro-pct">${pct}% of target</span>
    </div>`;
  }

  function _renderConsumedRing(fig) {
    const target = fig.target || 2000;
    const consumedLabel = `${fig.consumed}`;

    return `
    <div class="dy-card">
      <div class="dy-card-title">🍽️ Consumed</div>
      <div class="dy-ring-wrap">
        ${_ringSVG('diary-consumed-ring')}
        <div class="dy-ring-caption">
          <strong>${consumedLabel}</strong> of ${target} kcal consumed
        </div>
      </div>
      <div class="dy-macros">
        ${_macroCell('Protein', 'protein', _totals.protein, 4, _plan?.macros?.protein?.g)}
        ${_macroCell('Carbs',   'carbs',   _totals.carbs,   4, _plan?.macros?.carbs?.g)}
        ${_macroCell('Fat',     'fat',     _totals.fat,     9, _plan?.macros?.fat?.g)}
      </div>
    </div>`;
  }

  // ── Section 3: Expenditure Ring ────────────────────────────────────────

  function _renderExpenditureRing(fig) {
    const totalExp = fig.totalExpenditure;
    const bmrPct = totalExp > 0 ? Math.round((fig.bmr / totalExp) * 100) : 0;
    const basePct = totalExp > 0 ? Math.round((fig.baseline / totalExp) * 100) : 0;
    const exPct = totalExp > 0 ? Math.round((fig.exerciseKcal / totalExp) * 100) : 0;

    return `
    <div class="dy-card">
      <div class="dy-card-title">⚡ Expenditure</div>
      <div class="dy-ring-wrap">
        ${_ringSVG('diary-expenditure-ring')}
        <div class="dy-ring-caption">
          <strong>${totalExp}</strong> kcal total expenditure today
        </div>
      </div>
      <div class="dy-breakdown">
        <div class="dy-breakdown-row">
          <div class="dy-breakdown-left">
            <span class="dy-breakdown-dot bmr"></span>
            <span class="dy-breakdown-label">BMR</span>
          </div>
          <div class="dy-breakdown-right">
            <span class="dy-breakdown-kcal">${fig.bmr} kcal</span>
            <span class="dy-breakdown-pct">${bmrPct}%</span>
          </div>
        </div>
        <div class="dy-breakdown-row">
          <div class="dy-breakdown-left">
            <span class="dy-breakdown-dot baseline"></span>
            <span class="dy-breakdown-label">Baseline Activity</span>
          </div>
          <div class="dy-breakdown-right">
            <span class="dy-breakdown-kcal">${fig.baseline} kcal</span>
            <span class="dy-breakdown-pct">${basePct}%</span>
          </div>
        </div>
        <div class="dy-breakdown-row">
          <div class="dy-breakdown-left">
            <span class="dy-breakdown-dot exercise"></span>
            <span class="dy-breakdown-label">Exercise</span>
          </div>
          <div class="dy-breakdown-right">
            ${fig.exerciseLogged
              ? `<span class="dy-breakdown-kcal">${fig.exerciseKcal} kcal</span><span class="dy-breakdown-pct">${exPct}%</span>`
              : `<span class="dy-breakdown-pending">Added when logged</span>`}
          </div>
        </div>
      </div>
    </div>`;
  }

  // ── Section: Food Diversity ─────────────────────────────────────────────

  /**
   * Best-effort diversity tracker. Reads a lightweight food-history log if
   * present (written by log.js as it logs food; falls back to counting
   * unique foodName values seen in today's + recent totals if a richer
   * history isn't available). This keeps Diary functional even before any
   * other module is updated to write structured history.
   */
  function _diversityHistoryKey() {
    const uid = _currentUid();
    return 'thanzi_food_history_' + (uid || 'anon');
  }

  function _loadDiversityHistory() {
    try {
      const raw = localStorage.getItem(_diversityHistoryKey());
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function _computeDiversity() {
    const history = _loadDiversityHistory(); // { 'YYYY-MM-DD': [{id/name, group}] }
    const today = _todayISO();
    const dates = Object.keys(history).sort().reverse();
    const last7 = dates.slice(0, 7);

    const uniqueToday = new Set((history[today] || []).map(f => f.id || f.name));
    const uniqueWeekMap = new Map(); // id -> count of days seen
    const groupsToday = new Set();
    const groupsWeek = new Set();

    last7.forEach(d => {
      (history[d] || []).forEach(f => {
        const key = f.id || f.name;
        uniqueWeekMap.set(key, (uniqueWeekMap.get(key) || 0) + 1);
        if (f.group) groupsWeek.add(f.group);
        if (d === today && f.group) groupsToday.add(f.group);
      });
    });

    const uniqueWeekCount = uniqueWeekMap.size;
    const totalEntriesWeek = last7.reduce((s, d) => s + (history[d] || []).length, 0);
    const repeatedCount = Math.max(0, totalEntriesWeek - uniqueWeekCount);

    return {
      uniqueTodayCount: uniqueToday.size,
      uniqueWeekCount,
      repeatedCount,
      groupsToday,
      groupsWeek,
      hasHistory: dates.length > 0,
    };
  }

  function _diversityInsight(div) {
    if (!div.hasHistory) {
      return "Log a few meals this week and we'll show you how varied your plate has been.";
    }
    if (div.repeatedCount >= 3) {
      const missing = FOOD_GROUPS.filter(g => !div.groupsWeek.has(g.id)).map(g => g.label.toLowerCase());
      const suggestion = missing.length
        ? `try adding a new ${missing[0].replace(/s$/, '')} this week for more variety`
        : 'try mixing in something new this week for more variety';
      return `You've repeated ${div.repeatedCount} meal${div.repeatedCount === 1 ? '' : 's'} this week — ${suggestion}.`;
    }
    if (div.uniqueWeekCount >= 10) {
      return `Nice variety — ${div.uniqueWeekCount} unique foods this week. Keep exploring!`;
    }
    return `You're off to a good start — keep logging to build a fuller picture of your variety.`;
  }

  function _renderDiversity() {
    const div = _computeDiversity();
    const insight = _diversityInsight(div);

    const chips = FOOD_GROUPS.map(g => {
      const hitToday = div.groupsToday.has(g.id);
      const hitWeek = div.groupsWeek.has(g.id);
      const hit = hitToday || hitWeek;
      return `
      <span class="dy-group-chip ${hit ? 'hit' : ''}" style="--dy-group-color:${g.color}" title="${g.label}${hitToday ? ' — today' : hitWeek ? ' — this week' : ''}">
        <span class="dy-group-dot"></span>${g.label}
      </span>`;
    }).join('');

    return `
    <div class="dy-card">
      <div class="dy-card-title">🌈 Diversity</div>
      <div class="dy-diversity-stat">
        <span class="dy-diversity-count">${div.uniqueWeekCount}</span>
        <span class="dy-diversity-label">unique foods this week</span>
      </div>
      <div class="dy-diversity-sub">${div.uniqueTodayCount} unique food${div.uniqueTodayCount === 1 ? '' : 's'} logged today</div>
      <div class="dy-groups">${chips}</div>
      <div class="dy-insight">
        <span class="dy-insight-icon">💡</span>
        <span class="dy-insight-text">${insight}</span>
      </div>
    </div>`;
  }

  // ── Empty state tooltip ─────────────────────────────────────────────────

  function _renderEmptyTip() {
    if (_hasLoggedToday) return '';
    try {
      if (localStorage.getItem('thanzi_diary_tip_dismissed') === '1') return '';
    } catch (e) { /* ignore */ }
    return `
    <div class="dy-empty-tip" id="diary-empty-tip">
      Try adding your first food here!
      <button class="dy-empty-tip-close" id="diary-empty-tip-close" aria-label="Dismiss">✕</button>
    </div>`;
  }

  // ── Master render ────────────────────────────────────────────────────────

  function _render() {
    const panel = document.getElementById('diary-panel');
    if (!panel) return;

    const fig = _energyFigures();

    panel.innerHTML = `
      <div class="dy-page-header">
        <span class="dy-page-title">Diary</span>
        <div class="dy-settings-wrap">
          <button class="dy-settings-btn" id="diary-settings-btn" aria-label="Diary settings" title="Diary settings">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.14.36.22.75.22 1.15V10.85c0 .4-.08.79-.22 1.15z"/>
            </svg>
          </button>
          <div class="dy-settings-menu" id="diary-settings-menu" style="display:none">
            <button class="dy-settings-menu-item" id="diary-menu-targets">
              <span>🎯</span> Nutrient Targets
            </button>
            <button class="dy-settings-menu-item" id="diary-menu-health">
              <span>🔗</span> Health Sync
            </button>
          </div>
        </div>
      </div>

      ${_renderEnergySummary(fig)}
      ${_renderConsumedRing(fig)}
      ${_renderExpenditureRing(fig)}
      ${_renderDiversity()}
      ${_renderEmptyTip()}
    `;

    _bindPanelEvents(fig);
    _paintRings(fig);
  }

  function _paintRings(fig) {
    // Energy ring — remaining vs total target (Target mode) or balance (Balance mode)
    if (_prefs.displayMode === 'balance') {
      const pct = fig.totalTarget > 0 ? fig.consumed / fig.totalTarget : 0;
      _setRing('diary-energy-ring', fig.consumed, fig.totalTarget, {
        big: fig.remaining >= 0 ? `+${fig.remaining}` : `${fig.remaining}`,
        small: fig.remaining >= 0 ? 'under target' : 'over target',
        color: fig.remaining < 0 ? 'var(--orange)' : null,
      });
    } else {
      _setRing('diary-energy-ring', fig.consumed, fig.totalTarget, {
        big: Math.max(fig.remaining, 0),
        small: `of ${fig.totalTarget} kcal left`,
      });
    }

    // Consumed ring
    _setRing('diary-consumed-ring', fig.consumed, fig.target || 2000, {
      big: fig.consumed,
      small: `of ${fig.target || 2000} kcal`,
    });

    // Expenditure ring — always full since it's a breakdown of itself
    _setRing('diary-expenditure-ring', fig.totalExpenditure, fig.totalExpenditure || 1, {
      big: fig.totalExpenditure,
      small: 'kcal today',
    });
  }

  function _bindPanelEvents() {
    document.querySelectorAll('.dy-pref-option').forEach(opt => {
      opt.addEventListener('click', () => {
        _prefs.displayMode = opt.dataset.mode;
        _savePrefs();
        _render();
      });
    });

    const settingsBtn = document.getElementById('diary-settings-btn');
    const settingsMenu = document.getElementById('diary-settings-menu');
    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.style.display = settingsMenu.style.display === 'none' ? 'block' : 'none';
      });
      document.addEventListener('click', () => { settingsMenu.style.display = 'none'; }, { once: true });
    }
    document.getElementById('diary-menu-targets')?.addEventListener('click', () => {
      settingsMenu.style.display = 'none';
      openNutrientTargets();
    });
    document.getElementById('diary-menu-health')?.addEventListener('click', () => {
      settingsMenu.style.display = 'none';
      openHealthSync();
    });

    const tipClose = document.getElementById('diary-empty-tip-close');
    if (tipClose) {
      tipClose.addEventListener('click', (e) => {
        e.stopPropagation();
        try { localStorage.setItem('thanzi_diary_tip_dismissed', '1'); } catch (err) { /* ignore */ }
        const tip = document.getElementById('diary-empty-tip');
        if (tip) tip.remove();
      });
    }
  }

  // ── Nutrient Targets sub-page ──────────────────────────────────────────

  function _renderNutrientRow(item, catKey) {
    const value = _nutrientValue(item.id);
    const pinned = _pins.includes(item.id);
    return `
    <div class="nt-nutrient-row" data-nutrient="${item.id}">
      <div class="nt-nutrient-left">
        <button class="nt-pin-btn ${pinned ? 'pinned' : ''}" data-pin="${item.id}" title="${pinned ? 'Unpin from Diary' : 'Pin to Diary'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>
          </svg>
        </button>
        <span class="nt-nutrient-name">${item.name}</span>
      </div>
      <div class="nt-nutrient-input-wrap">
        <input type="number" class="nt-nutrient-input" data-target="${item.id}" value="${value}" step="any" inputmode="decimal">
        <span class="nt-nutrient-unit">${item.unit}</span>
      </div>
    </div>`;
  }

  function _renderNutrientCategory(catKey, cat) {
    const isOpen = _openCategory === catKey;
    return `
    <div class="nt-category ${isOpen ? 'open' : ''}" data-category="${catKey}">
      <div class="nt-category-header" data-toggle="${catKey}">
        <div class="nt-category-left">
          <span class="nt-category-icon">${cat.icon}</span>
          <div>
            <div class="nt-category-name">${cat.label}</div>
            <div class="nt-category-count">${cat.items.length} nutrient${cat.items.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <svg class="nt-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="nt-category-body">
        ${cat.items.map(i => _renderNutrientRow(i, catKey)).join('')}
      </div>
    </div>`;
  }

  function _renderHighlightSection() {
    if (!_pins.length) {
      return `
      <div class="nt-highlight-section">
        <div class="nt-highlight-title">Highlighted Nutrient Targets</div>
        <div class="nt-highlight-sub">Pin nutrients below to pin them to your main Diary view.</div>
        <div class="nt-highlight-empty">No nutrients pinned yet — tap the ★ pin icon on any nutrient to add it here.</div>
      </div>`;
    }
    const chips = _pins.map(id => {
      const item = _nutrientDefault(id);
      if (!item) return '';
      return `
      <span class="nt-highlight-chip">
        ${item.name}
        <button data-unpin="${id}" aria-label="Unpin ${item.name}">✕</button>
      </span>`;
    }).join('');

    return `
    <div class="nt-highlight-section">
      <div class="nt-highlight-title">Highlighted Nutrient Targets</div>
      <div class="nt-highlight-sub">Pinned nutrients appear on your main Diary view.</div>
      <div class="nt-highlight-chips">${chips}</div>
    </div>`;
  }

  function _renderNutrientTargets() {
    const panel = document.getElementById('nutrient-targets-panel');
    if (!panel) return;

    const categoriesHTML = Object.keys(NUTRIENT_CATALOGUE)
      .map(key => _renderNutrientCategory(key, NUTRIENT_CATALOGUE[key]))
      .join('');

    panel.innerHTML = `
      <div class="nt-page-header">
        <button class="nt-back-btn" id="nt-back-btn" aria-label="Back to Diary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div>
          <div class="nt-page-title">Nutrient Targets</div>
          <div class="nt-page-sub">Tap a category to view and edit your daily targets</div>
        </div>
      </div>

      ${categoriesHTML}
      ${_renderHighlightSection()}
      <div class="nt-toast" id="nt-toast"></div>
    `;

    _bindNutrientTargetsEvents();
  }

  function _showToast(msg) {
    const t = document.getElementById('nt-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1400);
  }

  function _bindNutrientTargetsEvents() {
    document.getElementById('nt-back-btn')?.addEventListener('click', closeNutrientTargets);

    document.querySelectorAll('[data-toggle]').forEach(header => {
      header.addEventListener('click', () => {
        const key = header.dataset.toggle;
        _openCategory = _openCategory === key ? null : key;
        _renderNutrientTargets();
      });
    });

    document.querySelectorAll('.nt-nutrient-input').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.dataset.target;
        const val = parseFloat(input.value);
        if (!isNaN(val)) {
          _targets[id] = val;
          _saveTargets();
          _showToast('Target updated');
        }
      });
    });

    document.querySelectorAll('[data-pin]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.pin;
        if (_pins.includes(id)) {
          _pins = _pins.filter(p => p !== id);
        } else {
          _pins.push(id);
        }
        _savePins();
        _renderNutrientTargets();
      });
    });

    document.querySelectorAll('[data-unpin]').forEach(btn => {
      btn.addEventListener('click', () => {
        _pins = _pins.filter(p => p !== btn.dataset.unpin);
        _savePins();
        _renderNutrientTargets();
      });
    });
  }

  function openNutrientTargets() {
    const diary = document.getElementById('diary-panel');
    const nt = document.getElementById('nutrient-targets-panel');
    if (diary) diary.style.display = 'none';
    if (nt) nt.style.display = 'block';
    _renderNutrientTargets();
  }

  function closeNutrientTargets() {
    const diary = document.getElementById('diary-panel');
    const nt = document.getElementById('nutrient-targets-panel');
    if (nt) nt.style.display = 'none';
    if (diary) diary.style.display = 'block';
  }

  /**
   * Opens the Health Sync panel (ThanziHealthPanel, health-panel.js).
   * Diary hides itself the same way it does for Nutrient Targets; the
   * Health panel's own "back" affordance should call closeHealthSync().
   */
  function openHealthSync() {
    const diary = document.getElementById('diary-panel');
    if (diary) diary.style.display = 'none';
    if (typeof ThanziHealthPanel !== 'undefined') {
      ThanziHealthPanel.open();
    } else {
      // Health module not loaded — fail safe by reopening Diary
      if (diary) diary.style.display = 'block';
      console.warn('ThanziDiary: ThanziHealthPanel is not loaded (missing health-panel.js?)');
    }
  }

  function closeHealthSync() {
    const diary = document.getElementById('diary-panel');
    const hp = document.getElementById('health-panel');
    if (hp) hp.style.display = 'none';
    if (diary) diary.style.display = 'block';
  }

  // ── Public API ────────────────────────────                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         