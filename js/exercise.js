/**
 * exercise.js — Thanzi Exercise Panel
 *
 * Follows the same IIFE / module pattern as meal-templates.js and
 * custom-foods.js.  Uses the Anthropic API (via the ai.js pattern) to
 * parse natural-language exercise input and estimate calories burned.
 *
 * Storage key  : "thanzi_exercise_logs"  — JSON map keyed by ISO date string
 * Panel element: #exercise-panel
 */
const ThanziExercise = (() => {
  'use strict';

  // ── Constants ───────────────────────────────────────────────────────────
  const STORAGE_KEY = 'thanzi_exercise_logs';

  // ── State ────────────────────────────────────────────────────────────────
  let _selectedDate = _todayISO();
  let _logs = {};        // { "2026-06-25": [ {...}, ... ] }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      _logs = raw ? JSON.parse(raw) : {};
    } catch (e) {
      _logs = {};
    }
  }

  function _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_logs));
    } catch (e) { /* ignore storage errors */ }
  }

  function _logsForDate(date) {
    return _logs[date] || [];
  }

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Calorie estimation (Anthropic AI) ────────────────────────────────────

  /**
   * Ask Claude to parse the natural-language description and return JSON.
   * Falls back to a simple keyword estimator if the API call fails.
   */
  async function _parseExercise(description) {
    const prompt = `
You are a fitness data parser. The user logged an exercise in natural language.
Extract the exercise details and estimate calories burned for an average adult (75 kg).

User input: "${description}"

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "name": "Exercise name (title-cased)",
  "duration_min": <number, integer minutes, estimate if not given>,
  "calories": <number, integer kcal burned estimate>,
  "notes": "brief note e.g. '5 km' or '3 sets × 10 reps' — empty string if none"
}

If the input is not an exercise at all, return: {"error": "not_exercise"}
`.trim();

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) throw new Error('API error ' + res.status);
      const data = await res.json();
      const text = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');

      const clean = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed.error) throw new Error(parsed.error);
      return parsed;

    } catch (e) {
      // ── Offline / error fallback ──────────────────────────────────────
      return _fallbackParse(description);
    }
  }

  /** Very simple keyword-based fallback (no network needed) */
  function _fallbackParse(desc) {
    const lower = desc.toLowerCase();

    // Pull duration
    const durMatch = lower.match(/(\d+)\s*(?:min(?:ute)?s?|hr?s?)/);
    let duration_min = durMatch ? parseInt(durMatch[1], 10) : 30;
    if (lower.includes('hr') || lower.includes('hour')) duration_min *= 60;

    // Rough MET-based calorie estimate (75 kg baseline)
    let met = 5; // default moderate
    if (/run|jog|sprint/.test(lower))          met = 10;
    else if (/walk/.test(lower))               met = 3.5;
    else if (/cycl|bike|bicycl/.test(lower))   met = 8;
    else if (/swim/.test(lower))               met = 7;
    else if (/weight|lift|strength/.test(lower)) met = 5;
    else if (/yoga|stretch|pilate/.test(lower))  met = 3;
    else if (/hiit|interval/.test(lower))        met = 10;
    else if (/dance/.test(lower))                met = 6;
    else if (/row/.test(lower))                  met = 7;

    const calories = Math.round((met * 75 * duration_min) / 60);

    // Clean name
    const name = desc
      .replace(/\d+\s*(min(ute)?s?|hr?s?|km|miles?|sets?|reps?)/gi, '')
      .replace(/\s+/g, ' ').trim()
      .replace(/^\w/, c => c.toUpperCase()) || 'Exercise';

    return { name, duration_min, calories, notes: '' };
  }

  // ── UI ───────────────────────────────────────────────────────────────────

  function _summaryForDate(date) {
    const items = _logsForDate(date);
    return {
      count:    items.length,
      duration: items.reduce((a, i) => a + (i.duration_min || 0), 0),
      calories: items.reduce((a, i) => a + (i.calories     || 0), 0),
    };
  }

  function _renderBanner(date) {
    const { count, duration, calories } = _summaryForDate(date);
    const el = id => document.getElementById(id);
    const setT = (elId, val) => { const e = el(elId); if (e) e.textContent = val; };

    setT('ex-stat-count',    count);
    setT('ex-stat-duration', duration);
    setT('ex-stat-calories', calories);
  }

  function _renderList(date) {
    const container = document.getElementById('ex-list');
    if (!container) return;

    const items = _logsForDate(date);

    // Update list heading
    const heading = document.getElementById('ex-list-title');
    if (heading) heading.textContent = `Exercises for ${date}`;

    if (items.length === 0) {
      container.innerHTML = `
        <div class="ex-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6.5 6.5h11M6.5 17.5h11M4 12h16M9 4.5v15M15 4.5v15"/>
          </svg>
          <span class="ex-empty-text">No exercises logged</span>
        </div>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="ex-row" data-id="${item.id}">
        <div class="ex-row-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6.5 6.5h11M6.5 17.5h11M4 12h16M9 4.5v15M15 4.5v15"/>
          </svg>
        </div>
        <div class="ex-row-info">
          <div class="ex-row-name">${_esc(item.name)}</div>
          <div class="ex-row-meta">${item.duration_min} min${item.notes ? ' · ' + _esc(item.notes) : ''}</div>
        </div>
        <div class="ex-row-kcal">−${item.calories} kcal</div>
        <button class="ex-row-delete" data-id="${item.id}" aria-label="Delete exercise">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    `).join('');

    // Bind delete buttons
    container.querySelectorAll('.ex-row-delete').forEach(btn => {
      btn.addEventListener('click', () => _deleteItem(date, btn.dataset.id));
    });
  }

  function _refresh(date) {
    date = date || _selectedDate;
    _renderBanner(date);
    _renderList(date);
  }

  function _deleteItem(date, id) {
    if (!_logs[date]) return;
    _logs[date] = _logs[date].filter(i => i.id !== id);
    _save();
    _refresh(date);
  }

  function _showError(msg) {
    const el = document.getElementById('ex-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('visible', !!msg);
  }

  function _setLoading(on) {
    const btn = document.getElementById('ex-add-btn');
    if (btn) btn.classList.toggle('loading', on);
    if (btn) btn.disabled = on;
  }

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Add exercise ──────────────────────────────────────────────────────────

  async function _addExercise() {
    const input = document.getElementById('ex-input');
    if (!input) return;

    const desc = input.value.trim();
    if (!desc) {
      _showError('Please describe your exercise first.');
      return;
    }

    _showError('');
    _setLoading(true);

    try {
      const parsed = await _parseExercise(desc);

      const entry = {
        id:           _uid(),
        name:         parsed.name || desc,
        duration_min: Math.max(1, parseInt(parsed.duration_min, 10) || 30),
        calories:     Math.max(0, parseInt(parsed.calories,     10) || 0),
        notes:        parsed.notes || '',
        addedAt:      new Date().toISOString(),
      };

      if (!_logs[_selectedDate]) _logs[_selectedDate] = [];
      _logs[_selectedDate].unshift(entry);
      _save();

      input.value = '';
      _refresh(_selectedDate);

    } catch (e) {
      _showError('Could not parse that exercise. Try: "ran 5 km in 30 minutes".');
    } finally {
      _setLoading(false);
    }
  }

  // ── Date dropdown ─────────────────────────────────────────────────────────

  function _buildDateOptions() {
    const sel = document.getElementById('ex-date-select');
    if (!sel) return;

    sel.innerHTML = '';
    const today = new Date();

    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday'
        : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

      const opt = document.createElement('option');
      opt.value = iso;
      opt.textContent = `${label} (${iso})`;
      if (iso === _selectedDate) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function init() {
    _load();

    const addBtn = document.getElementById('ex-add-btn');
    if (addBtn) addBtn.addEventListener('click', _addExercise);

    const input = document.getElementById('ex-input');
    if (input) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') _addExercise();
      });
    }

    const dateSel = document.getElementById('ex-date-select');
    if (dateSel) {
      dateSel.addEventListener('change', () => {
        _selectedDate = dateSel.value;
        _refresh(_selectedDate);
      });
    }

    _buildDateOptions();
    _refresh(_selectedDate);
  }

  /** Called by drawer when the panel is shown */
  function refresh() {
    _load();
    _buildDateOptions();
    _selectedDate = _todayISO();
    const sel = document.getElementById('ex-date-select');
    if (sel) sel.value = _selectedDate;
    _refresh(_selectedDate);
  }

  return { init, refresh };
})();

document.addEventListener('DOMContentLoaded', ThanziExercise.init);
