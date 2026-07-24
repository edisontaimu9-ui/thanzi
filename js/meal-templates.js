/**
 * meal-templates.js — Thanzi Meal Templates Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Appwrite meal_templates collection schema:
 *   userId (string), name (string), mealType (string),
 *   items (string — JSON), totalKcal (integer),
 *   totalCarbs (float), totalProtein (float), totalFat (float)
 *
 * Each item in items JSON:
 *   { name, grams, kcal, carbs, protein, fat }
 *
 * Dependencies: Appwrite SDK (IIFE), THANZI_CONFIG, ThanziFood, ThanziLog
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziMealTemplates = (() => {
  'use strict';

  // ── Appwrite ──────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const _db = new Appwrite.Databases(_client);

  // ── State ─────────────────────────────────────────────────────────────────
  const _state = {
    user:          null,
    templates:     [],
    inited:        false,
    editing:       null,       // doc $id being edited, or null for new
    draftItems:    [],         // foods building in the form
    draftMeal:     'breakfast',
    selectedFood:  null,       // food object chosen from search dropdown
    searchTimer:   null,
    searchReqId:   0,          // guards against stale async search responses
    logTarget:     null,       // template pending log confirmation
  };

  // ── Utilities ─────────────────────────────────────────────────────────────
  const _el  = id => document.getElementById(id);
  const _col = ()  => THANZI_CONFIG.collections.mealTemplates;
  const _dbId= ()  => THANZI_CONFIG.databaseId;

  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Appwrite CRUD ─────────────────────────────────────────────────────────

  async function _fetchTemplates() {
    if (!_state.user) return;
    try {
      const res = await _db.listDocuments(_dbId(), _col(), [
        Appwrite.Query.equal('userId', _state.user.$id),
        Appwrite.Query.orderDesc('$createdAt'),
        Appwrite.Query.limit(100),
      ]);
      _state.templates = res.documents.map(d => ({
        ...d,
        items: _parseItems(d.items),
      }));
    } catch (err) {
      console.warn('ThanziMealTemplates: fetch failed, using localStorage cache', err.message);
      _state.templates = _lsLoad();
    }
  }

  function _parseItems(raw) {
    try { return JSON.parse(raw || '[]'); } catch { return []; }
  }

  async function _saveTemplate(data) {
    const totals = _calcTotals(data.items);
    const doc = {
      userId:       _state.user.$id,
      name:         data.name.trim(),
      mealType:     data.mealType,
      items:        JSON.stringify(data.items),
      totalKcal:    totals.kcal,
      totalCarbs:   totals.carbs,
      totalProtein: totals.protein,
      totalFat:     totals.fat,
    };
    if (_state.editing) {
      await _db.updateDocument(_dbId(), _col(), _state.editing, doc);
    } else {
      await _db.createDocument(_dbId(), _col(), Appwrite.ID.unique(), doc);
    }
  }

  async function _deleteTemplate(docId) {
    await _db.deleteDocument(_dbId(), _col(), docId);
  }

  // ── localStorage fallback ─────────────────────────────────────────────────

  function _lsKey() {
    return _state.user ? `thanzi_meal_templates_${_state.user.$id}` : null;
  }

  function _lsLoad() {
    try {
      const k = _lsKey();
      if (!k) return [];
      return JSON.parse(localStorage.getItem(k) || '[]');
    } catch { return []; }
  }

  function _lsSave() {
    try {
      const k = _lsKey();
      if (k) localStorage.setItem(k, JSON.stringify(_state.templates));
    } catch { /* ignore */ }
  }

  // ── Macro calculator ──────────────────────────────────────────────────────

  function _calcTotals(items) {
    return items.reduce((acc, item) => ({
      kcal:    acc.kcal    + Math.round(item.kcal    || 0),
      carbs:   acc.carbs   + Math.round((item.carbs   || 0) * 10) / 10,
      protein: acc.protein + Math.round((item.protein || 0) * 10) / 10,
      fat:     acc.fat     + Math.round((item.fat     || 0) * 10) / 10,
    }), { kcal: 0, carbs: 0, protein: 0, fat: 0 });
  }

  function _scaleFood(food, grams) {
    const f = grams / 100;
    return {
      name:    food.name,
      grams,
      kcal:    Math.round((food.kcal || 0) * f),
      carbs:   Math.round(((food.cho || food.carbs || 0) * f) * 10) / 10,
      protein: Math.round(((food.pro || food.protein || 0) * f) * 10) / 10,
      fat:     Math.round(((food.fat || 0) * f) * 10) / 10,
    };
  }

  // ── Render templates list ─────────────────────────────────────────────────

  const MEAL_LABELS = {
    breakfast: '🌅 Breakfast',
    lunch:     '☀️ Lunch',
    dinner:    '🌙 Dinner',
    snack:     '🍎 Snack',
  };

  function _render() {
    const list  = _el('mt-list');
    const empty = _el('mt-empty');
    const count = _el('mt-count');

    if (count) count.textContent = _state.templates.length
      ? `${_state.templates.length} template${_state.templates.length === 1 ? '' : 's'}`
      : '';

    if (!_state.templates.length) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';

    list.innerHTML = _state.templates.map(t => {
      const totals   = _calcTotals(t.items);
      const preview  = t.items.slice(0, 3).map(i => _esc(i.name)).join(' · ');
      const more     = t.items.length > 3 ? ` +${t.items.length - 3} more` : '';
      const mealLbl  = MEAL_LABELS[t.mealType] || t.mealType;

      return `
        <div class="mt-card" data-id="${t.$id}">

          <div class="mt-card-top">
            <div class="mt-card-name">${_esc(t.name)}</div>
            <span class="mt-meal-tag">${mealLbl}</span>
          </div>

          <div class="mt-card-preview">${preview}${more ? `<span class="mt-more">${more}</span>` : ''}</div>

          <div class="mt-card-macros">
            <span class="mt-cmacro mt-cmacro--kcal">
              <span class="mt-cmacro-val">${totals.kcal}</span>
              <span class="mt-cmacro-lbl">kcal</span>
            </span>
            <span class="mt-cmacro mt-cmacro--carb">
              <span class="mt-cmacro-val">${totals.carbs}g</span>
              <span class="mt-cmacro-lbl">carbs</span>
            </span>
            <span class="mt-cmacro mt-cmacro--pro">
              <span class="mt-cmacro-val">${totals.protein}g</span>
              <span class="mt-cmacro-lbl">protein</span>
            </span>
            <span class="mt-cmacro mt-cmacro--fat">
              <span class="mt-cmacro-val">${totals.fat}g</span>
              <span class="mt-cmacro-lbl">fat</span>
            </span>
          </div>

          <div class="mt-card-footer">
            <button class="mt-log-btn" data-id="${t.$id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <polyline points="19 12 12 19 5 12"/>
              </svg>
              Log Meal
            </button>
            <div class="mt-card-icon-btns">
              <button class="mt-edit-btn" data-id="${t.$id}" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="mt-delete-btn" data-id="${t.$id}" title="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
              </button>
            </div>
          </div>

        </div>
      `;
    }).join('');

    // Bind card buttons
    list.querySelectorAll('.mt-log-btn').forEach(btn => {
      btn.addEventListener('click', () => _openLogPicker(btn.dataset.id));
    });
    list.querySelectorAll('.mt-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = _state.templates.find(x => x.$id === btn.dataset.id);
        if (t) _openForm(t);
      });
    });
    list.querySelectorAll('.mt-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => _confirmDelete(btn.dataset.id));
    });
  }

  // ── Form ──────────────────────────────────────────────────────────────────

  function _openForm(template = null) {
    _state.editing    = template ? template.$id : null;
    _state.draftItems = template ? [...template.items] : [];
    _state.draftMeal  = template ? template.mealType : 'breakfast';
    _state.selectedFood = null;

    _el('mt-form-title').textContent = template ? 'Edit Template' : 'New Meal Template';
    _el('mt-name').value             = template ? template.name : '';
    _el('mt-food-search').value      = '';
    _el('mt-food-results').style.display = 'none';
    _el('mt-food-grams').value       = 100;
    _el('mt-form-error').textContent = '';

    // Meal type pills
    document.querySelectorAll('.mt-meal-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.meal === _state.draftMeal);
    });

    _renderDraftItems();
    _el('mt-form-wrap').style.display = 'block';
    _el('mt-name').focus();
  }

  function _closeForm() {
    _el('mt-form-wrap').style.display = 'none';
    _el('mt-food-results').style.display = 'none';
    _state.editing    = null;
    _state.draftItems = [];
    _state.selectedFood = null;
  }

  // ── Draft items (inside form) ─────────────────────────────────────────────

  function _renderDraftItems() {
    const container = _el('mt-items-list');
    const totalsEl  = _el('mt-totals');

    if (!_state.draftItems.length) {
      container.innerHTML = `
        <div class="mt-items-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 7h13M7 13l-1-5"/>
          </svg>
          <span>Search foods above to build your template</span>
        </div>`;
      totalsEl.style.display = 'none';
      return;
    }

    totalsEl.style.display = 'flex';
    const totals = _calcTotals(_state.draftItems);
    _el('mt-total-kcal').textContent    = totals.kcal;
    _el('mt-total-carbs').textContent   = totals.carbs;
    _el('mt-total-protein').textContent = totals.protein;
    _el('mt-total-fat').textContent     = totals.fat;

    container.innerHTML = _state.draftItems.map((item, idx) => `
      <div class="mt-draft-item">
        <div class="mt-draft-item-info">
          <span class="mt-draft-name">${_esc(item.name)}</span>
          <span class="mt-draft-detail">${item.grams}g · ${item.kcal} kcal · ${item.protein}g P · ${item.fat}g F</span>
        </div>
        <button class="mt-draft-remove" data-idx="${idx}" title="Remove">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.mt-draft-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        _state.draftItems.splice(parseInt(btn.dataset.idx, 10), 1);
        _renderDraftItems();
      });
    });
  }

  // ── Food search inside form ───────────────────────────────────────────────

  function _onFormSearch(e) {
    const q = e.target.value.trim();
    clearTimeout(_state.searchTimer);
    const results = _el('mt-food-results');

    if (q.length < 2) {
      results.style.display = 'none';
      _state.selectedFood = null;
      return;
    }

    _state.searchTimer = setTimeout(async () => {
      const reqId = ++_state.searchReqId;

      // also include custom foods (instant, local)
      const custom = (typeof ThanziCustomFoods !== 'undefined')
        ? ThanziCustomFoods.search(q).map(f => ({ ...f, sourceUsed: 'custom' }))
        : [];

      results.innerHTML = '<div class="mt-sr-empty">Searching…</div>';
      results.style.display = 'block';

      // Chakudya Nutrition Registry (async — local FCT/packaged first,
      // falls through server-side to the external cascade)
      let hits = [];
      if (typeof ThanziFood !== 'undefined') {
        try {
          hits = await ThanziFood.search(q, { multi: true, limit: 8 });
        } catch (_e) { hits = []; }
      }

      // Stale response — a newer keystroke already fired a new search
      if (reqId !== _state.searchReqId) return;

      const all = [...custom, ...hits];

      if (!all.length) {
        results.innerHTML = '<div class="mt-sr-empty">No results</div>';
        results.style.display = 'block';
        return;
      }

      results.innerHTML = all.map((f, i) => `
        <div class="mt-sr-item" data-idx="${i}">
          <span class="mt-sr-name">${_esc(f.name)}</span>
          <span class="mt-sr-kcal">${f.kcal ?? '?'} kcal/100g</span>
        </div>
      `).join('');

      results.style.display = 'block';
      results._results = all;

      results.querySelectorAll('.mt-sr-item').forEach(item => {
        item.addEventListener('click', () => {
          _state.selectedFood = results._results[parseInt(item.dataset.idx)];
          _el('mt-food-search').value = _state.selectedFood.name;
          results.style.display = 'none';
        });
      });
    }, 220);
  }

  function _addFoodToTemplate() {
    const food  = _state.selectedFood;
    const grams = parseFloat(_el('mt-food-grams').value);

    if (!food)      return _setFormError('Search and select a food first.');
    if (!grams || grams <= 0) return _setFormError('Enter a valid gram amount.');

    _state.draftItems.push(_scaleFood(food, grams));
    _state.selectedFood = null;
    _el('mt-food-search').value = '';
    _el('mt-food-grams').value  = 100;
    _setFormError('');
    _renderDraftItems();
  }

  // ── Save template ─────────────────────────────────────────────────────────

  async function _onSave() {
    const name = _el('mt-name').value.trim();
    if (!name)                  return _setFormError('Give your template a name.');
    if (!_state.draftItems.length) return _setFormError('Add at least one food.');

    const btn = _el('mt-save-btn');
    btn.disabled    = true;
    btn.textContent = 'Saving…';

    try {
      await _saveTemplate({
        name,
        mealType: _state.draftMeal,
        items:    _state.draftItems,
      });
      await _fetchTemplates();
      _lsSave();
      _closeForm();
      _render();
    } catch (err) {
      console.error('ThanziMealTemplates: save error', err.message);
      _setFormError('Save failed — check your connection.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Template';
    }
  }

  function _setFormError(msg) {
    const el = _el('mt-form-error');
    if (el) el.textContent = msg;
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function _confirmDelete(docId) {
    const t = _state.templates.find(x => x.$id === docId);
    if (!t || !confirm(`Delete "${t.name}"?`)) return;

    try {
      await _deleteTemplate(docId);
      _state.templates = _state.templates.filter(x => x.$id !== docId);
      _lsSave();
      _render();
    } catch (err) {
      console.error('ThanziMealTemplates: delete error', err.message);
      alert('Could not delete. Please try again.');
    }
  }

  // ── Log meal picker ───────────────────────────────────────────────────────

  function _openLogPicker(docId) {
    _state.logTarget = _state.templates.find(t => t.$id === docId);
    if (!_state.logTarget) return;

    // Pre-select the template's default meal type
    document.querySelectorAll('.mt-log-meal-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.meal === _state.logTarget.mealType);
    });

    _el('mt-log-picker').style.display = 'block';
  }

  function _closeLogPicker() {
    _el('mt-log-picker').style.display = 'none';
    _state.logTarget = null;
  }

  async function _logTemplate(mealType) {
    const t = _state.logTarget;
    if (!t) return;

    const btns = document.querySelectorAll('.mt-log-meal-btn');
    btns.forEach(b => { b.disabled = true; b.textContent = b.textContent.replace('…', '') + '…'; });

    try {
      if (typeof ThanziLog !== 'undefined' && ThanziLog.logItems) {
        await ThanziLog.logItems(t.items, mealType);
      }
      _closeLogPicker();

      // Show success toast
      _showToast(`✓ "${t.name}" logged as ${MEAL_LABELS[mealType] || mealType}`);

      // If log panel is currently visible, refresh it
      const logPanel = document.getElementById('log-panel');
      if (logPanel && logPanel.style.display !== 'none') {
        if (typeof ThanziLog !== 'undefined') await ThanziLog.refresh();
      }
    } catch (err) {
      console.error('ThanziMealTemplates: log error', err.message);
      _showToast('⚠️ Could not log — try again.');
    } finally {
      btns.forEach(b => {
        b.disabled    = false;
        b.textContent = b.textContent.replace('…', '');
      });
    }
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function _showToast(msg) {
    let toast = document.getElementById('mt-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'mt-toast';
      toast.className = 'mt-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }

  // ── Event binding ─────────────────────────────────────────────────────────

  function _bindEvents() {
    // Create button
    _el('mt-create-btn').addEventListener('click', () => _openForm());

    // Form backdrop → close
    _el('mt-form-backdrop').addEventListener('click', _closeForm);
    _el('mt-form-card').addEventListener('click', e => e.stopPropagation());

    // Cancel / Save
    _el('mt-cancel-btn').addEventListener('click', _closeForm);
    _el('mt-save-btn').addEventListener('click', _onSave);

    // Meal type pills
    document.querySelectorAll('.mt-meal-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.mt-meal-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        _state.draftMeal = pill.dataset.meal;
      });
    });

    // Food search
    _el('mt-food-search').addEventListener('input', _onFormSearch);
    document.addEventListener('click', e => {
      if (!e.target.closest('.mt-search-wrap')) {
        _el('mt-food-results').style.display = 'none';
      }
    }, { passive: true });

    // Add food button
    _el('mt-food-add-btn').addEventListener('click', _addFoodToTemplate);
    _el('mt-food-grams').addEventListener('keydown', e => {
      if (e.key === 'Enter') _addFoodToTemplate();
    });

    // Log picker
    document.querySelectorAll('.mt-log-meal-btn').forEach(btn => {
      btn.addEventListener('click', () => _logTemplate(btn.dataset.meal));
    });
    _el('mt-log-backdrop').addEventListener('click', _closeLogPicker);
    _el('mt-log-cancel').addEventListener('click', _closeLogPicker);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function init(user) {
    if (_state.inited) return;
    _state.user   = user;
    _state.inited = true;
    _bindEvents();
    await _fetchTemplates();
    _render();
  }

  async function refresh() {
    if (!_state.user) return;
    await _fetchTemplates();
    _render();
  }

  return { init, refresh };
})();
