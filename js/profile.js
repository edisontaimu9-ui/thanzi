/**
 * profile.js — Thanzi Profile Panel
 *
 * Wires all 5 sub-tabs:
 *   Profile       — name, bio, avatar, save
 *   Health & Goals — powered by ThanziGoals (goals.js)
 *   Notifications — notification toggles + times
 *   Progress      — inline charts powered by ThanziProgress
 *   Achievements  — badge system calculated from logs
 */
const ThanziProfile = (() => {

  const AVATAR_MAX_DIM      = 480;
  const AVATAR_JPEG_QUALITY = 0.82;
  const AVATAR_MAX_BYTES    = 5 * 1024 * 1024;
  const NOTIF_KEY           = 'thanzi_notifications';

  let _user = null;

  const _el = (id) => document.getElementById(id);

  const _planKey   = (uid) => `thanzi_profile_${uid}`;
  const _avatarKey = (uid) => `thanzi_avatar_${uid}`;
  const _bioKey    = (uid) => `thanzi_bio_${uid}`;

  // ── Stat cards (BMI / BMR / TDEE) ─────────────────────────────────────

  const _renderStats = (uid) => {
    let plan;
    try {
      const raw = localStorage.getItem(_planKey(uid));
      plan = raw ? JSON.parse(raw) : null;
    } catch (e) { plan = null; }
    const a = plan && plan.assessment;
    if (!a) return;
    _el('profile-bmi').textContent     = a.bmi;
    _el('profile-bmi-cat').textContent = a.bmi_category;
    _el('profile-bmr').textContent     = Math.round(a.bmr_kcal);
    _el('profile-tdee').textContent    = Math.round(a.eer_kcal);
  };

  const _renderAccount = (user) => {
    _el('profile-email').textContent = user.email || '—';
    _el('profile-name').value = user.name || '';
  };

  // ── Avatar ────────────────────────────────────────────────────────────

  const _showAvatar = (dataUrl) => {
    const img    = _el('avatar-img');
    const circle = _el('avatar-circle');
    if (dataUrl) {
      img.src = dataUrl;
      img.style.display = 'block';
      circle.classList.add('has-photo');
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      circle.classList.remove('has-photo');
    }
  };

  const _loadAvatar = (uid) => {
    let stored = null;
    try { stored = localStorage.getItem(_avatarKey(uid)); } catch (e) {}
    _showAvatar(stored);
  };

  const _resizeImage = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, AVATAR_MAX_DIM / Math.max(width, height));
        width  = Math.max(1, Math.round(width  * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const _bindAvatarUpload = (uid) => {
    const input = _el('avatar-file-input');
    _el('avatar-upload-btn').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\/(jpeg|png)$/.test(file.type)) { _flash('Please choose a JPG or PNG image.', true); return; }
      if (file.size > AVATAR_MAX_BYTES) { _flash('That image is larger than 5MB.', true); return; }
      try {
        const dataUrl = await _resizeImage(file);
        try { localStorage.setItem(_avatarKey(uid), dataUrl); } catch (e) { _flash('Photo processed but could not be saved.', true); return; }
        _showAvatar(dataUrl);
        _flash('Photo updated.');
      } catch (err) {
        _flash(err.message || 'Could not process that image.', true);
      }
    });
  };

  // ── Save (name + bio) ─────────────────────────────────────────────────

  let _flashTimer = null;
  const _flash = (msg, isError = false) => {
    const el = _el('profile-save-msg');
    el.textContent = msg;
    el.classList.toggle('error', isError);
    el.style.display = 'block';
    clearTimeout(_flashTimer);
    _flashTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
  };

  const _bindSave = (uid) => {
    _el('profile-save-btn').addEventListener('click', async () => {
      const name = _el('profile-name').value.trim();
      const bio  = _el('profile-bio').value.trim();
      if (!name) { _flash("Full name can't be empty.", true); return; }
      const btn = _el('profile-save-btn');
      btn.disabled = true;
      try {
        if (typeof ThanziAuth.updateName === 'function') {
          const result = await ThanziAuth.updateName(name);
          if (!result.success) { _flash(result.error || 'Could not update name.', true); return; }
        }
        try { localStorage.setItem(_bioKey(uid), bio); } catch (e) {}
        _flash('Profile saved.');
      } catch (err) {
        _flash(err.message || 'Could not save profile.', true);
      } finally {
        btn.disabled = false;
      }
    });
  };

  // ── Sub-tabs ──────────────────────────────────────────────────────────

  const TAB_IDS = {
    profile:       'ptab-profile',
    goals:         'ptab-goals',
    notifications: 'ptab-notifications',
    progress:      'ptab-progress',
    achievements:  'ptab-achievements',
  };

  let _progressTabInited = false;

  const _bindSubtabs = () => {
    document.querySelectorAll('.psub-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.psub-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.ptab;
        // Hide all content panes
        Object.values(TAB_IDS).forEach(id => {
          const el = _el(id);
          if (el) el.style.display = 'none';
        });
        // Show selected pane
        const pane = _el(TAB_IDS[tab]);
        if (pane) pane.style.display = 'block';

        // Tab-specific refresh
        if (tab === 'goals' && typeof ThanziGoals !== 'undefined') {
          ThanziGoals.refresh();
        } else if (tab === 'progress') {
          _initProgressTab();
        } else if (tab === 'achievements') {
          _renderAchievements();
        } else if (tab === 'notifications') {
          _loadNotifPrefs();
        }
      });
    });
  };

  // ── Progress Tab (inline charts) ──────────────────────────────────────

  let _ptabWeightChart = null;
  let _ptabCalChart    = null;
  let _ptabWaterChart  = null;

  function _destroyChart(c) {
    if (c) { try { c.destroy(); } catch (_) {} } return null;
  }

  function _cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function _today() { return new Date().toISOString().split('T')[0]; }

  function _lastNDays(n) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }

  function _shortDay(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' });
  }

  function _baseChartOpts() {
    const muted  = _cssVar('--text-muted',   '#888');
    const border = _cssVar('--border',       'rgba(255,255,255,.08)');
    const bgCard = _cssVar('--bg-card',      '#1e1e2e');
    const prim   = _cssVar('--text-primary', '#fff');
    return {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: bgCard, titleColor: prim, bodyColor: prim, borderColor: border, borderWidth: 1, padding: 8 },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, font: { size: 10 } } },
        y: { grid: { color: border  }, border: { display: false }, ticks: { color: muted, font: { size: 10 }, maxTicksLimit: 4 } },
      },
    };
  }

  function _makeCanvas(containerId, canvasId) {
    const wrap = _el(containerId);
    wrap.innerHTML = `<div style="position:relative;height:130px"><canvas id="${canvasId}"></canvas></div>`;
    return _el(canvasId).getContext('2d');
  }

  async function _getDb() {
    if (typeof Appwrite === 'undefined' || typeof THANZI_CONFIG === 'undefined') return null;
    const client = new Appwrite.Client().setEndpoint(THANZI_CONFIG.endpoint).setProject(THANZI_CONFIG.projectId);
    return new Appwrite.Databases(client);
  }

  async function _renderPtabWeight() {
    const chartEl  = _el('ptab-prog-weight-chart');
    const listEl   = _el('ptab-prog-weight-list');
    const latestEl = _el('ptab-prog-weight-latest');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';
    _ptabWeightChart = _destroyChart(_ptabWeightChart);

    const db = await _getDb();
    let logs = [];
    if (db && _user) {
      try {
        const res = await db.listDocuments(
          THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.weightLogs,
          [Appwrite.Query.equal('userId', _user.$id), Appwrite.Query.orderDesc('date'), Appwrite.Query.limit(30)]
        );
        logs = res.documents;
      } catch (e) { console.error('ptab weight:', e.message); }
    }

    if (logs.length) {
      latestEl.textContent   = `${logs[0].weight} kg`;
      latestEl.style.display = 'inline-block';
    } else {
      latestEl.style.display = 'none';
    }

    if (logs.length < 2) {
      chartEl.innerHTML = logs.length
        ? `<p class="prog-chart-empty">⚖️ ${logs[0].weight} kg on ${logs[0].date}<br>Log more to see a trend.</p>`
        : '<p class="prog-chart-empty">Log your weight to see trends.</p>';
    } else {
      const data   = logs.slice(0, 10).reverse();
      const accent = _cssVar('--accent', '#6c63ff');
      const ctx    = _makeCanvas('ptab-prog-weight-chart', 'ptab-wc');
      _ptabWeightChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.map(l => l.date.slice(5)),
          datasets: [{ label: 'Weight (kg)', data: data.map(l => l.weight),
            borderColor: accent, backgroundColor: accent + '28', fill: true, tension: 0.35,
            pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: accent,
            pointBorderColor: _cssVar('--bg-card','#1e1e2e'), pointBorderWidth: 2 }],
        },
        options: { ..._baseChartOpts(),
          plugins: { ..._baseChartOpts().plugins,
            tooltip: { ..._baseChartOpts().plugins.tooltip, callbacks: { label: c => `${c.parsed.y} kg` } } } },
      });
    }

    if (!logs.length) { if (listEl) listEl.innerHTML = ''; return; }
    listEl.innerHTML = logs.slice(0, 5).map(l =>
      `<div class="prog-list-row">
        <span class="prog-list-val">${l.weight} kg</span>
        <span class="prog-list-date">${l.date}</span>
        <button class="prog-list-del" data-id="${l.$id}">✕</button>
      </div>`
    ).join('');
    listEl.querySelectorAll('.prog-list-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const db2 = await _getDb();
        if (db2) {
          try { await db2.deleteDocument(THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.weightLogs, btn.dataset.id); } catch(e) {}
        }
        _renderPtabWeight();
      });
    });
  }

  async function _renderPtabCalories() {
    const chartEl = _el('ptab-prog-cal-chart');
    const goalEl  = _el('ptab-prog-cal-goal-label');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';
    _ptabCalChart = _destroyChart(_ptabCalChart);

    const days = _lastNDays(7);
    let docs = [];
    const db = await _getDb();
    if (db && _user) {
      try {
        const res = await db.listDocuments(
          THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.foodLogs,
          [Appwrite.Query.equal('userId', _user.$id), Appwrite.Query.greaterThanEqual('date', days[0]), Appwrite.Query.limit(500)]
        );
        docs = res.documents;
      } catch(e) { console.error('ptab cal:', e.message); }
    }

    const byDate = {};
    docs.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + (d.calories || 0); });

    let plan = null;
    try { if (_user) plan = JSON.parse(localStorage.getItem(`thanzi_profile_${_user.$id}`) || 'null'); } catch(e) {}
    const goal = plan?.energy?.target_kcal || 2000;
    goalEl.textContent = `Goal: ${goal} kcal/day`;

    const labels = days.map(d => _shortDay(d));
    const values = days.map(d => Math.round(byDate[d] || 0));
    const accent = _cssVar('--accent', '#6c63ff');
    const ctx    = _makeCanvas('ptab-prog-cal-chart', 'ptab-cc');

    _ptabCalChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Calories', data: values,
            backgroundColor: values.map(v => v > goal * 1.02 ? '#ef4444cc' : accent + 'cc'),
            borderRadius: 5, borderSkipped: false, order: 2 },
          { type: 'line', label: 'Goal', data: Array(7).fill(goal),
            borderColor: _cssVar('--text-muted','#888') + 'bb', borderDash: [6,4], borderWidth: 1.8,
            pointRadius: 0, fill: false, tension: 0, order: 1 },
        ],
      },
      options: { ..._baseChartOpts(),
        plugins: { ..._baseChartOpts().plugins,
          tooltip: { ..._baseChartOpts().plugins.tooltip,
            callbacks: { label: c => c.datasetIndex === 0 ? `${c.parsed.y} kcal` : `Goal: ${goal} kcal` } } } },
    });
  }

  async function _renderPtabWater() {
    const chartEl = _el('ptab-prog-water-chart');
    const goalEl  = _el('ptab-prog-water-goal-label');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';
    _ptabWaterChart = _destroyChart(_ptabWaterChart);

    const days = _lastNDays(7);
    let docs = [];
    const db = await _getDb();
    if (db && _user) {
      try {
        const res = await db.listDocuments(
          THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.waterLogs,
          [Appwrite.Query.equal('userId', _user.$id), Appwrite.Query.greaterThanEqual('date', days[0]), Appwrite.Query.limit(500)]
        );
        docs = res.documents;
      } catch(e) { console.error('ptab water:', e.message); }
    }

    const byDate = {};
    docs.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + (d.amount || 0); });

    let plan = null;
    try { if (_user) plan = JSON.parse(localStorage.getItem(`thanzi_profile_${_user.$id}`) || 'null'); } catch(e) {}
    const waterGoal = plan?.micronutrients?.fluid_L ? Math.round(plan.micronutrients.fluid_L * 1000) : 2000;
    goalEl.textContent = `Goal: ${waterGoal} ml/day`;

    const labels = days.map(d => _shortDay(d));
    const values = days.map(d => Math.round(byDate[d] || 0));
    const ctx    = _makeCanvas('ptab-prog-water-chart', 'ptab-wac');

    _ptabWaterChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Water', data: values,
            backgroundColor: values.map(v => v > waterGoal * 1.02 ? '#ef4444cc' : '#3b82f6cc'),
            borderRadius: 5, borderSkipped: false, order: 2 },
          { type: 'line', label: 'Goal', data: Array(7).fill(waterGoal),
            borderColor: _cssVar('--text-muted','#888') + 'bb', borderDash: [6,4], borderWidth: 1.8,
            pointRadius: 0, fill: false, tension: 0, order: 1 },
        ],
      },
      options: { ..._baseChartOpts(),
        plugins: { ..._baseChartOpts().plugins,
          tooltip: { ..._baseChartOpts().plugins.tooltip,
            callbacks: { label: c => c.datasetIndex === 0 ? `${c.parsed.y} ml` : `Goal: ${waterGoal} ml` } } },
        scales: { ..._baseChartOpts().scales,
          y: { ..._baseChartOpts().scales.y,
            ticks: { ..._baseChartOpts().scales.y.ticks, callback: v => v >= 1000 ? (v/1000).toFixed(1)+'L' : v+'ml' } } } },
    });
  }

  function _bindWeightFormInline() {
    const toggleBtn = _el('ptab-prog-log-weight-btn');
    const form      = _el('ptab-prog-weight-form');
    const saveBtn   = _el('ptab-prog-weight-save-btn');
    const cancelBtn = _el('ptab-prog-weight-cancel-btn');
    const dateInput = _el('ptab-prog-weight-date');
    const errorEl   = _el('ptab-prog-weight-error');
    if (!toggleBtn) return;

    dateInput.value = _today(); dateInput.max = _today();

    toggleBtn.addEventListener('click', () => {
      const vis = form.style.display !== 'none';
      form.style.display = vis ? 'none' : 'block';
      if (!vis) { _el('ptab-prog-weight-input').value = ''; dateInput.value = _today(); errorEl.textContent = ''; }
    });
    cancelBtn.addEventListener('click', () => { form.style.display = 'none'; });
    saveBtn.addEventListener('click', async () => {
      const weight = parseFloat(_el('ptab-prog-weight-input').value);
      const date   = dateInput.value || _today();
      if (!weight || weight < 20 || weight > 350) { errorEl.textContent = 'Enter a valid weight (20–350 kg).'; return; }
      errorEl.textContent = ''; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      const db = await _getDb();
      if (db && _user) {
        try {
          await db.createDocument(THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.weightLogs,
            Appwrite.ID.unique(), { userId: _user.$id, weight, date });
          form.style.display = 'none';
          _el('ptab-prog-weight-input').value = '';
        } catch(e) { errorEl.textContent = 'Could not save. Try again.'; }
      }
      saveBtn.textContent = 'Save'; saveBtn.disabled = false;
      _renderPtabWeight();
    });
  }

  function _initProgressTab() {
    if (!_progressTabInited) {
      _bindWeightFormInline();
      _progressTabInited = true;
    }
    Promise.all([_renderPtabWeight(), _renderPtabCalories(), _renderPtabWater()]);
  }

  // ── Notifications Tab ─────────────────────────────────────────────────

  const NOTIF_DEFAULTS = {
    mealReminders: false, mealBreakfast: '08:00', mealLunch: '12:30', mealDinner: '19:00',
    waterReminders: false, waterInterval: 2,
    weeklyReport: false, goalAlert: true,
  };

  function _loadNotifPrefs() {
    let prefs = { ...NOTIF_DEFAULTS };
    try { const raw = localStorage.getItem(NOTIF_KEY); if (raw) prefs = { ...NOTIF_DEFAULTS, ...JSON.parse(raw) }; } catch(e) {}

    const set = (id, val) => { const el = _el(id); if (el) { if (el.type === 'checkbox') el.checked = val; else el.value = val; } };
    set('pntf-meal-remind',   prefs.mealReminders);
    set('pntf-time-breakfast', prefs.mealBreakfast);
    set('pntf-time-lunch',     prefs.mealLunch);
    set('pntf-time-dinner',    prefs.mealDinner);
    set('pntf-water-remind',   prefs.waterReminders);
    set('pntf-weekly-report',  prefs.weeklyReport);
    set('pntf-goal-alert',     prefs.goalAlert);
    const wiv = _el('pntf-water-interval-val');
    if (wiv) wiv.textContent = prefs.waterInterval + ' hrs';
    _el('pntf-water-interval-val').__val = prefs.waterInterval;

    // Toggle sub-rows
    const mealRow  = _el('pntf-meal-time-row');
    const waterRow = _el('pntf-water-interval-row');
    if (mealRow)  mealRow.style.display  = prefs.mealReminders  ? 'flex' : 'none';
    if (waterRow) waterRow.style.display = prefs.waterReminders ? 'flex' : 'none';
  }

  function _bindNotifTab() {
    const mealChk  = _el('pntf-meal-remind');
    const waterChk = _el('pntf-water-remind');

    if (mealChk) mealChk.addEventListener('change', () => {
      const r = _el('pntf-meal-time-row');
      if (r) r.style.display = mealChk.checked ? 'flex' : 'none';
    });
    if (waterChk) waterChk.addEventListener('change', () => {
      const r = _el('pntf-water-interval-row');
      if (r) r.style.display = waterChk.checked ? 'flex' : 'none';
    });

    // Water interval stepper
    let _wInterval = NOTIF_DEFAULTS.waterInterval;
    const wValEl = _el('pntf-water-interval-val');
    const _setWI = (v) => {
      _wInterval = Math.max(1, Math.min(8, v));
      if (wValEl) { wValEl.textContent = _wInterval + ' hrs'; wValEl.__val = _wInterval; }
    };
    const minus = _el('pntf-water-minus');
    const plus  = _el('pntf-water-plus');
    if (minus) minus.addEventListener('click', () => _setWI(_wInterval - 1));
    if (plus)  plus.addEventListener('click',  () => _setWI(_wInterval + 1));

    // Save
    const saveBtn = _el('pntf-save-btn');
    const saveMsg = _el('pntf-save-msg');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const prefs = {
        mealReminders:  _el('pntf-meal-remind')?.checked  ?? false,
        mealBreakfast:  _el('pntf-time-breakfast')?.value || '08:00',
        mealLunch:      _el('pntf-time-lunch')?.value     || '12:30',
        mealDinner:     _el('pntf-time-dinner')?.value    || '19:00',
        waterReminders: _el('pntf-water-remind')?.checked ?? false,
        waterInterval:  wValEl?.__val || _wInterval,
        weeklyReport:   _el('pntf-weekly-report')?.checked ?? false,
        goalAlert:      _el('pntf-goal-alert')?.checked    ?? true,
      };
      try { localStorage.setItem(NOTIF_KEY, JSON.stringify(prefs)); } catch(e) {}
      // Also sync with ThanziSettings if available
      if (typeof ThanziSettings !== 'undefined' && ThanziSettings.set) {
        ThanziSettings.set('mealReminders',  prefs.mealReminders);
        ThanziSettings.set('waterReminders', prefs.waterReminders);
        ThanziSettings.set('weeklyReport',   prefs.weeklyReport);
      }
      if (saveMsg) {
        saveMsg.textContent = '✓ Preferences saved';
        saveMsg.style.display = 'block';
        setTimeout(() => { saveMsg.style.display = 'none'; }, 2500);
      }
    });
  }

  // ── Achievements Tab ──────────────────────────────────────────────────

  const ACHIEVEMENTS = [
    { id: 'first_log',    icon: '🥗', title: 'First Bite',       desc: 'Log your first meal',               check: (s) => s.foodLogs >= 1 },
    { id: 'log_7',        icon: '📅', title: 'Week Warrior',     desc: 'Log meals for 7 days',              check: (s) => s.logDays >= 7 },
    { id: 'log_30',       icon: '🗓️', title: 'Monthly Master',   desc: 'Log meals for 30 days',             check: (s) => s.logDays >= 30 },
    { id: 'goal_set',     icon: '🎯', title: 'Goal Setter',      desc: 'Set your health goal',              check: (s) => s.goalSet },
    { id: 'weight_1',     icon: '⚖️', title: 'Scale Check',      desc: 'Log your first weight entry',       check: (s) => s.weightLogs >= 1 },
    { id: 'weight_5',     icon: '📉', title: 'Tracking Progress', desc: 'Log weight 5 times',               check: (s) => s.weightLogs >= 5 },
    { id: 'water_goal',   icon: '💧', title: 'Hydration Hero',   desc: 'Hit your water goal on any day',    check: (s) => s.waterGoalHit >= 1 },
    { id: 'cal_goal',     icon: '🔥', title: 'Calorie Crusader', desc: 'Hit calorie goal on any day',       check: (s) => s.calGoalHit >= 1 },
    { id: 'streak_3',     icon: '🔥', title: 'On a Roll',        desc: '3-day logging streak',              check: (s) => s.streak >= 3 },
    { id: 'streak_7',     icon: '⚡', title: 'Unstoppable',      desc: '7-day logging streak',              check: (s) => s.streak >= 7 },
    { id: 'profile_done', icon: '👤', title: 'Profile Pro',      desc: 'Complete your profile setup',       check: (s) => s.profileDone },
    { id: 'plan_saved',   icon: '📋', title: 'Nutrition Nerd',   desc: 'Save a nutrition plan',             check: (s) => s.planSaved },
  ];

  async function _buildStats() {
    const stats = {
      foodLogs: 0, logDays: 0, weightLogs: 0, waterGoalHit: 0,
      calGoalHit: 0, streak: 0, goalSet: false, profileDone: false, planSaved: false,
    };

    // Check local data
    if (_user) {
      const planRaw = localStorage.getItem(`thanzi_profile_${_user.$id}`);
      if (planRaw) {
        try {
          const plan = JSON.parse(planRaw);
          stats.planSaved = true;
          stats.profileDone = !!(plan.inputs);
          const goal = plan.inputs?.goal;
          stats.goalSet = !!(goal);
        } catch(e) {}
      }

      // Pull from Appwrite if available
      const db = await _getDb();
      if (db) {
        // Food logs
        try {
          const fr = await db.listDocuments(THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.foodLogs,
            [Appwrite.Query.equal('userId', _user.$id), Appwrite.Query.limit(500)]);
          stats.foodLogs = fr.total;
          const uniqueDays = new Set(fr.documents.map(d => d.date));
          stats.logDays = uniqueDays.size;

          // Streak — count consecutive days backwards from today
          let streak = 0;
          const today = _today();
          for (let i = 0; i < 365; i++) {
            const d = new Date(); d.setDate(d.getDate() - i);
            if (uniqueDays.has(d.toISOString().split('T')[0])) streak++;
            else if (i > 0) break;
          }
          stats.streak = streak;
        } catch(e) {}

        // Weight logs
        try {
          const wr = await db.listDocuments(THANZI_CONFIG.databaseId, THANZI_CONFIG.collections.weightLogs,
            [Appwrite.Query.equal('userId', _user.$id), Appwrite.Query.limit(100)]);
          stats.weightLogs = wr.total;
        } catch(e) {}
      }
    }
    return stats;
  }

  async function _renderAchievements() {
    const container = _el('ptab-achievements-list');
    if (!container) return;
    container.innerHTML = '<p class="prog-chart-loading" style="padding:24px 0">Loading achievements…</p>';

    const stats = await _buildStats();
    const earned = JSON.parse(localStorage.getItem('thanzi_achievements') || '{}');

    // Stamp newly earned
    const now = new Date().toISOString();
    ACHIEVEMENTS.forEach(a => {
      if (a.check(stats) && !earned[a.id]) earned[a.id] = now;
    });
    try { localStorage.setItem('thanzi_achievements', JSON.stringify(earned)); } catch(e) {}

    const unlocked = ACHIEVEMENTS.filter(a => earned[a.id]);
    const locked   = ACHIEVEMENTS.filter(a => !earned[a.id]);

    let html = '';
    if (unlocked.length) {
      html += `<div class="ach-group-title">🏆 Earned (${unlocked.length})</div>`;
      html += unlocked.map(a => `
        <div class="ach-badge earned">
          <div class="ach-icon">${a.icon}</div>
          <div class="ach-info">
            <div class="ach-title">${a.title}</div>
            <div class="ach-desc">${a.desc}</div>
          </div>
          <div class="ach-check">✓</div>
        </div>`).join('');
    }
    if (locked.length) {
      html += `<div class="ach-group-title" style="margin-top:16px">🔒 Locked (${locked.length})</div>`;
      html += locked.map(a => `
        <div class="ach-badge locked">
          <div class="ach-icon locked-icon">${a.icon}</div>
          <div class="ach-info">
            <div class="ach-title">${a.title}</div>
            <div class="ach-desc">${a.desc}</div>
          </div>
        </div>`).join('');
    }

    container.innerHTML = html || '<p class="prog-chart-empty">No achievements yet. Start logging!</p>';
  }

  // ── Public API ────────────────────────────────────────────────────────

  const init = (user) => {
    _user = user;
    _renderStats(user.$id);
    _renderAccount(user);
    let bio = '';
    try { bio = localStorage.getItem(_bioKey(user.$id)) || ''; } catch(e) {}
    _el('profile-bio').value = bio;
    _loadAvatar(user.$id);
    _bindAvatarUpload(user.$id);
    _bindSubtabs();
    _bindSave(user.$id);
    _bindNotifTab();
    // Init Goals module inside the tab
    if (typeof ThanziGoals !== 'undefined') ThanziGoals.init();
  };

  const refresh = () => {
    if (_user) _renderStats(_user.$id);
  };

  return { init, refresh };
})();
