/**
 * customFoods.js — Thanzi Custom Foods module
 *
 * Storage: localStorage key  `thanzi_custom_foods_<userId>`
 * Each food: { id, name, emoji, kcal, carbs, protein, fat, serving, unit, createdAt }
 *
 * Public API:  ThanziCustomFoods.init(user)
 *              ThanziCustomFoods.getAll()   → returns array (used by log search)
 */

const ThanziCustomFoods = (() => {
  'use strict';

  /* ── Constants ──────────────────────────────────────────────────────────── */

  const EMOJIS = ['🥗','🍲','🥩','🍗','🐟','🥚','🧀','🥛','🌽','🍠',
                  '🥜','🍌','🍎','🍞','🍚','🫘','🥦','🫐','🍋','🌿'];

  const UNITS  = ['g','ml','oz','cup','tbsp','tsp','piece','slice','bowl','plate'];

  /* ── State ─────────────────────────────────────────────────────────────── */

  let _userId   = null;
  let _foods    = [];         // in-memory cache
  let _editId   = null;       // null = add mode, string = edit mode
  let _selectedEmoji = '🥗';
  let _query    = '';

  /* ── Storage ────────────────────────────────────────────────────────────── */

  const _key = () => `thanzi_custom_foods_${_userId}`;

  const _load = () => {
    try {
      const raw = localStorage.getItem(_key());
      _foods = raw ? JSON.parse(raw) : [];
    } catch { _foods = []; }
  };

  const _save = () => {
    try { localStorage.setItem(_key(), JSON.stringify(_foods)); } catch { /* ignore */ }
  };

  /* ── DOM helpers ────────────────────────────────────────────────────────── */

  const _el = id => document.getElementById(id);

  /* ── Render food list ───────────────────────────────────────────────────── */

  const _render = () => {
    const grid = _el('cf-grid');
    const count = _el('cf-count');
    if (!grid) return;

    const q = _query.trim().toLowerCase();
    const list = q
      ? _foods.filter(f => f.name.toLowerCase().includes(q))
      : _foods;

    if (count) count.textContent = `${_foods.length} saved`;

    if (list.length === 0) {
      grid.innerHTML = `
        <div class="cf-empty">
          <div class="cf-empty-icon">🥗</div>
          <p class="cf-empty-title">${q ? 'No matches found' : 'Nothing saved yet'}</p>
          <p class="cf-empty-sub">${q ? 'Try a different name.' : 'Tap "New food" to save your first custom item.'}</p>
          ${!q ? '<button class="cf-empty-cta" id="cf-empty-cta-btn">+ New food</button>' : ''}
        </div>`;
      const ctaBtn = _el('cf-empty-cta-btn');
      if (ctaBtn) ctaBtn.addEventListener('click', _openSheet);
      return;
    }

    grid.innerHTML = list.map(f => `
      <div class="cf-food-card" data-id="${f.id}">
        <div class="cf-card-dot">${f.emoji || '🥗'}</div>
        <div class="cf-card-body">
          <div class="cf-card-name">${_esc(f.name)}</div>
          <div class="cf-card-meta">${f.serving}${f.unit} · P ${f.protein}g · C ${f.carbs}g · F ${f.fat}g</div>
        </div>
        <div class="cf-card-kcal">${f.kcal} kcal</div>
        <div class="cf-card-actions">
          <button class="cf-card-icon-btn edit"   data-id="${f.id}" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z"/>
            </svg>
          </button>
          <button class="cf-card-icon-btn delete" data-id="${f.id}" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.cf-card-icon-btn.edit').forEach(btn => {
      btn.addEventListener('click', () => _openSheetEdit(btn.dataset.id));
    });
    grid.querySelectorAll('.cf-card-icon-btn.delete').forEach(btn => {
      btn.addEventListener('click', () => _deleteFood(btn.dataset.id));
    });
  };

  /* ── Sheet (add / edit modal) ───────────────────────────────────────────── */

  const _openSheet = () => {
    _editId = null;
    _selectedEmoji = '🥗';
    _populateSheet(null);
    _showSheet(true);
  };

  const _openSheetEdit = (id) => {
    const food = _foods.find(f => f.id === id);
    if (!food) return;
    _editId = id;
    _selectedEmoji = food.emoji || '🥗';
    _populateSheet(food);
    _showSheet(true);
  };

  const _showSheet = (open) => {
    const overlay = _el('cf-sheet-overlay');
    const sheet   = _el('cf-sheet');
    if (!overlay || !sheet) return;
    overlay.classList.toggle('open', open);
    sheet.classList.toggle('open', open);
    if (open) document.body.style.overflow = 'hidden';
    else       document.body.style.overflow = '';
  };

  const _populateSheet = (food) => {
    // title
    const title = _el('cf-sheet-title');
    if (title) title.textContent = food ? 'Edit food' : 'New custom food';

    // fields
    _setVal('cf-f-name',    food?.name    ?? '');
    _setVal('cf-f-kcal',    food?.kcal    ?? '');
    _setVal('cf-f-carbs',   food?.carbs   ?? '');
    _setVal('cf-f-protein', food?.protein ?? '');
    _setVal('cf-f-fat',     food?.fat     ?? '');
    _setVal('cf-f-serving', food?.serving ?? '100');
    _setVal('cf-f-unit',    food?.unit    ?? 'g');
    _setVal('cf-form-error', '');

    // emoji picker
    _renderEmojiPicker();
  };

  const _setVal = (id, val) => {
    const el = _el(id);
    if (!el) return;
    el.textContent !== undefined && el.tagName !== 'INPUT' && el.tagName !== 'SELECT'
      ? (el.textContent = val)
      : (el.value = val);
  };

  /* ── Emoji picker ─────────────────────────────────────────────────────── */

  const _renderEmojiPicker = () => {
    const row = _el('cf-emoji-row');
    if (!row) return;
    row.innerHTML = EMOJIS.map(e => `
      <button type="button" class="cf-emoji-chip${e === _selectedEmoji ? ' selected' : ''}" data-emoji="${e}">${e}</button>
    `).join('');
    row.querySelectorAll('.cf-emoji-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectedEmoji = btn.dataset.emoji;
        row.querySelectorAll('.cf-emoji-chip').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  };

  /* ── CRUD ────────────────────────────────────────────────────────────── */

  const _saveFood = () => {
    const name    = (_el('cf-f-name')?.value    ?? '').trim();
    const kcal    = parseFloat(_el('cf-f-kcal')?.value    ?? '');
    const carbs   = parseFloat(_el('cf-f-carbs')?.value   ?? '');
    const protein = parseFloat(_el('cf-f-protein')?.value ?? '');
    const fat     = parseFloat(_el('cf-f-fat')?.value     ?? '');
    const serving = parseFloat(_el('cf-f-serving')?.value ?? '');
    const unit    = _el('cf-f-unit')?.value ?? 'g';
    const errEl   = _el('cf-form-error');

    if (!name) { if (errEl) errEl.textContent = 'Name is required.'; return; }
    if (isNaN(kcal) || kcal < 0) { if (errEl) errEl.textContent = 'Enter a valid calorie value.'; return; }
    if (isNaN(serving) || serving <= 0) { if (errEl) errEl.textContent = 'Serving size must be > 0.'; return; }
    if (errEl) errEl.textContent = '';

    if (_editId) {
      const idx = _foods.findIndex(f => f.id === _editId);
      if (idx !== -1) {
        _foods[idx] = { ..._foods[idx], name, emoji: _selectedEmoji, kcal, carbs: carbs || 0, protein: protein || 0, fat: fat || 0, serving, unit };
      }
    } else {
      _foods.unshift({
        id: `cf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name,
        emoji: _selectedEmoji,
        kcal,
        carbs:   carbs   || 0,
        protein: protein || 0,
        fat:     fat     || 0,
        serving,
        unit,
        createdAt: new Date().toISOString(),
      });
    }

    _save();
    _showSheet(false);
    _render();
  };

  const _deleteFood = (id) => {
    if (!confirm('Delete this food?')) return;
    _foods = _foods.filter(f => f.id !== id);
    _save();
    _render();
  };

  /* ── Panel HTML ────────────────────────────────────────────────────────── */

  const _buildPanelHTML = () => {
    const unitOptions = UNITS.map(u => `<option value="${u}">${u}</option>`).join('');

    return `
    <!-- ── Custom Foods Panel ──────────────────────────────────────────── -->
    <div id="custom-foods-panel" class="dash-panel" style="display:none">

      <!-- Top bar -->
      <div class="cf-topbar">
        <span class="cf-topbar-title">My Foods</span>
        <span class="cf-topbar-count" id="cf-count">0 saved</span>
      </div>

      <!-- Search + add -->
      <div class="cf-search-row">
        <div class="cf-search-wrap">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="cf-search-input" class="cf-search-input" type="search"
                 placeholder="Search saved foods…" autocomplete="off" autocorrect="off">
        </div>
        <button id="cf-add-btn" class="cf-add-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New food
        </button>
      </div>

      <!-- Food grid -->
      <div id="cf-grid" class="cf-grid"></div>

    </div><!-- /custom-foods-panel -->

    <!-- ── Sheet overlay ──────────────────────────────────────────────────── -->
    <div id="cf-sheet-overlay" class="cf-sheet-overlay"></div>

    <!-- ── Add / Edit Sheet ───────────────────────────────────────────────── -->
    <div id="cf-sheet" class="cf-sheet" role="dialog" aria-modal="true">
      <div class="cf-sheet-handle"></div>
      <div class="cf-sheet-header">
        <span id="cf-sheet-title" class="cf-sheet-title">New custom food</span>
        <button id="cf-sheet-close" class="cf-sheet-close" aria-label="Close">✕</button>
      </div>

      <div class="cf-form">

        <!-- Emoji icon -->
        <div class="cf-field">
          <span class="cf-label">Icon</span>
          <div id="cf-emoji-row" class="cf-emoji-row"></div>
        </div>

        <!-- Name -->
        <div class="cf-field">
          <label class="cf-label" for="cf-f-name">Food name</label>
          <input id="cf-f-name" class="cf-input" type="text" placeholder="e.g. Nsima, Chicken stew…"
                 autocorrect="off" autocomplete="off" spellcheck="false">
        </div>

        <!-- Calories -->
        <div class="cf-field">
          <label class="cf-label" for="cf-f-kcal">Calories (kcal)</label>
          <input id="cf-f-kcal" class="cf-input" type="number" inputmode="decimal" min="0" placeholder="e.g. 350">
        </div>

        <!-- Serving -->
        <div class="cf-field">
          <span class="cf-label">Serving size</span>
          <div style="display:flex; gap:8px;">
            <input id="cf-f-serving" class="cf-input" type="number" inputmode="decimal" min="0.1"
                   placeholder="100" style="flex:1">
            <select id="cf-f-unit" class="cf-select" style="width:90px">${unitOptions}</select>
          </div>
          <p class="cf-hint">All values below are per this serving</p>
        </div>

        <!-- Macros 2-col -->
        <div class="cf-field">
          <span class="cf-label">Macros (optional)</span>
          <div class="cf-macros-grid">
            <div class="cf-field">
              <label class="cf-label" for="cf-f-carbs">Carbs (g)</label>
              <input id="cf-f-carbs" class="cf-input" type="number" inputmode="decimal" min="0" placeholder="0">
            </div>
            <div class="cf-field">
              <label class="cf-label" for="cf-f-protein">Protein (g)</label>
              <input id="cf-f-protein" class="cf-input" type="number" inputmode="decimal" min="0" placeholder="0">
            </div>
            <div class="cf-field">
              <label class="cf-label" for="cf-f-fat">Fat (g)</label>
              <input id="cf-f-fat" class="cf-input" type="number" inputmode="decimal" min="0" placeholder="0">
            </div>
          </div>
        </div>

        <!-- Error -->
        <p id="cf-form-error" class="cf-form-error"></p>

        <!-- Submit -->
        <button id="cf-submit-btn" class="cf-submit-btn">Save food</button>

      </div>
    </div><!-- /cf-sheet -->
    `;
  };

  /* ── Init ─────────────────────────────────────────────────────────────── */

  const init = (user) => {
    _userId = user?.$id ?? 'guest';
    _load();

    // Inject panel + sheet into dashboard-screen if not already there
    if (!_el('custom-foods-panel')) {
      const dashScreen = _el('dashboard-screen');
      if (dashScreen) {
        const tmp = document.createElement('div');
        tmp.innerHTML = _buildPanelHTML();
        // Insert panel before bottom-nav
        const nav = dashScreen.querySelector('.bottom-nav');
        while (tmp.firstChild) {
          nav ? dashScreen.insertBefore(tmp.firstChild, nav) : dashScreen.appendChild(tmp.firstChild);
        }
      }
    }

    // Wire events
    _el('cf-add-btn')     ?.addEventListener('click', _openSheet);
    _el('cf-sheet-close') ?.addEventListener('click', () => _showSheet(false));
    _el('cf-sheet-overlay')?.addEventListener('click', () => _showSheet(false));
    _el('cf-submit-btn')  ?.addEventListener('click', _saveFood);
    _el('cf-search-input')?.addEventListener('input', e => {
      _query = e.target.value;
      _render();
    });

    _render();
  };

  /* ── Public ──────────────────────────────────────────────────────────── */

  const show = () => {
    document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
    const panel = _el('custom-foods-panel');
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  };

  const getAll = () => [..._foods];

  /* ── Tiny escape helper ───────────────────────────────────────────────── */
  const _esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  return { init, show, getAll };
})();
