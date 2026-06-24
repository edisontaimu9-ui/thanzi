/**
 * log.js — Thanzi Food Log Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Aligned to actual Appwrite food_logs collection schema:
 *
 *   userId    (text, required)
 *   foodName  (text, required)
 *   calories  (integer, required, Min: 0, Max: 9999)
 *   carbs     (double, required)
 *   protein   (double, required)
 *   fat       (double, required)
 *   mealType  (text, required)  — breakfast | lunch | dinner | snack
 *   date      (text, required)  — YYYY-MM-DD
 *   quantity  (double, required) — grams
 *   unit      (text, required)  — 'g'
 *
 * Dependencies: Appwrite SDK (IIFE), THANZI_CONFIG, ThanziFood, ThanziApp
 * Author: Edison Taimu — Thanzi
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziLog = (() => {
  'use strict';

  // ── Appwrite client ───────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const _db = new Appwrite.Databases(_client);

  // ── Module state ──────────────────────────────────────────────────────────
  const _state = {
    currentUser:  null,
    selectedFood: null,
    selectedMeal: 'breakfast',
    todayLogs:    [],
    logInited:    false,
    searchTimer:  null,
    searching:    false,
  };

  // ── Utilities ─────────────────────────────────────────────────────────────

  function _el(id) { return document.getElementById(id); }

  function _today() {
    return new Date().toISOString().split('T')[0];
  }

  function _todayLabel() {
    return new Date().toLocaleDateString('en-MW', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
  }

  /**
   * Scale per-100g nutrition to a given gram weight.
   * Returns field names matching the Appwrite schema.
   */
  function _scale(food, grams) {
    const f = grams / 100;
    return {
      calories: Math.min(Math.round((food.kcal || 0) * f), 9999), // integer, max 9999
      carbs:    Math.round((food.cho  || 0) * f * 10) / 10,
      protein:  Math.round((food.pro  || 0) * f * 10) / 10,
      fat:      Math.round((food.fat  || 0) * f * 10) / 10,
    };
  }

  // ── Search UI ─────────────────────────────────────────────────────────────

  function _renderSearchResults(results, isOnline = false) {
    const container = _el('food-search-results');

    if (!results || !results.length) {
      container.innerHTML = isOnline
        ? '<div class="sr-empty">No results found.</div>'
        : `<div class="sr-empty">No local results.
             <button id="search-online-btn" class="sr-online-btn">Search online →</button>
           </div>`;
      container.style.display = 'block';
      _el('search-online-btn')?.addEventListener('click', _searchOnline);
      return;
    }

    const sourceLabel = { local: 'MW', regional: 'AF', FDC: 'US', OFF: 'PKG', combined: '✓' };

    container.innerHTML = results.map((f, i) => `
      <div class="sr-item" data-idx="${i}">
        <div class="sr-item-left">
          <span class="sr-name">${f.name}</span>
          <span class="sr-sub">${f.cat || ''}</span>
        </div>
        <div class="sr-item-right">
          <span class="sr-kcal">${f.kcal != null ? f.kcal : '?'} kcal</span>
          <span class="sr-source ${(f.sourceUsed || 'local').toLowerCase()}">${sourceLabel[f.sourceUsed] || 'MW'}</span>
        </div>
      </div>
    `).join('');

    container.style.display = 'block';
    container._results = results;

    container.querySelectorAll('.sr-item').forEach(item => {
      item.addEventListener('click', () => {
        const food = container._results[parseInt(item.dataset.idx)];
        _selectFood(food);
        container.style.display = 'none';
        _el('food-search-input').value = food.name;
      });
    });
  }

  function _selectFood(food) {
    _state.selectedFood = food;

    _el('selected-food-name').textContent = food.name;
    _el('selected-food-per100').textContent =
      `Per 100g: ${food.kcal ?? '?'} kcal · ${food.cho ?? '?'}g carbs · ${food.pro ?? '?'}g protein · ${food.fat ?? '?'}g fat`;

    _el('portion-input').value = _defaultPortion(food);
    _updatePortionCalc();

    const card = _el('selected-food-card');
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function _defaultPortion(food) {
    if (food.measures && food.measures.length) {
      const serving = food.measures.find(m =>
        /serving|portion|piece|cup|plate/i.test(m.label)
      );
      if (serving && serving.g > 0) return serving.g;
    }
    return 100;
  }

  function _updatePortionCalc() {
    if (!_state.selectedFood) return;
    const grams = parseFloat(_el('portion-input').value) || 0;
    const s = _scale(_state.selectedFood, grams);

    _el('portion-calc').innerHTML = `
      <div class="pc-item"><span class="pc-val">${s.calories}</span><span class="pc-lbl">kcal</span></div>
      <div class="pc-item"><span class="pc-val">${s.carbs}g</span><span class="pc-lbl">carbs</span></div>
      <div class="pc-item"><span class="pc-val">${s.protein}g</span><span class="pc-lbl">protein</span></div>
      <div class="pc-item"><span class="pc-val">${s.fat}g</span><span class="pc-lbl">fat</span></div>
    `;
  }

  // ── Search logic ──────────────────────────────────────────────────────────

  function _onSearchInput(e) {
    const q = e.target.value.trim();
    if (q.length < 2) {
      _el('food-search-results').style.display = 'none';
      return;
    }

    clearTimeout(_state.searchTimer);
    _state.searchTimer = setTimeout(() => {
      const localResults = ThanziFood.searchLocal(q, 10);
      _renderSearchResults(localResults, false);

      // Kick off async full search if local results are sparse
      if (localResults.length < 3) {
        _searchFullAsync(q);
      }
    }, 220);
  }

  async function _searchFullAsync(q) {
    if (_state.searching) return;
    _state.searching = true;

    const container = _el('food-search-results');
    const hint = document.createElement('div');
    hint.className = 'sr-loading';
    hint.id = 'sr-loading-hint';
    hint.textContent = '⏳ Searching online…';
    container.appendChild(hint);
    container.style.display = 'block';

    try {
      const result = await ThanziFood.search(q, false, false, 10);
      const results = Array.isArray(result) ? result : (result ? [result] : []);
      _renderSearchResults(results, true);
    } catch {
      _el('sr-loading-hint')?.remove();
    } finally {
      _state.searching = false;
    }
  }

  async function _searchOnline() {
    const q = _el('food-search-input').value.trim();
    if (q) await _searchFullAsync(q);
  }

  // ── Meal selector ─────────────────────────────────────────────────────────

  function _bindMealSelector() {
    document.querySelectorAll('.meal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.meal-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _state.selectedMeal = btn.dataset.meal;
      });
    });
  }

  // ── Today's log rendering ─────────────────────────────────────────────────

  const MEAL_META = {
    breakfast: { label: '🌅 Breakfast', order: 0 },
    lunch:     { label: '☀️ Lunch',     order: 1 },
    dinner:    { label: '🌙 Dinner',    order: 2 },
    snack:     { label: '🍎 Snack',     order: 3 },
  };

  function _renderTodayLog(logs) {
    const container = _el('log-entries');
    const totalCal  = logs.reduce((s, l) => s + (l.calories || 0), 0);
    _el('log-total-kcal').textContent = `${totalCal} kcal today`;

    if (!logs.length) {
      container.innerHTML = `
        <div class="log-empty">
          <span class="log-empty-icon">🍽️</span>
          <p>Nothing logged yet.<br>Search for a food above to get started.</p>
        </div>`;
      return;
    }

    // Group by mealType
    const groups = { breakfast: [], lunch: [], dinner: [], snack: [] };
    logs.forEach(l => { if (groups[l.mealType]) groups[l.mealType].push(l); });

    const html = Object.entries(MEAL_META)
      .sort(([, a], [, b]) => a.order - b.order)
      .filter(([meal]) => groups[meal].length > 0)
      .map(([meal, meta]) => {
        const entries  = groups[meal];
        const mealCal  = entries.reduce((s, e) => s + (e.calories || 0), 0);
        return `
          <div class="log-meal-group">
            <div class="log-meal-header">
              <span class="log-meal-label">${meta.label}</span>
              <span class="log-meal-kcal">${mealCal} kcal</span>
            </div>
            ${entries.map(e => `
              <div class="log-entry" data-id="${e.$id}">
                <div class="log-entry-info">
                  <span class="log-entry-name">${e.foodName}</span>
                  <span class="log-entry-detail">${e.quantity}${e.unit} &middot; ${e.calories} kcal &middot; ${e.protein}g P</span>
                </div>
                <button class="log-entry-delete" data-id="${e.$id}" title="Remove">✕</button>
              </div>
            `).join('')}
          </div>`;
      }).join('');

    container.innerHTML = html;

    container.querySelectorAll('.log-entry-delete').forEach(btn => {
      btn.addEventListener('click', () => _deleteLog(btn.dataset.id));
    });
  }

  // ── Appwrite operations ───────────────────────────────────────────────────

  async function _loadTodayLogs() {
    if (!_state.currentUser) return;

    try {
      const res = await _db.listDocuments(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.foodLogs,
        [
          Appwrite.Query.equal('userId', _state.currentUser.$id),
          Appwrite.Query.equal('date', _today()),
          Appwrite.Query.orderAsc('$createdAt'),
          Appwrite.Query.limit(200),
        ]
      );

      _state.todayLogs = res.documents;
      _renderTodayLog(res.documents);
      _syncDashboard(res.documents);

    } catch (err) {
      console.error('ThanziLog: load error', err.message);
    }
  }

  async function _logFood() {
    const food  = _state.selectedFood;
    const grams = parseFloat(_el('portion-input').value);

    if (!food)                return _flashError('Select a food first.');
    if (!grams || grams <= 0) return _flashError('Enter a valid portion.');
    if (!_state.currentUser)  return;

    const btn = _el('log-food-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const scaled = _scale(food, grams);

    try {
      await _db.createDocument(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.foodLogs,
        Appwrite.ID.unique(),
        {
          userId:   _state.currentUser.$id,
          foodName: food.name,
          calories: scaled.calories,   // integer
          carbs:    scaled.carbs,
          protein:  scaled.protein,
          fat:      scaled.fat,
          mealType: _state.selectedMeal,
          date:     _today(),
          quantity: grams,
          unit:     'g',
        }
      );

      // Reset food card
      _el('selected-food-card').style.display = 'none';
      _el('food-search-input').value = '';
      _el('food-search-results').style.display = 'none';
      _state.selectedFood = null;

      btn.textContent = '✓ Logged!';
      setTimeout(() => {
        btn.textContent = 'Log Food';
        btn.disabled = false;
      }, 1200);

      await _loadTodayLogs();

    } catch (err) {
      console.error('ThanziLog: save error', err.message);
      btn.textContent = 'Error — try again';
      btn.disabled = false;
    }
  }

  async function _deleteLog(docId) {
    try {
      await _db.deleteDocument(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.foodLogs,
        docId
      );
      await _loadTodayLogs();
    } catch (err) {
      console.error('ThanziLog: delete error', err.message);
    }
  }

  // ── Dashboard sync ────────────────────────────────────────────────────────

  function _syncDashboard(logs) {
    const totals = logs.reduce((acc, l) => ({
      kcal:    acc.kcal    + (l.calories || 0),
      carbs:   acc.carbs   + (l.carbs    || 0),
      protein: acc.protein + (l.protein  || 0),
      fat:     acc.fat     + (l.fat      || 0),
    }), { kcal: 0, carbs: 0, protein: 0, fat: 0 });

    if (typeof ThanziApp !== 'undefined' && ThanziApp.updateNutrition) {
      ThanziApp.updateNutrition(totals);
    }
  }

  // ── Misc helpers ──────────────────────────────────────────────────────────

  function _flashError(msg) {
    const el = _el('log-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function init(user) {
    _state.currentUser = user;

    const dateEl = _el('log-date-label');
    if (dateEl) dateEl.textContent = _todayLabel();

    _bindMealSelector();

    _el('food-search-input').addEventListener('input', _onSearchInput);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.food-search-wrap')) {
        _el('food-search-results').style.display = 'none';
      }
    }, { passive: true });

    _el('portion-input').addEventListener('input', _updatePortionCalc);
    _el('log-food-btn').addEventListener('click', _logFood);

    await _loadTodayLogs();
    _state.logInited = true;
  }

  async function refresh() {
    await _loadTodayLogs();
  }

  return { init, refresh };

})();
