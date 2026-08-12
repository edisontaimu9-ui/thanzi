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
  let _selectedInterests = []; // currently selected health-interest values
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

  // ── BMR / TDEE calculation ───────────────────────────────────────────────
  // Delegates to ThanziNutrition (thanzi-nutrition.js), which already
  // implements the correct DRI/Krause & Mahan EER equations with
  // sex-specific PA coefficients (Box 2.1: unified normal/overweight/obese
  // adults 19+, BMI ≥18.5 — M: 1.00/1.12/1.27/1.54, F: 1.00/1.14/1.27/1.45).
  // This used to keep its
  // own separate, generic Mifflin-St Jeor-style multiplier set
  // (1.2/1.375/1.55/1.725) which didn't match the engine's real numbers —
  // stats shown here could drift from the actual saved plan. Delegating
  // instead of duplicating means there's only one place these coefficients
  // can ever go stale.

  function _calcBMR(profile) {
    if (!profile || typeof ThanziNutrition === 'undefined') return null;
    const { age, sex, weight_kg, height_m } = profile;
    if (!age || !sex || !weight_kg || !height_m) return null;
    return ThanziNutrition.calcBMR(age, sex, weight_kg, height_m);
  }

  function _calcTDEE(profile) {
    if (!profile || typeof ThanziNutrition === 'undefined') return null;
    const { age, sex, weight_kg, height_m, activity_level } = profile;
    if (!age || !sex || !weight_kg || !height_m || !activity_level) return null;
    return ThanziNutrition.calcEER(age, sex, weight_kg, height_m, activity_level);
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

    _renderRecommendations();
  }

  // ── Recommendations (micronutrient flags + practical tips) ───────────────
  // Sourced from ThanziNutrition.generate()'s existing output —
  // plan.micronutrients.flags and plan.food_recommendations.practical_tips.
  // Nothing new is computed here; this just surfaces data the engine
  // already produces but no panel was rendering.

  function _firstSearchTerm(hint) {
    if (!hint) return '';
    // query_hint looks like "banana OR sweet potato OR beans" — take the
    // first alternative as the actual search box query.
    return hint.split(/\s+OR\s+/i)[0].trim();
  }

  async function _findFoods(hint) {
    const term = _firstSearchTerm(hint);
    if (!term) return;
    if (typeof ThanziApp !== 'undefined' && ThanziApp.openLogPanel) {
      await ThanziApp.openLogPanel();
    }
    if (typeof ThanziLog !== 'undefined' && ThanziLog.searchFor) {
      ThanziLog.searchFor(term);
    }
  }

  function _renderRecommendations() {
    const wrap  = document.getElementById('gl-recs-wrap');
    const flagsEl = document.getElementById('gl-recs-flags');
    const tipsEl  = document.getElementById('gl-recs-tips');
    if (!wrap || !flagsEl || !tipsEl) return;

    const flags = (_plan && _plan.micronutrients && _plan.micronutrients.flags) || [];
    const tips  = (_plan && _plan.food_recommendations && _plan.food_recommendations.practical_tips) || [];

    if (!flags.length && !tips.length) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';

    const _priorityClass = (p) => p === 'high' ? 'high' : (p === 'medium' ? 'med' : 'low');
    const _priorityLabel = (p) => p === 'high' ? 'High priority' : (p === 'medium' ? 'Worth watching' : 'Good to know');

    flagsEl.innerHTML = flags.map((f, i) => `
      <div class="gl-flag gl-flag-${_priorityClass(f.priority)}">
        <div class="gl-flag-top">
          <span class="gl-flag-name">${f.nutrient || f.name || 'Nutrient'}</span>
          <span class="gl-flag-priority">${_priorityLabel(f.priority)}</span>
        </div>
        ${f.note ? `<div class="gl-flag-note">${f.note}</div>` : ''}
        ${f.query_hint ? `<button type="button" class="gl-flag-find-btn" data-idx="${i}">Find foods →</button>` : ''}
      </div>
    `).join('');

    flagsEl.querySelectorAll('.gl-flag-find-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = flags[parseInt(btn.dataset.idx, 10)];
        if (f && f.query_hint) _findFoods(f.query_hint);
      });
    });

    tipsEl.innerHTML = tips.length
      ? `<div class="gl-tips-title">Tips for your goal</div>
         <ul class="gl-tips-list">${tips.map(t => `<li>${t}</li>`).join('')}</ul>`
      : '';
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

  // ── Health-interest chip selection ────────────────────────────────────────

  function _bindInterestChips() {
    document.querySelectorAll('.gl-interest-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.interest;
        btn.classList.toggle('selected');
        const idx = _selectedInterests.indexOf(val);
        if (btn.classList.contains('selected')) {
          if (idx === -1) _selectedInterests.push(val);
        } else if (idx !== -1) {
          _selectedInterests.splice(idx, 1);
        }
      });
    });
  }

  function _restoreInterestChips() {
    _selectedInterests = (_plan && _plan.health_interests)
      || (_profile && _profile.health_interests)
      || [];
    document.querySelectorAll('.gl-interest-btn').forEach(btn => {
      btn.classList.toggle('selected', _selectedInterests.includes(btn.dataset.interest));
    });
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
      health_interests: _selectedInterests,
    });

    if (newPlan.error) {
      _showError(newPlan.error);
      return;
    }

    // Persist
    _plan = newPlan;
    _profile.goal              = _selected;
    _profile.health_interests  = _selectedInterests;
    _plan.inputs             = _profile;
    _plan.health_interests    = _selectedInterests;

    if (_userId) {
      localStorage.setItem('thanzi_profile_' + _userId, JSON.stringify(_plan));
    }

    _saveGoalOverride(_selected, targetWeight);

    // Mirror the daily kcal target to the push_subscriptions doc (if the
    // user has push enabled) so the push-scheduler Worker's Goal Reached
    // webhook handler can compare today's logged calories against it.
    // No-ops quietly if push isn't enabled — nothing to sync yet.
    if (typeof ThanziPush !== 'undefined' && _plan.energy && _plan.energy.target_kcal) {
      ThanziPush.updatePrefs({ dailyGoalKcal: _plan.energy.target_kcal }).catch(() => {});
    }

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

    // Bind goal buttons (exclude health-interest chips, which share styling
    // but use data-interest instead of data-goal and are multi-select)
    document.querySelectorAll('.gl-goal-btn[data-goal]').forEach(btn => {
      btn.addEventListener('click', () => _setSelected(btn.dataset.goal));
    });

    // Bind health-interest chips
    _bindInterestChips();

    // Bind save
    const saveBtn = document.getElementById('gl-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', _saveGoal);

    // Pre-select current goal
    const currentGoal = _profile ? _profile.goal : null;
    if (currentGoal) _setSelected(currentGoal);

    // Pre-select current health interests
    _restoreInterestChips();

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

    _restoreInterestChips();

    const tw = _loadTargetWeight();
    const twInput = document.getElementById('gl-target-weight-input');
    if (twInput && tw) twInput.value = tw;

    _renderStats();
    _renderTargets();
  }

  return { init, refresh };
})();

// Init is called by ThanziProfile when the Health & Goals tab is opened.
