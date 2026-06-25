/**
 * custom-foods.js — Thanzi Custom Foods Module
 * ─────────────────────────────────────────────────────────────────────────────
 * Appwrite custom_foods collection schema:
 *   userId (string), name (string), kcal (integer), carbs (float),
 *   protein (float), fat (float), servingSize (integer, optional)
 *
 * Also exposes ThanziCustomFoods.search(query) so ThanziLog's food
 * search can include user-defined foods in results.
 *
 * Dependencies: Appwrite SDK (IIFE), THANZI_CONFIG
 * ─────────────────────────────────────────────────────────────────────────────
 */

const ThanziCustomFoods = (() => {
  'use strict';

  // ── Appwrite ──────────────────────────────────────────────────────────────
  const _client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const _db = new Appwrite.Databases(_client);

  // ── State ─────────────────────────────────────────────────────────────────
  const _state = {
    user:    null,
    foods:   [],          // cached list of user's custom foods
    editing: null,        // doc $id being edited, or null for new
    inited:  false,
  };

  // ── Helpers ───────────────────────────────────────────────────────────────
  const _el   = id => document.getElementById(id);
  const _col  = () => THANZI_CONFIG.collections.customFoods;
  const _dbId = () => THANZI_CONFIG.databaseId;

  // ── Appwrite CRUD ─────────────────────────────────────────────────────────

  async function _fetchFoods() {
    if (!_state.user) return;
    try {
      const res = await _db.listDocuments(_dbId(), _col(), [
        Appwrite.Query.equal('userId', _state.user.$id),
        Appwrite.Query.orderDesc('$createdAt'),
        Appwrite.Query.limit(200),
      ]);
      _state.foods = res.documents;
    } catch (err) {
      console.warn('ThanziCustomFoods: fetch failed, using localStorage cache', err.message);
      _state.foods = _lsLoad();
    }
  }

  async function _saveFood(data) {
    const doc = {
      userId:      _state.user.$id,
      name:        data.name.trim(),
      kcal:        data.kcal,
      carbs:       data.carbs,
      protein:     data.protein,
      fat:         data.fat,
      servingSize: data.servingSize || 100,
    };
    if (_state.editing) {
      await _db.updateDocument(_dbId(), _col(), _state.editing, doc);
    } else {
      await _db.createDocument(_dbId(), _col(), Appwrite.ID.unique(), doc);
    }
  }

  async function _deleteFood(docId) {
    await _db.deleteDocument(_dbId(), _col(), docId);
  }

  // ── localStorage fallback ─────────────────────────────────────────────────

  function _lsKey() {
    return _state.user ? `thanzi_custom_foods_${_state.user.$id}` : null;
  }

  function _lsLoad() {
    try {
      const k = _lsKey();
      return k ? JSON.parse(localStorage.getItem(k) || '[]') : [];
    } catch { return []; }
  }

  function _lsSave(foods) {
    try {
      const k = _lsKey();
      if (k) localStorage.setItem(k, JSON.stringify(foods));
    } catch { /* ignore */ }
  }

  // ── Public search (used by ThanziLog food search) ─────────────────────────

  /**
   * Returns custom foods whose names include the query string.
   * Result objects match ThanziFood item format so they slot straight
   * into the existing log-food flow.
   */
  function search(query) {
    if (!query || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return _state.foods
      .filter(f => f.name.toLowerCase().includes(q))
      .map(f => ({
        name:        f.name,
        kcal:        f.kcal,
        cho:         f.carbs,
        pro:         f.protein,
        fat:         f.fat,
        sourceUsed:  'custom',
        measures:    [{ label: `1 serving (${f.servingSize}g)`, g: f.servingSize }],
        _customId:   f.$id,
      }));
  }

  // ── Form helpers ──────────────────────────────────────────────────────────

  function _showForm(food = null) {
    _state.editing = food ? food.$id : null;

    _el('cf-form-title').textContent = food ? 'Edit Food' : 'New Custom Food';
    _el('cf-name').value        = food ? food.name        : '';
    _el('cf-kcal').value        = food ? food.kcal        : '';
    _el('cf-carbs').value       = food ? food.carbs       : '';
    _el('cf-protein').value     = food ? food.protein     : '';
    _el('cf-fat').value         = food ? food.fat         : '';
    _el('cf-serving').value     = food ? food.servingSize : 100;
    _el('cf-form-error').textContent = '';

    _el('cf-form-wrap').style.display = 'block';
    _el('cf-name').focus();
  }

  function _hideForm() {
    _el('cf-form-wrap').style.display = 'none';
    _state.editing = null;
  }

  function _validate() {
    const name    = _el('cf-name').value.trim();
    const kcal    = parseFloat(_el('cf-kcal').value);
    const carbs   = parseFloat(_el('cf-carbs').value);
    const protein = parseFloat(_el('cf-protein').value);
    const fat     = parseFloat(_el('cf-fat').value);
    const serving = parseInt(_el('cf-serving').value, 10);

    if (!name)               return 'Food name is required.';
    if (isNaN(kcal)  || kcal  < 0) return 'Enter valid calories (≥ 0).';
    if (isNaN(carbs) || carbs < 0) return 'Enter valid carbs (≥ 0).';
    if (isNaN(protein) || protein < 0) return 'Enter valid protein (≥ 0).';
    if (isNaN(fat)   || fat   < 0) return 'Enter valid fat (≥ 0).';
    if (isNaN(serving) || serving <= 0) return 'Enter a valid serving size (> 0g).';
    return null; // valid
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function _render() {
    const list  = _el('cf-list');
    const empty = _el('cf-empty');
    const count = _el('cf-count');

    if (count) count.textContent = _state.foods.length
      ? `${_state.foods.length} food${_state.foods.length === 1 ? '' : 's'}`
      : '';

    if (!_state.foods.length) {
      list.innerHTML  = '';
      empty.style.display = 'flex';
      return;
    }

    empty.style.display = 'none';

    list.innerHTML = _state.foods.map(f => `
      <div class="cf-card" data-id="${f.$id}">
        <div class="cf-card-body">
          <div class="cf-card-name">${_escHtml(f.name)}</div>
          <div class="cf-card-serving">per ${f.servingSize}g serving</div>
          <div class="cf-macros">
            <span class="cf-macro cf-macro--kcal">
              <span class="cf-macro-val">${f.kcal}</span>
              <span class="cf-macro-lbl">kcal</span>
            </span>
            <span class="cf-macro cf-macro--carb">
              <span class="cf-macro-val">${f.carbs}g</span>
              <span class="cf-macro-lbl">carbs</span>
            </span>
            <span class="cf-macro cf-macro--pro">
              <span class="cf-macro-val">${f.protein}g</span>
              <span class="cf-macro-lbl">protein</span>
            </span>
            <span class="cf-macro cf-macro--fat">
              <span class="cf-macro-val">${f.fat}g</span>
              <span class="cf-macro-lbl">fat</span>
            </span>
          </div>
        </div>
        <div class="cf-card-actions">
          <button class="cf-edit-btn"   data-id="${f.$id}" title="Edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="cf-delete-btn" data-id="${f.$id}" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    // bind edit / delete buttons
    list.querySelectorAll('.cf-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const food = _state.foods.find(f => f.$id === btn.dataset.id);
        if (food) _showForm(food);
      });
    });

    list.querySelectorAll('.cf-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => _confirmDelete(btn.dataset.id));
    });
  }

  // ── Delete confirm ────────────────────────────────────────────────────────

  async function _confirmDelete(docId) {
    const food = _state.foods.find(f => f.$id === docId);
    if (!food) return;
    if (!confirm(`Delete "${food.name}"?`)) return;

    try {
      await _deleteFood(docId);
      _state.foods = _state.foods.filter(f => f.$id !== docId);
      _lsSave(_state.foods);
      _render();
    } catch (err) {
      console.error('ThanziCustomFoods: delete error', err.message);
      alert('Could not delete. Please try again.');
    }
  }

  // ── Save handler ──────────────────────────────────────────────────────────

  async function _onSave() {
    const errMsg = _validate();
    if (errMsg) {
      _el('cf-form-error').textContent = errMsg;
      return;
    }

    const btn = _el('cf-save-btn');
    btn.disabled    = true;
    btn.textContent = 'Saving…';

    const data = {
      name:        _el('cf-name').value.trim(),
      kcal:        Math.round(parseFloat(_el('cf-kcal').value)),
      carbs:       Math.round(parseFloat(_el('cf-carbs').value) * 10) / 10,
      protein:     Math.round(parseFloat(_el('cf-protein').value) * 10) / 10,
      fat:         Math.round(parseFloat(_el('cf-fat').value) * 10) / 10,
      servingSize: parseInt(_el('cf-serving').value, 10) || 100,
    };

    try {
      await _saveFood(data);
      await _fetchFoods();
      _lsSave(_state.foods);
      _hideForm();
      _render();
    } catch (err) {
      console.error('ThanziCustomFoods: save error', err.message);
      _el('cf-form-error').textContent = 'Save failed — check your connection.';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Food';
    }
  }

  // ── Bind events ───────────────────────────────────────────────────────────

  function _bindEvents() {
    _el('cf-add-btn').addEventListener('click', () => _showForm());
    _el('cf-cancel-btn').addEventListener('click', _hideForm);
    _el('cf-save-btn').addEventListener('click', _onSave);

    // Close form on backdrop click
    _el('cf-form-backdrop').addEventListener('click', _hideForm);

    // Prevent propagation from the form card itself
    _el('cf-form-card').addEventListener('click', e => e.stopPropagation());
  }

  // ── Tiny XSS helper ──────────────────────────────────────────────────────

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async function init(user) {
    if (_state.inited) return;   // already set up
    _state.user   = user;
    _state.inited = true;

    _bindEvents();
    await _fetchFoods();
    _render();
  }

  /** Called when the drawer routes to the custom-foods panel */
  async function refresh() {
    if (!_state.user) return;
    await _fetchFoods();
    _render();
  }

  return { init, refresh, search };
})();
