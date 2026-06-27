/**
 * recipe.js — Thanzi Recipe Builder
 *
 * Features:
 *  - Create recipes with ingredients (manual search or AI natural language parsing)
 *  - Auto-calculate macros per serving
 *  - Save to Appwrite (recipes collection)
 *  - Log a recipe as a meal to today's food log
 *  - Edit & delete saved recipes
 *
 * Dependencies: Appwrite SDK (IIFE), THANZI_CONFIG, ThanziFood, ThanziLog
 */
const ThanziRecipe = (() => {
  'use strict';

  // ── Appwrite ───────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);
  const _db     = new Appwrite.Databases(_client);
  const _auth   = new Appwrite.Account(_client);

  // ── State ──────────────────────────────────────────────────────────────────
  const _s = {
    user:        null,
    recipes:     [],       // loaded from Appwrite
    editId:      null,     // null = new recipe, else = recipe $id being edited
    ingredients: [],       // [{ name, qty, unit, calories, carbs, protein, fat }]
    searchTimer: null,
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const _el  = id => document.getElementById(id);
  const _fmt = n  => isNaN(n) ? '0' : Number(n).toFixed(1);

  function _today() {
    return new Date().toISOString().slice(0, 10);
  }

  // ── Nutrition recalc ───────────────────────────────────────────────────────
  function _recalc() {
    const servings = Math.max(1, parseInt(_el('rb-servings').value) || 1);
    const totals   = _s.ingredients.reduce((acc, ing) => {
      acc.calories += ing.calories || 0;
      acc.carbs    += ing.carbs    || 0;
      acc.protein  += ing.protein  || 0;
      acc.fat      += ing.fat      || 0;
      return acc;
    }, { calories: 0, carbs: 0, protein: 0, fat: 0 });

    const perServing = {
      calories: totals.calories / servings,
      carbs:    totals.carbs    / servings,
      protein:  totals.protein  / servings,
      fat:      totals.fat      / servings,
    };

    _el('rb-nut-kcal').textContent    = Math.round(perServing.calories);
    _el('rb-nut-carbs').textContent   = _fmt(perServing.carbs)   + 'g';
    _el('rb-nut-protein').textContent = _fmt(perServing.protein) + 'g';
    _el('rb-nut-fat').textContent     = _fmt(perServing.fat)     + 'g';

    const summary = _el('rb-nutrition-summary');
    if (summary) summary.style.display = _s.ingredients.length ? 'block' : 'none';

    return { totals, perServing };
  }

  // ── Render ingredient list ─────────────────────────────────────────────────
  function _renderIngredients() {
    const container = _el('rb-ingredients');
    if (!container) return;

    if (!_s.ingredients.length) {
      container.innerHTML = '';
      _recalc();
      return;
    }

    container.innerHTML = _s.ingredients.map((ing, i) => `
      <div class="rb-ing-row" data-idx="${i}">
        <div class="rb-ing-info">
          <span class="rb-ing-name">${ing.name}</span>
          <span class="rb-ing-macros">${Math.round(ing.calories)} kcal · ${_fmt(ing.carbs)}g C · ${_fmt(ing.protein)}g P · ${_fmt(ing.fat)}g F</span>
        </div>
        <div class="rb-ing-qty-wrap">
          <input class="rb-ing-qty" type="number" min="0.1" step="0.1" value="${ing.qty || 1}"
            data-idx="${i}" title="Quantity (${ing.unit || 'serving'})">
          <span class="rb-ing-unit">${ing.unit || 'srv'}</span>
        </div>
        <button class="rb-ing-remove" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');

    // Qty change listeners
    container.querySelectorAll('.rb-ing-qty').forEach(input => {
      input.addEventListener('change', e => {
        const idx    = parseInt(e.target.dataset.idx);
        const newQty = parseFloat(e.target.value) || 1;
        const ing    = _s.ingredients[idx];
        const ratio  = newQty / (ing.qty || 1);
        ing.qty      = newQty;
        ing.calories = (ing.calories || 0) * ratio;
        ing.carbs    = (ing.carbs    || 0) * ratio;
        ing.protein  = (ing.protein  || 0) * ratio;
        ing.fat      = (ing.fat      || 0) * ratio;
        _recalc();
      });
    });

    // Remove listeners
    container.querySelectorAll('.rb-ing-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.idx);
        _s.ingredients.splice(idx, 1);
        _renderIngredients();
        _recalc();
      });
    });

    _recalc();
  }

  // ── Add ingredient from food search result ─────────────────────────────────
  function _addIngredient(food) {
    _s.ingredients.push({
      name:     food.name || food.label || 'Food',
      qty:      food.servingQty  || 100,
      unit:     food.servingUnit || 'g',
      calories: food.calories    || food.kcal || 0,
      carbs:    food.carbs       || food.carbohydrates || 0,
      protein:  food.protein     || 0,
      fat:      food.fat         || food.totalFat || 0,
    });
    _renderIngredients();
    _el('rb-ing-search').value = '';
    _el('rb-ing-results').style.display = 'none';
  }

  // ── Food search (uses ThanziFood.searchLocal) ──────────────────────────────
  function _runSearch(query) {
    const results = _el('rb-ing-results');
    if (!query || query.length < 2) {
      results.style.display = 'none';
      return;
    }

    let hits = [];
    if (typeof ThanziFood !== 'undefined') {
      hits = ThanziFood.searchLocal(query, 8);
    }

    if (!hits.length) {
      results.innerHTML = '<div class="rb-ing-result-item rb-ing-no-result">No local results — try AI Parse above</div>';
      results.style.display = 'block';
      return;
    }

    results.innerHTML = hits.map((h, i) => `
      <div class="rb-ing-result-item" data-idx="${i}">
        <span class="rb-ing-result-name">${h.name}</span>
        <span class="rb-ing-result-kcal">${Math.round(h.calories || h.kcal || 0)} kcal</span>
      </div>
    `).join('');
    results.style.display = 'block';

    results.querySelectorAll('.rb-ing-result-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        if (hits[i]) _addIngredient(hits[i]);
      });
    });
  }

  // ── AI ingredient parsing ──────────────────────────────────────────────────
  async function _aiParseIngredients() {
    const text = (_el('rb-ai-input').value || '').trim();
    if (!text) return;

    const btn = _el('rb-ai-parse-btn');
    btn.disabled    = true;
    btn.textContent = 'Parsing…';

    try {
      const prompt = `Parse the following ingredient description into a JSON array. For each ingredient, provide name, qty (number), unit (g/ml/cup/tbsp/tsp/piece/serving), calories, carbs, protein, fat — all for the stated quantity. Prefer Malawian/Southern African food values. Return ONLY a valid JSON array, no markdown:
[{"name":"ingredient name","qty":100,"unit":"g","calories":120,"carbs":25,"protein":3,"fat":1}]

Ingredients: ${text}`;

      const res = await fetch('https://thanzi-ai-proxy.edisontaimu9.workers.dev/v1/groq/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Thanzi-Key': 'thanzi_app001',
        },
        body: JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          messages:    [
            { role: 'system', content: 'You are a nutrition assistant. Always respond with only a valid JSON array. No markdown, no explanation.' },
            { role: 'user',   content: prompt },
          ],
          temperature: 0.1,
          max_tokens:  800,
        }),
      });

      if (!res.ok) throw new Error(`Proxy error ${res.status}`);

      const data      = await res.json();
      const replyText = data?.choices?.[0]?.message?.content ?? '';
      const cleaned   = replyText.replace(/```json|```/g, '').trim();

      let arr;
      try {
        arr = JSON.parse(cleaned);
      } catch {
        const m = cleaned.match(/\[[\s\S]*\]/);
        arr = m ? JSON.parse(m[0]) : [];
      }

      if (!Array.isArray(arr) || !arr.length) throw new Error('No ingredients parsed');

      arr.forEach(ing => {
        _s.ingredients.push({
          name:     ing.name     || 'Ingredient',
          qty:      ing.qty      || 100,
          unit:     ing.unit     || 'g',
          calories: ing.calories || 0,
          carbs:    ing.carbs    || 0,
          protein:  ing.protein  || 0,
          fat:      ing.fat      || 0,
        });
      });

      _el('rb-ai-input').value = '';
      _renderIngredients();

    } catch (err) {
      alert('AI parsing failed: ' + err.message);
    } finally {
      btn.disabled    = false;
      btn.innerHTML   = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v1h1a3 3 0 010 6h-1v1a4 4 0 01-8 0v-1H7a3 3 0 010-6h1V6a4 4 0 014-4z"/></svg> AI Parse`;
    }
  }

  // ── Save recipe to Appwrite ────────────────────────────────────────────────
  async function _saveRecipe() {
    const name     = (_el('rb-recipe-name').value || '').trim();
    const servings = Math.max(1, parseInt(_el('rb-servings').value) || 1);

    if (!name)                   return alert('Please enter a recipe name.');
    if (!_s.ingredients.length)  return alert('Add at least one ingredient.');
    if (!_s.user)                return alert('Please sign in first.');

    const btn     = _el('rb-save-btn');
    btn.disabled  = true;
    btn.textContent = 'Saving…';

    try {
      const { totals } = _recalc();
      const doc = {
        userId:      _s.user.$id,
        name,
        servings,
        ingredients: JSON.stringify(_s.ingredients),
        calories:    Math.round(totals.calories / servings),
        carbs:       parseFloat(_fmt(totals.carbs    / servings)),
        protein:     parseFloat(_fmt(totals.protein  / servings)),
        fat:         parseFloat(_fmt(totals.fat      / servings)),
        createdAt:   new Date().toISOString(),
      };

      if (_s.editId) {
        await _db.updateDocument(
          THANZI_CONFIG?.databaseId || 'thanzi-db',
          THANZI_CONFIG?.collections?.recipes || 'recipes',
          _s.editId,
          doc
        );
      } else {
        await _db.createDocument(
          THANZI_CONFIG?.databaseId || 'thanzi-db',
          THANZI_CONFIG?.collections?.recipes || 'recipes',
          Appwrite.ID.unique(),
          doc
        );
      }

      _closeModal();
      await _loadRecipes();

    } catch (err) {
      alert('Failed to save recipe: ' + err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Recipe';
    }
  }

  // ── Delete recipe ──────────────────────────────────────────────────────────
  async function _deleteRecipe(id) {
    if (!confirm('Delete this recipe?')) return;
    try {
      await _db.deleteDocument(
        THANZI_CONFIG?.databaseId || 'thanzi-db',
        THANZI_CONFIG?.collections?.recipes || 'recipes',
        id
      );
      await _loadRecipes();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  // ── Log recipe as meal ─────────────────────────────────────────────────────
  async function _logRecipe(recipe) {
    if (!_s.user) return alert('Please sign in first.');

    const meal = prompt('Which meal? (breakfast / lunch / dinner / snack)', 'lunch');
    if (!meal) return;

    try {
      const doc = {
        userId:    _s.user.$id,
        date:      _today(),
        meal:      meal.toLowerCase(),
        name:      recipe.name,
        calories:  recipe.calories,
        carbs:     recipe.carbs,
        protein:   recipe.protein,
        fat:       recipe.fat,
        qty:       1,
        unit:      'serving',
        source:    'recipe',
      };

      await _db.createDocument(
        THANZI_CONFIG?.databaseId || 'thanzi-db',
        THANZI_CONFIG?.collections?.foodLogs || 'food_logs',
        Appwrite.ID.unique(),
        doc
      );

      // Refresh log if available
      if (typeof ThanziLog !== 'undefined') ThanziLog.refresh?.();

      alert(`✅ "${recipe.name}" logged to ${meal}!`);

    } catch (err) {
      alert('Failed to log recipe: ' + err.message);
    }
  }

  // ── Load and render saved recipes ──────────────────────────────────────────
  async function _loadRecipes() {
    if (!_s.user) return;

    try {
      const res = await _db.listDocuments(
        THANZI_CONFIG?.databaseId || 'thanzi-db',
        THANZI_CONFIG?.collections?.recipes || 'recipes',
        [
          Appwrite.Query.equal('userId', _s.user.$id),
          Appwrite.Query.orderDesc('$createdAt'),
          Appwrite.Query.limit(50),
        ]
      );
      _s.recipes = res.documents;
      _renderRecipes();
    } catch (err) {
      console.error('[Recipe] Load failed:', err.message);
    }
  }

  function _renderRecipes() {
    const list  = _el('rb-list');
    const empty = _el('rb-empty');
    if (!list) return;

    if (!_s.recipes.length) {
      if (empty) empty.style.display = 'flex';
      list.querySelectorAll('.rb-card').forEach(c => c.remove());
      return;
    }

    if (empty) empty.style.display = 'none';

    // Remove old cards
    list.querySelectorAll('.rb-card').forEach(c => c.remove());

    _s.recipes.forEach(r => {
      const card = document.createElement('div');
      card.className = 'rb-card';
      card.innerHTML = `
        <div class="rb-card-body">
          <div class="rb-card-name">${r.name}</div>
          <div class="rb-card-meta">${r.servings} serving${r.servings > 1 ? 's' : ''}</div>
          <div class="rb-card-macros">
            <span>${r.calories} kcal</span>
            <span class="rb-c">C: ${r.carbs}g</span>
            <span class="rb-p">P: ${r.protein}g</span>
            <span class="rb-f">F: ${r.fat}g</span>
          </div>
        </div>
        <div class="rb-card-actions">
          <button class="rb-card-log"  data-id="${r.$id}">Log</button>
          <button class="rb-card-edit" data-id="${r.$id}">Edit</button>
          <button class="rb-card-del"  data-id="${r.$id}">Delete</button>
        </div>
      `;

      card.querySelector('.rb-card-log').addEventListener('click', () => _logRecipe(r));
      card.querySelector('.rb-card-edit').addEventListener('click', () => _openModal(r));
      card.querySelector('.rb-card-del').addEventListener('click', () => _deleteRecipe(r.$id));

      list.appendChild(card);
    });
  }

  // ── Modal open / close ─────────────────────────────────────────────────────
  function _openModal(recipe = null) {
    _s.editId      = recipe ? recipe.$id : null;
    _s.ingredients = recipe ? JSON.parse(recipe.ingredients || '[]') : [];

    _el('rb-modal-title').textContent  = recipe ? 'Edit Recipe' : 'New Recipe';
    _el('rb-recipe-name').value        = recipe ? recipe.name     : '';
    _el('rb-servings').value           = recipe ? recipe.servings : 1;
    _el('rb-ai-input').value           = '';
    _el('rb-ing-search').value         = '';
    _el('rb-ing-results').style.display = 'none';

    _renderIngredients();
    _el('rb-modal-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function _closeModal() {
    _el('rb-modal-overlay').style.display = 'none';
    document.body.style.overflow = '';
    _s.editId      = null;
    _s.ingredients = [];
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    try {
      _s.user = await _auth.get();
    } catch {
      _s.user = null;
    }

    // Wire modal open/close
    _el('rb-new-btn')?.addEventListener('click', () => _openModal());
    _el('rb-modal-close')?.addEventListener('click', _closeModal);
    _el('rb-cancel-btn')?.addEventListener('click', _closeModal);
    _el('rb-modal-overlay')?.addEventListener('click', e => {
      if (e.target === _el('rb-modal-overlay')) _closeModal();
    });

    // Save
    _el('rb-save-btn')?.addEventListener('click', _saveRecipe);

    // AI parse
    _el('rb-ai-parse-btn')?.addEventListener('click', _aiParseIngredients);

    // Servings change → recalc
    _el('rb-servings')?.addEventListener('input', _recalc);

    // Food search
    _el('rb-ing-search')?.addEventListener('input', e => {
      clearTimeout(_s.searchTimer);
      _s.searchTimer = setTimeout(() => _runSearch(e.target.value.trim()), 300);
    });

    // Close search results on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('#rb-ing-search') && !e.target.closest('#rb-ing-results')) {
        const r = _el('rb-ing-results');
        if (r) r.style.display = 'none';
      }
    });

    await _loadRecipes();
  }

  async function refresh() {
    await _loadRecipes();
  }

  // Auto-init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, refresh };
})();
