/**
 * progress.js — Thanzi Progress Panel
 * ─────────────────────────────────────────────────────────────────────────────
 * Three sections:
 *   1. Weight tracker  — log / view / delete weight entries (weight_logs)
 *   2. Calorie history — 7-day bar chart from food_logs
 *   3. Water history   — 7-day bar chart from water_logs
 *
 * Public API: init(user), refresh(), saveWater(ml)
 * saveWater is called by ThanziApp.addWater() to persist each addition.
 *
 * NOTE: Range queries on the `date` field require a string index on that
 * column in Appwrite Console → Database → Collection → Indexes.
 * Add a key index on `date` for food_logs and water_logs.
 *
 * Author: Edison Taimu — Thanzi
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziProgress = (() => {
  'use strict';

  // ── Appwrite ──────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);
  const _db = new Appwrite.Databases(_client);

  // ── State ─────────────────────────────────────────────────────────────────
  let _user    = null;
  let _inited  = false;
  let _loading = false;

  // ── DOM helper ────────────────────────────────────────────────────────────
  const _el = id => document.getElementById(id);

  // ── Date helpers ──────────────────────────────────────────────────────────

  function _today() {
    return new Date().toISOString().split('T')[0];
  }

  /** Returns ISO date strings for the last N days, oldest first. */
  function _lastNDays(n = 7) {
    const days = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().split('T')[0]);
    }
    return days;
  }

  /** 'Mon', 'Tue' … from ISO date string. */
  function _shortDay(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-MW', { weekday: 'short' });
  }

  /** 'MM-DD' display from ISO date string. */
  function _mmdd(iso) {
    return iso.slice(5);   // '2025-06-25' → '06-25'
  }

  // ── Nutrition plan helper ─────────────────────────────────────────────────

  function _getPlan() {
    try {
      return JSON.parse(localStorage.getItem(`thanzi_profile_${_user.$id}`) || 'null');
    } catch { return null; }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SVG Charts
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Bar chart.
   * items: [{ label: string, value: number }]
   * goalLine: optional number — draws a dashed horizontal line
   */
  function _svgBars(items, { goalLine = null } = {}) {
    if (!items || !items.length) {
      return '<p class="prog-chart-empty">No data yet.</p>';
    }

    const W = 320, H = 130;
    const PL = 34, PR = 8, PT = 12, PB = 26;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    const maxVal = Math.max(...items.map(d => d.value), goalLine || 0, 1) * 1.18;
    const gap    = plotW / items.length;
    const barW   = Math.max(4, Math.floor(gap * 0.55));

    const yS = v => PT + plotH - (v / maxVal) * plotH;
    const xC = i => PL + gap * i + gap / 2;

    const bars = items.map((d, i) => {
      const bx = (xC(i) - barW / 2).toFixed(1);
      const by = yS(d.value).toFixed(1);
      const bh = Math.max(2, plotH - (yS(d.value) - PT)).toFixed(1);
      const over = goalLine && d.value > goalLine * 1.02;
      const fill = over ? 'var(--progress-over, #ef4444)' : 'var(--accent)';
      return `<rect x="${bx}" y="${by}" width="${barW}" height="${bh}" rx="3" fill="${fill}" opacity="0.88"/>`;
    }).join('');

    const xlabels = items.map((d, i) =>
      `<text x="${xC(i).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="pcc-lbl">${d.label}</text>`
    ).join('');

    const yMax = maxVal > 1200
      ? `${(maxVal / 1000).toFixed(1)}k`
      : Math.round(maxVal).toString();

    const yLabels = `
      <text x="${PL - 4}" y="${PT + 5}" text-anchor="end" class="pcc-lbl">${yMax}</text>
      <text x="${PL - 4}" y="${PT + plotH + 1}" text-anchor="end" class="pcc-lbl">0</text>`;

    const goalSvg = goalLine != null
      ? `<line x1="${PL}" y1="${yS(goalLine).toFixed(1)}" x2="${W - PR}" y2="${yS(goalLine).toFixed(1)}"
           stroke="var(--text-muted,#888)" stroke-dasharray="4 3" stroke-width="1.2" opacity="0.7"/>`
      : '';

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;display:block">
      ${goalSvg}${bars}${xlabels}${yLabels}
    </svg>`;
  }

  /**
   * Line chart (for weight trend).
   * items: [{ label: string, value: number }]
   */
  function _svgLine(items, { unit = '' } = {}) {
    if (!items || items.length === 0) {
      return '<p class="prog-chart-empty">Log your weight to see trends.</p>';
    }
    if (items.length === 1) {
      return `<p class="prog-chart-empty">⚖️ ${items[0].value}${unit} on ${items[0].label}<br>Log more entries to see a trend.</p>`;
    }

    const W = 320, H = 130;
    const PL = 40, PR = 8, PT = 12, PB = 26;
    const plotW = W - PL - PR;
    const plotH = H - PT - PB;

    const vals = items.map(d => d.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const range = maxV - minV || 1;
    const pad = range * 0.25;
    const lo = minV - pad;
    const hi = maxV + pad;

    const xS = i => PL + (i / (items.length - 1)) * plotW;
    const yS = v => PT + plotH - ((v - lo) / (hi - lo)) * plotH;

    const pts = items.map((d, i) => `${xS(i).toFixed(1)},${yS(d.value).toFixed(1)}`).join(' ');

    // Gradient fill under line
    const fillPts = pts
      + ` ${(PL + plotW).toFixed(1)},${(PT + plotH).toFixed(1)}`
      + ` ${PL.toFixed(1)},${(PT + plotH).toFixed(1)}`;

    const dots = items.map((d, i) =>
      `<circle cx="${xS(i).toFixed(1)}" cy="${yS(d.value).toFixed(1)}" r="3.5"
        fill="var(--accent)" stroke="var(--bg-card,#1e1e2e)" stroke-width="1.5"/>`
    ).join('');

    const xlabels = items.map((d, i) =>
      `<text x="${xS(i).toFixed(1)}" y="${H - 7}" text-anchor="middle" class="pcc-lbl">${d.label}</text>`
    ).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:visible;display:block">
      <defs>
        <linearGradient id="line-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="var(--accent)" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <polygon points="${fillPts}" fill="url(#line-grad)"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xlabels}
      <text x="${PL - 4}" y="${PT + 5}" text-anchor="end" class="pcc-lbl">${maxV.toFixed(1)}${unit}</text>
      <text x="${PL - 4}" y="${PT + plotH + 1}" text-anchor="end" class="pcc-lbl">${minV.toFixed(1)}${unit}</text>
    </svg>`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Weight Section
  // ═════════════════════════════════════════════════════════════════════════

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

    const logs = await _loadWeightLogs();

    // Latest reading badge
    if (logs.length > 0) {
      const latest = logs[0];
      latestEl.textContent = `${latest.weight} kg`;
      latestEl.style.display = 'inline-block';
    } else {
      latestEl.style.display = 'none';
    }

    // Line chart (up to last 10, chronological)
    const chartData = logs.slice(0, 10).reverse().map(l => ({
      label: _mmdd(l.date),
      value: l.weight,
    }));
    chartEl.innerHTML = _svgLine(chartData, { unit: 'kg' });

    // Recent list (last 5)
    if (!logs.length) {
      listEl.innerHTML = '';
      return;
    }
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
    const toggleBtn  = _el('prog-log-weight-btn');
    const form       = _el('prog-weight-form');
    const saveBtn    = _el('prog-weight-save-btn');
    const cancelBtn  = _el('prog-weight-cancel-btn');
    const dateInput  = _el('prog-weight-date');
    const errorEl    = _el('prog-weight-error');

    // Default date
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

    cancelBtn.addEventListener('click', () => {
      form.style.display = 'none';
    });

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
        form.style.display = 'none';
        _el('prog-weight-input').value = '';
        saveBtn.textContent = '✓ Saved!';
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

  // ═════════════════════════════════════════════════════════════════════════
  // Calorie History Section
  // ═════════════════════════════════════════════════════════════════════════

  async function _renderCalories() {
    const chartEl  = _el('prog-cal-chart');
    const goalEl   = _el('prog-cal-goal-label');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';

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

    // Sum per day
    const byDate = {};
    docs.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + (d.calories || 0); });

    // Calorie goal
    const plan = _getPlan();
    const goal = plan?.energy?.target_kcal || 2000;
    goalEl.textContent = `Goal: ${goal} kcal/day  ·  Dashed line`;

    const items = days.map(d => ({
      label: _shortDay(d),
      value: byDate[d] || 0,
    }));

    chartEl.innerHTML = _svgBars(items, { goalLine: goal });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Water History Section
  // ═════════════════════════════════════════════════════════════════════════

  async function _renderWater() {
    const chartEl = _el('prog-water-chart');
    const goalEl  = _el('prog-water-goal-label');
    chartEl.innerHTML = '<p class="prog-chart-loading">Loading…</p>';

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

    const plan = _getPlan();
    const waterGoal = plan?.micronutrients?.fluid_L
      ? Math.round(plan.micronutrients.fluid_L * 1000)
      : 2000;
    goalEl.textContent = `Goal: ${waterGoal} ml/day  ·  Dashed line`;

    const items = days.map(d => ({
      label: _shortDay(d),
      value: Math.round(byDate[d] || 0),
    }));

    chartEl.innerHTML = _svgBars(items, { goalLine: waterGoal });
  }

  // ═════════════════════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Persist a water addition.
   * Called by ThanziApp.addWater() each time the user taps a water button.
   */
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
      // Non-fatal — UI already updated; just log silently
      console.error('ThanziProgress[water save]:', e.message);
    }
  }

  /** First-time setup for this session. */
  function init(user) {
    _user   = user;
    _inited = true;
    _bindWeightForm();
    _renderWeight();
    _renderCalories();
    _renderWater();
  }

  /** Called every time the Progress nav tab is opened. */
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
