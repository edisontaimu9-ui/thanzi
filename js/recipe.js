/**
 * recipe.js — Thanzi AI Recipe Builder  (v2.1)
 *
 * NEW in v2.1:
 *  - Chakudya RAG/semantic grounding: both full-recipe generation and
 *    manual ingredient parsing pull relevant Malawian food knowledge from
 *    Chakudya before calling the AI, so ingredient names, synonyms and
 *    Chichewa terms are recognised correctly (incl. nsima variants).
 *  - Ingredient-to-database matching is now Chakudya-first and rank-aware:
 *    every candidate Chakudya returns is scored and the best meaningful
 *    match is used (instead of blindly trusting whichever result came
 *    first), with a curated nsima disambiguation table so a vague
 *    ingredient name can never land on an unrelated dish.
 *
 * NEW in v2:
 *  - "Describe a meal" flow: AI generates full recipe (name, servings,
 *    prep time, cook time, steps, ingredients with Malawian portions) then
 *    each ingredient is auto-matched to the Chakudya Nutrition Registry.
 *  - Extended nutrition panel: fibre, sodium, sugar per serving in addition
 *    to kcal / carbs / protein / fat.
 *  - Preparation steps panel (editable).
 *  - Share recipe as text.
 *  - Save as Custom Meal for direct logging.
 *  - Full backward-compatible openWithData() API (used by Thandizo AI).
 *
 * Unchanged from v1:
 *  - Manual ingredient search via ThanziFood.search()
 *  - Appwrite persistence (load / save / edit / delete / log)
 *  - ThanziLog.refresh() hook
 *
 * Dependencies: Appwrite SDK (IIFE), THANZI_CONFIG, ThanziFood, ThanziLog
 */
const ThanziRecipe = (() => {
  'use strict';

  // ── Appwrite ───────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);
  const _db   = new Appwrite.Databases(_client);
  const _auth = new Appwrite.Account(_client);

  // ── Proxy endpoint (Groq via Cloudflare Worker) ────────────────────────────
  const PROXY_URL = 'https://thanzi-ai-proxy.edisontaimu9.workers.dev/v1/groq/v1/chat/completions';
  const PROXY_KEY = 'thanzi_app001';
  const AI_MODEL  = 'llama-3.3-70b-versatile';

  // ── Chakudya RAG / semantic knowledge base ─────────────────────────────────
  const RAG_URL = 'https://chakudya-api.edisontaimu9.workers.dev/rag/retrieve';

  /** Pull grounding context from Chakudya's RAG/semantic layer so recipe
   *  generation and ingredient parsing recognise Malawian foods, Chichewa
   *  names, recipes and common misspellings. Never blocks the flow. */
  async function _retrieveRAG(query) {
    try {
      const res = await fetch(RAG_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: 'both', top_k: 6 }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      const chunks = data?.data || data?.chunks || [];
      if (!chunks.length) return '';
      return chunks.map(c => c.content || c.text || '').filter(Boolean).join('\n');
    } catch (_e) {
      return '';
    }
  }

  // ── Ingredient-matching helpers (Chakudya-first, same logic as Quick Add) ──

  /** Normalise a food name for comparison. */
  function _normName(s) {
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Generic filler words that shouldn't count as a meaningful match on their
  // own — prevents e.g. "thick porridge" matching an unrelated cassava dish
  // just because both happen to be described as a "porridge".
  const _GENERIC_WORDS = new Set([
    'thick', 'thin', 'porridge', 'food', 'meal', 'dish', 'mixed', 'plain',
    'cooked', 'fresh', 'dried', 'whole', 'of', 'with', 'and', 'a', 'the',
  ]);

  function _meaningfulTokens(tokens) {
    return tokens.filter(t => t.length > 2 && !_GENERIC_WORDS.has(t));
  }

  /** How well does a search hit match the ingredient name? Requires overlap
   *  on MEANINGFUL (non-generic) tokens. Returns { tier, overlap } or null. */
  function _matchInfo(query, hit) {
    if (!hit || !hit.name) return null;
    const nq = _normName(query), nh = _normName(hit.name);
    if (!nq || !nh) return null;
    if (nq === nh) return { tier: 'exact', overlap: 99 };

    const qTokens = _meaningfulTokens(nq.split(' ').filter(Boolean));
    const hTokens = _meaningfulTokens(nh.split(' ').filter(Boolean));
    if (!qTokens.length || !hTokens.length) return null;

    const overlap = qTokens.filter(t => hTokens.includes(t)).length;
    if (overlap === 0) return null;

    const containment = nh.indexOf(nq) !== -1 || nq.indexOf(nh) !== -1;
    return { tier: containment ? 'alias' : 'token', overlap };
  }

  function _classifyMatch(query, hit) {
    const m = _matchInfo(query, hit);
    return m ? m.tier : null;
  }

  /** Rank score for a candidate — tier dominates, overlap count breaks ties
   *  between candidates of the same tier (e.g. "Nsima ya mgaiwa" should
   *  outrank "Nsima yaufa woyera" when the ingredient says "mgaiwa nsima"). */
  function _matchScore(query, hit) {
    const m = _matchInfo(query, hit);
    if (!m) return -1;
    const tierBase = m.tier === 'exact' ? 100 : m.tier === 'alias' ? 50 : 10;
    let score = tierBase + m.overlap;
    if (_isPreferredNsimaVariant(query, hit.name)) score += 1;
    return score;
  }

  function _isGoodMatch(hit, query) {
    if (!hit) return false;
    const tier = _classifyMatch(query, hit);
    if (!tier) return false;
    const fromChakudya = hit.sourceUsed === 'Chakudya' ||
      hit.dbSource === 'Chakudya API' || hit.dbSource === 'Chakudya Packaged DB';
    if (tier === 'exact' || tier === 'alias') return true;
    return fromChakudya || (hit.confidenceScore || 0) >= 0.5;
  }

  // ── Nsima variant preference — used ONLY as a tie-break bonus among
  // candidates Chakudya already returned for a bare "nsima" query, never to
  // rewrite the search text itself. Chakudya does literal/substring search,
  // so guessing a "canonical" name and searching for THAT instead of what
  // was written can silently return zero results.
  function _isPreferredNsimaVariant(query, hitName) {
    const nq = _normName(query);
    const hasQualifier = /mgaiwa|gilamilu|woyera|refined|dehulled|de\s*-?\s*hulled/i.test(nq);
    if (!/\bnsima\b/.test(nq) || hasQualifier) return false;
    return /woyera|refined/i.test(hitName);
  }

  // ── State ──────────────────────────────────────────────────────────────────
  const _s = {
    user:        null,
    recipes:     [],
    editId:      null,
    ingredients: [],     // [{ name, qty, unit, calories, carbs, protein, fat, fibre, sodium, sugar, dbMatched }]
    steps:       [],     // string[]
    searchTimer: null,
    generating:  false,
  };

  // ── DOM helpers ────────────────────────────────────────────────────────────
  const _el  = id => document.getElementById(id);
  const _fmt = n  => isNaN(n) ? '0' : Number(n).toFixed(1);
  const _today = () => new Date().toISOString().slice(0, 10);

  // ── Toast ──────────────────────────────────────────────────────────────────
  function _toast(msg, type = 'info') {
    const el = _el('st-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = `st-toast st-toast--${type} st-toast--show`;
    clearTimeout(_s._toastTimer);
    _s._toastTimer = setTimeout(() => el.classList.remove('st-toast--show'), 3200);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // NUTRITION ENGINE
  // ══════════════════════════════════════════════════════════════════════════

  function _recalc() {
    const servings = Math.max(1, parseInt(_el('rb-servings')?.value) || 1);
    const totals   = _s.ingredients.reduce((acc, ing) => {
      acc.calories += ing.calories || 0;
      acc.carbs    += ing.carbs    || 0;
      acc.protein  += ing.protein  || 0;
      acc.fat      += ing.fat      || 0;
      acc.fibre    += ing.fibre    || 0;
      acc.sodium   += ing.sodium   || 0;
      acc.sugar    += ing.sugar    || 0;
      return acc;
    }, { calories: 0, carbs: 0, protein: 0, fat: 0, fibre: 0, sodium: 0, sugar: 0 });

    const per = {};
    Object.keys(totals).forEach(k => per[k] = totals[k] / servings);

    const set = (id, val) => { const e = _el(id); if (e) e.textContent = val; };
    set('rb-nut-kcal',    Math.round(per.calories));
    set('rb-nut-carbs',   _fmt(per.carbs)   + 'g');
    set('rb-nut-protein', _fmt(per.protein) + 'g');
    set('rb-nut-fat',     _fmt(per.fat)     + 'g');
    set('rb-nut-fibre',   _fmt(per.fibre)   + 'g');
    set('rb-nut-sodium',  Math.round(per.sodium) + 'mg');
    set('rb-nut-sugar',   _fmt(per.sugar)   + 'g');

    const summary = _el('rb-nutrition-summary');
    if (summary) summary.style.display = _s.ingredients.length ? 'block' : 'none';

    return { totals, per };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DATABASE MATCHING — map an AI ingredient name to the Chakudya Nutrition Registry
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Try to find `name` in the Chakudya Nutrition Registry (CNR) — Thanzi's
   * sole food data source, via GET /foods (with /packaged as fallback)
   * inside ThanziFood. Searches with the name AS WRITTEN — same call the
   * manual search box
   * uses — since Chakudya does literal/substring search and a guessed
   * "canonical" name can silently return zero hits even when the food
   * exists. If found, scales its per-100g macros to `qty` and `unit`.
   * Returns a nutrition object if matched, else null.
   */
  async function _matchToDatabase(name, qty, unit) {
    if (typeof ThanziFood === 'undefined') return null;

    const raw = await ThanziFood.search(name, { multi: true, limit: 8 });
    const results = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (!results.length) return null;

    // Rank ALL returned candidates instead of trusting whichever the API
    // put first — pick the best meaningful match (overlap count breaks
    // ties between same-tier candidates).
    let food = null, bestScore = -1;
    for (const hit of results) {
      const score = _matchScore(name, hit);
      if (score > bestScore) { bestScore = score; food = hit; }
    }
    if (!food || !_isGoodMatch(food, name)) return null;

    // Resolve grams for the quantity
    let grams = qty;
    if (unit === 'g' || unit === 'gram' || unit === 'grams') {
      grams = qty;
    } else if (unit === 'kg') {
      grams = qty * 1000;
    } else if (unit === 'ml' || unit === 'mL') {
      grams = qty; // ~1g/ml for most liquids
    } else if (unit === 'cup' || unit === 'cups') {
      grams = qty * 240;
    } else if (unit === 'tbsp' || unit === 'tablespoon') {
      grams = qty * 15;
    } else if (unit === 'tsp' || unit === 'teaspoon') {
      grams = qty * 5;
    } else if (unit === 'piece' || unit === 'pieces' || unit === 'pcs') {
      grams = qty * 100;
    } else if (unit === 'serving' || unit === 'srv') {
      // Use the food's first measure if available
      if (food.measures && food.measures[0]) {
        const m = food.measures[0];
        // Extract grams from label e.g. "1 cup (240g)" → 240
        const match = m.lbl.match(/\((\d+(?:\.\d+)?)g\)/);
        grams = match ? parseFloat(match[1]) : 100;
      } else {
        grams = 100;
      }
    } else {
      grams = qty; // fallback
    }

    // food.kcal / food.pro / food.cho / food.fat are per 100g
    const ratio = grams / 100;
    return {
      calories: (food.kcal  || food.calories || 0) * ratio,
      carbs:    (food.cho   || food.carbs    || 0) * ratio,
      protein:  (food.pro   || food.protein  || 0) * ratio,
      fat:      (food.fat   || 0)                  * ratio,
      fibre:    (food.fibre || food.fiber    || 0) * ratio,
      sodium:   (food.sodium || 0)                 * ratio,
      sugar:    (food.sugar  || 0)                 * ratio,
      dbName:   food.name,
      dbMatched: true,
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // AI RECIPE GENERATION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Calls the Groq proxy with a structured prompt.
   * Returns parsed JSON or throws.
   */
  async function _callAI(systemPrompt, userPrompt, maxTokens = 1200) {
    const res = await fetch(PROXY_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Thanzi-Key': PROXY_KEY,
      },
      body: JSON.stringify({
        model:       AI_MODEL,
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        temperature: 0.15,
        max_tokens:  maxTokens,
      }),
    });

    if (!res.ok) throw new Error(`AI proxy error ${res.status}`);

    const data      = await res.json();
    const replyText = data?.choices?.[0]?.message?.content ?? '';
    const cleaned   = replyText.replace(/```json[\s\S]*?```|```[\s\S]*?```/g, s =>
      s.replace(/```json|```/g, '').trim()
    ).trim();

    // Extract JSON even if there's surrounding text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('No JSON in AI response');

    return JSON.parse(jsonMatch[0]);
  }

  /**
   * Full recipe generation from a natural-language meal description.
   * Steps:
   *   1. AI generates complete recipe JSON
   *   2. Each ingredient is matched against the Chakudya Nutrition Registry
   *   3. DB values override AI nutrition estimates where matched
   *   4. Modal is populated with results
   */
  async function _generateRecipe() {
    const input = (_el('rb-ai-generate-input')?.value || '').trim();
    if (!input) return;

    if (_s.generating) return;
    _s.generating = true;

    const btn = _el('rb-ai-generate-btn');
    if (btn) {
      btn.disabled   = true;
      btn.innerHTML  = `<span class="rb-ai-spinner"></span> Generating…`;
    }

    // Show progress indicator in modal
    _showGeneratingState(input);

    try {
      const ragContext = await _retrieveRAG(input);

      const systemPrompt = `You are Thandizo, Thanzi's Malawian nutrition assistant. Generate realistic recipes using local Malawian ingredients and household measures common in Malawi (nsima, relish, cups, tablespoons, pieces). Use nutrition values typical for Sub-Saharan African foods. Never translate "nsima" into a generic English word like "porridge" — keep it as "nsima" and preserve any qualifier given (e.g. "mgaiwa nsima", "nsima ya ufa woyera"). Always respond with ONLY a valid JSON object — no markdown, no explanation.`;

      const userPrompt = `Generate a complete recipe for: "${input}"
${ragContext ? `\nRelevant Malawian food knowledge (use this to ground ingredient names, portions and authenticity — Chakudya, Thanzi's Malawi food database):\n${ragContext}\n` : ''}
Respond ONLY with this exact JSON structure:
{
  "name": "Recipe name",
  "description": "One sentence about the dish",
  "servings": 4,
  "prepTime": 15,
  "cookTime": 30,
  "steps": [
    "Step 1 description",
    "Step 2 description"
  ],
  "ingredients": [
    {
      "name": "ingredient name (simple, searchable)",
      "qty": 200,
      "unit": "g",
      "calories": 246,
      "carbs": 55,
      "protein": 5.3,
      "fat": 1.2,
      "fibre": 2.1,
      "sodium": 5,
      "sugar": 0.5
    }
  ]
}

Rules:
- Use realistic Malawian household portions (cups, tablespoons, pieces, grams)
- Ingredient names should be simple and searchable (e.g. "nsima (thick, maize)" not "nsima flour mixture")
- Nutrition values are for the STATED quantity (not per 100g)
- Include 4–10 ingredients
- Include 3–8 preparation steps
- servings: integer 1–10
- prepTime and cookTime: integer minutes`;

      const recipe = await _callAI(systemPrompt, userPrompt, 1400);

      if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) {
        throw new Error('Invalid recipe structure from AI');
      }

      // Match each ingredient to Chakudya API and override nutrition if matched
      recipe.ingredients = await Promise.all(recipe.ingredients.map(async ing => {
        const dbMatch = await _matchToDatabase(ing.name, ing.qty, ing.unit);
        if (dbMatch) {
          return {
            ...ing,
            calories:  dbMatch.calories,
            carbs:     dbMatch.carbs,
            protein:   dbMatch.protein,
            fat:       dbMatch.fat,
            fibre:     dbMatch.fibre,
            sodium:    dbMatch.sodium,
            sugar:     dbMatch.sugar,
            dbName:    dbMatch.dbName,
            dbMatched: true,
          };
        }
        return { ...ing, dbMatched: false };
      }));

      // Populate modal with the generated recipe
      _openModal(null, recipe);

    } catch (err) {
      console.error('[Recipe] Generation failed:', err);
      _toast('Could not generate recipe: ' + err.message, 'error');
      _hideGeneratingState();
    } finally {
      _s.generating = false;
      if (btn) {
        btn.disabled  = false;
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v1h1a3 3 0 010 6h-1v1a4 4 0 01-8 0v-1H7a3 3 0 010-6h1V6a4 4 0 014-4z"/><circle cx="9" cy="10" r="1" fill="currentColor"/><circle cx="15" cy="10" r="1" fill="currentColor"/></svg> Generate`;
      }
    }
  }

  function _showGeneratingState(input) {
    const overlay = _el('rb-modal-overlay');
    if (!overlay) return;

    _s.ingredients = [];
    _s.steps       = [];

    _el('rb-modal-title').textContent = 'Generating Recipe…';
    _el('rb-recipe-name').value       = '';
    _el('rb-servings').value          = 4;
    _el('rb-ingredients').innerHTML   = `
      <div class="rb-generating-indicator">
        <div class="rb-generating-dots">
          <span></span><span></span><span></span>
        </div>
        <p>Crafting "<strong>${input}</strong>" with Malawian ingredients…</p>
        <small>Matching to Chakudya Nutrition Registry…</small>
      </div>`;
    _el('rb-nutrition-summary').style.display = 'none';
    _el('rb-steps-section').style.display     = 'none';
    overlay.style.display    = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function _hideGeneratingState() {
    _el('rb-modal-overlay').style.display = 'none';
    document.body.style.overflow = '';
  }

  // ── AI ingredient-only parse (kept from v1 — used in manual mode) ──────────
  async function _aiParseIngredients() {
    const text = (_el('rb-ai-input')?.value || '').trim();
    if (!text) return;

    const btn = _el('rb-ai-parse-btn');
    btn.disabled   = true;
    btn.textContent = 'Parsing…';

    try {
      const ragContext = await _retrieveRAG(text);

      const systemPrompt = 'You are Thandizo, a Malawian nutrition assistant. Never translate "nsima" into a generic English word like "porridge" — keep it as "nsima" and preserve any qualifier given (e.g. "mgaiwa nsima"). Always respond with only a valid JSON array. No markdown, no explanation.';
      const userPrompt   = `Parse the following into a JSON array. For each ingredient give: name, qty (number), unit (g/ml/cup/tbsp/tsp/piece/serving), calories, carbs, protein, fat, fibre, sodium, sugar — all for the stated quantity. Use Malawian/Southern African food values.
${ragContext ? `\nRelevant Malawian food knowledge (Chakudya, Thanzi's Malawi food database):\n${ragContext}\n` : ''}
Return ONLY a valid JSON array:
[{"name":"ingredient","qty":100,"unit":"g","calories":120,"carbs":25,"protein":3,"fat":1,"fibre":2,"sodium":5,"sugar":0.5}]

Ingredients: ${text}`;

      const arr = await _callAI(systemPrompt, userPrompt, 900);
      if (!Array.isArray(arr) || !arr.length) throw new Error('No ingredients parsed');

      for (const ing of arr) {
        const dbMatch = await _matchToDatabase(ing.name, ing.qty, ing.unit);
        _s.ingredients.push({
          name:      ing.name     || 'Ingredient',
          qty:       ing.qty      || 100,
          unit:      ing.unit     || 'g',
          calories:  dbMatch ? dbMatch.calories : (ing.calories || 0),
          carbs:     dbMatch ? dbMatch.carbs    : (ing.carbs    || 0),
          protein:   dbMatch ? dbMatch.protein  : (ing.protein  || 0),
          fat:       dbMatch ? dbMatch.fat       : (ing.fat      || 0),
          fibre:     dbMatch ? dbMatch.fibre    : (ing.fibre    || 0),
          sodium:    dbMatch ? dbMatch.sodium   : (ing.sodium   || 0),
          sugar:     dbMatch ? dbMatch.sugar    : (ing.sugar    || 0),
          dbName:    dbMatch ? dbMatch.dbName   : null,
          dbMatched: !!dbMatch,
        });
      }

      _el('rb-ai-input').value = '';
      _renderIngredients();

    } catch (err) {
      _toast('AI parse failed: ' + err.message, 'error');
    } finally {
      btn.disabled    = false;
      btn.innerHTML   = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 014 4v1h1a3 3 0 010 6h-1v1a4 4 0 01-8 0v-1H7a3 3 0 010-6h1V6a4 4 0 014-4z"/></svg> AI Parse`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — INGREDIENTS
  // ══════════════════════════════════════════════════════════════════════════

  function _renderIngredients() {
    const container = _el('rb-ingredients');
    if (!container) return;

    if (!_s.ingredients.length) {
      container.innerHTML = '';
      _recalc();
      return;
    }

    container.innerHTML = _s.ingredients.map((ing, i) => `
      <div class="rb-ing-row ${ing.dbMatched ? 'rb-ing-row--matched' : ''}" data-idx="${i}">
        <div class="rb-ing-info">
          <span class="rb-ing-name">${ing.name}</span>
          ${ing.dbMatched ? `<span class="rb-ing-db-badge" title="Matched to Chakudya: ${ing.dbName || ''}">✓ MW</span>` : ''}
          <span class="rb-ing-macros">
            ${Math.round(ing.calories)} kcal ·
            <span class="rb-c">${_fmt(ing.carbs)}g C</span> ·
            <span class="rb-p">${_fmt(ing.protein)}g P</span> ·
            <span class="rb-f">${_fmt(ing.fat)}g F</span>
            ${ing.fibre ? ` · <span class="rb-fi">${_fmt(ing.fibre)}g Fi</span>` : ''}
          </span>
        </div>
        <div class="rb-ing-qty-wrap">
          <input class="rb-ing-qty" type="number" min="0.1" step="0.1"
            value="${ing.qty || 1}" data-idx="${i}" title="Quantity (${ing.unit || 'serving'})">
          <span class="rb-ing-unit">${ing.unit || 'srv'}</span>
        </div>
        <button class="rb-ing-remove" data-idx="${i}" aria-label="Remove ${ing.name}">✕</button>
      </div>
    `).join('');

    // Quantity change — scale nutrition proportionally
    container.querySelectorAll('.rb-ing-qty').forEach(input => {
      input.addEventListener('change', e => {
        const idx    = parseInt(e.target.dataset.idx);
        const newQty = parseFloat(e.target.value) || 1;
        const ing    = _s.ingredients[idx];
        const ratio  = newQty / (ing.qty || 1);
        ing.qty      = newQty;
        ['calories','carbs','protein','fat','fibre','sodium','sugar'].forEach(k => {
          ing[k] = (ing[k] || 0) * ratio;
        });
        _renderIngredients();
        _recalc();
      });
    });

    container.querySelectorAll('.rb-ing-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        _s.ingredients.splice(parseInt(e.currentTarget.dataset.idx), 1);
        _renderIngredients();
        _recalc();
      });
    });

    _recalc();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — STEPS
  // ══════════════════════════════════════════════════════════════════════════

  function _renderSteps() {
    const container = _el('rb-steps-list');
    const section   = _el('rb-steps-section');
    if (!container || !section) return;

    if (!_s.steps.length) {
      section.style.display = 'none';
      return;
    }

    section.style.display = 'block';
    container.innerHTML = _s.steps.map((step, i) => `
      <div class="rb-step-row" data-idx="${i}">
        <span class="rb-step-num">${i + 1}</span>
        <div class="rb-step-text" contenteditable="true"
          data-idx="${i}"
          spellcheck="false">${step}</div>
        <button class="rb-step-remove" data-idx="${i}" aria-label="Remove step">✕</button>
      </div>
    `).join('');

    // Step text editing
    container.querySelectorAll('.rb-step-text').forEach(el => {
      el.addEventListener('blur', e => {
        const idx = parseInt(e.target.dataset.idx);
        _s.steps[idx] = e.target.textContent.trim();
      });
    });

    // Step remove
    container.querySelectorAll('.rb-step-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        _s.steps.splice(parseInt(e.currentTarget.dataset.idx), 1);
        _renderSteps();
      });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FOOD SEARCH (manual ingredient add)
  // ══════════════════════════════════════════════════════════════════════════

  function _addIngredient(food) {
    // Resolve a default qty from the first measure label if available
    let qty  = 100;
    let unit = 'g';
    if (food.measures && food.measures[0]) {
      const m     = food.measures[0];
      const match = m.lbl.match(/\((\d+(?:\.\d+)?)g\)/);
      if (match) { qty = parseFloat(match[1]); unit = 'g'; }
    }

    _s.ingredients.push({
      name:      food.name || food.label || 'Food',
      qty:       food.servingQty  || qty,
      unit:      food.servingUnit || unit,
      calories:  food.calories    || food.kcal  || (food.kcal_per100 ? food.kcal_per100 * qty / 100 : 0),
      carbs:     food.carbs       || food.cho   || 0,
      protein:   food.protein     || food.pro   || 0,
      fat:       food.fat         || 0,
      fibre:     food.fibre       || food.fiber || 0,
      sodium:    food.sodium      || 0,
      sugar:     food.sugar       || 0,
      dbName:    food.name,
      dbMatched: true,
    });
    _renderIngredients();
    _el('rb-ing-search').value         = '';
    _el('rb-ing-results').style.display = 'none';
  }

  async function _runSearch(query) {
    const results = _el('rb-ing-results');
    if (!query || query.length < 2) { results.style.display = 'none'; return; }

    results.innerHTML = '<div class="rb-ing-result-item rb-ing-no-result">Searching…</div>';
    results.style.display = 'block';

    const raw  = typeof ThanziFood !== 'undefined'
      ? await ThanziFood.search(query, { multi: true, limit: 8 })
      : [];
    const hits = Array.isArray(raw) ? raw : (raw ? [raw] : []);

    if (!hits.length) {
      results.innerHTML = '<div class="rb-ing-result-item rb-ing-no-result">No results found</div>';
      results.style.display = 'block';
      return;
    }

    results.innerHTML = hits.map((h, i) => `
      <div class="rb-ing-result-item" data-idx="${i}">
        <span class="rb-ing-result-name">${h.name}</span>
        <span class="rb-ing-result-kcal">${Math.round(h.kcal || h.calories || 0)} kcal/100g</span>
      </div>
    `).join('');
    results.style.display = 'block';

    results.querySelectorAll('.rb-ing-result-item').forEach((el, i) => {
      el.addEventListener('click', () => { if (hits[i]) _addIngredient(hits[i]); });
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADD STEP
  // ══════════════════════════════════════════════════════════════════════════

  function _addStep() {
    const input = _el('rb-step-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    _s.steps.push(text);
    input.value = '';
    _renderSteps();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SAVE TO APPWRITE
  // ══════════════════════════════════════════════════════════════════════════

  async function _saveRecipe() {
    const name     = (_el('rb-recipe-name')?.value || '').trim();
    const servings = Math.max(1, parseInt(_el('rb-servings')?.value) || 1);
    const prepTime = parseInt(_el('rb-prep-time')?.value) || 0;
    const cookTime = parseInt(_el('rb-cook-time')?.value) || 0;

    if (!name)                  { _toast('Enter a recipe name.', 'error'); return; }
    if (!_s.ingredients.length) { _toast('Add at least one ingredient.', 'error'); return; }
    if (!_s.user)               { _toast('Sign in to save recipes.', 'error'); return; }

    const btn     = _el('rb-save-btn');
    btn.disabled  = true;
    btn.textContent = 'Saving…';

    try {
      const { totals } = _recalc();
      const doc = {
        userId:      _s.user.$id,
        name,
        servings,
        prepTime,
        cookTime,
        ingredients: JSON.stringify(_s.ingredients),
        steps:       JSON.stringify(_s.steps),
        calories:    Math.round(totals.calories / servings),
        carbs:       parseFloat(_fmt(totals.carbs    / servings)),
        protein:     parseFloat(_fmt(totals.protein  / servings)),
        fat:         parseFloat(_fmt(totals.fat      / servings)),
        fibre:       parseFloat(_fmt(totals.fibre    / servings)),
        sodium:      Math.round(totals.sodium / servings),
        sugar:       parseFloat(_fmt(totals.sugar    / servings)),
        createdAt:   new Date().toISOString(),
      };

      if (_s.editId) {
        await _db.updateDocument(
          THANZI_CONFIG?.databaseId || 'thanzi-db',
          THANZI_CONFIG?.collections?.recipes || 'recipes',
          _s.editId,
          doc
        );
        _toast(`"${name}" updated.`, 'success');
      } else {
        await _db.createDocument(
          THANZI_CONFIG?.databaseId || 'thanzi-db',
          THANZI_CONFIG?.collections?.recipes || 'recipes',
          Appwrite.ID.unique(),
          doc
        );
        _toast(`"${name}" saved!`, 'success');
      }

      _closeModal();
      await _loadRecipes();

    } catch (err) {
      _toast('Save failed: ' + err.message, 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Recipe';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DELETE
  // ══════════════════════════════════════════════════════════════════════════

  async function _deleteRecipe(id) {
    if (!confirm('Delete this recipe?')) return;
    try {
      await _db.deleteDocument(
        THANZI_CONFIG?.databaseId || 'thanzi-db',
        THANZI_CONFIG?.collections?.recipes || 'recipes',
        id
      );
      _toast('Recipe deleted.', 'info');
      await _loadRecipes();
    } catch (err) {
      _toast('Delete failed: ' + err.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOG RECIPE AS MEAL
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Show the existing mt-log-picker bottom sheet so the user can choose a
   * meal slot, then write a properly-shaped food_logs document.
   */
  function _logRecipe(recipe) {
    if (!_s.user) { _toast('Sign in to log meals.', 'error'); return; }

    const picker   = document.getElementById('mt-log-picker');
    const backdrop = document.getElementById('mt-log-backdrop');
    const cancelBtn = document.getElementById('mt-log-cancel');

    if (!picker) {
      // Fallback: no picker in DOM — default to lunch
      _doLogRecipe(recipe, 'lunch');
      return;
    }

    picker.style.display = 'flex';

    // One-shot listeners — cleaned up after any selection or cancel
    function cleanup() {
      picker.style.display = 'none';
      picker.querySelectorAll('.mt-log-meal-btn').forEach(b => {
        b.removeEventListener('click', onMeal);
      });
      backdrop?.removeEventListener('click', onCancel);
      cancelBtn?.removeEventListener('click', onCancel);
    }

    function onCancel() { cleanup(); }

    function onMeal(e) {
      const meal = e.currentTarget.dataset.meal;
      cleanup();
      _doLogRecipe(recipe, meal);
    }

    picker.querySelectorAll('.mt-log-meal-btn').forEach(b => {
      b.addEventListener('click', onMeal);
    });
    backdrop?.addEventListener('click',  onCancel);
    cancelBtn?.addEventListener('click', onCancel);
  }

  async function _doLogRecipe(recipe, meal) {
    try {
      // Calories/macros on the recipe are already per-serving.
      // Log quantity as 100g equivalent so the schema stays consistent.
      await _db.createDocument(
        THANZI_CONFIG?.databaseId    || 'thanzi-db',
        THANZI_CONFIG?.collections?.foodLogs || 'food_logs',
        Appwrite.ID.unique(),
        {
          userId:   _s.user.$id,
          date:     _today(),
          mealType: meal,
          foodName: recipe.name,
          calories: Math.round(recipe.calories || 0),
          carbs:    parseFloat((recipe.carbs   || 0).toFixed(1)),
          protein:  parseFloat((recipe.protein || 0).toFixed(1)),
          fat:      parseFloat((recipe.fat     || 0).toFixed(1)),
          quantity: 100,
          unit:     'g',
        }
      );

      if (typeof ThanziLog !== 'undefined') ThanziLog.refresh?.();
      _toast(`"${recipe.name}" logged to ${meal}! ✓`, 'success');

    } catch (err) {
      _toast('Log failed: ' + err.message, 'error');
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHARE RECIPE
  // ══════════════════════════════════════════════════════════════════════════

  function _shareRecipe(recipe) {
    let ings = [];
    try { ings = JSON.parse(recipe.ingredients || '[]'); } catch { ings = []; }

    let steps = [];
    try { steps = JSON.parse(recipe.steps || '[]'); } catch { steps = []; }

    const lines = [
      `🍽️ ${recipe.name}`,
      `Servings: ${recipe.servings}`,
      recipe.prepTime ? `Prep: ${recipe.prepTime} min` : '',
      recipe.cookTime ? `Cook: ${recipe.cookTime} min` : '',
      '',
      '📋 Ingredients:',
      ...ings.map(i => `  • ${i.qty} ${i.unit} ${i.name}`),
    ];

    if (steps.length) {
      lines.push('', '👨‍🍳 Steps:');
      steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    }

    lines.push(
      '',
      '📊 Nutrition per serving:',
      `  Calories: ${recipe.calories} kcal`,
      `  Carbs: ${recipe.carbs}g | Protein: ${recipe.protein}g | Fat: ${recipe.fat}g`,
      '',
      'Shared via Thanzi — Know what you eat 🌿'
    );

    const text = lines.filter(Boolean).join('\n');

    if (navigator.share) {
      navigator.share({ title: recipe.name, text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text).then(() => _toast('Copied to clipboard!', 'success'));
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOAD & RENDER SAVED RECIPES
  // ══════════════════════════════════════════════════════════════════════════

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
    list.querySelectorAll('.rb-card').forEach(c => c.remove());

    _s.recipes.forEach(r => {
      const card = document.createElement('div');
      card.className = 'rb-card';

      const timeParts = [];
      if (r.prepTime) timeParts.push(`Prep ${r.prepTime}m`);
      if (r.cookTime) timeParts.push(`Cook ${r.cookTime}m`);
      const timeStr = timeParts.join(' · ');

      card.innerHTML = `
        <div class="rb-card-body">
          <div class="rb-card-name">${r.name}</div>
          <div class="rb-card-meta">
            ${r.servings} serving${r.servings > 1 ? 's' : ''}
            ${timeStr ? ` · ${timeStr}` : ''}
          </div>
          <div class="rb-card-macros">
            <span class="rb-card-kcal">${r.calories} kcal</span>
            <span class="rb-c">C: ${r.carbs}g</span>
            <span class="rb-p">P: ${r.protein}g</span>
            <span class="rb-f">F: ${r.fat}g</span>
          </div>
        </div>
        <div class="rb-card-actions">
          <button class="rb-card-log"   data-id="${r.$id}" title="Log to food diary">Log</button>
          <button class="rb-card-share" data-id="${r.$id}" title="Share recipe">Share</button>
          <button class="rb-card-edit"  data-id="${r.$id}" title="Edit recipe">Edit</button>
          <button class="rb-card-del"   data-id="${r.$id}" title="Delete recipe">Delete</button>
        </div>
      `;

      card.querySelector('.rb-card-log').addEventListener('click',   () => _logRecipe(r));
      card.querySelector('.rb-card-share').addEventListener('click', () => _shareRecipe(r));
      card.querySelector('.rb-card-edit').addEventListener('click',  () => _openModal(r));
      card.querySelector('.rb-card-del').addEventListener('click',   () => _deleteRecipe(r.$id));

      list.appendChild(card);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL OPEN / CLOSE
  // ══════════════════════════════════════════════════════════════════════════

  function _openModal(recipe = null, generatedRecipe = null) {
    const source = generatedRecipe || recipe;

    _s.editId      = recipe ? recipe.$id : null;
    _s.ingredients = [];
    _s.steps       = [];

    if (source) {
      // Populate ingredients
      let ings = [];
      if (generatedRecipe) {
        ings = generatedRecipe.ingredients || [];
      } else {
        try { ings = JSON.parse(recipe.ingredients || '[]'); } catch { ings = []; }
      }
      _s.ingredients = ings.map(ing => ({
        name:      ing.name     || 'Ingredient',
        qty:       ing.qty      || 100,
        unit:      ing.unit     || 'g',
        calories:  ing.calories || 0,
        carbs:     ing.carbs    || 0,
        protein:   ing.protein  || 0,
        fat:       ing.fat      || 0,
        fibre:     ing.fibre    || 0,
        sodium:    ing.sodium   || 0,
        sugar:     ing.sugar    || 0,
        dbName:    ing.dbName   || null,
        dbMatched: ing.dbMatched || false,
      }));

      // Populate steps
      if (generatedRecipe) {
        _s.steps = generatedRecipe.steps || [];
      } else {
        try { _s.steps = JSON.parse(recipe.steps || '[]'); } catch { _s.steps = []; }
      }
    }

    // Fill form fields
    _el('rb-modal-title').textContent = recipe ? 'Edit Recipe' : 'New Recipe';
    _el('rb-recipe-name').value       = source?.name     || '';
    _el('rb-servings').value          = source?.servings || 4;
    if (_el('rb-prep-time')) _el('rb-prep-time').value = source?.prepTime || '';
    if (_el('rb-cook-time')) _el('rb-cook-time').value = source?.cookTime || '';
    if (_el('rb-ai-input'))  _el('rb-ai-input').value  = '';
    if (_el('rb-ing-search')) {
      _el('rb-ing-search').value = '';
      _el('rb-ing-results').style.display = 'none';
    }

    _renderIngredients();
    _renderSteps();

    _el('rb-modal-overlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function _closeModal() {
    _el('rb-modal-overlay').style.display = 'none';
    document.body.style.overflow = '';
    _s.editId      = null;
    _s.ingredients = [];
    _s.steps       = [];
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOG RECIPE FROM MODAL (replaces Save Recipe)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Called when the user taps "Log Food" inside the recipe editor modal.
   * Shows the shared meal-type picker, then writes a food_logs document
   * whose fields match the Appwrite schema used by ThanziLog:
   *   userId, foodName, calories (int), carbs, protein, fat,
   *   mealType, date, quantity (double, grams), unit ('g')
   */
  function _logFromModal() {
    const name     = (_el('rb-recipe-name')?.value || '').trim();
    const servings = Math.max(1, parseInt(_el('rb-servings')?.value) || 1);

    if (!name)                  { _toast('Enter a recipe name.', 'error'); return; }
    if (!_s.ingredients.length) { _toast('Add at least one ingredient.', 'error'); return; }
    if (!_s.user)               { _toast('Sign in to log food.', 'error'); return; }

    const { per } = _recalc();

    const picker    = document.getElementById('mt-log-picker');
    const backdrop  = document.getElementById('mt-log-backdrop');
    const cancelBtn = document.getElementById('mt-log-cancel');

    if (!picker) {
      _doLogFromModal(name, per, 'lunch');
      return;
    }

    picker.style.display = 'flex';

    function cleanup() {
      picker.style.display = 'none';
      picker.querySelectorAll('.mt-log-meal-btn').forEach(b => b.removeEventListener('click', onMeal));
      backdrop?.removeEventListener('click', onCancel);
      cancelBtn?.removeEventListener('click', onCancel);
    }

    function onCancel() { cleanup(); }

    function onMeal(e) {
      const meal = e.currentTarget.dataset.meal;
      cleanup();
      _doLogFromModal(name, per, meal);
    }

    picker.querySelectorAll('.mt-log-meal-btn').forEach(b => b.addEventListener('click', onMeal));
    backdrop?.addEventListener('click', onCancel);
    cancelBtn?.addEventListener('click', onCancel);
  }

  async function _doLogFromModal(name, per, meal) {
    const btn = _el('rb-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Logging…'; }

    try {
      await _db.createDocument(
        THANZI_CONFIG?.databaseId             || 'thanzi-db',
        THANZI_CONFIG?.collections?.foodLogs  || 'food_logs',
        Appwrite.ID.unique(),
        {
          userId:   _s.user.$id,
          foodName: name,
          calories: Math.round(per.calories),
          carbs:    parseFloat((per.carbs   || 0).toFixed(1)),
          protein:  parseFloat((per.protein || 0).toFixed(1)),
          fat:      parseFloat((per.fat     || 0).toFixed(1)),
          mealType: meal,
          date:     _today(),
          quantity: 100,   // one serving represented as 100 g equivalent
          unit:     'g',
        }
      );

      if (typeof ThanziLog !== 'undefined') ThanziLog.refresh?.();
      _toast(`"${name}" logged to ${meal}! ✓`, 'success');
      _closeModal();

    } catch (err) {
      _toast('Log failed: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Log Food'; }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════════

  async function init() {
    try {
      _s.user = await _auth.get();
    } catch {
      _s.user = null;
    }

    // Recipe list actions
    _el('rb-new-btn')?.addEventListener('click', () => _openModal());

    // Modal close
    _el('rb-modal-close')?.addEventListener('click', _closeModal);
    _el('rb-cancel-btn')?.addEventListener('click', _closeModal);
    _el('rb-modal-overlay')?.addEventListener('click', e => {
      if (e.target === _el('rb-modal-overlay')) _closeModal();
    });

    // Log Food (replaces Save Recipe)
    _el('rb-save-btn')?.addEventListener('click', _logFromModal);

    // Servings → recalc
    _el('rb-servings')?.addEventListener('input', _recalc);

    // AI generate (full recipe from description)
    _el('rb-ai-generate-btn')?.addEventListener('click', _generateRecipe);
    _el('rb-ai-generate-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _generateRecipe(); }
    });

    // AI parse (ingredients only — manual mode)
    _el('rb-ai-parse-btn')?.addEventListener('click', _aiParseIngredients);

    // Food search
    _el('rb-ing-search')?.addEventListener('input', e => {
      clearTimeout(_s.searchTimer);
      _s.searchTimer = setTimeout(() => _runSearch(e.target.value.trim()), 300);
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#rb-ing-search') && !e.target.closest('#rb-ing-results')) {
        const r = _el('rb-ing-results');
        if (r) r.style.display = 'none';
      }
    });

    // Add step button
    _el('rb-step-add-btn')?.addEventListener('click', _addStep);
    _el('rb-step-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); _addStep(); }
    });

    await _loadRecipes();
  }

  async function refresh() {
    await _loadRecipes();
  }

  /** Called by Thandizo AI assistant to pre-fill the modal */
  function openWithData(data) {
    if (!data) return;
    _openModal(null, data);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init, refresh, openWithData };
})();
