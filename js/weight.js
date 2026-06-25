/**
 * weight.js — Thanzi Weight Panel
 *
 * Follows the same IIFE / module pattern as exercise.js and meal-templates.js.
 * Reads height from the user's saved profile to compute BMI.
 *
 * Storage key : "thanzi_weight_logs" — array of { id, weight, date, addedAt }
 *               sorted newest-first
 * Panel element: #weight-panel
 */
const ThanziWeight = (() => {
  'use strict';

  const STORAGE_KEY   = 'thanzi_weight_logs';
  const PROFILE_KEY   = 'thanzi_profile';   // written by app.js / profile.js

  let _entries  = [];   // sorted newest-first
  let _chartInst = null;

  // ── Persistence ───────────────────────────────────────────────────────────

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      _entries = raw ? JSON.parse(raw) : [];
    } catch (e) { _entries = []; }
  }

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_entries)); } catch (e) {}
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ── Profile helpers ───────────────────────────────────────────────────────

  function _getHeightCm() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}');
      return parseFloat(p.height) || null;
    } catch (e) { return null; }
  }

  function _bmi(weightKg) {
    const h = _getHeightCm();
    if (!h || !weightKg) return null;
    const hm = h / 100;
    return Math.round((weightKg / (hm * hm)) * 10) / 10;
  }

  function _bmiLabel(bmi) {
    if (bmi === null) return '';
    if (bmi < 18.5)  return 'Underweight';
    if (bmi < 25)    return 'Normal weight';
    if (bmi < 30)    return 'Overweight';
    return 'Obese';
  }

  // ── Computed stats ────────────────────────────────────────────────────────

  function _stats() {
    if (_entries.length === 0) {
      return { current: null, bmi: null, bmiLabel: '', change: null, changePct: null };
    }
    const current  = _entries[0].weight;
    const oldest   = _entries[_entries.length - 1].weight;
    const change   = Math.round((current - oldest) * 10) / 10;
    const changePct = oldest
      ? Math.round(((current - oldest) / oldest) * 1000) / 10
      : 0;
    const bmi = _bmi(current);
    return { current, bmi, bmiLabel: _bmiLabel(bmi), change, changePct };
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function _esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _showError(msg) {
    const el = document.getElementById('wt-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('visible', !!msg);
  }

  // ── Banner & stat cards ───────────────────────────────────────────────────

  function _renderBanner() {
    const s = _stats();
    _setText('wt-stat-weight',  s.current !== null ? s.current + ' kg' : '—');
    _setText('wt-stat-bmi',     s.bmi     !== null ? s.bmi             : '—');
    _setText('wt-stat-change',  s.change  !== null ? (s.change >= 0 ? '+' : '') + s.change : '—');

    _setText('wt-card-current',  s.current !== null ? s.current + ' kg' : '—');
    _setText('wt-card-bmi',      s.bmi     !== null ? s.bmi             : '—');
    _setText('wt-card-bmi-sub',  s.bmiLabel || '—');
    _setText('wt-card-change',   s.change  !== null ? (s.change >= 0 ? '+' : '') + s.change + ' kg' : '—');
    _setText('wt-card-pct',      s.changePct !== null ? (s.changePct >= 0 ? '+' : '') + s.changePct + '%' : '—');
  }

  // ── Chart ─────────────────────────────────────────────────────────────────

  function _renderChart() {
    const canvas  = document.getElementById('wt-chart');
    const emptyEl = document.getElementById('wt-chart-empty');

    if (!canvas) return;

    // Need ≥2 entries to draw a meaningful line
    const sorted = [..._entries].sort((a, b) => a.date.localeCompare(b.date));

    if (sorted.length < 2) {
      canvas.style.display = 'none';
      if (emptyEl) emptyEl.style.display = 'flex';
      if (_chartInst) { _chartInst.destroy(); _chartInst = null; }
      return;
    }

    canvas.style.display = 'block';
    if (emptyEl) emptyEl.style.display = 'none';

    const labels = sorted.map(e => {
      const d = new Date(e.date);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    const data = sorted.map(e => e.weight);

    // Resolve CSS vars for theming
    const style   = getComputedStyle(document.documentElement);
    const accent  = style.getPropertyValue('--accent').trim()  || '#2d9b6a';
    const text3   = style.getPropertyValue('--text-3').trim()  || '#888';
    const surface = style.getPropertyValue('--surface-1').trim() || '#fff';

    if (_chartInst) {
      _chartInst.data.labels        = labels;
      _chartInst.data.datasets[0].data = data;
      _chartInst.update();
      return;
    }

    if (typeof Chart === 'undefined') return;

    _chartInst = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Weight (kg)',
          data,
          borderColor: accent,
          backgroundColor: accent + '22',
          borderWidth: 2.5,
          pointBackgroundColor: accent,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.35,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.parsed.y} kg`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: text3, font: { size: 11 } },
            grid:  { display: false },
          },
          y: {
            ticks: { color: text3, font: { size: 11 }, callback: v => v + ' kg' },
            grid:  { color: text3 + '22' },
          },
        },
      },
    });
  }

  // ── History list ──────────────────────────────────────────────────────────

  function _renderHistory() {
    const container = document.getElementById('wt-history-list');
    if (!container) return;

    if (_entries.length === 0) {
      container.innerHTML = `
        <div class="wt-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          <span class="wt-empty-text">No weight entries yet</span>
          <span class="wt-empty-sub">Add your first entry above to start tracking!</span>
        </div>`;
      return;
    }

    container.innerHTML = _entries.map((entry, idx) => {
      const prev  = _entries[idx + 1];
      let delta = '', deltaClass = 'same';
      if (prev) {
        const diff = Math.round((entry.weight - prev.weight) * 10) / 10;
        if (diff > 0)      { delta = '+' + diff + ' kg'; deltaClass = 'up'; }
        else if (diff < 0) { delta = diff + ' kg';        deltaClass = 'down'; }
        else               { delta = '—';                 deltaClass = 'same'; }
      }

      return `
        <div class="wt-row" data-id="${entry.id}">
          <div class="wt-row-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9z"/>
              <line x1="8" y1="12" x2="16" y2="12"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
            </svg>
          </div>
          <div class="wt-row-info">
            <div class="wt-row-weight">${_esc(entry.weight)} kg</div>
            <div class="wt-row-date">${entry.date}</div>
          </div>
          ${delta ? `<div class="wt-row-delta ${deltaClass}">${_esc(delta)}</div>` : ''}
          <button class="wt-row-delete" data-id="${entry.id}" aria-label="Delete entry">
            <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
          </button>
        </div>`;
    }).join('');

    container.querySelectorAll('.wt-row-delete').forEach(btn => {
      btn.addEventListener('click', () => _deleteEntry(btn.dataset.id));
    });
  }

  function _deleteEntry(id) {
    _entries = _entries.filter(e => e.id !== id);
    _save();
    _refresh();
  }

  // ── Add entry ─────────────────────────────────────────────────────────────

  function _addEntry() {
    const weightInput = document.getElementById('wt-weight-input');
    const dateSelect  = document.getElementById('wt-date-select');
    if (!weightInput || !dateSelect) return;

    const weight = parseFloat(weightInput.value);
    const date   = dateSelect.value;

    if (!weight || weight <= 0 || weight > 500) {
      _showError('Please enter a valid weight between 1 and 500 kg.');
      return;
    }
    if (!date) {
      _showError('Please select a date.');
      return;
    }

    _showError('');

    // Remove any existing entry for the same date
    _entries = _entries.filter(e => e.date !== date);

    _entries.unshift({ id: _uid(), weight, date, addedAt: new Date().toISOString() });
    // Keep sorted newest-first
    _entries.sort((a, b) => b.date.localeCompare(a.date));

    _save();
    weightInput.value = '';
    _refresh();
  }

  // ── Date dropdown ─────────────────────────────────────────────────────────

  function _buildDateOptions() {
    const sel = document.getElementById('wt-date-select');
    if (!sel) return;
    sel.innerHTML = '';
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso   = d.toISOString().slice(0, 10);
      const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const opt = document.createElement('option');
      opt.value       = iso;
      opt.textContent = `${label} (${iso})`;
      if (i === 0) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ── Full refresh ──────────────────────────────────────────────────────────

  function _refresh() {
    _renderBanner();
    _renderChart();
    _renderHistory();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    _load();
    _buildDateOptions();

    const addBtn = document.getElementById('wt-add-btn');
    if (addBtn) addBtn.addEventListener('click', _addEntry);

    const input = document.getElementById('wt-weight-input');
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') _addEntry(); });

    _refresh();
  }

  function refresh() {
    _load();
    _buildDateOptions();
    _refresh();
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', ThanziWeight.init);
