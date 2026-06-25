/**
 * progress.js — Thanzi Progress Panel (Chart.js 4.5.1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Three sections:
 *   1. Weight tracker  — line chart + log / view / delete (weight_logs)
 *   2. Calorie history — 7-day bar chart + goal line (food_logs)
 *   3. Water history   — 7-day bar chart + goal line (water_logs)
 *
 * Public API: init(user), refresh(), saveWater(ml)
 *
 * Requires: Chart.js 4.5.1 (loaded before this file)
 * Author: Edison Taimu — Thanzi
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziProgress = (() => {
  'use strict';

  // ── Appwrite ───────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);
  const _db = new Appwrite.Databases(_client);

  // ── State ──────────────────────────────────────────────────────────────────
  let _user    = null;
  let _loading = false;

  // Chart.js instances — destroyed before each re-render
  let _weightChart = null;
  let _calChart    = null;
  let _waterChart  = null;

  // ── DOM helper ─────────────────────────────────────────────────────────────
  const _el = id => document.getElementById(id);

  // ── Date helpers ───────────────────────────────────────────────────────────

  function _today() {
    return new Date().toISOString().split('T')[0];
  }

  function _lastNDays(n = 7) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }

  function _shortDay(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-MW', { weekday: 'short' });
  }

  function _mmdd(iso) {
    return iso.slice(5);   // '2025-06-25' → '06-25'
  }

  // ── CSS variable reader ────────────────────────────────────────────────────

  function _cssVar(name, fallback = '') {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  // ── Nutrition plan ─────────────────────────────────────────────────────────

  function _getPlan() {
    try {
      return JSON.parse(localStorage.getItem(`thanzi_profile_${_user.$id}`) || 'null');
    } catch { return null; }
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────

  /** Safely destroy a Chart.js instance and return null. */
  function _destroy(chart) {
    if (chart) { try { chart.destroy(); } catch (_) {} }
    return null;
  }

  /** Shared Chart.js options, reading theme CSS vars at call time. */
  function _baseOpts() {
    const muted   = _cssVar('--text-muted',    '#888');
    const border  = _cssVar('--border',        'rgba(255,255,255,.08)');
    const bgCard  = _cssVar('--bg-card',       '#1e1e2e');
    const primary = _cssVar('--text-primary',  '#fff');

    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: bgCard,
          titleColor:  primary,
          bodyColor:   primary,
          borderColor: border,
          borderWidth: 1,
          padding: 8,
        },
      },
      scales: {
        x: {
          grid:   { display: false },
          border: { display: false },
          ticks:  { color: muted, font: { size: 11 } },
        },
        y: {
          grid:   { color: border },
          border: { display: false },
          ticks:  { color: muted, font: { size: 11 }, maxTicksLimit: 4 },
        },
      },
    };
  }

  /** Create a canvas inside a container div and return its 2D context. */
  function _makeCanvas(containerId, canvasId) {
    const wrap = _el(containerId);
    wrap.innerHTML = `<div style="position:relative;height:140px"><canvas id="${canvasId}"></canvas></div>`;
    return _el(canvasId).getContext('2d');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Weight Section
  // ═══════════════════════════════════════════════════════════════════════════

  async function _loadWeightLogs() {
    try {
      const res = await _db.listDocuments(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.weightLogs,
        [
          Appwrite.Query.equal('userId', _user.$id),
          Appwrite.Query.orderDesc('date'),
          Appwrite.Query.limit(30),
        ]
      );
      return res.documents;
    } catch (e) {
      console.error('ThanziProgress[weight]:', e.message);
      return [];
    }
  }

  async function _renderWeight() {
    const chartEl  = _el('prog-weight-chart');
    const listEl   = _el('prog-weight-list');
    const latestEl = _el('prog-weight-latest');

    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';
    _weightChart = _destroy(_weightChart);

    const logs = await _loadWeightLogs();

    // Latest badge
    if (logs.length) {
      latestEl.textContent    = `${logs[0].weight} kg`;
      latestEl.style.display  = 'inline-block';
    } else {
      latestEl.style.display = 'none';
    }

    // Chart
    if (!logs.length) {
      chartEl.innerHTML = '<p class="prog-chart-empty">Log your weight to see trends.</p>';
    } else if (logs.length === 1) {
      chartEl.innerHTML = `<p class="prog-chart-empty">⚖️ ${logs[0].weight} kg on ${logs[0].date}<br>Log more entries to see a trend.</p>`;
    } else {
      const data   = logs.slice(0, 10).reverse();
      const accent = _cssVar('--accent', '#6c63ff');
      const ctx    = _makeCanvas('prog-weight-chart', 'prog-weight-canvas');

      _weightChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.map(l => _mmdd(l.date)),
          datasets: [{
            label: 'Weight (kg)',
            data:  data.map(l => l.weight),
            borderColor:            accent,
            backgroundColor:        accent + '28',
            fill:                   true,
            tension:                0.35,
            pointRadius:            5,
            pointHoverRadius:       7,
            pointBackgroundColor:   accent,
            pointBorderColor:       _cssVar('--bg-card', '#1e1e2e'),
            pointBorderWidth:       2,
          }],
        },
        options: {
          ..._baseOpts(),
          scales: {
            ..._baseOpts().scales,
            y: {
              ..._baseOpts().scales.y,
              ticks: {
                ..._baseOpts().scales.y.ticks,
                callback: v => v + ' kg',
              },
            },
          },
          plugins: {
            ..._baseOpts().plugins,
            tooltip: {
              ..._baseOpts().plugins.tooltip,
              callbacks: {
                label: ctx => `${ctx.parsed.y} kg`,
              },
            },
          },
        },
      });
    }

    // Recent list (last 5)
    if (!logs.length) { listEl.innerHTML = ''; return; }

    listEl.innerHTML = logs.slice(0, 5).map(l => `
      <div class="prog-list-row">
        <span class="prog-list-val">${l.weight} kg</span>
        <span class="prog-list-date">${l.date}</span>
        <button class="prog-list-del" data-id="${l.$id}" title="Delete">✕</button>
      </div>
    `).join('');

    listEl.querySelectorAll('.prog-list-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          await _db.deleteDocument(
            THANZI_CONFIG.databaseId,
            THANZI_CONFIG.collections.weightLogs,
            btn.dataset.id
          );
          _renderWeight();
        } catch (e) {
          console.error('ThanziProgress[weight delete]:', e.message);
          btn.disabled = false;
        }
      });
    });
  }

  function _bindWeightForm() {
    const toggleBtn = _el('prog-log-weight-btn');
    const form      = _el('prog-weight-form');
    const saveBtn   = _el('prog-weight-save-btn');
    const cancelBtn = _el('prog-weight-cancel-btn');
    const dateInput = _el('prog-weight-date');
    const errorEl   = _el('prog-weight-error');

    dateInput.value = _today();
    dateInput.max   = _today();

    toggleBtn.addEventListener('click', () => {
      const visible = form.style.display !== 'none';
      form.style.display = visible ? 'none' : 'block';
      if (!visible) {
        _el('prog-weight-input').value = '';
        dateInput.value = _today();
        errorEl.textContent = '';
      }
    });

    cancelBtn.addEventListener('click', () => { form.style.display = 'none'; });

    saveBtn.addEventListener('click', async () => {
      const weight = parseFloat(_el('prog-weight-input').value);
      const date   = dateInput.value || _today();

      if (!weight || weight < 20 || weight > 350) {
        errorEl.textContent = 'Enter a valid weight (20–350 kg).';
        return;
      }
      errorEl.textContent = '';
      saveBtn.disabled    = true;
      saveBtn.textContent = 'Saving…';

      try {
        await _db.createDocument(
          THANZI_CONFIG.databaseId,
          THANZI_CONFIG.collections.weightLogs,
          Appwrite.ID.unique(),
          { userId: _user.$id, weight, date }
        );
        form.style.display          = 'none';
        _el('prog-weight-input').value = '';
        saveBtn.textContent         = '✓ Saved!';
        setTimeout(() => {
          saveBtn.textContent = 'Save';
          saveBtn.disabled    = false;
        }, 1200);
        _renderWeight();
      } catch (e) {
        console.error('ThanziProgress[weight save]:', e.message);
        errorEl.textContent = 'Could not save. Try again.';
        saveBtn.textContent = 'Save';
        saveBtn.disabled    = false;
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Calorie History Section
  // ═══════════════════════════════════════════════════════════════════════════

  async function _renderCalories() {
    const chartEl = _el('prog-cal-chart');
    const goalEl  = _el('prog-cal-goal-label');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';
    _calChart = _destroy(_calChart);

    const days      = _lastNDays(7);
    const startDate = days[0];

    let docs = [];
    try {
      const res = await _db.listDocuments(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.foodLogs,
        [
          Appwrite.Query.equal('userId', _user.$id),
          Appwrite.Query.greaterThanEqual('date', startDate),
          Appwrite.Query.limit(500),
        ]
      );
      docs = res.documents;
    } catch (e) {
      console.error('ThanziProgress[calories]:', e.message);
    }

    const byDate = {};
    docs.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + (d.calories || 0); });

    const plan   = _getPlan();
    const goal   = plan?.energy?.target_kcal || 2000;
    goalEl.textContent = `Goal: ${goal} kcal/day`;

    const labels = days.map(d => _shortDay(d));
    const values = days.map(d => Math.round(byDate[d] || 0));

    const accent = _cssVar('--accent', '#6c63ff');
    const ctx    = _makeCanvas('prog-cal-chart', 'prog-cal-canvas');

    _calChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Calories',
            data: values,
            backgroundColor: values.map(v =>
              v > goal * 1.02 ? '#ef4444cc' : accent + 'cc'
            ),
            borderRadius: 5,
            borderSkipped: false,
            order: 2,
          },
          {
            type: 'line',
            label: 'Goal',
            data: Array(7).fill(goal),
            borderColor:  _cssVar('--text-muted', '#888') + 'bb',
            borderDash:   [6, 4],
            borderWidth:  1.8,
            pointRadius:  0,
            fill:         false,
            tension:      0,
            order:        1,
          },
        ],
      },
      options: {
        ..._baseOpts(),
        plugins: {
          ..._baseOpts().plugins,
          tooltip: {
            ..._baseOpts().plugins.tooltip,
            callbacks: {
              label: ctx => ctx.datasetIndex === 0
                ? `${ctx.parsed.y} kcal`
                : `Goal: ${goal} kcal`,
            },
          },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Water History Section
  // ═══════════════════════════════════════════════════════════════════════════

  async function _renderWater() {
    const chartEl = _el('prog-water-chart');
    const goalEl  = _el('prog-water-goal-label');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';
    _waterChart = _destroy(_waterChart);

    const days      = _lastNDays(7);
    const startDate = days[0];

    let docs = [];
    try {
      const res = await _db.listDocuments(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.waterLogs,
        [
          Appwrite.Query.equal('userId', _user.$id),
          Appwrite.Query.greaterThanEqual('date', startDate),
          Appwrite.Query.limit(500),
        ]
      );
      docs = res.documents;
    } catch (e) {
      console.error('ThanziProgress[water]:', e.message);
    }

    const byDate = {};
    docs.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + (d.amount || 0); });

    const plan      = _getPlan();
    const waterGoal = plan?.micronutrients?.fluid_L
      ? Math.round(plan.micronutrients.fluid_L * 1000)
      : 2000;
    goalEl.textContent = `Goal: ${waterGoal} ml/day`;

    const labels = days.map(d => _shortDay(d));
    const values = days.map(d => Math.round(byDate[d] || 0));

    const ctx = _makeCanvas('prog-water-chart', 'prog-water-canvas');

    _waterChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Water',
            data: values,
            backgroundColor: values.map(v =>
              v > waterGoal * 1.02 ? '#ef4444cc' : '#3b82f6cc'
            ),
            borderRadius: 5,
            borderSkipped: false,
            order: 2,
          },
          {
            type: 'line',
            label: 'Goal',
            data: Array(7).fill(waterGoal),
            borderColor:  _cssVar('--text-muted', '#888') + 'bb',
            borderDash:   [6, 4],
            borderWidth:  1.8,
            pointRadius:  0,
            fill:         false,
            tension:      0,
            order:        1,
          },
        ],
      },
      options: {
        ..._baseOpts(),
        plugins: {
          ..._baseOpts().plugins,
          tooltip: {
            ..._baseOpts().plugins.tooltip,
            callbacks: {
              label: ctx => ctx.datasetIndex === 0
                ? `${ctx.parsed.y} ml`
                : `Goal: ${waterGoal} ml`,
            },
          },
        },
        scales: {
          ..._baseOpts().scales,
          y: {
            ..._baseOpts().scales.y,
            ticks: {
              ..._baseOpts().scales.y.ticks,
              callback: v => v >= 1000 ? (v / 1000).toFixed(1) + 'L' : v + 'ml',
            },
          },
        },
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════════════

  /** Persist a water addition. Called by ThanziApp.addWater(). */
  async function saveWater(amount) {
    if (!_user) return;
    try {
      await _db.createDocument(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.waterLogs,
        Appwrite.ID.unique(),
        { userId: _user.$id, amount, date: _today() }
      );
    } catch (e) {
      console.error('ThanziProgress[water save]:', e.message);
    }
  }

  /** First-time setup for this session. */
  function init(user) {
    _user = user;
    _bindWeightForm();
    _renderWeight();
    _renderCalories();
    _renderWater();
  }

  /** Called every time the Progress tab is opened. */
  async function refresh() {
    if (!_user || _loading) return;
    _loading = true;
    try {
      await Promise.all([_renderWeight(), _renderCalories(), _renderWater()]);
    } finally {
      _loading = false;
    }
  }

  return { init, refresh, saveWater };
})();
