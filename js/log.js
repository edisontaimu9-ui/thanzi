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
    quickItems:   [],
    quickBusy:    false,
  };

  // ── Fallback household measures ───────────────────────────────────────────
  const DEFAULT_MEASURES = [
    { label: '1 serving', g: 100 },
    { label: '1 cup',     g: 240 },
    { label: '1 tbsp',    g: 15  },
    { label: '1 tsp',     g: 5   },
    { label: '1 piece',   g: 80  },
  ];

  // ── Quick-add natural language parsing tables ────────────────────────────
  const WORD_NUM = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    couple: 2, few: 3, several: 3, half: 0.5,
  };

  const UNIT_GRAMS = {
    cup: 240, cups: 240,
    tbsp: 15, tablespoon: 15, tablespoons: 15,
    tsp: 5, teaspoon: 5, teaspoons: 5,
    slice: 30, slices: 30,
    piece: 80, pieces: 80,
    bowl: 300, bowls: 300,
    plate: 350, plates: 350,
    glass: 250, glasses: 250,
    serving: 100, servings: 100,
    handful: 30, handfuls: 30,
    scoop: 30, scoops: 30,
    g: 1, gram: 1, grams: 1,
  };

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

    const sourceLabel = { local: 'MW', regional: 'AF', FDC: 'US', OFF: 'PKG', combined: '✓', custom: '★ Mine' };

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
      // Merge custom foods (shown first, labelled "Mine") + local DB
      const customResults = (typeof ThanziCustomFoods !== 'undefined')
        ? ThanziCustomFoods.search(q).map(f => ({ ...f, sourceUsed: 'custom' }))
        : [];
      const localResults = ThanziFood.searchLocal(q, 10);
      const merged = [...customResults, ...localResults];
      _renderSearchResults(merged, false);
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

  // ── Quick Add — natural language meal entry ─────────────────────────────
  //
  // Splits a free-text meal description ("2 eggs and toast") into individual
  // food clauses, tries to resolve each against the local Malawi/regional
  // food database first, and only falls back to the AI backend for items it
  // can't confidently match. Calorie/macro values for AI items are estimated
  // directly for the stated quantity (not per-100g), so no further scaling
  // is needed before saving.

  const _CLAUSE_SPLIT = /\s*,\s*|\s*;\s*|\s+and\s+|\s+with\s+|\s+plus\s+|\s*\+\s*/i;

  function _parseClause(clauseRaw) {
    let text = clauseRaw.trim();
    let qty  = 1;

    const numMatch = text.match(/^(\d+(?:\.\d+)?)\s+/);
    if (numMatch) {
      qty  = parseFloat(numMatch[1]);
      text = text.slice(numMatch[0].length);
    } else {
      const wordMatch = text.match(/^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|half)\s+(?:a\s+)?(?:of\s+)?/i);
      if (wordMatch) {
        qty  = WORD_NUM[wordMatch[1].toLowerCase()] ?? 1;
        text = text.slice(wordMatch[0].length);
      }
    }

    let unit = null;
    const unitNames = Object.keys(UNIT_GRAMS).sort((a, b) => b.length - a.length).join('|');
    const unitMatch = text.match(new RegExp(`^(${unitNames})\\s+(?:of\\s+)?`, 'i'));
    if (unitMatch) {
      unit = unitMatch[1].toLowerCase();
      text = text.slice(unitMatch[0].length);
    }

    text = text.replace(/^(a|an|the)\s+/i, '').trim();
    return { raw: clauseRaw.trim(), qty, unit, name: text };
  }

  /** Estimate a total gram weight for a parsed clause, using a detected unit,
   *  the matched food's own count-based measure (e.g. "2 eggs (100g)"), or a
   *  generic per-item fallback. */
  function _estimateGrams(qty, unit, rawFood) {
    if (unit && UNIT_GRAMS[unit]) return qty * UNIT_GRAMS[unit];

    if (rawFood && Array.isArray(rawFood.measures)) {
      for (const m of rawFood.measures) {
        const cm = (m.lbl || '').match(/^(\d+)\s+\D*\((\d+(?:\.\d+)?)\s*(?:g|mL|ml)\)/i);
        if (cm) {
          const n = parseFloat(cm[1]);
          const w = parseFloat(cm[2]);
          if (n > 0) return qty * (w / n);
        }
      }
    }
    return qty * 80; // generic "1 piece" default
  }

  /** True if a local search hit is confident enough to use without AI. */
  function _isGoodLocalMatch(hit) {
    if (!hit) return false;
    return hit.matchTier === 'exact' || hit.matchTier === 'alias' ||
      (hit.matchTier === 'token' && hit.confidenceScore >= 0.55);
  }

  /** One-shot call to the AI backend for items the local DB couldn't resolve.
   *  Asks for calories/macros for each item AS WRITTEN (exact stated
   *  quantity) — not per 100g — so results can be used directly. */
  async function _estimateViaAI(rawItems) {
    const functionId = THANZI_CONFIG.functions && THANZI_CONFIG.functions.aiAssistant;
    if (!functionId) {
      throw new Error('AI function not configured. Set THANZI_CONFIG.functions.aiAssistant in config.js');
    }

    const prompt = `You are a nutrition estimation engine for a Malawian food-tracking app.
For each numbered food item below (written by a user, with its stated quantity), estimate the calories, carbohydrates (g), protein (g), and fat (g) for that EXACT stated quantity — do not normalise to 100g. Prefer foods and dishes common in Malawi and Southern Africa when a term is ambiguous (e.g. "porridge" → maize porridge, "greens" → leafy vegetables like mustard or pumpkin leaves).
Respond with ONLY a valid JSON array, no markdown formatting, no commentary — in this exact shape and order:
[{"name":"short food name","calories":123,"carbs":12.3,"protein":5.0,"fat":3.0}]

Items:
${rawItems.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

    const res = await fetch(
      `${THANZI_CONFIG.endpoint}/functions/${functionId}/executions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': THANZI_CONFIG.projectId,
        },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
        credentials: 'include',
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`AI function error (${res.status}): ${err}`);
    }

    const execution = await res.json();

    let replyText;
    try {
      const parsed = JSON.parse(execution.responseBody);
      replyText = parsed.reply || parsed.content || parsed.text || execution.responseBody;
    } catch {
      replyText = execution.responseBody;
    }

    const cleaned = String(replyText).replace(/```json|```/g, '').trim();
    const arr = JSON.parse(cleaned);
    if (!Array.isArray(arr)) throw new Error('Unexpected AI response shape');
    return arr;
  }

  async function _quickAddMeal() {
    if (_state.quickBusy) return;
    const input = _el('quick-meal-input');
    const text  = input.value.trim();
    if (!text) return;

    _state.quickBusy = true;
    const btn = _el('quick-meal-btn');
    btn.disabled    = true;
    btn.textContent = 'Parsing…';

    const clauses = text.split(_CLAUSE_SPLIT).map(s => s.trim()).filter(Boolean);
    const resolved = [];
    const needsAI  = [];

    clauses.forEach((clause) => {
      const { qty, unit, name } = _parseClause(clause);
      if (!name) return;

      const hits = ThanziFood.searchLocal(name, 3);
      const top  = hits[0];

      if (_isGoodLocalMatch(top)) {
        const grams  = _estimateGrams(qty, unit, top._raw || top);
        const scaled = _scale(top, grams);
        resolved.push({
          raw: clause, name: top.name, source: 'local',
          quantity: Math.round(grams * 10) / 10,
          calories: scaled.calories, carbs: scaled.carbs,
          protein: scaled.protein, fat: scaled.fat,
        });
      } else {
        const grams = _estimateGrams(qty, unit, null);
        needsAI.push({ raw: clause, name, quantity: Math.round(grams * 10) / 10 });
      }
    });

    if (needsAI.length) {
      try {
        const aiResults = await _estimateViaAI(needsAI.map(i => i.raw));
        aiResults.forEach((r, i) => {
          const meta = needsAI[i];
          if (!meta) return;
          resolved.push({
            raw: meta.raw, name: r.name || meta.name, source: 'ai',
            quantity: meta.quantity,
            calories: Math.round(r.calories || 0),
            carbs:    Math.round((r.carbs   || 0) * 10) / 10,
            protein:  Math.round((r.protein || 0) * 10) / 10,
            fat:      Math.round((r.fat     || 0) * 10) / 10,
          });
        });
      } catch (err) {
        console.error('ThanziLog: AI estimate failed', err.message);
        needsAI.forEach(meta => {
          resolved.push({
            raw: meta.raw, name: meta.name, source: 'error',
            quantity: meta.quantity, calories: null, carbs: null, protein: null, fat: null,
          });
        });
      }
    }

    _state.quickItems = resolved;
    _renderQuickPreview(resolved);

    btn.disabled    = false;
    btn.textContent = 'Add';
    _state.quickBusy = false;
  }

  function _renderQuickPreview(items) {
    const wrap = _el('quick-meal-preview');
    if (!wrap) return;

    if (!items.length) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }

    const totalKcal = items.reduce((s, it) => s + (it.calories || 0), 0);
    const badgeLabel = { local: 'MW', ai: 'AI', error: '⚠' };

    wrap.innerHTML = `
      ${items.map((it, i) => `
        <div class="qm-item" data-i="${i}">
          <div class="qm-item-left">
            <span class="qm-name">${it.name}</span>
            <span class="qm-sub">${it.calories != null ? `${it.quantity}g (est.)` : 'Not recognized — remove or search manually'}</span>
          </div>
          <div class="qm-item-right">
            ${it.calories != null ? `<span class="qm-kcal">${it.calories} kcal</span>` : ''}
            <span class="qm-badge qm-badge--${it.source}">${badgeLabel[it.source] || ''}</span>
            <button class="qm-remove" data-i="${i}" aria-label="Remove">✕</button>
          </div>
        </div>
      `).join('')}
      <div class="qm-footer">
        <span class="qm-total">${totalKcal} kcal total</span>
        <button id="quick-log-all-btn" class="qm-log-all-btn">Log All</button>
      </div>
    `;
    wrap.style.display = 'block';

    wrap.querySelectorAll('.qm-remove').forEach(b => {
      b.addEventListener('click', () => {
        _state.quickItems.splice(parseInt(b.dataset.i, 10), 1);
        _renderQuickPreview(_state.quickItems);
      });
    });

    _el('quick-log-all-btn')?.addEventListener('click', _confirmQuickLog);
  }

  async function _confirmQuickLog() {
    const items = (_state.quickItems || []).filter(it => it.calories != null);
    if (!items.length || !_state.currentUser) return;

    const btn = _el('quick-log-all-btn');
    btn.disabled    = true;
    btn.textContent = 'Saving…';

    try {
      for (const it of items) {
        await _db.createDocument(
          THANZI_CONFIG.databaseId,
          THANZI_CONFIG.collections.foodLogs,
          Appwrite.ID.unique(),
          {
            userId:   _state.currentUser.$id,
            foodName: it.name,
            calories: it.calories,
            carbs:    it.carbs,
            protein:  it.protein,
            fat:      it.fat,
            mealType: _state.selectedMeal,
            date:     _today(),
            quantity: it.quantity,
            unit:     'g',
          }
        );
      }

      _el('quick-meal-input').value = '';
      _el('quick-meal-input').style.height = 'auto';
      _el('quick-meal-preview').style.display = 'none';
      _state.quickItems = [];

      await _loadTodayLogs();
    } catch (err) {
      console.error('ThanziLog: quick-add save error', err.message);
      btn.textContent = 'Error — try again';
      btn.disabled = false;
      return;
    }

    btn.textContent = 'Log All';
    btn.disabled = false;
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
    if (typeof ThanziApp !== 'undefined' && ThanziApp.updateHomeMeals) {
      ThanziApp.updateHomeMeals(logs);
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

    // Quick add — natural language meal entry
    const quickInput = _el('quick-meal-input');
    if (quickInput) {
      quickInput.addEventListener('input', () => {
        quickInput.style.height = 'auto';
        quickInput.style.height = Math.min(quickInput.scrollHeight, 90) + 'px';
      });
      quickInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          _quickAddMeal();
        }
      });
    }
    _el('quick-meal-btn')?.addEventListener('click', _quickAddMeal);

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

  /**
   * Log an array of pre-calculated food items to Appwrite.
   * Called by ThanziMealTemplates when a template is applied.
   * items: [{ name, grams, kcal, carbs, protein, fat }]
   */
  async function logItems(items, mealType) {
    if (!_state.currentUser || !items || !items.length) return;
    const today = _today();
    for (const item of items) {
      try {
        await _db.createDocument(
          THANZI_CONFIG.databaseId,
          THANZI_CONFIG.collections.foodLogs,
          Appwrite.ID.unique(),
          {
            userId:   _state.currentUser.$id,
            foodName: item.name,
            calories: Math.round(item.kcal    || 0),
            carbs:    Math.round((item.carbs   || 0) * 10) / 10,
            protein:  Math.round((item.protein || 0) * 10) / 10,
            fat:      Math.round((item.fat     || 0) * 10) / 10,
            mealType: mealType || 'breakfast',
            date:     today,
            quantity: Math.round((item.grams   || 100) * 10) / 10,
            unit:     'g',
          }
        );
      } catch (err) {
        console.error('ThanziLog: logItems error', err.message);
      }
    }
    await _loadTodayLogs();
  }

  return { init, refresh, logItems };

})();
