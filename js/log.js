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
    quickReply:   '',
    quickPending: [],
  };

  // ── Fallback household measures ───────────────────────────────────────────
  const DEFAULT_MEASURES = [
    { label: '1 serving', g: 100 },
    { label: '1 cup',     g: 240 },
    { label: '1 tbsp',    g: 15  },
    { label: '1 tsp',     g: 5   },
    { label: '1 piece',   g: 80  },
  ];

  // ── Quick-add unit conversion table ──────────────────────────────────────
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
   * Called by ThanziScanner when a barcode is detected.
   * Delegates to ThanziFood.searchBarcode() — Chakudya Nutrition Registry
   * GET /packaged?barcode= exact lookup.
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

    let food = null;
    try {
      food = await ThanziFood.searchBarcode(barcode);
    } catch (err) {
      container.innerHTML = `
        <div class="sr-empty">
          Lookup failed: ${err.message || 'Network error'}.<br>
          <small>Try searching by name instead.</small>
        </div>`;
      return;
    }

    if (!food) {
      container.innerHTML = `
        <div class="sr-empty">
          Product not found for barcode <strong>${barcode}</strong>.<br>
          <small>Try searching by name instead.</small>
        </div>`;
      return;
    }

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

    const sourceLabel = { Chakudya: 'MW', local: 'MW', custom: '★ Mine' };

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
      // Show custom foods instantly while API search runs
      const customResults = (typeof ThanziCustomFoods !== 'undefined')
        ? ThanziCustomFoods.search(q).map(f => ({ ...f, sourceUsed: 'custom' }))
        : [];
      if (customResults.length) _renderSearchResults(customResults, false);
      // Always hit the Malawinutrient API (async, replaces local-only search)
      _searchFullAsync(q);
    }, 280);
  }

  async function _searchFullAsync(q) {
    if (_state.searching) return;
    _state.searching = true;
    const container = _el('food-search-results');

    // Show loading indicator
    let hint = document.getElementById('sr-loading-hint');
    if (!hint) {
      hint = document.createElement('div');
      hint.className = 'sr-loading';
      hint.id = 'sr-loading-hint';
      hint.textContent = '⏳ Searching…';
      container.appendChild(hint);
    }
    container.style.display = 'block';

    try {
      // multi:true returns an array of up to 10 results
      const results = await ThanziFood.search(q, { multi: true });
      const arr = Array.isArray(results) ? results : (results ? [results] : []);

      // Merge with custom foods (custom always first)
      const customResults = (typeof ThanziCustomFoods !== 'undefined')
        ? ThanziCustomFoods.search(q).map(f => ({ ...f, sourceUsed: 'custom' }))
        : [];
      const merged = [...customResults, ...arr];
      _renderSearchResults(merged, true);
    } catch (_e) {
      document.getElementById('sr-loading-hint')?.remove();
    } finally {
      _state.searching = false;
    }
  }

  async function _searchOnline() {
    const q = _el('food-search-input').value.trim();
    if (q) await _searchFullAsync(q);
  }

  // ── Quick Add — AI-powered natural language meal logger ─────────────────
  //
  // Flow:
  //   1. Pull grounding context from Chakudya's RAG/semantic layer so
  //      Thandizo recognises Malawian foods, Chichewa names, recipes,
  //      synonyms and common misspellings.
  //   2. Thandizo (AI) parses the free-text description into discrete food
  //      items (name, qty, unit) and flags any item that's genuinely
  //      ambiguous, with a short clarifying question + tap-able options.
  //   3. Each item is resolved against Chakudya FIRST — it's the primary,
  //      highest-confidence source. Only items Chakudya can't confidently
  //      match fall back to a single batched AI macro-estimate call.
  //   4. Ambiguous items pause for a one-tap clarification instead of
  //      guessing, then get resolved the same Chakudya-first way.
  //   5. The parsed meal is always shown for confirmation before saving.

  const _RAG_URL      = 'https://chakudya-api.edisontaimu9.workers.dev/rag/retrieve';
  const _AI_PROXY_URL = 'https://thanzi-ai-proxy.edisontaimu9.workers.dev/v1/groq/v1/chat/completions';
  const _AI_KEY       = 'thanzi_app001';
  const _AI_MODEL     = 'llama-3.3-70b-versatile';

  /** Normalise a food name for comparison. */
  function _normName(s) {
    return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Generic filler words that shouldn't count as a meaningful match on their
  // own — e.g. "thick porridge" being a substring of "Cassava Thick Porridge"
  // must NOT be treated as a match for "nsima" just because both happen to
  // be described as a "porridge".
  const _GENERIC_WORDS = new Set([
    'thick', 'thin', 'porridge', 'food', 'meal', 'dish', 'mixed', 'plain',
    'cooked', 'fresh', 'dried', 'whole', 'of', 'with', 'and', 'a', 'the',
  ]);

  function _meaningfulTokens(tokens) {
    return tokens.filter(t => t.length > 2 && !_GENERIC_WORDS.has(t));
  }

  /** How well does a search hit match the name Thandizo extracted?
   *  Requires overlap on MEANINGFUL (non-generic) tokens — a shared generic
   *  word like "porridge" alone is never enough to call it an alias/match.
   *  Returns { tier, overlap } or null if there's no meaningful match. */
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
   *  outrank "Nsima yaufa woyera" when the query says "mgaiwa nsima"). */
  function _matchScore(query, hit) {
    const m = _matchInfo(query, hit);
    if (!m) return -1;
    const tierBase = m.tier === 'exact' ? 100 : m.tier === 'alias' ? 50 : 10;
    let score = tierBase + m.overlap;
    if (_isPreferredNsimaVariant(query, hit.name)) score += 1; // small default bias
    return score;
  }

  // ── Known Malawian nsima variants — used only as a tie-break preference
  // when the QUERY is generic "nsima" with no qualifier and several Chakudya
  // entries could match. We never rewrite the search query itself: Chakudya
  // does literal/substring search, so guessing a "canonical" name and
  // searching for THAT instead of what the user said can silently return
  // zero results.
  function _isPreferredNsimaVariant(query, hitName) {
    const nq = _normName(query);
    const hasQualifier = /mgaiwa|gilamilu|woyera|refined|dehulled|de\s*-?\s*hulled/i.test(nq);
    if (!/\bnsima\b/.test(nq) || hasQualifier) return false; // only for bare "nsima"
    return /woyera|refined/i.test(hitName); // most common variant
  }

  /** True if a local search hit is confident enough to use without AI estimation.
   *  Chakudya (CNR) hits are trusted at token-level too, since it's the sole,
   *  curated source — non-Chakudya hits need a tighter match or higher score. */
  function _isGoodLocalMatch(hit, query) {
    if (!hit) return false;
    const tier = _classifyMatch(query, hit);
    if (!tier) return false;
    const fromChakudya = hit.sourceUsed === 'Chakudya' ||
      hit.dbSource === 'Chakudya API' || hit.dbSource === 'Chakudya Packaged DB';
    if (tier === 'exact' || tier === 'alias') return true;
    return fromChakudya || (hit.confidenceScore || 0) >= 0.5; // tier === 'token'
  }

  /** Estimate a total gram weight, using a detected unit, the matched food's
   *  own count-based measure (e.g. "2 eggs (100g)"), or a generic fallback. */
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

  /** Pull grounding context from Chakudya's RAG/semantic layer — never blocks
   *  the flow; an empty result just means Thandizo parses without it. */
  async function _retrieveRAG(query) {
    try {
      const res = await fetch(_RAG_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: 'foods', top_k: 6 }),
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

  /** Thandizo's NLU pass — free text → structured items, flags ambiguity. */
  async function _parseMealNLU(text, ragContext) {
    const prompt = `Parse this meal description into individual food items: "${text}"
${ragContext ? `\nRelevant Malawian food knowledge (use this to recognise local foods, Chichewa names, and correct spelling):\n${ragContext}\n` : ''}
For EACH distinct food item, return:
- name: canonical food name (fix obvious spelling mistakes; keep recognised Malawian/Chichewa names as-is, e.g. nsima, chambo, dagaa, matemba, nchunga — NEVER translate "nsima" into generic English like "porridge"; if a type/qualifier is given, e.g. "mgaiwa nsima", "nsima ya ufa woyera", "gilamilu", keep that exact qualifier word in the name)
- qty: the stated or clearly implied quantity (number, default 1)
- unit: a unit if mentioned ("cup","plate","piece","slice","bowl","g", etc.) else null
- ambiguous: true ONLY if the item is genuinely unclear in a way that meaningfully changes its nutrition (e.g. "soup" or "porridge" with no type stated). Do NOT mark common, well-understood foods as ambiguous.
- clarify: if ambiguous, one short specific question, else null
- options: if ambiguous, 2-4 short tap-able answers, else []

Also include "reply": one short, friendly sentence (casual, Malawian, but professional) acknowledging what you understood.

Respond with ONLY valid JSON, no markdown:
{"reply":"...","items":[{"name":"...","qty":1,"unit":null,"ambiguous":false,"clarify":null,"options":[]}]}`;

    const res = await fetch(_AI_PROXY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Thanzi-Key': _AI_KEY },
      body: JSON.stringify({
        model:       _AI_MODEL,
        messages:    [
          { role: 'system', content: "You are Thandizo, Thanzi's nutrition assistant. You always respond with only valid JSON — no markdown, no commentary." },
          { role: 'user',   content: prompt },
        ],
        temperature: 0.2,
        max_tokens:  700,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => String(res.status));
      throw new Error('Proxy error (' + res.status + '): ' + errText);
    }

    const data  = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? '';
    const clean = String(reply).replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (_e) {
      const m = clean.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!parsed || !Array.isArray(parsed.items)) {
      throw new Error("Couldn't understand that meal — try rephrasing");
    }
    return parsed;
  }

  /** One-shot AI macro estimate for items Chakudya couldn't confidently match.
   *  Asks for calories/macros for the EXACT stated quantity (not per 100g). */
  async function _estimateViaAI(rawItems) {
    const prompt = `For each numbered food item below, estimate the calories, carbohydrates (g), protein (g), and fat (g) for that EXACT stated quantity. Prefer foods common in Malawi and Southern Africa (e.g. "porridge" means maize porridge, "greens" means leafy vegetables).
Respond with ONLY a valid JSON array, no markdown, no commentary:
[{"name":"short food name","calories":123,"carbs":12.3,"protein":5.0,"fat":3.0}]

Items:
${rawItems.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

    let res;
    try {
      res = await fetch(_AI_PROXY_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Thanzi-Key': _AI_KEY },
        body: JSON.stringify({
          model:       _AI_MODEL,
          messages:    [
            { role: 'system', content: 'You are a nutrition estimation engine. Always respond with only a valid JSON array. No markdown, no explanation.' },
            { role: 'user',   content: prompt },
          ],
          temperature: 0.1,
          max_tokens:  512,
        }),
      });
    } catch (netErr) {
      throw new Error('Network error: ' + netErr.message);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => String(res.status));
      throw new Error('Proxy error (' + res.status + '): ' + errText);
    }

    let data;
    try { data = await res.json(); }
    catch (_e) { throw new Error('Invalid JSON from proxy'); }

    const replyText = data?.choices?.[0]?.message?.content ?? null;
    if (!replyText) throw new Error('Empty AI response');

    const cleaned = String(replyText).replace(/```json|```/g, '').trim();
    let arr;
    try {
      arr = JSON.parse(cleaned);
    } catch (_e) {
      const m = cleaned.match(/\[[\s\S]*\]/);
      if (m) arr = JSON.parse(m[0]);
      else throw new Error('Could not parse AI response as JSON');
    }

    if (!Array.isArray(arr)) throw new Error('Unexpected AI response shape');
    return arr;
  }

  /** Resolve a single parsed item against Chakudya. Returns a resolved item
   *  object, or null if it should fall back to the batched AI estimate.
   *  Searches with the food name AS WRITTEN — same call the normal search
   *  box uses — since Chakudya is the primary (and only) lookup layer and
   *  does literal/substring matching: rewriting the query to a guessed
   *  "canonical" name can return zero hits even when the food exists. */
  async function _resolveItem(item) {
    const raw  = await ThanziFood.search(item.name, { multi: true, limit: 8 });
    const hits = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    if (!hits.length) return null;

    // Rank ALL returned candidates instead of trusting whatever the API put
    // first — pick the best meaningful match (overlap count breaks ties,
    // e.g. preferring "Nsima ya mgaiwa" over "Nsima yaufa woyera" when the
    // query says "mgaiwa nsima").
    let best = null, bestScore = -1;
    for (const hit of hits) {
      const score = _matchScore(item.name, hit);
      if (score > bestScore) { bestScore = score; best = hit; }
    }

    if (best && _isGoodLocalMatch(best, item.name)) {
      const grams  = _estimateGrams(item.qty, item.unit, best._raw || best);
      const scaled = _scale(best, grams);
      return {
        raw: item.raw || item.name, name: best.name, source: 'local',
        quantity: Math.round(grams * 10) / 10,
        calories: scaled.calories, carbs: scaled.carbs,
        protein: scaled.protein, fat: scaled.fat,
      };
    }
    return null;
  }

  async function _quickAddMeal() {
    if (_state.quickBusy) return;
    const input = _el('quick-meal-input');
    const text  = input.value.trim();
    if (!text) return;

    _state.quickBusy    = true;
    _state.quickReply   = '';
    _state.quickPending = [];
    const btn = _el('quick-meal-btn');
    btn.disabled    = true;
    btn.textContent = 'Thinking…';

    try {
      const ragContext = await _retrieveRAG(text);
      const parsed      = await _parseMealNLU(text, ragContext);
      _state.quickReply = parsed.reply || '';

      const resolved = [];
      const needsAI  = [];
      const pending  = [];

      for (const item of parsed.items) {
        if (!item || !item.name) continue;
        item.qty = typeof item.qty === 'number' && item.qty > 0 ? item.qty : 1;

        if (item.ambiguous && item.clarify) {
          pending.push(item);
          continue;
        }

        const hit = await _resolveItem(item);
        if (hit) {
          resolved.push(hit);
        } else {
          const grams = _estimateGrams(item.qty, item.unit, null);
          needsAI.push({
            raw: `${item.qty} ${item.unit || ''} ${item.name}`.replace(/\s+/g, ' ').trim(),
            name: item.name,
            quantity: Math.round(grams * 10) / 10,
          });
        }
      }

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

      _state.quickItems   = resolved;
      _state.quickPending = pending;
      _renderQuickPreview(resolved);
    } catch (err) {
      console.error('ThanziLog: quick-add parse error', err.message);
      _state.quickReply   = `Sorry, I couldn't quite catch that. (${err.message})`;
      _state.quickItems   = [];
      _state.quickPending = [];
      _renderQuickPreview([]);
    }

    btn.disabled    = false;
    btn.textContent = 'Add';
    _state.quickBusy = false;
  }

  /** A tapped clarification option (or the default "skip") resolves that one
   *  item the same Chakudya-first way and folds it into the preview. */
  async function _resolveClarification(idx, choice) {
    const pending = _state.quickPending || [];
    const item = pending[idx];
    if (!item) return;

    pending.splice(idx, 1);
    const fullName = `${choice} ${item.name}`.trim();

    let resolvedItem = await _resolveItem({ ...item, name: fullName });
    if (!resolvedItem) {
      const grams = _estimateGrams(item.qty, item.unit, null);
      try {
        const aiResults = await _estimateViaAI([`${item.qty} ${item.unit || ''} ${fullName}`.replace(/\s+/g, ' ').trim()]);
        const r = aiResults[0] || {};
        resolvedItem = {
          raw: fullName, name: r.name || fullName, source: 'ai',
          quantity: Math.round(grams * 10) / 10,
          calories: Math.round(r.calories || 0),
          carbs:    Math.round((r.carbs   || 0) * 10) / 10,
          protein:  Math.round((r.protein || 0) * 10) / 10,
          fat:      Math.round((r.fat     || 0) * 10) / 10,
        };
      } catch (_e) {
        resolvedItem = {
          raw: fullName, name: fullName, source: 'error',
          quantity: Math.round(grams * 10) / 10, calories: null, carbs: null, protein: null, fat: null,
        };
      }
    }

    _state.quickItems.push(resolvedItem);
    _renderQuickPreview(_state.quickItems);
  }

  function _renderQuickPreview(items) {
    const wrap = _el('quick-meal-preview');
    if (!wrap) return;

    const reply   = _state.quickReply   || '';
    const pending = _state.quickPending || [];

    if (!items.length && !pending.length && !reply) {
      wrap.style.display = 'none';
      wrap.innerHTML = '';
      return;
    }

    const totalKcal  = items.reduce((s, it) => s + (it.calories || 0), 0);
    const badgeLabel = { local: 'MW', ai: 'AI', error: '⚠' };

    let html = '';

    if (reply) {
      html += `<div class="qm-reply"><span class="qm-reply-icon">🍃</span><span>${reply}</span></div>`;
    }

    pending.forEach((p, i) => {
      html += `
        <div class="qm-clarify" data-pi="${i}">
          <div class="qm-clarify-q">${p.clarify}</div>
          <div class="qm-clarify-opts">
            ${(p.options || []).map(o => `<button class="qm-chip" data-pi="${i}" data-opt="${o}">${o}</button>`).join('')}
          </div>
        </div>`;
    });

    if (items.length) {
      html += items.map((it, i) => `
        <div class="qm-item" data-i="${i}">
          <div class="qm-item-top">
            <span class="qm-name">${it.name}</span>
            <div class="qm-item-actions">
              <span class="qm-badge qm-badge--${it.source}">${badgeLabel[it.source] || ''}</span>
              <button class="qm-remove" data-i="${i}" aria-label="Remove">✕</button>
            </div>
          </div>
          ${it.calories != null ? `
          <div class="qm-item-stats">
            <span class="qm-amount">${it.quantity}g</span>
            <span class="qm-kcal">${it.calories} kcal</span>
            <span class="qm-macro qm-macro--c">C ${it.carbs ?? 0}g</span>
            <span class="qm-macro qm-macro--p">P ${it.protein ?? 0}g</span>
            <span class="qm-macro qm-macro--f">F ${it.fat ?? 0}g</span>
          </div>` : `
          <div class="qm-sub">Not recognized — remove or search manually</div>`}
        </div>
      `).join('');

      html += `
        <div class="qm-footer">
          <span class="qm-total">${totalKcal} kcal total</span>
          <button id="quick-log-all-btn" class="qm-log-all-btn">Log All</button>
        </div>`;
    }

    wrap.innerHTML = html;
    wrap.style.display = 'block';

    wrap.querySelectorAll('.qm-remove').forEach(b => {
      b.addEventListener('click', () => {
        _state.quickItems.splice(parseInt(b.dataset.i, 10), 1);
        _renderQuickPreview(_state.quickItems);
      });
    });

    wrap.querySelectorAll('.qm-chip').forEach(b => {
      b.addEventListener('click', () => _resolveClarification(parseInt(b.dataset.pi, 10), b.dataset.opt));
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
    if (typeof ThanziDiary !== 'undefined' && ThanziDiary.updateFromLogs) {
      ThanziDiary.updateFromLogs(totals, logs);
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
