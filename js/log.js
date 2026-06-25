/**
 * log.js — Thanzi Food Log Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Appwrite food_logs schema:
 *   userId, foodName, calories (int), carbs, protein, fat,
 *   mealType, date, quantity (grams, double), unit ('g')
 *
 * Dependencies: Appwrite SDK (IIFE), THANZI_CONFIG, ThanziFood,
 *               ThanziApp, ThanziScanner
 * Author: Edison Taimu — Thanzi
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziLog = (() => {
  'use strict';

  // ── Appwrite ──────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const _db = new Appwrite.Databases(_client);

  // ── State ─────────────────────────────────────────────────────────────────
  const _state = {
    currentUser:  null,
    selectedFood: null,
    selectedMeal: 'breakfast',
    todayLogs:    [],
    logInited:    false,
    searchTimer:  null,
    searching:    false,
  };

  // ── Fallback household measures ───────────────────────────────────────────
  const DEFAULT_MEASURES = [
    { label: '1 serving', g: 100 },
    { label: '1 cup',     g: 240 },
    { label: '1 tbsp',    g: 15  },
    { label: '1 tsp',     g: 5   },
    { label: '1 piece',   g: 80  },
  ];

  // ── Utilities ─────────────────────────────────────────────────────────────
  function _el(id) { return document.getElementById(id); }
  function _today() { return new Date().toISOString().split('T')[0]; }
  function _todayLabel() {
    return new Date().toLocaleDateString('en-MW', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
  }

  function _scale(food, totalGrams) {
    const f = totalGrams / 100;
    return {
      calories: Math.min(Math.round((food.kcal || 0) * f), 9999),
      carbs:    Math.round((food.cho  || 0) * f * 10) / 10,
      protein:  Math.round((food.pro  || 0) * f * 10) / 10,
      fat:      Math.round((food.fat  || 0) * f * 10) / 10,
    };
  }

  function _totalGrams() {
    const qty       = parseFloat(_el('portion-qty').value)         || 0;
    const unitGrams = parseFloat(_el('portion-unit-select').value) || 1;
    return qty * unitGrams;
  }

  // ── Measures dropdown ─────────────────────────────────────────────────────

  function _populateMeasures(food) {
    const select   = _el('portion-unit-select');
    const qtyInput = _el('portion-qty');
    select.innerHTML = '';

    const measures = (food.measures && food.measures.length > 0)
      ? food.measures
      : DEFAULT_MEASURES;

    measures.forEach(m => {
      if (!m.g || m.g <= 0) return;
      const opt       = document.createElement('option');
      opt.value       = m.g;
      opt.textContent = `${m.label} (${m.g}g)`;
      select.appendChild(opt);
    });

    const gOpt           = document.createElement('option');
    gOpt.value           = '1';
    gOpt.dataset.manual  = 'true';
    gOpt.textContent     = 'g (manual)';
    select.appendChild(gOpt);

    select.selectedIndex = 0;
    qtyInput.value = 1;
    qtyInput.step  = 0.5;
    qtyInput.min   = 0.1;
    qtyInput.max   = 99;

    _updatePortionCalc();
  }

  function _onUnitChange() {
    const select   = _el('portion-unit-select');
    const qtyInput = _el('portion-qty');
    const isManual = select.options[select.selectedIndex]?.dataset?.manual === 'true';

    if (isManual) {
      qtyInput.value = 100;
      qtyInput.step  = 10;
      qtyInput.min   = 1;
      qtyInput.max   = 5000;
    } else {
      qtyInput.value = 1;
      qtyInput.step  = 0.5;
      qtyInput.min   = 0.1;
      qtyInput.max   = 99;
    }
    _updatePortionCalc();
  }

  function _updatePortionCalc() {
    if (!_state.selectedFood) return;
    const totalGrams = _totalGrams();
    const isManual   = _el('portion-unit-select')
      .options[_el('portion-unit-select').selectedIndex]
      ?.dataset?.manual === 'true';

    const hint = _el('portion-grams-hint');
    hint.textContent = (!isManual && totalGrams > 0)
      ? `= ${Math.round(totalGrams)}g`
      : '';

    const s = _scale(_state.selectedFood, totalGrams);
    _el('portion-calc').innerHTML = `
      <div class="pc-item"><span class="pc-val">${s.calories}</span><span class="pc-lbl">kcal</span></div>
      <div class="pc-item"><span class="pc-val">${s.carbs}g</span><span class="pc-lbl">carbs</span></div>
      <div class="pc-item"><span class="pc-val">${s.protein}g</span><span class="pc-lbl">protein</span></div>
      <div class="pc-item"><span class="pc-val">${s.fat}g</span><span class="pc-lbl">fat</span></div>
    `;
  }

  // ── Barcode lookup ────────────────────────────────────────────────────────

  /**
   * Look up a barcode via Open Food Facts.
   * Returns a food object in ThanziFood format, or null if not found.
   */
  async function _lookupBarcode(barcode) {
    try {
      const res  = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
      const data = await res.json();

      if (data.status !== 1 || !data.product) return null;

      const p  = data.product;
      const n  = p.nutriments || {};

      return {
        name:       p.product_name || p.product_name_en || p.abbreviated_product_name || `Product ${barcode}`,
        kcal:       Math.round(n['energy-kcal_100g'] || n['energy-kcal'] || 0),
        cho:        Math.round((n.carbohydrates_100g || 0) * 10) / 10,
        pro:        Math.round((n.proteins_100g      || 0) * 10) / 10,
        fat:        Math.round((n.fat_100g           || 0) * 10) / 10,
        sourceUsed: 'OFF',
        measures:   [],  // packaged food — default measures will apply
        barcode,
      };
    } catch (err) {
      console.error('ThanziLog: barcode lookup failed', err.message);
      return null;
    }
  }

  /**
   * Called by ThanziScanner when a barcode is detected.
   * Shows loading state, hits OFF API, renders result.
   */
  async function _onBarcodeScanned(barcode) {
    const input     = _el('food-search-input');
    const container = _el('food-search-results');

    input.value = barcode;
    container.innerHTML = `
      <div class="sr-barcode-lookup">
        <span class="sr-spin">⏳</span> Looking up barcode <strong>${barcode}</strong>…
      </div>`;
    container.style.display = 'block';

    // 1. Try ThanziFood.search first (covers OFF layer natively)
    let food = null;
    try {
      const result = await ThanziFood.search(barcode, false, false, 1);
      const results = Array.isArray(result) ? result : (result ? [result] : []);
      if (results.length > 0) food = results[0];
    } catch { /* fall through */ }

    // 2. Direct OFF lookup if food search didn't find it
    if (!food) {
      food = await _lookupBarcode(barcode);
    }

    if (!food) {
      container.innerHTML = `
        <div class="sr-empty">
          Product not found for barcode <strong>${barcode}</strong>.<br>
          <small>Try searching by name instead.</small>
        </div>`;
      return;
    }

    // Show as single search result
    _renderSearchResults([food], true);
    input.value = food.name;
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
          <span class="sr-sub">${f.cat || (f.barcode ? `Barcode: ${f.barcode}` : '')}</span>
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
    _populateMeasures(food);
    const card = _el('selected-food-card');
    card.style.display = 'block';
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      if (localResults.length < 3) _searchFullAsync(q);
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
      const result  = await ThanziFood.search(q, false, false, 10);
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

  // ── Today's log ───────────────────────────────────────────────────────────

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

    const groups = { breakfast: [], lunch: [], dinner: [], snack: [] };
    logs.forEach(l => { if (groups[l.mealType]) groups[l.mealType].push(l); });

    const html = Object.entries(MEAL_META)
      .sort(([, a], [, b]) => a.order - b.order)
      .filter(([meal]) => groups[meal].length > 0)
      .map(([meal, meta]) => {
        const entries = groups[meal];
        const mealCal = entries.reduce((s, e) => s + (e.calories || 0), 0);
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
                  <span class="log-entry-detail">${e.quantity}g &middot; ${e.calories} kcal &middot; ${e.protein}g P</span>
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

  // ── Appwrite ──────────────────────────────────────────────────────────────

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
    const food       = _state.selectedFood;
    const totalGrams = _totalGrams();

    if (!food)            return _flashError('Select a food first.');
    if (totalGrams <= 0)  return _flashError('Enter a valid portion.');
    if (!_state.currentUser) return;

    const btn = _el('log-food-btn');
    btn.disabled    = true;
    btn.textContent = 'Saving…';

    const scaled = _scale(food, totalGrams);

    try {
      await _db.createDocument(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.foodLogs,
        Appwrite.ID.unique(),
        {
          userId:   _state.currentUser.$id,
          foodName: food.name,
          calories: scaled.calories,
          carbs:    scaled.carbs,
          protein:  scaled.protein,
          fat:      scaled.fat,
          mealType: _state.selectedMeal,
          date:     _today(),
          quantity: Math.round(totalGrams * 10) / 10,
          unit:     'g',
        }
      );

      _el('selected-food-card').style.display = 'none';
      _el('food-search-input').value           = '';
      _el('food-search-results').style.display = 'none';
      _state.selectedFood = null;

      btn.textContent = '✓ Logged!';
      setTimeout(() => { btn.textContent = 'Log Food'; btn.disabled = false; }, 1200);

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

  function _flashError(msg) {
    const el = _el('log-error');
    if (!el) return;
    el.textContent   = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  async function init(user) {
    _state.currentUser = user;

    const dateEl = _el('log-date-label');
    if (dateEl) dateEl.textContent = _todayLabel();

    _bindMealSelector();

    _el('food-search-input').addEventListener('input', _onSearchInput);

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.food-search-wrap') && !e.target.closest('#scanner-modal')) {
        _el('food-search-results').style.display = 'none';
      }
    }, { passive: true });

    _el('portion-qty').addEventListener('input', _updatePortionCalc);
    _el('portion-unit-select').addEventListener('change', _onUnitChange);
    _el('log-food-btn').addEventListener('click', _logFood);

    // Barcode scan button
    _el('barcode-scan-btn')?.addEventListener('click', () => {
      ThanziScanner.open(_onBarcodeScanned);
    });

    // Init scanner modal events
    ThanziScanner.init();

    await _loadTodayLogs();
    _state.logInited = true;
  }

  async function refresh() {
    await _loadTodayLogs();
  }

  return { init, refresh };

})();
