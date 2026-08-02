/**
 * learn.js — Thanzi Learn Panel (Dietary Education)
 *
 * Reads the user's saved nutrition plan (thanzi_profile_<uid>) and asks
 * ThanziEducation.forUser() for a personalized "For You" shortlist, plus
 * renders the full article library below with category filter chips.
 * Each card expands in place to show the full article body.
 *
 * Depends on: ThanziEducation (thanzi-education.js), ThanziAuth (auth.js)
 * Panel element: #learn-panel
 * Opened from: side drawer ("learn" route)
 */
const ThanziLearn = (() => {
  'use strict';

  let _userId  = null;
  let _plan    = null;
  let _filter  = 'All';
  let _inited  = false;

  // ── Load the saved plan (same key goals.js/progress.js read) ─────────────

  function _loadPlan() {
    try {
      if (!_userId) return;
      const raw = localStorage.getItem('thanzi_profile_' + _userId);
      _plan = raw ? JSON.parse(raw) : null;
    } catch (e) { _plan = null; }
  }

  // ── Card rendering ────────────────────────────────────────────────────────

  function _cardHTML(article, idx, prefix) {
    const id = `lrn-body-${prefix}-${idx}`;
    return `
      <div class="lrn-card">
        <button type="button" class="lrn-card-head" data-target="${id}">
          <div class="lrn-card-head-text">
            <span class="lrn-card-category">${article.category}</span>
            <span class="lrn-card-title">${article.title}</span>
            <span class="lrn-card-summary">${article.summary}</span>
          </div>
          <span class="lrn-card-meta">
            <span class="lrn-card-read">${article.read_min} min</span>
            <span class="lrn-card-chevron">▾</span>
          </span>
        </button>
        <div class="lrn-card-body" id="${id}" style="display:none">
          ${article.body.map(p => `<p>${p}</p>`).join('')}
        </div>
      </div>`;
  }

  function _bindExpand(containerEl) {
    containerEl.querySelectorAll('.lrn-card-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const body = document.getElementById(btn.dataset.target);
        if (!body) return;
        const open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        btn.classList.toggle('open', !open);
      });
    });
  }

  // ── "For You" section ──────────────────────────────────────────────────────

  function _renderForYou(forYou) {
    const wrap = document.getElementById('lrn-foryou-wrap');
    const list = document.getElementById('lrn-foryou-list');
    if (!wrap || !list) return;

    if (!forYou.length) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';
    list.innerHTML = forYou.map((a, i) => _cardHTML(a, i, 'fy')).join('');
    _bindExpand(list);
  }

  // ── Filter chips + "All Topics" section ─────────────────────────────────────

  function _renderFilters() {
    const row = document.getElementById('lrn-filter-row');
    if (!row) return;
    const cats = ['All', ...ThanziEducation.categories()];
    row.innerHTML = cats.map(c => `
      <button type="button" class="lrn-filter-chip ${c === _filter ? 'active' : ''}" data-cat="${c}">${c}</button>
    `).join('');
    row.querySelectorAll('.lrn-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        _filter = btn.dataset.cat;
        _renderFilters();
        _renderAll();
      });
    });
  }

  function _renderAll() {
    const list = document.getElementById('lrn-all-list');
    if (!list) return;
    const articles = _filter === 'All'
      ? ThanziEducation.ARTICLES
      : ThanziEducation.ARTICLES.filter(a => a.category === _filter);
    list.innerHTML = articles.map((a, i) => _cardHTML(a, i, 'all')).join('');
    _bindExpand(list);
  }

  // ── Init / refresh ──────────────────────────────────────────────────────────

  async function _loadUserId() {
    try {
      if (typeof ThanziAuth !== 'undefined') {
        const u = await ThanziAuth.getUser();
        if (u) _userId = u.$id;
      }
    } catch (e) {}
  }

  async function _renderAllSections() {
    _loadPlan();
    const { forYou } = ThanziEducation.forUser(_plan);
    _renderForYou(forYou);
    if (!_inited) {
      _renderFilters();
      _inited = true;
    }
    _renderAll();
  }

  async function init() {
    await _loadUserId();
    await _renderAllSections();
  }

  /** Called by drawer each time the panel is opened. */
  async function refresh() {
    await _loadUserId();
    await _renderAllSections();
  }

  return { init, refresh };
})();
