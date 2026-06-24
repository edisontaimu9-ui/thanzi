/**
 * thanzi-nutrition.js
 * Thanzi App — Full Nutrition Engine v1.0
 *
 * Modules: EER, Weight Management (lose/maintain/gain), Sports Performance,
 *          Bone Health, Aging (45-60), Adolescent/Young Adult (18-24),
 *          Oral Health, Micronutrient Flags, Food Recommendation Layer
 *
 * References: Krause & Mahan (14th ed), DRI/NASEM 2005-2019,
 *             ACSM/AND/DC Joint Position Stand 2016, WHO Guidelines
 *
 * Architecture: Pure client-side IIFE, no dependencies, vanilla JS (ES6)
 * Food APIs: Malawi FCT (local) → FatSecret → USDA FDC → Open Food Facts
 * Exposes:  window.ThanziNutrition
 *
 * Author: Built for Thanzi App — Malawi's first fitness app
 */

'use strict';

const ThanziNutrition = (() => {

  // ═══════════════════════════════════════════════════════════════════
  // SECTION 1 — CONSTANTS & DRI LOOKUP TABLES
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Physical Activity (PA) coefficients for DRI EER equations
   * Source: IOM/NASEM Dietary Reference Intakes, 2005
   */
  const PA_COEFFICIENTS = {
    M: { sedentary: 1.00, low_active: 1.11, active: 1.25, very_active: 1.48 },
    F: { sedentary: 1.00, low_active: 1.12, active: 1.27, very_active: 1.45 }
  };

  /**
   * Calcium DRI (mg/day) — NASEM 2011
   */
  function _calciumDRI(age, sex) {
    if (age <= 18) return 1300;
    if (age <= 50) return 1000;
    if (sex === 'F') return 1200;   // Post-menopausal female
    return 1000;                     // Male 51-70
  }

  /**
   * Vitamin D DRI (IU/day) — NASEM 2011
   */
  function _vitDDRI(age) {
    return age >= 70 ? 800 : 600;
  }

  /**
   * Iron DRI (mg/day) — NASEM 2001
   */
  function _ironDRI(age, sex) {
    if (sex === 'M') return 8;
    return age <= 50 ? 18 : 8;      // Pre/post-menopausal females
  }

  /**
   * Dietary Fiber AI (g/day) — NASEM 2005
   */
  function _fiberAI(age, sex) {
    if (sex === 'M') return age <= 50 ? 38 : 30;
    return age <= 50 ? 25 : 21;
  }

  /**
   * Total Water AI (L/day) — NASEM 2005
   */
  function _fluidAI(sex) {
    return sex === 'M' ? 3.7 : 2.7;
  }

  /**
   * Sport-specific protein ranges (g/kg BW/day)
   * Source: ACSM/AND/DC Position Stand 2016
   */
  const SPORT_PROTEIN_RANGES = {
    endurance:    { min: 1.2, max: 1.4 },
    strength:     { min: 1.6, max: 2.2 },
    team_sport:   { min: 1.4, max: 1.7 },
    power:        { min: 1.6, max: 2.0 },
    recreational: { min: 0.8, max: 1.0 }
  };

  /**
   * Sport-specific carbohydrate ranges (g/kg BW/day)
   * Source: ACSM/AND/DC Position Stand 2016
   */
  const SPORT_CARB_RANGES = {
    endurance:    { min: 5, max: 7 },   // heavy training: 7-10
    strength:     { min: 4, max: 7 },
    team_sport:   { min: 5, max: 7 },
    power:        { min: 5, max: 7 },
    recreational: { min: 3, max: 5 }
  };

  /**
   * Malawi-contextualised food sources mapped to API priority
   * source priority: 'local' (Malawi FCT) → 'fatsecret' → 'usda' → 'off'
   */
  const MALAWI_FOOD_SOURCES = {
    protein: [
      { name: 'Dagaa / Usipa (dried)', query: 'dagaa usipa', source: 'local',  note: 'High protein + calcium (eaten whole)' },
      { name: 'Kapenta',               query: 'kapenta',     source: 'local',  note: 'Protein + omega-3 fatty acids' },
      { name: 'Matemba',               query: 'matemba',     source: 'local',  note: 'Small fish, calcium-rich' },
      { name: 'Groundnut flour',        query: 'groundnut flour', source: 'local', note: 'Protein + healthy fats, affordable' },
      { name: 'Beans (boiled)',         query: 'beans boiled', source: 'local', note: 'Plant protein + fiber + iron' },
      { name: 'Eggs',                   query: 'egg',         source: 'fatsecret', note: 'Complete protein, all EAAs' },
      { name: 'Chicken (grilled)',      query: 'grilled chicken', source: 'fatsecret', note: 'Lean protein source' }
    ],
    carbs: [
      { name: 'Nsima (maize)',    query: 'nsima maize flour', source: 'local', note: 'Primary staple; portion-control for weight loss' },
      { name: 'Sweet potato',     query: 'sweet potato',      source: 'local', note: 'Carbs + beta-carotene, lower GI than nsima' },
      { name: 'Cassava (boiled)', query: 'cassava',           source: 'local', note: 'Energy-dense, low protein' },
      { name: 'Rice (cooked)',    query: 'rice cooked',       source: 'usda',  note: 'Easily digestible, good pre-workout' },
      { name: 'Banana',          query: 'banana',             source: 'fatsecret', note: 'Pre/post-workout carbs + potassium' },
      { name: 'Likuni Phala',    query: 'likuni phala',       source: 'local', note: 'Fortified maize-soya blend' }
    ],
    calcium: [
      { name: 'Dagaa / Usipa (dried)', query: 'dagaa',        source: 'local', note: 'Highest local calcium (eaten whole with bones)' },
      { name: 'Matemba',              query: 'matemba',        source: 'local', note: 'Calcium-rich small fish' },
      { name: 'Rape / Mustard leaves',query: 'rape leaves',   source: 'local', note: 'Plant-source calcium + iron' },
      { name: 'Milk (fresh/UHT)',     query: 'whole milk',    source: 'fatsecret', note: 'Bioavailable calcium + D + B12' },
      { name: 'Soybeans',            query: 'soybean',        source: 'usda',  note: 'Plant calcium for dairy-free users' }
    ],
    iron: [
      { name: 'Liver (beef/chicken)', query: 'chicken liver', source: 'fatsecret', note: 'Best bioavailable heme iron' },
      { name: 'Red beans',           query: 'red beans',      source: 'local', note: 'Non-heme iron — pair with vitamin C' },
      { name: 'Nchunga / Dark greens', query: 'pumpkin leaves', source: 'local', note: 'Iron + folate + vitamin C' },
      { name: 'Kapenta',             query: 'kapenta',         source: 'local', note: 'Iron + calcium' }
    ],
    healthy_fats: [
      { name: 'Groundnuts',  query: 'groundnuts raw',  source: 'local', note: 'Monounsaturated fats + protein + zinc' },
      { name: 'Avocado',     query: 'avocado',          source: 'fatsecret', note: 'Calorie-dense, heart-healthy fats' },
      { name: 'Sunflower oil', query: 'sunflower oil', source: 'usda',  note: 'Cooking fat, vitamin E' }
    ]
  };


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 2 — UTILITY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  function _round(n, dp = 0) {
    return parseFloat(n.toFixed(dp));
  }

  function _bmi(wt_kg, ht_m) {
    return _round(wt_kg / (ht_m * ht_m), 1);
  }

  function _bmiCategory(bmi) {
    if (bmi < 18.5) return 'Underweight';
    if (bmi < 25.0) return 'Normal weight';
    if (bmi < 30.0) return 'Overweight';
    return 'Obese';
  }

  /**
   * Ideal Body Weight — Devine formula (1974)
   * Male:   50 + 2.3 × (height_inches - 60)
   * Female: 45.5 + 2.3 × (height_inches - 60)
   */
  function _ibw(ht_m, sex) {
    const ht_in = ht_m * 39.3701;
    const base  = sex === 'M' ? 50 : 45.5;
    return _round(base + 2.3 * Math.max(0, ht_in - 60), 1);
  }

  /**
   * Adjusted Body Weight for obesity (BMI ≥ 30)
   * ABW = IBW + 0.25 × (Actual - IBW)
   */
  function _adjustedBW(actual_kg, ibw_kg) {
    return _round(ibw_kg + 0.25 * (actual_kg - ibw_kg), 1);
  }

  /**
   * Select the correct dosing weight for protein/nutrient calculations
   * - Normal/overweight: actual weight (capped at IBW × 1.20 to avoid over-prescribing)
   * - Obese (BMI ≥ 30): adjusted body weight
   */
  function _dosingWeight(actual_kg, ibw_kg, bmi) {
    if (bmi >= 30) return _adjustedBW(actual_kg, ibw_kg);
    return Math.min(actual_kg, ibw_kg * 1.2);
  }

  function _clamp(val, min, max) {
    return Math.min(Math.max(val, min), max);
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 3 — EER ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Estimated Energy Requirement (EER) — DRI 2005 equations
   *
   * Adult Male   (19+): EER = 662 − (9.53 × age) + PA × (15.91 × wt + 539.6 × ht)
   * Adult Female (19+): EER = 354 − (6.91 × age) + PA × (9.36 × wt + 726 × ht)
   *
   * Aging correction: REE declines ~7 kcal/year after age 50 due to
   * progressive sarcopenia — applied on top of the age term above.
   *
   * @param {number} age          - years (18–60)
   * @param {string} sex          - 'M' | 'F'
   * @param {number} wt_kg        - actual body weight in kg
   * @param {number} ht_m         - height in metres
   * @param {string} activity     - 'sedentary'|'low_active'|'active'|'very_active'
   * @returns {number}            - EER in kcal/day
   */
  function calcEER(age, sex, wt_kg, ht_m, activity) {
    const pa = PA_COEFFICIENTS[sex][activity] || PA_COEFFICIENTS[sex].sedentary;
    let eer;

    if (sex === 'M') {
      eer = 662 - (9.53 * age) + pa * (15.91 * wt_kg + 539.6 * ht_m);
    } else {
      eer = 354 - (6.91 * age) + pa * (9.36 * wt_kg + 726 * ht_m);
    }

    // Aging correction (Krause: energy needs decline ~100 kcal/decade post-50)
    if (age > 50) eer -= (age - 50) * 7;

    return _round(eer);
  }

  /**
   * Basal Metabolic Rate — Mifflin-St Jeor (1990)
   * Used as a cross-check reference in the assessment output.
   * Generally considered the most accurate predictive equation for adults.
   *
   * Male:   (10 × wt) + (6.25 × ht_cm) − (5 × age) + 5
   * Female: (10 × wt) + (6.25 × ht_cm) − (5 × age) − 161
   */
  function calcBMR(age, sex, wt_kg, ht_m) {
    const base = sex === 'M' ? 5 : -161;
    return _round((10 * wt_kg) + (6.25 * ht_m * 100) - (5 * age) + base);
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 4 — WEIGHT MANAGEMENT ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Weight goal engine
   *
   * Safety rules (Krause Chapter 20):
   *   - Max safe loss rate: 0.5–1.0 kg/week (500–1000 kcal/day deficit)
   *   - Minimum calorie floor: 1500 kcal (M), 1200 kcal (F) — below this
   *     risks micronutrient deficiency and lean mass loss
   *   - BMI < 18.5: override goal to 'maintain' regardless of user intent
   *   - Weight gain: 300–500 kcal/day surplus for lean mass gain
   *
   * @param {number} eer              - calculated EER kcal/day
   * @param {string} sex              - 'M' | 'F'
   * @param {number} bmi              - calculated BMI
   * @param {string} goal             - 'lose' | 'maintain' | 'gain'
   * @param {number} rate_kg_per_week - target rate 0.25–1.0 (default 0.5)
   * @returns {Object}
   */
  function weightEngine(eer, sex, bmi, goal, rate_kg_per_week = 0.5) {
    const MIN_KCAL = sex === 'M' ? 1500 : 1200;

    // Safety: clamp rate to evidence-based safe range
    const rate = _clamp(rate_kg_per_week, 0.25, 1.0);
    const daily_delta = _round((rate * 7700) / 7);   // 7700 kcal ≈ 1 kg fat

    // BMI-based override
    if (bmi < 18.5 && goal === 'lose') {
      return {
        eer_kcal: eer,
        target_kcal: eer,
        goal: 'maintain',
        goal_override: true,
        override_reason: 'BMI < 18.5 (underweight) — weight loss is contraindicated.',
        rate_kg_per_week: 0,
        note: 'Calories set to maintenance. Consider weight gain instead.'
      };
    }

    let target_kcal, note, actual_rate;

    switch (goal) {
      case 'lose': {
        const raw_target = eer - daily_delta;
        target_kcal = Math.max(raw_target, MIN_KCAL);
        const actual_deficit = eer - target_kcal;
        actual_rate = _round((actual_deficit * 7) / 7700, 2);
        note = target_kcal === MIN_KCAL
          ? `Calorie floor applied (${MIN_KCAL} kcal/day min). Actual deficit: ${actual_deficit} kcal → ~${actual_rate} kg/week`
          : `${daily_delta} kcal/day deficit → ~${rate} kg/week loss`;
        break;
      }
      case 'gain': {
        // Cap surplus at 500 kcal/day to minimise fat gain during bulk
        const surplus = Math.min(daily_delta, 500);
        target_kcal = eer + surplus;
        actual_rate = rate;
        note = `${surplus} kcal/day surplus → ~${_round((surplus * 7) / 7700, 2)} kg/week gain (lean mass focus)`;
        break;
      }
      default: // maintain
        target_kcal = eer;
        actual_rate = 0;
        note = 'Eating at maintenance (EER). Monitor weight monthly.';
    }

    return {
      eer_kcal: eer,
      target_kcal: _round(target_kcal),
      goal,
      goal_override: false,
      rate_kg_per_week: actual_rate,
      min_floor_applied: goal === 'lose' && target_kcal === MIN_KCAL,
      note
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 5 — MACRO ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Macronutrient distribution engine
   *
   * Protein targets (Krause + ACSM/AND):
   *   Maintenance sedentary : 0.8–1.0 g/kg
   *   Maintenance active    : 1.0–1.4 g/kg
   *   Weight loss           : 1.2–1.6 g/kg  (preserve lean mass during deficit)
   *   Weight gain (muscle)  : 1.6–2.2 g/kg
   *
   * Fat (AMDR): 20–35% of total kcal
   *   - Weight loss: lower end (25%) to preserve carb space for satiety
   *   - Gain: higher end (30%) for hormone support and calorie density
   *
   * Carbs: Remainder after protein + fat are allocated (by difference)
   *
   * Dosing weight: IBW for obese, actual for normal/overweight
   *
   * @returns {Object} macro breakdown in grams, kcal, and % of target
   */
  function macroEngine(target_kcal, wt_kg, ibw_kg, bmi, goal, activity) {
    const dw = _dosingWeight(wt_kg, ibw_kg, bmi);

    // Protein g/kg selection
    let pro_g_per_kg;
    if (goal === 'lose') {
      pro_g_per_kg = (activity === 'sedentary' || activity === 'low_active') ? 1.2 : 1.6;
    } else if (goal === 'gain') {
      pro_g_per_kg = 1.8;      // Mid-range of 1.6–2.2 for practical default
    } else {
      // Maintain
      pro_g_per_kg = (activity === 'very_active' || activity === 'active') ? 1.2 : 1.0;
    }

    const protein_g    = _round(dw * pro_g_per_kg);
    const protein_kcal = protein_g * 4;

    // Fat %
    const fat_pct  = goal === 'lose' ? 0.25 : goal === 'gain' ? 0.30 : 0.28;
    const fat_kcal = _round(target_kcal * fat_pct);
    const fat_g    = _round(fat_kcal / 9);

    // Carbs by difference
    const carb_kcal = _round(target_kcal - protein_kcal - fat_kcal);
    const carb_g    = _round(carb_kcal / 4);
    const carb_pct  = _round((carb_kcal / target_kcal) * 100, 1);

    // Validate AMDR (carbs should be 45–65%)
    const amdr_flag = carb_pct < 40
      ? 'Carbohydrate below AMDR lower limit — review protein or fat targets'
      : null;

    return {
      protein: {
        g: protein_g,
        kcal: protein_kcal,
        g_per_kg: pro_g_per_kg,
        pct: _round((protein_kcal / target_kcal) * 100, 1)
      },
      fat: {
        g: fat_g,
        kcal: fat_kcal,
        pct: _round(fat_pct * 100, 1)
      },
      carbs: {
        g: carb_g,
        kcal: carb_kcal,
        pct: carb_pct
      },
      dosing_weight_kg: dw,
      amdr_flag
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 6 — SPORTS NUTRITION ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Sports performance nutrition — ACSM/AND/DC Position Stand (2016)
   *
   * Covers:
   *   - Daily protein and carb targets by sport type
   *   - Pre / during / post-workout nutrition timing
   *   - Hydration strategy
   *   - Malawian food translations for each phase
   *
   * @param {number} wt_kg            - body weight in kg
   * @param {string} sport_type       - key in SPORT_PROTEIN_RANGES
   * @param {number} session_min      - session duration in minutes (default 60)
   * @returns {Object}
   */
  function sportsEngine(wt_kg, sport_type, session_min = 60) {
    const sp = SPORT_PROTEIN_RANGES[sport_type] || SPORT_PROTEIN_RANGES.recreational;
    const sc = SPORT_CARB_RANGES[sport_type]   || SPORT_CARB_RANGES.recreational;

    const protein = {
      min_g: _round(wt_kg * sp.min),
      max_g: _round(wt_kg * sp.max),
      g_per_kg: `${sp.min}–${sp.max} g/kg`,
      note: 'Distribute across 4–5 meals/snacks; 20–40g per meal for max MPS'
    };

    const carbs = {
      min_g_day: _round(wt_kg * sc.min),
      max_g_day: _round(wt_kg * sc.max),
      g_per_kg: `${sc.min}–${sc.max} g/kg/day`,
      heavy_training_note: sport_type === 'endurance'
        ? 'Heavy endurance training (>90 min/day): increase to 7–10 g/kg'
        : null
    };

    // Peri-workout timing windows
    const timing = {
      pre_workout: {
        window: '1–4 hours before exercise',
        carbs_g: `${_round(wt_kg * 1)}–${_round(wt_kg * 4)} g`,
        protein_g: '10–20 g (optional, improves MPS)',
        fat: 'Low-fat meal — fat slows gastric emptying',
        local_foods: [
          'Nsima (small portion) + beans',
          'Banana + groundnut butter (1 tbsp)',
          'Sweet potato + egg (boiled)',
          'Rice porridge (thobwa) with milk'
        ],
        note: 'Large meal 3–4 hr before; small snack only 30–60 min before'
      },
      during: session_min > 60 ? {
        window: 'Every 15–20 min for sessions > 60 min',
        carbs_g_per_hr: '30–60 g/hour',
        fluids_ml_per_hr: '400–800 mL/hour',
        local_foods: [
          'Banana (1 medium = ~27g carbs)',
          'Sugar cane (natural glucose)',
          'ORS / homemade sports drink (water + sugar + pinch of salt)'
        ],
        note: 'Multiple carb sources (glucose + fructose) improve absorption at high rates'
      } : {
        note: `Session duration (${session_min} min) < 60 min — water only is sufficient during exercise`
      },
      post_workout: {
        window: 'Within 30 minutes (critical anabolic window)',
        carbs_g: `${_round(wt_kg * 1.0)}–${_round(wt_kg * 1.5)} g`,
        protein_g: `${_round(wt_kg * 0.25)}–${_round(wt_kg * 0.3)} g`,
        carb_protein_ratio: '3:1 (carb:protein) for glycogen + muscle repair',
        local_foods: [
          'Milk + banana (ideal ratio)',
          'Groundnut porridge with milk',
          'Eggs + nsima',
          'Kapenta + rice',
          'Likuni Phala made with milk'
        ]
      }
    };

    // Hydration strategy (ACSM 2017)
    const hydration = {
      pre_exercise: `${_round(wt_kg * 5)}–${_round(wt_kg * 7)} mL — drink 4 hours before`,
      during: '400–800 mL per hour (drink to thirst; do not over-hydrate)',
      post_exercise: '1.5 L per kg of body weight lost in sweat',
      urine_target: 'Pale yellow urine = adequate hydration',
      malawi_note: 'High heat and humidity in Malawi increase sweat losses — increase to upper end of range during hot season'
    };

    return { sport_type, protein, carbs, timing, hydration };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 7 — BONE HEALTH ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Bone health assessment and risk scoring
   *
   * Risk factors assessed (Krause Chapter 24):
   *   - Calcium intake adequacy
   *   - Vitamin D / sun exposure
   *   - Weight-bearing exercise
   *   - Female age ≥ 45 (perimenopause → accelerated bone resorption)
   *
   * Risk score: 0–5 → Low (<2) / Moderate (2–3) / High (4–5)
   *
   * @param {number} age
   * @param {string} sex
   * @param {Object} inputs - { dairy_servings_day, sun_exposure, weight_bearing_activity }
   * @returns {Object}
   */
  function boneHealthEngine(age, sex, inputs = {}) {
    const {
      dairy_servings_day   = 0,       // number (1 serving ≈ 240mL milk or equivalent)
      sun_exposure          = 'moderate', // 'low' | 'moderate' | 'high'
      weight_bearing_activity = true   // boolean (walking, running, strength training)
    } = inputs;

    const ca_target = _calciumDRI(age, sex);
    const vd_target = _vitDDRI(age);

    // Estimate calcium from dairy (1 serving ≈ 300mg Ca)
    // Non-dairy local sources (dagaa, greens) are prompted separately
    const ca_from_dairy = dairy_servings_day * 300;
    const ca_gap_mg     = Math.max(0, ca_target - ca_from_dairy);
    const ca_pct_met    = _round((ca_from_dairy / ca_target) * 100, 0);

    // Risk scoring
    let risk_score = 0;
    const risk_flags = [];

    if (ca_from_dairy < ca_target * 0.70) {
      risk_score += 2;
      risk_flags.push(`Low calcium intake (~${ca_from_dairy}mg vs ${ca_target}mg target)`);
    }
    if (sun_exposure === 'low') {
      risk_score += 1;
      risk_flags.push('Low sun exposure → likely vitamin D insufficiency');
    }
    if (!weight_bearing_activity) {
      risk_score += 1;
      risk_flags.push('No weight-bearing exercise (critical for bone density maintenance)');
    }
    if (sex === 'F' && age >= 45) {
      risk_score += 1;
      risk_flags.push('Female ≥ 45 years: oestrogen decline → accelerated bone resorption');
    }

    const risk_level = risk_score <= 1 ? 'Low'
                     : risk_score <= 3 ? 'Moderate'
                     : 'High';

    return {
      calcium: {
        target_mg: ca_target,
        estimated_from_dairy_mg: ca_from_dairy,
        gap_mg: ca_gap_mg,
        percent_met: ca_pct_met,
        local_sources: MALAWI_FOOD_SOURCES.calcium,
        tip: 'Dagaa eaten whole is the richest local calcium source in Malawi — include 2–3 times per week'
      },
      vitamin_d: {
        target_iu: vd_target,
        malawi_sun_note: 'Malawi has excellent solar UVB — 15–20 min midday sun on arms and legs is usually sufficient for vitamin D synthesis',
        supplement_flag: sun_exposure === 'low'
      },
      risk_score,
      risk_level,
      risk_flags,
      recommendation: {
        High:     'Consult a health professional. Consider bone density assessment (DXA if available). Supplement calcium and vitamin D.',
        Moderate: 'Increase calcium-rich foods (especially dagaa). Ensure daily sun exposure. Add resistance exercise 3×/week.',
        Low:      'Maintain current bone-protective habits. Reassess annually.'
      }[risk_level]
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 8 — AGING MODULE (45–60)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Age-specific nutrition adjustments for 45–60 year olds
   *
   * Key changes (Krause Chapter 19):
   *   - Sarcopenia: ~1% muscle lost/year after 50 → higher protein needed
   *   - Energy needs decline (lower RMR + reduced NEAT)
   *   - B12 absorption decreases (gastric acid secretion declines)
   *   - Female 51+: calcium need increases to 1200mg
   *   - Thirst mechanism blunted → dehydration risk
   *
   * @returns {Object|null} - null if age < 45
   */
  function agingModule(age, sex) {
    if (age < 45) return null;

    return {
      age_group: '45–60',
      key_adjustments: {
        energy:   'EER decreases due to declining lean mass; avoid excess restriction to prevent further muscle loss',
        protein:  '1.0–1.2 g/kg/day (higher than 0.8 g/kg young adult RDA) — preserves muscle mass (sarcopenia prevention)',
        calcium:  sex === 'F' && age >= 51
                    ? '1200mg/day (increased from 1000mg at menopause — bone protection)'
                    : '1000mg/day',
        vitamin_d: '600 IU/day via sun + food; critical for calcium absorption at this age',
        fiber:    `${_fiberAI(age, sex)}g/day — bowel health, cholesterol, blood glucose regulation`,
        fluid:    `${_round(_fluidAI(sex) * 1000)} mL/day minimum — thirst sensation diminishes with age; schedule fluid intake`
      },
      special_flags: [
        'Vitamin B12 (2.4 µg/day): absorption declines with age → consider fortified foods or supplement',
        'Resistance training 2–3×/week alongside adequate protein is the best sarcopenia prevention',
        sex === 'F' ? 'Iron: requirement decreases to 8mg/day post-menopause' : null,
        'Screen for hypertension: reduce sodium <2300mg/day; increase potassium (fruits, vegetables)',
        'Blood glucose: reduce refined carbs; choose lower-GI options (sweet potato, legumes over white nsima)'
      ].filter(Boolean)
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 9 — ADOLESCENT / YOUNG ADULT MODULE (18–24)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Young adult nutrition flags (18–24 years)
   *
   * Key facts (Krause Chapter 17):
   *   - Peak bone mass accrual continues until ~25 → critical calcium window
   *   - Female: iron needs highest (18mg/day) due to menstruation
   *   - Zinc: supports growth, immune function, reproductive health
   *   - Folate essential for all reproductive-age females
   *   - Higher protein needs than adult RDA during this growth completion phase
   *
   * @returns {Object|null} - null if age > 24
   */
  function adolescentModule(age, sex) {
    if (age > 24) return null;

    const flags = [
      `Calcium: ${_calciumDRI(age, sex)}mg/day — peak bone mass accumulation continues until ~age 25`,
      `Protein: 0.85 g/kg/day — slightly higher than later adult RDA to support final growth`,
      `Zinc: ${sex === 'M' ? '11mg' : '8mg'}/day — growth, immunity, wound healing`
    ];

    if (sex === 'F') {
      flags.push('Iron: 18mg/day — menstrual blood loss significantly increases requirement');
      flags.push('Folate: 400 µg/day — critical for all females of reproductive age (neural tube protection)');
    }

    return {
      age_group: '18–24 (Young Adult)',
      flags,
      local_focus: [
        'Encourage variety beyond nsima + one relish — diversify protein and vegetable sources',
        'Dagaa 3× per week covers both calcium and protein needs affordably',
        sex === 'F' ? 'Pair beans/greens (non-heme iron) with tomatoes/guava (vitamin C) at the same meal' : null
      ].filter(Boolean)
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 10 — ORAL HEALTH ENGINE
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Oral health / dental caries risk scoring
   *
   * Key Krause principle (Chapter 26):
   *   Frequency of sugar exposure > total sugar amount for caries risk.
   *   Each sugary exposure drops plaque pH below 5.5 → demineralisation.
   *
   * @param {Object} inputs - diet behaviour inputs
   * @returns {Object}
   */
  function oralHealthEngine(inputs = {}) {
    const {
      sugary_drink_times      = 0,   // times/day
      sweet_snack_times       = 0,   // times/day
      water_as_main_drink     = true,
      fruit_veg_servings      = 0
    } = inputs;

    const total_exposures = sugary_drink_times + sweet_snack_times;

    const risk = total_exposures >= 5 ? 'High'
               : total_exposures >= 3 ? 'Moderate'
               : 'Low';

    const notes = [];
    if (total_exposures >= 5) {
      notes.push('Reduce sugary drink and snack frequency — limit to mealtimes only');
      notes.push('Each sugary drink/snack is a separate acid attack on enamel — frequency matters more than amount');
    } else if (total_exposures >= 3) {
      notes.push('Consolidate sweet foods/drinks to mealtimes to reduce acid exposure episodes');
    }
    if (!water_as_main_drink) {
      notes.push('Switch main beverage to water — fluoridated water where available strengthens enamel');
    }
    if (fruit_veg_servings < 5) {
      notes.push('Increase fruit and vegetable intake — antioxidants and vitamins support gum health');
    }

    // Tooth-protective nutrients
    const protective_nutrients = [
      {
        nutrient: 'Calcium + Phosphorus',
        role: 'Enamel remineralisation after acid attacks',
        sources: ['Milk', 'Dagaa (whole)', 'Cheese', 'Kapenta']
      },
      {
        nutrient: 'Vitamin C',
        role: 'Collagen synthesis for gum health; deficiency → gingivitis',
        sources: ['Guava', 'Tomatoes', 'Baobab fruit', 'Citrus']
      },
      {
        nutrient: 'Fluoride',
        role: 'Enamel hardening and remineralisation',
        sources: ['Fluoridated water', 'Tea (where fluoride content is adequate)']
      },
      {
        nutrient: 'Vitamin D',
        role: 'Supports calcium absorption for bone/tooth mineralisation',
        sources: ['Sunlight (primary in Malawi)', 'Kapenta', 'Egg yolk']
      }
    ];

    return {
      cariogenic_exposures_per_day: total_exposures,
      risk_level: risk,
      notes,
      protective_nutrients,
      tip: 'Rinse with water after sugary foods; wait 30 min before brushing (enamel temporarily softened)'
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 11 — MICRONUTRIENT FLAGS
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generate prioritised micronutrient flags based on user profile.
   * Flags are tagged High / Medium priority for UI rendering.
   *
   * @returns {Array<Object>} sorted High → Medium
   */
  function micronutrientFlags(age, sex, goal) {
    const flags = [];

    // Iron — always flag for pre-menopausal females
    if (sex === 'F' && age <= 50) {
      flags.push({
        nutrient: 'Iron',
        target: `${_ironDRI(age, sex)} mg/day`,
        priority: 'high',
        note: 'Menstrual blood loss — include iron-rich foods daily; pair plant sources with vitamin C',
        sources: MALAWI_FOOD_SOURCES.iron,
        query_hint: 'liver OR kapenta OR beans'   // for food search API
      });
    }

    // Calcium
    flags.push({
      nutrient: 'Calcium',
      target: `${_calciumDRI(age, sex)} mg/day`,
      priority: age >= 45 ? 'high' : 'medium',
      note: age >= 45 ? 'Increased need; bone loss accelerates in this age group' : 'Peak bone mass window',
      sources: MALAWI_FOOD_SOURCES.calcium,
      query_hint: 'dagaa OR milk OR kapenta'
    });

    // Vitamin D
    flags.push({
      nutrient: 'Vitamin D',
      target: `${_vitDDRI(age)} IU/day`,
      priority: 'medium',
      note: 'Malawi sun exposure usually adequate. 15–20 min midday sun on arms + legs daily.',
      query_hint: 'egg yolk OR kapenta'
    });

    // B12 for 50+
    if (age >= 50) {
      flags.push({
        nutrient: 'Vitamin B12',
        target: '2.4 µg/day',
        priority: 'high',
        note: 'Gastric acid secretion declines with age — reduced B12 absorption. Consider supplement or fortified food.',
        query_hint: 'liver OR beef OR kapenta OR eggs'
      });
    }

    // Folate for reproductive-age females
    if (sex === 'F' && age <= 45) {
      flags.push({
        nutrient: 'Folate',
        target: '400 µg/day',
        priority: 'medium',
        note: 'Dark leafy greens (nchunga, rape), legumes, fortified flour',
        query_hint: 'pumpkin leaves OR rape OR beans'
      });
    }

    // Zinc — weight loss risk
    if (goal === 'lose') {
      flags.push({
        nutrient: 'Zinc',
        target: sex === 'M' ? '11 mg/day' : '8 mg/day',
        priority: 'medium',
        note: 'Caloric restriction diets risk zinc inadequacy — include legumes, nuts, meat',
        query_hint: 'groundnuts OR beans OR beef'
      });
    }

    // Potassium — general cardiovascular
    if (age >= 40) {
      flags.push({
        nutrient: 'Potassium',
        target: sex === 'M' ? '3400 mg/day' : '2600 mg/day',
        priority: 'medium',
        note: 'Supports blood pressure regulation; increases in fruit and vegetable intake',
        query_hint: 'banana OR sweet potato OR beans'
      });
    }

    // Sort: high first
    return flags.sort((a, b) => (a.priority === 'high' ? -1 : 1));
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 12 — FOOD RECOMMENDATION LAYER
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Food recommendation layer
   *
   * Returns structured food suggestions with API routing hints.
   * The actual food lookup is done by the calling app using its
   * existing food search infrastructure:
   *   Layer 1: Malawi FCT (local foods)
   *   Layer 2: FatSecret API
   *   Layer 3: USDA FDC
   *   Layer 4: Open Food Facts
   *
   * @returns {Object}
   */
  function foodRecommendations(goal, sex, age) {
    const tips = [];

    if (goal === 'gain') {
      tips.push('Add groundnut butter (PB) to porridge — ~100 kcal + 4g protein per tablespoon');
      tips.push('Cook nsima in milk instead of water for extra calories and protein');
      tips.push('Include avocado daily — calorie-dense, micronutrient-rich');
      tips.push('Eat 5–6 smaller meals per day — easier to hit a surplus than 3 large meals');
      tips.push('Post-workout: milk + banana within 30 min for muscle protein synthesis');
    } else if (goal === 'lose') {
      tips.push('Prioritise high-volume low-calorie foods: vegetables, greens, clear soups');
      tips.push('Control nsima portions: 1 cup cooked per meal (200–250 kcal)');
      tips.push('Cooking method: boil, grill, or steam rather than fry');
      tips.push('Protein at every meal increases satiety and preserves muscle in a deficit');
      tips.push('Eat slowly — satiety signals take 15–20 min to reach the brain');
    } else {
      tips.push('Aim for variety: different coloured vegetables, different protein sources each week');
      tips.push('The Malawian plate: ½ vegetables/relish, ¼ nsima, ¼ protein (fish/beans/meat)');
    }

    return {
      primary_sources: MALAWI_FOOD_SOURCES,
      api_priority: ['local (Malawi FCT)', 'fatsecret', 'usda_fdc', 'open_food_facts'],
      routing_note: 'Query Malawi FCT first for any local food name. Fall back to FatSecret → USDA → OFF for packaged/international foods.',
      practical_tips: tips
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // SECTION 13 — MASTER generate() FUNCTION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Main entry point — generates a complete nutrition plan for a user.
   *
   * @param {Object} profile - User profile object
   * @param {number} profile.age               - 18–60
   * @param {string} profile.sex               - 'M' | 'F'
   * @param {number} profile.weight_kg         - actual body weight
   * @param {number} profile.height_m          - height in metres
   * @param {string} profile.activity_level    - 'sedentary'|'low_active'|'active'|'very_active'
   * @param {string} profile.goal              - 'lose'|'maintain'|'gain'
   * @param {number} [profile.rate_kg_per_week]- target loss/gain rate (0.25–1.0)
   * @param {string} [profile.sport_type]      - 'endurance'|'strength'|'team_sport'|'power'|'recreational'
   * @param {number} [profile.session_min]     - workout session duration in minutes
   * @param {Object} [profile.bone_inputs]     - { dairy_servings_day, sun_exposure, weight_bearing_activity }
   * @param {Object} [profile.oral_inputs]     - { sugary_drink_times, sweet_snack_times, water_as_main_drink, fruit_veg_servings }
   *
   * @returns {Object} Full nutrition plan | { error: string }
   */
  function generate(profile) {
    const {
      age, sex, weight_kg, height_m, activity_level, goal,
      rate_kg_per_week, sport_type, session_min,
      bone_inputs, oral_inputs
    } = profile;

    // ── Validation ──
    const missing = ['age','sex','weight_kg','height_m','activity_level','goal']
      .filter(k => profile[k] === undefined || profile[k] === null || profile[k] === '');
    if (missing.length) return { error: `Missing required fields: ${missing.join(', ')}` };
    if (age < 18 || age > 60) return { error: 'Thanzi engine targets ages 18–60' };
    if (!['M','F'].includes(sex)) return { error: "sex must be 'M' or 'F'" };
    if (!['lose','maintain','gain'].includes(goal)) return { error: "goal must be 'lose' | 'maintain' | 'gain'" };
    if (!PA_COEFFICIENTS[sex][activity_level]) return { error: "activity_level must be 'sedentary'|'low_active'|'active'|'very_active'" };

    // ── Core assessment ──
    const bmi    = _bmi(weight_kg, height_m);
    const ibw    = _ibw(height_m, sex);
    const bmr    = calcBMR(age, sex, weight_kg, height_m);
    const eer    = calcEER(age, sex, weight_kg, height_m, activity_level);

    // ── Goal + energy ──
    const weight = weightEngine(eer, sex, bmi, goal, rate_kg_per_week);
    const eff_goal = weight.goal;  // may be overridden (e.g. underweight → maintain)

    // ── Macros ──
    const macros = macroEngine(
      weight.target_kcal, weight_kg, ibw, bmi, eff_goal, activity_level
    );

    // ── Micronutrients + food recs ──
    const micros = micronutrientFlags(age, sex, eff_goal);
    const foods  = foodRecommendations(eff_goal, sex, age);

    // ── Optional sport module ──
    const sports = sport_type
      ? sportsEngine(weight_kg, sport_type, session_min)
      : null;

    // ── Bone health ──
    const bone   = boneHealthEngine(age, sex, bone_inputs || {});

    // ── Age-specific modules ──
    const aging  = agingModule(age, sex);
    const youth  = adolescentModule(age, sex);

    // ── Oral health ──
    const oral   = oral_inputs ? oralHealthEngine(oral_inputs) : null;

    // ── Assemble final output ──
    return {
      _meta: {
        engine: 'ThanziNutrition v1.0',
        app: 'Thanzi — Malawi\'s First Fitness App',
        reference: 'Krause & Mahan 14th Ed | DRI/NASEM | ACSM/AND 2016 | WHO',
        generated_at: new Date().toISOString()
      },

      assessment: {
        bmi,
        bmi_category: _bmiCategory(bmi),
        ibw_kg: ibw,
        bmr_kcal: bmr,
        eer_kcal: eer
      },

      energy: {
        eer_kcal:          weight.eer_kcal,
        target_kcal:       weight.target_kcal,
        goal:              eff_goal,
        goal_override:     weight.goal_override || false,
        override_reason:   weight.override_reason || null,
        rate_kg_per_week:  weight.rate_kg_per_week,
        note:              weight.note,
        min_floor_applied: weight.min_floor_applied || false
      },

      macros,

      micronutrients: {
        fiber_g:   _fiberAI(age, sex),
        fluid_L:   _fluidAI(sex),
        flags:     micros
      },

      food_recommendations: foods,

      modules: {
        sports:       sports,
        bone_health:  bone,
        aging:        aging,
        young_adult:  youth,
        oral_health:  oral
      }
    };
  }


  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  return {
    // ── Master function ──
    generate,

    // ── Individual engines (granular access for partial use) ──
    calcEER,
    calcBMR,
    weightEngine,
    macroEngine,
    sportsEngine,
    boneHealthEngine,
    agingModule,
    adolescentModule,
    oralHealthEngine,
    micronutrientFlags,
    foodRecommendations,

    // ── Raw data (for UI dropdowns, food search routing, etc.) ──
    MALAWI_FOOD_SOURCES,
    SPORT_PROTEIN_RANGES,
    SPORT_CARB_RANGES,

    // ── Utility functions ──
    utils: {
      bmi:         _bmi,
      bmiCategory: _bmiCategory,
      ibw:         _ibw,
      round:       _round
    }
  };

})();

// ── Expose globally (consistent with Oasis CNST architecture) ──
window.ThanziNutrition = ThanziNutrition;


/* ═══════════════════════════════════════════════════════════════════
 * USAGE EXAMPLES
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1. Full plan — weight loss:
 *
 *    const plan = ThanziNutrition.generate({
 *      age: 28, sex: 'F', weight_kg: 72, height_m: 1.62,
 *      activity_level: 'active', goal: 'lose', rate_kg_per_week: 0.5,
 *      bone_inputs: { dairy_servings_day: 1, sun_exposure: 'moderate', weight_bearing_activity: true },
 *      oral_inputs: { sugary_drink_times: 2, sweet_snack_times: 1, water_as_main_drink: true, fruit_veg_servings: 3 }
 *    });
 *    console.log(plan.energy.target_kcal);  // e.g. 1750
 *    console.log(plan.macros.protein.g);    // e.g. 92
 *
 * 2. Sports athlete — strength training:
 *
 *    const plan = ThanziNutrition.generate({
 *      age: 22, sex: 'M', weight_kg: 80, height_m: 1.78,
 *      activity_level: 'very_active', goal: 'gain', rate_kg_per_week: 0.3,
 *      sport_type: 'strength', session_min: 75
 *    });
 *    console.log(plan.modules.sports.timing.post_workout.local_foods);
 *
 * 3. Individual engine — EER only:
 *
 *    const eer = ThanziNutrition.calcEER(45, 'F', 68, 1.60, 'low_active');
 *
 * 4. Food source routing — query hint for search API:
 *
 *    const micros = plan.micronutrients.flags;
 *    micros.forEach(flag => {
 *      // Use flag.query_hint to search MalawiFC / FatSecret / USDA
 *      foodSearch(flag.query_hint, flag.sources[0].source);
 *    });
 *
 * ═══════════════════════════════════════════════════════════════════ */
