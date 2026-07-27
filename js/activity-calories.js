/**
 * activity-calories.js — Thanzi Activity Calorie Reference
 *
 * Source: Krause & Mahan's Food & the Nutrition Care Process, 16th ed.,
 * Appendix 10 "Physical Activity and Calories Expended Per Hour"
 * (data compiled by HealtheTech Inc., 2001; original source Hammond K,
 * Nurs Clin North Am 32(4):779–790, 1997).
 *
 * Provides a fast, offline, weight-accurate calorie lookup for common
 * activities — used by exercise.js as the primary estimation path before
 * falling back to the AI parser or the flat-MET guess.
 *
 * Table columns are kcal/hour at reference body weights: 110, 130, 150,
 * 170, 190, 210, 230, 250 lb. Values are exactly as published; a few
 * entries in the source table are non-monotonic (e.g. the 130 lb column
 * dips below the 110 lb column for a handful of rows) — kept verbatim
 * rather than "corrected", since altering source data risks introducing
 * new errors.
 */
const ThanziActivityCalories = (() => {
  'use strict';

  const LB_COLUMNS = [110, 130, 150, 170, 190, 210, 230, 250];

  // [ activityName, type, [kcal/hr @ 110,130,150,170,190,210,230,250 lb] ]
  const TABLE = [
    ['Aerobics class', 'Water', [210, 248, 286, 325, 364, 401, 439, 477]],
    ['Aerobics class', 'Low impact', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Aerobics class', 'High impact', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Aerobics class', 'Step with 6- to 8-inch step', [446, 527, 609, 690, 774, 852, 933, 1014]],
    ['Aerobics class', 'Step with 10- to 12-inch step', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Backpack', 'General', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Badminton', 'Singles and doubles', [236, 279, 322, 365, 410, 451, 494, 537]],
    ['Badminton', 'Competitive', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Baseball', 'Throw, catch', [131, 155, 179, 203, 228, 251, 274, 298]],
    ['Baseball', 'Fast or slow pitch', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Basketball', 'Shooting baskets', [236, 279, 322, 365, 410, 451, 494, 537]],
    ['Basketball', 'Wheelchair', [341, 403, 465, 528, 592, 652, 713, 775]],
    ['Basketball', 'Game', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Bike', '10-11.9 mph, slow', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Bike', '12-13.9 mph, moderate', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Bike', '14-15.9 mph, fast', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Bike', '16-19.9 mph, very fast', [630, 745, 859, 974, 1092, 1203, 1317, 1431]],
    ['Bike', '>20 mph, racing', [840, 993, 1146, 1299, 1457, 1604, 1756, 1908]],
    ['Bike', '50 watts, stationary, very light', [158, 133, 215, 243, 273, 301, 329, 358]],
    ['Bike', '100 watts, stationary, light', [289, 341, 394, 446, 501, 552, 603, 656]],
    ['Bike', '150 watts, stationary, moderate', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Bike', '200 watts, stationary, vigorous', [551, 652, 752, 852, 956, 1053, 1152, 1252]],
    ['Bike', '250 watts, stationary, very vigorous', [656, 776, 895, 1015, 1138, 1253, 1372, 1491]],
    ['Bike', 'BMX or mountain', [446, 527, 609, 690, 774, 852, 933, 1014]],
    ['Boxing', 'Punching bag', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Boxing', 'Sparring', [473, 558, 644, 730, 819, 902, 988, 1074]],
    ['Calisthenics', 'Back exercises', [184, 217, 251, 284, 319, 351, 384, 417]],
    ['Calisthenics', 'Pull-ups, jumping jacks', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Calisthenics', 'Push-ups or sit-ups', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Circuit training', 'General', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Football', 'Flag or touch', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Football', 'Competitive', [473, 558, 644, 730, 819, 902, 988, 1074]],
    ['Frisbee', 'General', [158, 133, 215, 243, 273, 301, 329, 358]],
    ['Frisbee', 'Ultimate', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Golf', 'Power cart', [184, 217, 251, 284, 319, 351, 384, 417]],
    ['Golf', 'Pull clubs', [226, 267, 308, 349, 391, 431, 472, 513]],
    ['Golf', 'Carry clubs', [236, 279, 322, 365, 410, 451, 494, 537]],
    ['Handball', 'General', [630, 745, 859, 974, 1092, 1203, 1317, 1431]],
    ['Hike', 'General', [315, 372, 460, 487, 546, 602, 658, 716]],
    ['Hockey', 'Ice, field hockey', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Jog', 'General', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Jog', 'Jog-walk combination', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Jump rope', 'Slow', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Jump rope', 'Moderate', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Jump rope', 'Fast', [630, 745, 859, 974, 1092, 1203, 1317, 1431]],
    ['Kayak', 'General', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Martial arts', 'General', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Racquetball', 'Casual', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Racquetball', 'Competition', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Rafting', 'White water', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Rock climb', 'General', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Rugby', 'General', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Run', '5 mph, 12 min/mile', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Run', '5.2 mph, 11.5 min/mile', [473, 558, 644, 730, 819, 902, 988, 1074]],
    ['Run', '6 mph, 10 min/mile', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Run', '6.7 mph, 9 min/mile', [578, 683, 788, 893, 1001, 1103, 1207, 1312]],
    ['Run', '7 mph, 8.5 min/mile', [604, 714, 824, 933, 1047, 1153, 1262, 1372]],
    ['Run', '7.5 mph, 8 min/mile', [656, 776, 895, 1015, 1138, 1253, 1372, 1491]],
    ['Run', '8 mph, 7.5 min/mile', [709, 838, 967, 1096, 1229, 1354, 1481, 1610]],
    ['Run', '8.6 mph, 7 min/mile', [735, 869, 1003, 1136, 1274, 1404, 1536, 1670]],
    ['Run', '9 mph, 6.5 min/mile', [788, 931, 1074, 1217, 1366, 1504, 1646, 1789]],
    ['Run', '10 mph, 6 min/mile', [840, 993, 1146, 1299, 1457, 1604, 1756, 1908]],
    ['Run', '10.9 mph, 5.5 min/mile', [945, 1117, 1289, 1461, 1639, 1805, 1975, 2147]],
    ['Run', 'Cross country', [473, 558, 644, 730, 819, 902, 988, 1074]],
    ['Skate, ice', 'General', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Skate, inline', 'Inline, general', [656, 776, 895, 1015, 1138, 1253, 1372, 1491]],
    ['Skateboard', 'General', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Ski, downhill', 'Light', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Ski, downhill', 'Moderate', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Ski, downhill', 'Vigorous, race', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Ski machine', 'General', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Ski, cross-country', '2.5 mph, slow', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Ski, cross-country', '4-4.9 mph, moderate', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Ski, cross-country', '5-7.9 mph, brisk', [473, 558, 644, 730, 819, 902, 988, 1074]],
    ['Snowboard', 'General', [394, 465, 537, 609, 683, 752, 823, 895]],
    ['Snowshoe', 'General', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Soccer', 'Casual', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Soccer', 'Competitive', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Softball', 'General', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Stair stepper', 'General', [473, 558, 644, 730, 819, 902, 988, 1074]],
    ['Stationary rower', '50 watts, light', [184, 217, 251, 284, 319, 351, 384, 417]],
    ['Stationary rower', '100 watts, moderate', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Stationary rower', '150 watts, vigorous', [446, 527, 609, 690, 774, 852, 933, 1014]],
    ['Stationary rower', '200 watts, very vigorous', [630, 745, 859, 974, 1092, 1203, 1317, 1431]],
    ['Stretch, yoga', 'General, hatha', [131, 155, 179, 203, 228, 251, 274, 298]],
    ['Swim', 'Lake, ocean, or river', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Swim', 'Laps freestyle, slow or moderate', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Swim', 'Laps freestyle, fast', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Swim', 'Backstroke', [368, 434, 501, 568, 637, 702, 768, 835]],
    ['Swim', 'Sidestroke', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Swim', 'Breaststroke', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Swim', 'Butterfly', [578, 683, 788, 893, 1001, 1103, 1207, 1312]],
    ['Tennis', 'Doubles', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Tennis', 'Singles', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Treadmill, run', '6 mph, 10 min/mile, 0% incline', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Treadmill, run', '6 mph, 10 min/mile, 2% incline', [578, 683, 788, 893, 1001, 1103, 1207, 1312]],
    ['Treadmill, run', '6 mph, 10 min/mile, 4% incline', [620, 732, 845, 958, 1074, 1183, 1295, 1408]],
    ['Treadmill, run', '6 mph, 10 min/mile, 6% incline', [667, 788, 909, 1031, 1156, 1273, 1394, 1515]],
    ['Treadmill, run', '7 mph, 8.5 min/mile, 0% incline', [604, 714, 824, 933, 1047, 1153, 1262, 1372]],
    ['Treadmill, run', '7 mph, 8.5 min/mile, 2% incline', [667, 788, 909, 1031, 1156, 1273, 1394, 1515]],
    ['Treadmill, run', '7 mph, 8.5 min/mile, 4% incline', [719, 850, 981, 1112, 1247, 1374, 1503, 1634]],
    ['Treadmill, run', '7 mph, 8.5 min/mile, 6% incline', [767, 906, 1046, 1185, 1329, 1464, 1602, 1741]],
    ['Treadmill, run', '8 mph, 7.5 min/mile, 0% incline', [709, 838, 967, 1096, 1229, 1354, 1481, 1610]],
    ['Treadmill, run', '8 mph, 7.5 min/mile, 2% incline', [756, 894, 1031, 1169, 1311, 1444, 1580, 1718]],
    ['Treadmill, run', '8 mph, 7.5 min/mile, 4% incline', [814, 962, 1110, 1258, 1411, 1554, 1701, 1849]],
    ['Treadmill, run', '8 mph, 7.5 min/mile, 6% incline', [872, 1030, 1189, 1347, 1511, 1665, 1821, 1980]],
    ['Treadmill, run', '3 mph, 20 min/mile, 0% incline', [173, 205, 236, 268, 300, 331, 362, 394]],
    ['Treadmill, run', '3 mph, 20 min/mile, 2% incline', [194, 230, 265, 300, 337, 371, 406, 441]],
    ['Treadmill, run', '3 mph, 20 min/mile, 4% incline', [215, 254, 293, 333, 373, 411, 450, 489]],
    ['Treadmill, run', '3 mph, 20 min/mile, 6% incline', [236, 279, 322, 365, 410, 451, 494, 537]],
    ['Treadmill, run', '4 mph, 15 min/mile, 0% incline', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Treadmill, run', '4 mph, 15 min/mile, 2% incline', [294, 348, 401, 455, 510, 562, 614, 668]],
    ['Treadmill, run', '4 mph, 15 min/mile, 4% incline', [326, 385, 444, 503, 564, 622, 680, 740]],
    ['Treadmill, run', '4 mph, 15 min/mile, 6% incline', [352, 416, 480, 544, 610, 672, 735, 799]],
    ['Tread water', 'Moderate', [210, 248, 286, 325, 364, 401, 439, 477]],
    ['Tread water', 'Vigorous', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Volleyball', 'Noncompetitive', [158, 133, 215, 243, 273, 301, 329, 358]],
    ['Volleyball', 'Competitive', [420, 496, 573, 649, 728, 802, 878, 954]],
    ['Walk', '<2 mph', [105, 124, 143, 162, 182, 201, 219, 239]],
    ['Walk', '2 mph, 30 min/mile', [131, 155, 179, 203, 228, 251, 274, 298]],
    ['Walk', '2.5 mph, 24 min/mile', [158, 133, 215, 243, 273, 301, 329, 358]],
    ['Walk', '3 mph, 20 min/mile', [173, 205, 236, 268, 300, 331, 362, 394]],
    ['Walk', '3.5 mph, 17 min/mile', [200, 236, 272, 308, 346, 381, 417, 453]],
    ['Walk', '4 mph, 15 min/mile', [263, 310, 358, 406, 455, 501, 549, 596]],
    ['Walk', '4.5 mph, 13 min/mile', [331, 391, 451, 511, 574, 632, 691, 751]],
    ['Walk', 'Race walking', [341, 403, 465, 528, 592, 652, 713, 775]],
    ['Water polo', 'General', [525, 621, 716, 812, 910, 1003, 1097, 1193]],
    ['Weight training', 'Free, nautilus, light or moderate', [158, 133, 215, 243, 273, 301, 329, 358]],
    ['Weight training', 'Free, nautilus, vigorous', [315, 372, 430, 487, 546, 602, 658, 716]],
    ['Wind surf', 'Casual', [158, 133, 215, 243, 273, 301, 329, 358]],
  ];

  // ── Weight interpolation ────────────────────────────────────────────────

  /** Interpolate kcal/hour for an arbitrary body weight (kg) from an 8-point lb table row. */
  function _kcalPerHourAt(row, weightKg) {
    const lb = weightKg / 0.45359237;
    if (lb <= LB_COLUMNS[0]) return row[0];
    if (lb >= LB_COLUMNS[LB_COLUMNS.length - 1]) return row[row.length - 1];

    for (let i = 0; i < LB_COLUMNS.length - 1; i++) {
      const lo = LB_COLUMNS[i], hi = LB_COLUMNS[i + 1];
      if (lb >= lo && lb <= hi) {
        const frac = (lb - lo) / (hi - lo);
        return row[i] + frac * (row[i + 1] - row[i]);
      }
    }
    return row[Math.floor(row.length / 2)];
  }

  // ── Matching ─────────────────────────────────────────────────────────────

  const INTENSITY_FAST = /\b(fast|vigorous|competitive|competition|race|racing|sprint|hard|intense)\b/i;
  const INTENSITY_SLOW = /\b(slow|casual|light|easy|gentle|leisure|leisurely)\b/i;

  /** Group table rows by activity name (case-insensitive). */
  function _groups() {
    const map = new Map();
    for (const row of TABLE) {
      const key = row[0].toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
    return map;
  }

  // A few common synonyms/aliases → canonical activity name in the table.
  const ALIASES = {
    'cycle': 'bike', 'cycling': 'bike', 'biking': 'bike', 'bicycle': 'bike', 'bicycling': 'bike',
    'biked': 'bike', 'cycled': 'bike',
    'running': 'run', 'ran': 'run',
    'jogging': 'jog', 'jogged': 'jog',
    'walking': 'walk', 'walked': 'walk',
    'swimming': 'swim', 'swam': 'swim', 'swum': 'swim',
    'gym': 'weight training', 'lifting': 'weight training', 'lifted': 'weight training',
    'weights': 'weight training', 'strength training': 'weight training',
    'football (soccer)': 'soccer', 'american football': 'football',
    'yoga': 'stretch, yoga', 'stretching': 'stretch, yoga', 'stretched': 'stretch, yoga',
    'skiing': 'ski, downhill', 'skied': 'ski, downhill',
    'ice skating': 'skate, ice', 'inline skating': 'skate, inline',
    'rollerblading': 'skate, inline', 'rowing': 'stationary rower', 'rowed': 'stationary rower',
    'rowing machine': 'stationary rower',
    'jump roping': 'jump rope', 'skipping rope': 'jump rope',
    'hiking': 'hike', 'hiked': 'hike',
    'treadmill': 'treadmill, run', 'martial art': 'martial arts',
    'boxed': 'boxing', 'kayaking': 'kayak', 'kayaked': 'kayak',
    'hoop': 'basketball', 'hooped': 'basketball',
  };

  /**
   * Attempt to match a free-text exercise description against the table.
   * Returns { name, type, kcalPerHour(weightKg) } or null if no confident match.
   */
  function match(description) {
    const desc = (description || '').toLowerCase();
    if (!desc.trim()) return null;

    const groupMap = _groups();
    let bestKey = null;
    let bestLen = 0;

    // Check aliases first (longest alias phrase wins), then raw group names.
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      if (desc.includes(alias) && alias.length > bestLen && groupMap.has(canonical)) {
        bestKey = canonical;
        bestLen = alias.length;
      }
    }
    for (const key of groupMap.keys()) {
      if (desc.includes(key) && key.length > bestLen) {
        bestKey = key;
        bestLen = key.length;
      }
    }
    if (!bestKey) return null;

    const rows = groupMap.get(bestKey);
    let chosen = rows[0];

    // Try to match an explicit mph figure in the description to the closest row.
    const mphMatch = desc.match(/(\d+(?:\.\d+)?)\s*mph/);
    const mphRows = rows.filter(r => /mph/i.test(r[1]));
    if (mphMatch && mphRows.length) {
      const target = parseFloat(mphMatch[1]);
      let bestDiff = Infinity;
      for (const r of mphRows) {
        const rowMph = parseFloat((r[1].match(/(\d+(?:\.\d+)?)\s*mph/) || [])[1]);
        if (!isNaN(rowMph)) {
          const diff = Math.abs(rowMph - target);
          if (diff < bestDiff) { bestDiff = diff; chosen = r; }
        }
      }
    } else if (rows.length > 1) {
      // No explicit speed: use intensity wording, else prefer a "General" row, else the middle row.
      if (INTENSITY_FAST.test(desc)) {
        chosen = rows.find(r => INTENSITY_FAST.test(r[1])) || rows[rows.length - 1];
      } else if (INTENSITY_SLOW.test(desc)) {
        chosen = rows.find(r => INTENSITY_SLOW.test(r[1])) || rows[0];
      } else {
        chosen = rows.find(r => /general/i.test(r[1])) || rows[Math.floor(rows.length / 2)];
      }
    }

    return {
      name: chosen[0],
      type: chosen[1],
      kcalPerHour: (weightKg) => _kcalPerHourAt(chosen[2], weightKg),
    };
  }

  /** Estimate calories burned for a duration given a matched entry and weight. */
  function estimate(description, durationMin, weightKg) {
    const m = match(description);
    if (!m) return null;
    const perHour = m.kcalPerHour(weightKg || 70);
    return {
      name: m.name + (m.type && !/general/i.test(m.type) ? ' — ' + m.type : ''),
      calories: Math.round((perHour * durationMin) / 60),
      source: 'table',
    };
  }

  return { match, estimate, TABLE };
})();
