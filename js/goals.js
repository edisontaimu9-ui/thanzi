/**
 * goals.js — Thanzi Goals Panel
 *
 * Reads the user's saved nutrition plan (thanzi_profile_<uid>) to show
 * current Weight, BMR, TDEE, and daily macro targets.
 * Lets the user change their goal (lose / maintain / gain) and optional
 * target weight, then regenerates and saves the plan.
 *
 * Depends on: ThanziNutrition (thanzi-nutrition.js), ThanziAuth (auth.js)
 * Panel element: #goals-panel
 */
const ThanziGoals = (() => {
  'use strict';

  const GOALS_KEY = 'thanzi_goals_override'; // stores { goal, targetWeight }

  let _plan     = null;   // current nutrition plan object
  let _profile  = null;   // raw profile inputs { age, sex, weight_kg, height_m, activity_level, goal }
  let _selected = null;   // currently selected goal button value
  let _userId   = null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = (val === null || val === undefined) ? '—' : val;
  }

  function _showError(msg) {
    const el = document.getElementById('gl-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('visible', !!msg);
  }

  function _showSuccess(msg) {
    const el = document.getElementById('gl-success');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('visible', !!msg);
    if (msg) setTimeout(() => _showSuccess(''), 2500);
  }

  // ── Load plan from localStorage ───────────────────────────────────────────

  function _loadPlan() {
    try {
      if (!_userId) return;
      const raw = localStorage.getItem('thanzi_profile_' + _userId);
      if (!raw) return;
      _plan = JSON.parse(raw);

      // Reconstruct the original profile inputs from the stored plan
      // (plan stores them under plan.inputs if ThanziNutrition puts them there,
      //  otherwise we fall back to what we can derive)
      _profile = _plan.inputs || null;
    } catch (e) { _plan = null; }
  }

  // ── BMR / TDEE calculation (Mifflin-St Jeor) ─────────────────────────────
  // Used to display stats; the authoritative recalculation goes through
  // ThanziNutrition.generate() when saving.

  function _calcBMR(profile) {
    if (!profile) return null;
    const { age, sex, weight_kg, height_m } = profile;
    const h = height_m * 100; // cm
    if (sex === 'M') return Math.round(10 * weight_kg + 6.25 * h - 5 * age + 5);
    return Math.round(10 * weight_kg + 6.25 * h - 5 * age - 161);
  }

  const ACTIVITY_MULTS = {
    sedentary:   1.2,
    low_active:  1.375,
    active:      1.55,
    very_active: 1.725,
  };

  function _calcTDEE(profile) {
    const bmr = _calcBMR(profile);
    if (!bmr) return null;
    const mult = ACTIVITY_MULTS[profile.activity_level] || 1.4;
    return Math.round(bmr * mult);
  }

  // ── Render banner & stat cards ────────────────────────────────────────────

  function _renderStats() {
    const weight  = _profile ? _profile.weight_kg : (_plan ? null : null);
    const bmr     = _calcBMR(_profile);
    const tdee    = _calcTDEE(_profile);
    const dailyKcal = _plan ? _plan.energy.target_kcal : null;

    // Banner
    _setText('gl-stat-daily',   dailyKcal || '—');
    _setText('gl-stat-target',  _loadTargetWeight() ? _loadTargetWeight() + ' kg' : (weight ? weight + ' kg' : '—'));
    _setText('gl-stat-togo',    _calcToGo());

    // Stat cards
    _setText('gl-card-weight', weight  || '—');
    _setText('gl-card-bmr',    bmr     || '—');
    _setText('gl-card-tdee',   tdee    || '—');
  }

  function _calcToGo() {
    const target  = parseFloat(_loadTargetWeight());
    const current = _profile ? _profile.weight_kg : null;
    if (!target || !current) return '0.0';
    return Math.round(Math.abs(target - current) * 10) / 10;
  }

  // ── Render daily targets card ─────────────────────────────────────────────

  function _renderTargets() {
    if (!_plan) {
      document.getElementById('gl-targets-card').style.display = 'none';
      return;
    }
    document.getElementById('gl-targets-card').style.display = 'block';

    const kcal    = _plan.energy.target_kcal;
    const protein = _plan.macros.protein.g;
    const carbs   = _plan.macros.carbs.g;
    const fat     = _plan.macros.fat.g;
    const tdee    = _calcTDEE(_profile);

    _setText('gl-tgt-kcal',    kcal);
    _setText('gl-tgt-kcal-sub', tdee ? tdee + ' TDEE' : '');
    _setText('gl-tgt-protein', protein + 'g');
    _setText('gl-tgt-carbs',   carbs + 'g');
    _setText('gl-tgt-fat',     fat + 'g');
  }

  // ── Goal selection UI ─────────────────────────────────────────────────────

  function _setSelected(val) {
    _selected = val;
    document.querySelectorAll('.gl-goal-btn').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.goal === val);
    });

    // Show target weight input only for lose/gain
    const wrap = document.getElementById('gl-target-wrap');
    if (wrap) wrap.classList.toggle('visible', val === 'lose' || val === 'gain');
  }

  // ── Target weight persistence ─────────────────────────────────────────────

  function _loadTargetWeight() {
    try {
      const raw = localStorage.getItem(GOALS_KEY);
      if (!raw) return null;
      return JSON.parse(raw).targetWeight || null;
    } catch (e) { return null; }
  }

  function _saveGoalOverride(goal, targetWeight) {
    try {
      localStorage.setItem(GOALS_KEY, JSON.stringify({ goal, targetWeight }));
    } catch (e) {}
  }

  // ── Save goal ─────────────────────────────────────────────────────────────

  async function _saveGoal() {
    _showError('');
    _showSuccess('');

    if (!_selected) {
      _showError('Please select a goal first.');
      return;
    }

    if (!_profile) {
      _showError('Profile not found. Please complete your profile setup.');
      return;
    }

    // Validate target weight if shown
    let targetWeight = null;
    if (_selected === 'lose' || _selected === 'gain') {
      const tw = parseFloat(document.getElementById('gl-target-weight-input').value);
      if (tw && (tw < 20 || tw > 500)) {
        _showError('Please enter a valid target weight.');
        return;
      }
      targetWeight = tw || null;
    }

    // Regenerate the plan with the new goal
    if (typeof ThanziNutrition === 'undefined') {
      _showError('Nutrition engine not loaded.');
      return;
    }

    const newPlan = ThanziNutrition.generate({
      ..._profile,
      goal: _selected,
    });

    if (newPlan.error) {
      _showError(newPlan.error);
      return;
    }

    // Persist
    _plan = newPlan;
    _profile.goal = _selected;
    _plan.inputs  = _profile;

    if (_userId) {
      localStorage.setItem('thanzi_profile_' + _userId, JSON.stringify(_plan));
    }

    _saveGoalOverride(_selected, targetWeight);

    // Update the live app calorie goal
    if (typeof ThanziApp !== 'undefined') {
      ThanziApp.applyPlanPublic
        ? ThanziApp.applyPlanPublic(_plan)
        : console.log('[Goals] ThanziApp.applyPlanPublic not exposed — reload to apply');
    }

    _renderStats();
    _renderTargets();
    _showSuccess('Goal saved! Your daily targets have been updated.');
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init() {
    // Get user ID
    try {
      if (typeof ThanziAuth !== 'undefined') {
        const u = await ThanziAuth.getUser();
        if (u) _userId = u.$id;
      }
    } catch (e) {}

    _loadPlan();

    // Bind goal buttons
    document.querySelectorAll('.gl-goal-btn').forEach(btn => {
      btn.addEventListener('click', () => _setSelected(btn.dataset.goal));
    });

    // Bind save
    const saveBtn = document.getElementById('gl-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', _saveGoal);

    // Pre-select current goal
    const currentGoal = _profile ? _profile.goal : null;
    if (currentGoal) _setSelected(currentGoal);

    // Restore target weight
    const tw = _loadTargetWeight();
    const twInput = document.getElementById('gl-target-weight-input');
    if (twInput && tw) twInput.value = tw;

    _renderStats();
    _renderTargets();
  }

  /** Called by drawer when panel is shown */
  async function refresh() {
    try {
      if (typeof ThanziAuth !== 'undefined') {
        const u = await ThanziAuth.getUser();
        if (u) _userId = u.$id;
      }
    } catch (e) {}

    _loadPlan();

    const currentGoal = _profile ? _profile.goal : null;
    if (currentGoal) _setSelected(currentGoal);

    const tw = _loadTargetWeight();
    const twInput = document.getElementById('gl-target-weight-input');
    if (twInput && tw) twInput.value = tw;

    _renderStats();
    _renderTargets();
  }

  return { init, refresh };
})();

// Init is called by ThanziProfile when the Health & Goals tab is opened.
