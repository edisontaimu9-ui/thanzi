/**
 * thanzi-foodSearch.js — Thanzi Food Search Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Single source of truth: Chakudya Nutrition Registry (CNR).
 *
 * TEXT SEARCH  (searchFood)
 *   GET /foods?search=   Malawi FCT + community foods.
 *
 * BARCODE SEARCH  (searchBarcode)
 *   GET /packaged?barcode=   Packaged foods DB — exact EAN-13 lookup.
 *
 * OUTPUT SHAPE (unified food object)
 *   { id, name, brand?, cat, kcal, kj, pro, cho, fat,
 *     fiber?, sugar?, sodium?, salt?,
 *     measures?,          // from CNR when available
 *     unit,               // 'g' | 'mL'
 *     barcode?,           // barcode pipeline only
 *     barcodeSource?,     // 'Chakudya'
 *     sourceUsed,         // 'Chakudya'
 *     confidenceScore,    // 0.0–1.0
 *     lastUpdated }
 *
 * Author: Edison Taimu — Thanzi
 * ─────────────────────────────────────────────────────────────────────────────
 */

(function (global) {
  'use strict';

  // ── CONFIG ─────────────────────────────────────────────────────────────────
  const _MW_API = 'https://chakudya-api.edisontaimu9.workers.dev';

  // ── SESSION CACHE ───────────────────────────────────────────────────────────
  const _cache = new Map();

  // ── UTILS ───────────────────────────────────────────────────────────────────

  /** Normalise string for cache keys */
  function _norm(str) {
    return (str || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** AbortSignal with fallback for older Android WebViews */
  function _signal(ms = 6000) {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // CHAKUDYA NUTRITION REGISTRY (CNR)
  // Malawi FCT (whole-food, traditional) + packaged foods database.
  // Sole food data source; falls through silently on any network error.
  // ══════════════════════════════════════════════════════════════════════════

  /** Map a CNR food object → unified shape */
  function _mwToUnified(item) {
    const kcal = item.energy_kcal ?? item.kcal ?? null;
    return {
      id:              'mw_' + item.id,
      name:            item.name || item.food_name,
      cat:             item.category  || 'Malawi',
      measure:         item.measure   || null,
      weight_g:        item.weight_g  || 100,
      kcal,
      kj:              item.kj ?? (kcal != null ? +(kcal * 4.184).toFixed(0) : null),
      pro:             item.protein_g  ?? null,
      cho:             item.carbs_g   ?? null,
      fat:             item.fat_g     ?? null,
      fiber:           item.fiber_g   ?? null,
      sodium:          item.sodium_mg != null
                         ? +(item.sodium_mg / 1000).toFixed(3) : null,
      measures:        item.measure
                         ? [{ lbl: item.measure, weight: item.weight_g,
                              kcal, kj: item.kj,
                              pro: item.protein_g, cho: item.carbs_g, fat: item.fat_g }]
                         : null,
      unit:            'g',
      sourceUsed:      'Chakudya',
      dbSource:        'Chakudya API',
      confidenceScore: 0.98,
      lastUpdated:     null,
    };
  }

  /** Text search — GET /foods?search= */
  async function _searchMW(query, limit = 10) {
    try {
      const url = _MW_API + '/foods?search='
        + encodeURIComponent(query.trim()) + '&limit=' + limit;
      const res = await fetch(url, {
        signal:  _signal(),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const json = await res.json();
      if (!Array.isArray(json.data) || !json.data.length) return [];
      return json.data.map(_mwToUnified);
    } catch (_e) { return []; }
  }

  /** Fetch a single food by id — used by import/detail screens */
  async function _fetchMWById(id) {
    try {
      const res = await fetch(_MW_API + '/foods/' + id, {
        signal:  _signal(),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json.data) return null;
      return _mwToUnified(json.data);
    } catch (_e) { return null; }
  }

  /** Browse by category — for category screens (Staples, Legumes, etc.) */
  async function browseMWCategory(category, limit = 20) {
    try {
      const url = _MW_API + '/foods?category='
        + encodeURIComponent(category) + '&limit=' + limit;
      const res = await fetch(url, {
        signal:  _signal(),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const json = await res.json();
      if (!Array.isArray(json.data) || !json.data.length) return [];
      return json.data.map(_mwToUnified);
    } catch (_e) { return []; }
  }

  /** Barcode lookup — GET /packaged?barcode= */
  async function _searchMWBarcode(barcode) {
    try {
      const url = _MW_API + '/packaged?barcode=' + encodeURIComponent(barcode.trim());
      const res = await fetch(url, {
        signal:  _signal(),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = await res.json();
      // /packaged returns { data: [product] }
      const d = Array.isArray(json.data) ? json.data[0] : json.data;
      if (!d) return null;
      const kcal = d.kcal ?? null;
      return {
        id:              'mwp_' + (d.id || barcode),
        name:            d.product_name || d.food_name || barcode,
        brand:           d.brand        || null,
        cat:             d.category     || 'Packaged',
        barcode,
        barcodeSource:   'Chakudya',
        barcodeMatch:    'exact',
        kcal,
        kj:              d.kj ?? (kcal != null ? +(kcal * 4.184).toFixed(0) : null),
        pro:             d.protein_g    ?? null,
        cho:             d.carbs_g      ?? null,
        fat:             d.fat_g        ?? null,
        fiber:           d.fiber_g      ?? null,
        sodium:          d.sodium_mg != null ? +(d.sodium_mg / 1000).toFixed(3) : null,
        unit:            'g',
        measures:        null,
        sourceUsed:      'Chakudya',
        dbSource:        'Chakudya Packaged DB',
        confidenceScore: 0.97,
        lastUpdated:     null,
      };
    } catch (_e) { return null; }
  }

  /** Packaged-food text search — GET /packaged?search= (used as a fallback
   *  when /foods has no hit, so packaged/branded items are still reachable
   *  by name and not only by barcode). */
  async function _searchMWPackaged(query, limit = 10) {
    try {
      const url = _MW_API + '/packaged?search='
        + encodeURIComponent(query.trim()) + '&limit=' + limit;
      const res = await fetch(url, {
        signal:  _signal(),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const json = await res.json();
      const list = Array.isArray(json.data) ? json.data : [];
      if (!list.length) return [];
      return list.map(d => {
        const kcal = d.kcal ?? null;
        return {
          id:              'mwp_' + (d.id || _norm(d.product_name || d.food_name || '')),
          name:            d.product_name || d.food_name || query,
          brand:           d.brand        || null,
          cat:             d.category     || 'Packaged',
          kcal,
          kj:              d.kj ?? (kcal != null ? +(kcal * 4.184).toFixed(0) : null),
          pro:             d.protein_g    ?? null,
          cho:             d.carbs_g      ?? null,
          fat:             d.fat_g        ?? null,
          fiber:           d.fiber_g      ?? null,
          sodium:          d.sodium_mg != null ? +(d.sodium_mg / 1000).toFixed(3) : null,
          unit:            'g',
          measures:        null,
          sourceUsed:      'Chakudya',
          dbSource:        'Chakudya Packaged DB',
          confidenceScore: 0.95,
          lastUpdated:     null,
        };
      });
    } catch (_e) { return []; }
  }


  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — TEXT SEARCH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Search for a food by name.
   *
   * @param  {string}  query
   * @param  {object}  [opts]
   * @param  {boolean} [opts.multi=false]  Return array of results (up to limit)
   * @param  {number}  [opts.limit=10]
   * @returns {Promise<object|object[]|null>}
   */
  async function searchFood(query, opts = {}) {
    const { multi = false, limit = 10 } = opts;
    if (!query || !query.trim()) return multi ? [] : null;

    const cacheKey = _norm(query) + (multi ? '|m' : '');
    if (_cache.has(cacheKey)) return _cache.get(cacheKey);

    // GET /foods — whole-food / traditional Malawi FCT
    const mwResults = await _searchMW(query, multi ? limit : 5);
    if (mwResults.length) {
      const result = multi ? mwResults.slice(0, limit) : mwResults[0];
      _cache.set(cacheKey, result);
      return result;
    }

    // GET /packaged — fallback for branded/packaged items reachable by name
    const pkgResults = await _searchMWPackaged(query, multi ? limit : 5);
    const result = multi ? pkgResults.slice(0, limit) : (pkgResults[0] || null);
    _cache.set(cacheKey, result);
    return result;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — BARCODE SEARCH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a scanned barcode to a food object.
   *
   * @param  {string} barcode  EAN-13 / UPC-A / GTIN-14
   * @returns {Promise<object|null>}
   */
  async function searchBarcode(barcode) {
    if (!barcode) return null;

    // GET /packaged?barcode= — Chakudya packaged foods, exact match
    return await _searchMWBarcode(barcode);
  }

  function clearCache() { _cache.clear(); }


  // ── Public API ─────────────────────────────────────────────────────────────
  global.ThanziFood = {
    // Main entry points
    search:           searchFood,
    searchBarcode:    searchBarcode,
    browseCategory:   browseMWCategory,
    clearCache,
    // Internals — exposed for dev/debug and explicit single-source import UIs
    _mwById:          _fetchMWById,
  };

})(typeof window !== 'undefined' ? window : this);
