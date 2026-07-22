/**
 * thanzi-foodSearch.js — Thanzi Food Search Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TEXT SEARCH  (searchFood)
 *   Layer 1 — Chakudya API    Malawi FCT + packaged foods. Highest priority.
 *   Layer 2 — USDA FDC        Falls through when Chakudya returns nothing.
 *   Layer 3 — Open Food Facts  Last resort; also used to enrich sparse FDC results.
 *   Layer 4 — FatSecret        [placeholder — integrate later]
 *
 * BARCODE SEARCH  (searchBarcode)
 *   Layer 1 — Chakudya API    /packaged endpoint — exact EAN-13 lookup.
 *   Layer 2 — Open Food Facts  v2 barcode API. 7-day localStorage cache.
 *   Layer 3 — FatSecret        [placeholder — integrate later]
 *
 * OUTPUT SHAPE (unified food object)
 *   { id, name, brand?, cat, kcal, kj, pro, cho, fat,
 *     fiber?, sugar?, sodium?, salt?,
 *     measures?,          // from Chakudya when available
 *     unit,               // 'g' | 'mL'
 *     barcode?,           // barcode pipeline only
 *     barcodeSource?,     // 'Chakudya' | 'OFF'
 *     sourceUsed,         // 'Chakudya' | 'FDC' | 'OFF' | 'FDC+OFF'
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
  const _KEYS   = Object.freeze({
    fdc: 'GLO1YbLvrZomZCBqe8FgQtXlaujpRB20acobHSFQ',
  });

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
   * Used to enrich a sparse FDC result with OFF data.
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

  /** Barcode lookup — /packaged?barcode= */
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
      const kcal = d.energy_kcal ?? d.kcal ?? null;
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


  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 2 — USDA FOODDATA CENTRAL  (text search only)
  // ══════════════════════════════════════════════════════════════════════════

  async function _searchFDC(query) {
    try {
      const url = 'https://api.nal.usda.gov/fdc/v1/foods/search'
        + '?query='    + encodeURIComponent(query)
        + '&pageSize=3'
        + '&api_key='  + _KEYS.fdc;
      const res = await fetch(url, { signal: _signal() });
      if (!res.ok) return null;
      const data = await res.json();
      const food = data?.foods?.[0];
      if (!food) return null;
      const n    = (id) => food.foodNutrients?.find(x => x.nutrientId === id)?.value ?? null;
      const kcal = n(1008) ?? n(2047);
      return {
        id:              'fdc_' + food.fdcId,
        name:            food.description,
        cat:             food.foodCategory || 'Global',
        kcal,
        kj:              kcal != null ? +(kcal * 4.184).toFixed(0) : null,
        pro:             n(1003),
        cho:             n(1005),
        fat:             n(1004),
        fiber:           n(1079),
        sugar:           n(2000),
        sodium:          n(1093),
        unit:            'g',
        measures:        null,
        sourceUsed:      'FDC',
        confidenceScore: 0.60,
        lastUpdated:     food.publishedDate || null,
      };
    } catch (_e) { return null; }
  }


  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 3 — OPEN FOOD FACTS
  // Text search (_searchOFF) + barcode lookup (_fetchOFFBarcode).
  // ══════════════════════════════════════════════════════════════════════════

  /** Determine per-100 unit from OFF product metadata */
  function _offUnit(p) {
    if (!p) return 'g';
    if (p.nutrition_data_per === '100ml') return 'mL';
    const qu = (p.product_quantity_unit || '').toLowerCase();
    return (qu === 'ml' || qu === 'cl' || qu === 'l') ? 'mL' : 'g';
  }

  /** Extract a safe numeric value from OFF nutriments object */
  function _offN(nm) {
    return (id) => {
      const val = nm[id];
      return (val !== undefined && val !== null && val !== '')
        ? +parseFloat(val).toFixed(2) : null;
    };
  }

  /** Map an OFF product object → unified shape */
  function _offShape(p, barcode = null) {
    const nm   = p.nutriments || {};
    const n    = _offN(nm);
    // Try per-100g kcal first, then per-100g kJ→kcal, then fall back to
    // per-serving fields. Some packaged products in OFF only carry
    // serving-level nutriments (no *_100g fields at all), which previously
    // caused kcal to resolve to null and display as 0.
    let kcal = n('energy-kcal_100g');
    if (kcal == null && nm['energy_100g'] != null) {
      kcal = +(parseFloat(nm['energy_100g']) / 4.184).toFixed(1);
    }
    if (kcal == null) kcal = n('energy-kcal_serving');
    if (kcal == null && nm['energy_serving'] != null) {
      kcal = +(parseFloat(nm['energy_serving']) / 4.184).toFixed(1);
    }
    if (kcal == null) kcal = n('energy-kcal');
    if (kcal == null && nm['energy'] != null) {
      kcal = +(parseFloat(nm['energy']) / 4.184).toFixed(1);
    }
    const rawCat = p.categories_tags?.[0] || p.food_groups_tags?.[0] || '';
    return {
      id:              barcode ? 'off_' + barcode : 'off_' + _norm(p.product_name || ''),
      name:            (p.product_name || p.product_name_en || '').trim() || barcode || '',
      brand:           (p.brands || '').trim() || null,
      cat:             rawCat.replace(/^[a-z]{2}:/, '') || 'Open Food Facts',
      barcode:         barcode || null,
      kcal,
      kj:              n('energy_100g'),
      pro:             n('proteins_100g'),
      cho:             n('carbohydrates_100g'),
      fat:             n('fat_100g'),
      fiber:           n('fiber_100g'),
      sugar:           n('sugars_100g'),
      sodium:          n('sodium_100g'),
      salt:            n('salt_100g'),
      unit:            _offUnit(p),
      measures:        null,
      sourceUsed:      'OFF',
      confidenceScore: barcode ? 0.82 : 0.65,
      lastUpdated:     null,
    };
  }

  /** OFF name-based text search */
  async function _searchOFF(query) {
    try {
      const url = 'https://world.openfoodfacts.org/cgi/search.pl'
        + '?search_terms=' + encodeURIComponent(query.trim())
        + '&action=process&json=1&page_size=3'
        + '&fields=product_name,product_name_en,brands,categories_tags,'
        + 'food_groups_tags,nutrition_data_per,product_quantity_unit,nutriments';
      const res = await fetch(url, {
        signal:  _signal(8000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data?.products) || !data.products.length) return null;
      // Pick the first product with at least kcal
      const p = data.products.find(pr => {
        const nm = pr.nutriments || {};
        return nm['energy-kcal_100g'] != null || nm['energy_100g'] != null;
      }) || data.products[0];
      return p ? _offShape(p, null) : null;
    } catch (_e) { return null; }
  }

  // OFF barcode cache (7-day TTL, 50-entry cap)
  const _BC_CACHE_KEY = 'thanzi_bc_cache_v1';
  const _BC_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

  function _bcCacheGet(barcode) {
    try {
      const store = JSON.parse(localStorage.getItem(_BC_CACHE_KEY) || '{}');
      const entry = store[barcode];
      if (!entry) return null;
      if (Date.now() - entry.ts > _BC_CACHE_TTL) {
        delete store[barcode];
        localStorage.setItem(_BC_CACHE_KEY, JSON.stringify(store));
        return null;
      }
      return entry.data;
    } catch (_e) { return null; }
  }

  function _bcCacheSet(barcode, data) {
    try {
      const store = JSON.parse(localStorage.getItem(_BC_CACHE_KEY) || '{}');
      store[barcode] = { ts: Date.now(), data };
      const keys = Object.keys(store);
      if (keys.length > 50) delete store[keys[0]];
      localStorage.setItem(_BC_CACHE_KEY, JSON.stringify(store));
    } catch (_e) {}
  }

  /** OFF v2 barcode API — exact product lookup with localStorage cache */
  async function _fetchOFFBarcode(barcode) {
    const cached = _bcCacheGet(barcode);
    if (cached !== null) return cached;

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 12000);

    let r;
    try {
      r = await fetch(
        'https://world.openfoodfacts.org/api/v2/product/'
        + encodeURIComponent(barcode.trim())
        // 'nutriments' returns the whole nutriments object (all energy keys
        // included — per-100g, per-serving, and unprefixed). Listing
        // individual nutriment subfields here would silently drop the
        // serving-level fallback fields the parser now relies on.
        + '.json?fields=product_name,product_name_en,brands,categories_tags,'
        + 'food_groups_tags,nutrition_data_per,product_quantity_unit,nutriments',
        { signal: ctrl.signal, headers: { Accept: 'application/json' } }
      );
    } catch (err) {
      throw new Error(err.name === 'AbortError'
        ? 'Request timed out — check connection'
        : 'Network error: ' + (err.message || err));
    } finally {
      clearTimeout(tid);
    }

    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Open Food Facts returned ' + r.status);

    let d;
    try { d = await r.json(); }
    catch (_e) { throw new Error('Bad response from Open Food Facts'); }

    if (d.status !== 1 || !d.product) return null;

    const result = {
      ..._offShape(d.product, barcode),
      barcodeSource: 'OFF',
      barcodeMatch:  'exact',
    };
    _bcCacheSet(barcode, result);
    return result;
  }


  // ══════════════════════════════════════════════════════════════════════════
  // LAYER 4 — FATSECRET  [placeholder — integrate later]
  // ══════════════════════════════════════════════════════════════════════════

  // async function _searchFatSecret(query) { /* TODO */ return null; }
  // async function _fetchFatSecretBarcode(barcode) { /* TODO */ return null; }


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

    // Layer 1 — Chakudya
    const mwResults = await _searchMW(query, multi ? limit : 5);
    if (mwResults.length) {
      const result = multi ? mwResults.slice(0, limit) : mwResults[0];
      _cache.set(cacheKey, result);
      return result;
    }

    // Layer 2 — USDA FDC
    const fdcResult = await _searchFDC(query);
    if (fdcResult) {
      // Enrich with OFF when core macros are missing
      if (fdcResult.kcal == null || fdcResult.pro == null) {
        const offResult = await _searchOFF(query);
        const enriched  = offResult ? _merge(fdcResult, offResult) : fdcResult;
        const result    = multi ? [enriched] : enriched;
        _cache.set(cacheKey, result);
        return result;
      }
      const result = multi ? [fdcResult] : fdcResult;
      _cache.set(cacheKey, result);
      return result;
    }

    // Layer 3 — Open Food Facts
    const offResult = await _searchOFF(query);
    if (offResult) {
      const result = multi ? [offResult] : offResult;
      _cache.set(cacheKey, result);
      return result;
    }

    // Layer 4 — FatSecret [TODO]

    _cache.set(cacheKey, multi ? [] : null);
    return multi ? [] : null;
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

    // Layer 1 — Chakudya packaged foods
    const mwResult = await _searchMWBarcode(barcode);
    if (mwResult) return mwResult;

    // Layer 2 — Open Food Facts
    return await _fetchOFFBarcode(barcode);

    // Layer 3 — FatSecret [TODO]
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
    _fdcSearch:       _searchFDC,
    _offSearch:       _searchOFF,
    _fetchOFFBarcode: _fetchOFFBarcode,
  };

})(typeof window !== 'undefined' ? window : this);
