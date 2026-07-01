/**
 * health.js — Thanzi Health Sync
 *
 * Two integration paths, auto-selected at runtime:
 *
 *   1. NATIVE BRIDGE (Health Connect / Samsung Health via Capacitor plugin)
 *      Active only when Thanzi is wrapped in a native shell that exposes
 *      `window.ThanziHealthNative` (a Capacitor plugin — see bottom of this
 *      file for the expected interface). Until that shell exists, this
 *      path is simply unavailable and the UI won't offer it.
 *
 *   2. MANUAL IMPORT (works today, in any browser / PWA install)
 *      User exports data from Samsung Health / Google Fit / Health Connect
 *      (Settings → Export data, or Health Connect → App permissions →
 *      Export), then uploads the file here. We parse CSV or JSON client-side
 *      — no server, no native code — and merge results into the same
 *      storage keys the rest of the app already reads:
 *        - steps / active kcal  → 'thanzi_exercise_logs'  (same key exercise.js uses)
 *        - weight entries       → 'thanzi_weight_logs'    (same shape weight.js expects)
 *
 * Panel element: #health-panel (opened from Diary settings, alongside
 *                Nutrient Targets)
 */
const ThanziHealth = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────
  const EXERCISE_KEY = 'thanzi_exercise_logs';   // written by exercise.js
  const WEIGHT_KEY    = 'thanzi_weight_logs';    // written by weight.js
  const SYNC_LOG_KEY   = 'thanzi_health_sync_log'; // our own import history

  // ── State ──────────────────────────────────────────────────────────────
  let _lastImportPreview = null; // holds parsed-but-unconfirmed import batch

  // ── Helpers ────────────────────────────────────────────────────────────

  function _uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function _todayISO() {
    return new Date().toISOString().slice(0, 10);
  }

  function _loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function _saveJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ }
  }

  function _appendSyncLog(entry) {
    const log = _loadJSON(SYNC_LOG_KEY, []);
    log.unshift(Object.assign({ id: _uid(), at: new Date().toISOString() }, entry));
    _saveJSON(SYNC_LOG_KEY, log.slice(0, 20)); // keep last 20 imports
  }

  // ── Native bridge detection ───────────────────────────────────────────

  /**
   * True only inside a native shell (Capacitor) that has registered the
   * ThanziHealthNative plugin. In a plain browser/PWA this is always false,
   * and the UI falls back to manual import without erroring.
   */
  function isNativeAvailable() {
    return typeof window !== 'undefined' &&
      typeof window.ThanziHealthNative !== 'undefined' &&
      typeof window.ThanziHealthNative.isHealthConnectAvailable === 'function';
  }

  async function nativeStatus() {
    if (!isNativeAvailable()) return { available: false, connected: false };
    try {
      const available = await window.ThanziHealthNative.isHealthConnectAvailable();
      const connected = available ? await window.ThanziHealthNative.isConnected() : false;
      return { available, connected };
    } catch (e) {
      return { available: false, connected: false, error: e.message };
    }
  }

  async function nativeConnect() {
    if (!isNativeAvailable()) throw new Error('Native health bridge not present');
    return window.ThanziHealthNative.requestPermissions([
      'steps', 'active_calories', 'weight', 'exercise',
    ]);
  }

  /**
   * Pulls today's steps/active-calories/exercise sessions from the native
   * bridge and merges them into the same storage keys manual import uses,
   * so the rest of the app (Diary, exercise.js) doesn't need to know or
   * care which path the data came from.
   */
  async function nativeSyncToday() {
    if (!isNativeAvailable()) throw new Error('Native health bridge not present');
    const data = await window.ThanziHealthNative.readToday([
      'steps', 'active_calories', 'exercise_sessions', 'weight',
    ]);
    // data expected shape:
    // { steps: 8231, active_calories: 340, exercise_sessions: [{name,duration_min,calories}], weight_kg: 71.2|null }
    _mergeExerciseEntry({
      name: 'Health Connect sync',
      duration_min: null,
      calories: Math.round(data.active_calories || 0),
      notes: data.steps ? `${data.steps} steps` : '',
      source: 'health_connect',
    });
    (data.exercise_sessions || []).forEach(s => _mergeExerciseEntry({
      name: s.name || 'Workout',
      duration_min: s.duration_min || null,
      calories: Math.round(s.calories || 0),
      notes: s.notes || '',
      source: 'health_connect',
    }));
    if (data.weight_kg) _mergeWeightEntry(data.weight_kg, _todayISO());

    _appendSyncLog({ type: 'native', summary: `Synced ${data.steps || 0} steps, ${Math.round(data.active_calories || 0)} kcal` });
    return data;
  }

  // ── Merge helpers (shared by native + manual paths) ────────────────────

  function _mergeExerciseEntry({ name, duration_min, calories, notes, source, date }) {
    const logs = _loadJSON(EXERCISE_KEY, {});
    const d = date || _todayISO();
    if (!logs[d]) logs[d] = [];
    logs[d].push({
      id: _uid(),
      name: name || 'Imported activity',
      duration_min: duration_min || null,
      calories: Math.max(0, Math.round(calories || 0)),
      notes: notes || '',
      source: source || 'import',
    });
    _saveJSON(EXERCISE_KEY, logs);
  }

  function _mergeWeightEntry(kg, date) {
    const logs = _loadJSON(WEIGHT_KEY, []);
    const d = date || _todayISO();
    // avoid duplicate same-day entries from repeated imports
    const existingIdx = logs.findIndex(l => l.date === d && l.source === 'import');
    const entry = { id: _uid(), date: d, weight_kg: Math.round(kg * 10) / 10, source: 'import' };
    if (existingIdx >= 0) logs[existingIdx] = entry; else logs.push(entry);
    _saveJSON(WEIGHT_KEY, logs);
  }

  // ── Manual import: file parsing ─────────────────────────────────────────

  /**
   * Accepts a File object (from <input type="file">). Detects CSV vs JSON
   * by extension/content, parses it, and returns a normalized preview:
   *   { steps: [{date, count}], calories: [{date, kcal}],
   *     exercise: [{date, name, duration_min, calories}],
   *     weight: [{date, kg}] }
   * Nothing is written to storage yet — call confirmImport() to commit.
   */
  async function parseFile(file) {
    const text = await file.text();
    const isJSON = file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('{') || text.trim().startsWith('[');
    const result = isJSON ? _parseJSONExport(text) : _parseCSVExport(text, file.name);
    _lastImportPreview = result;
    return result;
  }

  /**
   * Handles common Samsung Health / Google Fit CSV export shapes.
   * Samsung Health CSVs vary by data type (steps, exercise, weight each
   * export separately) — we sniff headers to figure out which kind this is.
   */
  function _parseCSVExport(text, filename) {
    const rows = _csvToRows(text);
    if (!rows.length) return { steps: [], calories: [], exercise: [], weight: [], sourceFile: filename, format: 'csv (empty)' };

    const header = rows[0].map(h => h.trim().toLowerCase());
    const body = rows.slice(1).filter(r => r.length && r.some(c => c && c.trim()));

    const idx = (names) => names.map(n => header.indexOf(n)).find(i => i >= 0);

    const dateIdx  = idx(['date', 'day', 'start_time', 'create_time', 'time']);
    const stepsIdx = idx(['step_count', 'steps', 'count']);
    const kcalIdx  = idx(['calorie', 'calories', 'active_calories', 'burned_calories', 'energy']);
    const nameIdx  = idx(['exercise', 'exercise_type', 'workout', 'activity']);
    const durIdx   = idx(['duration', 'duration_min', 'exercise_time', 'exercise_duration']);
    const weightIdx = idx(['weight', 'weight_kg', 'body_weight']);

    const out = { steps: [], calories: [], exercise: [], weight: [], sourceFile: filename, format: 'csv' };

    body.forEach(cols => {
      const rawDate = dateIdx != null ? cols[dateIdx] : null;
      const date = _normalizeDate(rawDate) || _todayISO();

      if (stepsIdx != null && cols[stepsIdx]) {
        const n = parseInt(cols[stepsIdx], 10);
        if (!isNaN(n)) out.steps.push({ date, count: n });
      }
      if (weightIdx != null && cols[weightIdx]) {
        const w = parseFloat(cols[weightIdx]);
        if (!isNaN(w)) out.weight.push({ date, kg: w > 300 ? w / 1000 : w }); // handle grams vs kg
      }
      if (nameIdx != null && cols[nameIdx]) {
        out.exercise.push({
          date,
          name: cols[nameIdx] || 'Workout',
          duration_min: durIdx != null ? parseFloat(cols[durIdx]) || null : null,
          calories: kcalIdx != null ? Math.round(parseFloat(cols[kcalIdx]) || 0) : 0,
        });
      } else if (kcalIdx != null && cols[kcalIdx] && nameIdx == null) {
        // Plain calorie-burn export with no named workout (e.g. daily active calories)
        const kcal = Math.round(parseFloat(cols[kcalIdx]) || 0);
        if (kcal > 0) out.calories.push({ date, kcal });
      }
    });

    return out;
  }

  /** Handles Health Connect / Google Fit style JSON export shapes (best-effort). */
  function _parseJSONExport(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return { steps: [], calories: [], exercise: [], weight: [], format: 'json (invalid)' }; }

    const out = { steps: [], calories: [], exercise: [], weight: [], format: 'json' };
    const records = Array.isArray(data) ? data : (data.records || data.data || [data]);

    records.forEach(rec => {
      const date = _normalizeDate(rec.date || rec.startTime || rec.start_time || rec.timestamp) || _todayISO();
      const type = (rec.type || rec.dataType || rec.recordType || '').toLowerCase();

      if (type.includes('step') || rec.stepCount != null) {
        out.steps.push({ date, count: rec.stepCount || rec.count || rec.value || 0 });
      } else if (type.includes('weight') || rec.weightKg != null) {
        const kg = rec.weightKg || rec.value || rec.weight;
        if (kg) out.weight.push({ date, kg: kg > 300 ? kg / 1000 : kg });
      } else if (type.includes('exercise') || type.includes('workout') || rec.exerciseType) {
        out.exercise.push({
          date,
          name: rec.exerciseType || rec.name || rec.title || 'Workout',
          duration_min: rec.durationMinutes || rec.duration_min || null,
          calories: Math.round(rec.calories || rec.energy || rec.kcal || 0),
        });
      } else if (type.includes('calorie') || type.includes('energy')) {
        const kcal = Math.round(rec.calories || rec.energy || rec.value || 0);
        if (kcal > 0) out.calories.push({ date, kcal });
      }
    });

    return out;
  }

  function _csvToRows(text) {
    return text.split(/\r?\n/)
      .filter(line => line.trim().length)
      .map(line => line.split(',').map(c => c.replace(/^"|"$/g, '').trim()));
  }

  function _normalizeDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) {
      // try YYYYMMDD
      const m = String(raw).match(/^(\d{4})(\d{2})(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      return null;
    }
    return d.toISOString().slice(0, 10);
  }

  /**
   * Commits the last parsed preview into the app's real storage keys.
   * Steps + standalone calorie entries are merged into one "Imported
   * activity" exercise entry per day (so they show in Diary's Exercise
   * breakdown); named workouts get their own entries; weight entries
   * go to the weight log.
   */
  function confirmImport() {
    if (!_lastImportPreview) return { ok: false, reason: 'Nothing to import — parse a file first.' };
    const p = _lastImportPreview;
    let count = 0;

    // Group steps + standalone calories by date into one summary entry/day
    const byDate = {};
    p.steps.forEach(s => {
      byDate[s.date] = byDate[s.date] || { steps: 0, kcal: 0 };
      byDate[s.date].steps += s.count;
    });
    p.calories.forEach(c => {
      byDate[c.date] = byDate[c.date] || { steps: 0, kcal: 0 };
      byDate[c.date].kcal += c.kcal;
    });
    Object.keys(byDate).forEach(date => {
      const { steps, kcal } = byDate[date];
      if (steps || kcal) {
        _mergeExerciseEntry({
          name: 'Imported activity',
          calories: kcal,
          notes: steps ? `${steps} steps` : '',
          source: 'manual_import',
          date,
        });
        count++;
      }
    });

    p.exercise.forEach(e => {
      _mergeExerciseEntry({
        name: e.name, duration_min: e.duration_min, calories: e.calories,
        source: 'manual_import', date: e.date,
      });
      count++;
    });

    p.weight.forEach(w => {
      _mergeWeightEntry(w.kg, w.date);
      count++;
    });

    _appendSyncLog({
      type: 'manual',
      summary: `Imported ${p.sourceFile || 'file'} — ${count} record${count === 1 ? '' : 's'}`,
    });

    _lastImportPreview = null;
    return { ok: true, count };
  }

  function discardPreview() {
    _lastImportPreview = null;
  }

  function getSyncLog() {
    return _loadJSON(SYNC_LOG_KEY, []);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    // Native (Health Connect via Capacitor) — no-ops safely if unavailable
    isNativeAvailable,
    nativeStatus,
    nativeConnect,
    nativeSyncToday,

    // Manual import — works in any browser today
    parseFile,
    confirmImport,
    discardPreview,
    getSyncLog,
  };

})();

/**
 * ── Expected native plugin interface (for later Capacitor wrapper) ───────
 *
 * When you wrap Thanzi in Capacitor and add a Health Connect plugin, expose
 * it on `window.ThanziHealthNative` with this shape so the code above picks
 * it up automatically with zero changes to this file:
 *
 *   window.ThanziHealthNative = {
 *     isHealthConnectAvailable: async () => boolean,
 *     isConnected: async () => boolean,
 *     requestPermissions: async (scopes: string[]) => boolean,
 *     readToday: async (types: string[]) => {
 *       steps: number,
 *       active_calories: number,
 *       exercise_sessions: [{ name, duration_min, calories, notes }],
 *       weight_kg: number | null,
 *     },
 *   };
 *
 * A Capacitor plugin implementing this against Health Connect's Kotlin SDK
 * (androidx.health.connect.client) is a separate native-code project — this
 * file is deliberately native-agnostic so it works whether that plugin
 * exists yet or not.
 */
