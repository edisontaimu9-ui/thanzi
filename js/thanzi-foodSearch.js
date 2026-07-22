/**
 * thanzi-foodSearch.js — Thanzi Food Search Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TEXT SEARCH  (searchFood)
 *   Layer 1 — Chakudya /foods           Malawi FCT + packaged foods. Highest priority.
 *   Layer 2 — Chakudya /foods/lookup    Server-side external cascade (USDA FDC →
 *                                       Open Food Facts → FatSecret), only hit
 *                                       when Layer 1 has no match. Chakudya caches
 *                                       the first external hit itself, so we never
 *                                       call USDA/OFF/FatSecret directly from the
 *                                       client.
 *
 * BARCODE SEARCH  (searchBarcode)
 *   Single call — Chakudya /foods/lookup?barcode=   Checks Chakudya's own
 *   packaged DB first (source: 'local_packaged'), then falls through
 *   server-side to Open Food Facts if there's no local match.
 *
 * OUTPUT SHAPE (unified food object)
 *   { id, name, brand?, cat, kcal, kj, pro, cho, fat,
 *     fiber?, sugar?, sodium?, salt?,
 *     measures?,          // from Chakudya when available
 *     unit,               // 'g' | 'mL'
 *     barcode?,           // barcode pipeline only
 *     barcodeSource?,     // 'Chakudya' | 'Chakudya-lookup'
 *     sourceUsed,         // 'Chakudya' | 'Chakudya-lookup'
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

  /**
   * Merge ext fields into base — fills null/missing fields only.
   * (Currently unused — kept as a utility in case a future layer needs it.)
   */
  function _merge(base, ext) {
    if (!ext) return base;
    const FIELDS = ['kcal', 'kj', 'pro', 'cho', 'fat', 'fiber', 'sugar', 'sodium'];
    const out = { ...base };
    let merged = false;
    for (const f of FIELDS) {
      if ((out[f] == null || out[f] === '') && ext[f] != null) {
        out[f]  = ext[f];
        merged  = true;
      }
    }
    if (merged) {
      out.sourceUsed      = [base.sourceUsed, ext.sourceUsed].filter(Boolean).join('+');
      out.confidenceScore = +Math.min(
        Math.max(base.confidenceScore, ext.confidenceScore) + 0.05, 1
      ).toFixed(2);
    }
    return out;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 1 — CHAKUDYA API
  // Malawi FCT (whole-food, traditional) + packaged foods database.
  // Highest-priority source; falls through silently on any network error.
  // ══════════════════════════════════════════════════════════════════════════

  /** Map a Chakudya food object → unified shape */
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

  /** Text search — /foods?search= */
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


  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2 — CHAKUDYA EXTERNAL LOOKUP CASCADE  (/foods/lookup)
  // The Worker itself already cascades through USDA FDC → Open Food Facts →
  // FatSecret (see chakudya-api README, "GET /foods/lookup"), and caches the
  // first external hit server-side in `external_foods_cache`. We only call
  // this when Layer 1 (/foods or /packaged) has no local match — no direct
  // client calls to USDA/OFF/FatSecret, no client-side API keys, no
  // duplicate caching logic.
  // ══════════════════════════════════════════════════════════════════════════

  /** Map a /foods/lookup result → unified shape.
   *  apiSource is the envelope's `source` field: 'local' | 'local_packaged'
   *  when Chakudya matched its own DB, or an external source name otherwise. */
  function _lookupToUnified(item, { barcode = null, apiSource = null } = {}) {
    const kcal    = item.energy_kcal ?? item.kcal ?? null;
    const isLocal = apiSource === 'local' || apiSource === 'local_packaged';
    return {
      id:              'lookup_' + (item.id ?? barcode ?? _norm(item.food_name || item.product_name || '')),
      name:            item.food_name || item.product_name || barcode || '',
      brand:           item.brand || null,
      cat:             item.category || (barcode ? 'Packaged' : 'Global'),
      barcode:         barcode || item.barcode || null,
      kcal,
      kj:              item.kj ?? (kcal != null ? +(kcal * 4.184).toFixed(0) : null),
      pro:             item.protein_g ?? null,
      cho:             item.carbs_g ?? null,
      fat:             item.fat_g ?? null,
      fiber:           item.fiber_g ?? null,
      sugar:           item.sugar_g ?? item.sugars_g ?? null,
      sodium:          item.sodium_mg != null ? +(item.sodium_mg / 1000).toFixed(3) : null,
      unit:            'g',
      measures:        item.measure
                         ? [{ lbl: item.measure, weight: item.weight_g,
                              kcal, pro: item.protein_g, cho: item.carbs_g, fat: item.fat_g }]
                         : null,
      sourceUsed:      isLocal ? 'Chakudya' : 'Chakudya-lookup:' + (apiSource || 'external'),
      barcodeSource:   barcode ? (isLocal ? 'Chakudya' : 'Chakudya-lookup') : undefined,
      barcodeMatch:    barcode ? 'exact' : undefined,
      confidenceScore: isLocal ? 0.97 : 0.75,
      lastUpdated:     null,
    };
  }

  /** GET /foods/lookup?q=... or ?barcode=...
   *  Already checks Chakudya's own DB first internally (source: 'local' /
   *  'local_packaged'), then falls through server-side to USDA/OFF/FatSecret
   *  only if nothing local matched. One HTTP call covers the whole cascade. */
  async function _lookupExternal({ q, barcode } = {}) {
    try {
      const params = new URLSearchParams();
      if (q)       params.set('q', q.trim());
      if (barcode) params.set('barcode', barcode.trim());
      const url = _MW_API + '/foods/lookup?' + params.toString();
      const res = await fetch(url, {
        signal:  _signal(8000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (json.status !== 'success' || !json.data) return null;
      return _lookupToUnified(json.data, { barcode: barcode || null, apiSource: json.source });
    } catch (_e) { return null; }
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

    // Layer 1 — Chakudya local database
    const mwResults = await _searchMW(query, multi ? limit : 5);
    if (mwResults.length) {
      const result = multi ? mwResults.slice(0, limit) : mwResults[0];
      _cache.set(cacheKey, result);
      return result;
    }

    // Layer 2 — Chakudya external cascade (USDA → OFF → FatSecret, server-side)
    const lookupResult = await _lookupExternal({ q: query });
    const result = multi ? (lookupResult ? [lookupResult] : []) : lookupResult;
    _cache.set(cacheKey, result);
    return result;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — BARCODE SEARCH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve a scanned barcode to a food object. Single call — /foods/lookup
   * checks Chakudya's own packaged DB first (source: 'local_packaged') and
   * only falls through to Open Food Facts server-side if there's no match.
   *
   * @param  {string} barcode  EAN-13 / UPC-A / GTIN-14
   * @returns {Promise<object|null>}
   */
  async function searchBarcode(barcode) {
    if (!barcode) return null;
    return await _lookupExternal({ barcode });
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
    _lookupExternal:  _lookupExternal,
  };

})(typeof window !== 'undefined' ? window : this);
