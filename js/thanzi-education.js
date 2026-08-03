/**
 * thanzi-education.js
 * Thanzi App — Dietary Education Library v1.0
 *
 * A static, offline-friendly library of short nutrition articles, tagged
 * against the same taxonomy the nutrition engine already uses:
 *   - goal            : 'lose' | 'maintain' | 'gain'
 *   - health_interest  : same values as the Goals panel's interest chips
 *   - nutrient          : matches micronutrient flag names (thanzi-nutrition.js)
 *   - module            : 'bone_health' | 'aging' | 'young_adult' | 'oral_health' | 'sports'
 *
 * forUser(plan) reads those same tags off a generated plan (the object
 * ThanziNutrition.generate() returns, already saved as thanzi_profile_<uid>)
 * and returns a personalized "For You" shortlist — no new computation,
 * just matching against data the engine already produces.
 *
 * Architecture: Pure client-side IIFE, no dependencies, vanilla JS (ES6)
 * Exposes: window.ThanziEducation
 * Author: Built for Thanzi App — Malawi's first fitness app
 */

'use strict';

const ThanziEducation = (() => {

  // ═══════════════════════════════════════════════════════════════════
  // DYNAMIC ARTICLES — weekly RAG-generated additions (see
  // workers/education-generator/), fetched from the Appwrite
  // `education_articles` collection and merged with the static library
  // below at render time. Offline-first: if the fetch fails (no network,
  // collection not yet created, etc.) the app silently falls back to the
  // static library only — nothing here is required for Learn to work.
  // ═══════════════════════════════════════════════════════════════════

  let _dynamicArticles = [];
  let _dynamicLoaded   = false;

  function _appwriteDb() {
    if (typeof Appwrite === 'undefined' || typeof THANZI_CONFIG === 'undefined') return null;
    const client = new Appwrite.Client()
      .setEndpoint(THANZI_CONFIG.endpoint)
      .setProject(THANZI_CONFIG.projectId);
    return new Appwrite.Databases(client);
  }

  /** Maps an Appwrite `education_articles` document onto the same shape
   *  as a static ARTICLES entry, so both can be rendered identically. */
  function _fromDoc(doc) {
    return {
      id:        doc.$id,
      title:     doc.title,
      category:  doc.category,
      tags:      doc.tags || [],
      read_min:  doc.read_min,
      summary:   doc.summary,
      body:      doc.body || [],
    };
  }

  /** Fetches published dynamic articles from Appwrite. Safe to call
   *  repeatedly — pass force=true to bypass the "already loaded" cache
   *  (e.g. when the Learn panel is re-opened). Never throws; failures
   *  just leave _dynamicArticles at whatever it was before (or empty). */
  async function refreshLibrary(force = false) {
    if (_dynamicLoaded && !force) return;
    const db = _appwriteDb();
    if (!db) { _dynamicLoaded = true; return; }

    try {
      const res = await db.listDocuments(
        THANZI_CONFIG.databaseId,
        THANZI_CONFIG.collections.educationArticles,
        [
          Appwrite.Query.equal('status', 'published'),
          Appwrite.Query.orderDesc('$createdAt'),
          Appwrite.Query.limit(100),
        ]
      );
      _dynamicArticles = res.documents.map(_fromDoc);
    } catch (e) {
      // Offline, collection not created yet, etc. — fall back to static
      // library only rather than breaking the Learn panel.
      _dynamicArticles = _dynamicArticles || [];
    }
    _dynamicLoaded = true;
  }

  /** Static + dynamic, static first (dynamic articles are already sorted
   *  newest-first, so they naturally surface recent additions near the
   *  top of "All Topics" without reshuffling the hand-written library). */
  function allArticles() {
    return ARTICLES.concat(_dynamicArticles);
  }

  // ═══════════════════════════════════════════════════════════════════
  // ARTICLE LIBRARY
  // ═══════════════════════════════════════════════════════════════════

  const ARTICLES = [
    {
      id: 'malawian-plate',
      title: 'Building a balanced Malawian plate',
      category: 'Fundamentals',
      tags: ['general_wellness', 'maintain'],
      read_min: 3,
      summary: 'A simple portion guide using nsima, relish, and protein — no scales required.',
      body: [
        'A balanced plate doesn\'t need to be complicated or imported. Split your plate into three rough sections: half vegetables or relish, a quarter nsima or another starch, and a quarter protein — fish, beans, meat, or eggs.',
        'Vegetables and relish should take up the most space because they are lowest in calories and highest in fibre and micronutrients per bite. Rape, pumpkin leaves, okra, and mustard greens are all excellent and widely available.',
        'Keep nsima portions to about one cup cooked (roughly a fist-sized ball) per meal. It\'s easy to serve more than you need, and portion is what usually drives excess calories, not the food itself.',
        'Rotate your protein source through the week — dagaa, kapenta, beans, groundnuts, chicken, and eggs each bring a slightly different mix of amino acids and minerals. Variety over a week matters more than any single "perfect" meal.',
      ],
    },
    {
      id: 'weight-loss-basics',
      title: 'Losing weight without losing energy',
      category: 'Weight Management',
      tags: ['weight_loss', 'lose'],
      read_min: 4,
      summary: 'Why crash diets backfire, and what a sustainable calorie deficit actually looks like.',
      body: [
        'Weight loss ultimately comes down to eating fewer calories than you burn — but how you get there determines whether you keep the weight off and whether you have energy for daily life.',
        'A large, aggressive deficit (skipping meals, cutting out entire food groups) often backfires: it triggers strong hunger, poor concentration, and eventually a binge that erases the progress. A moderate deficit of around 500 kcal/day below your maintenance level is enough to lose roughly 0.5 kg a week while staying functional.',
        'Protein is your best tool during a deficit — it preserves muscle mass and keeps you fuller for longer than carbs or fat alone. Aim to include a protein source (beans, fish, eggs, chicken) at every meal, not just dinner.',
        'Volume matters too. Vegetables, clear soups, and fruit add bulk and satiety for relatively few calories, which makes portion control feel less like restriction and more like a different way of filling your plate.',
        'Cooking method changes calories more than people expect — boiling, grilling, or steaming instead of deep-frying can cut a meal\'s calorie count substantially without changing the ingredients.',
      ],
    },
    {
      id: 'gaining-weight-safely',
      title: 'Gaining weight the healthy way',
      category: 'Weight Management',
      tags: ['muscle_gain', 'gain'],
      read_min: 3,
      summary: 'How to add calories without just adding sugar and oil.',
      body: [
        'A calorie surplus is necessary to gain weight, but where those extra calories come from matters — especially if the goal is muscle, not just a higher number on the scale.',
        'Groundnut butter, avocado, milk, and eggs are calorie-dense and nutrient-rich, which makes them more efficient additions than sugary drinks or fried snacks. A tablespoon of groundnut butter stirred into porridge adds roughly 100 kcal and 4g of protein in one easy step.',
        'Eating five or six smaller meals across the day is often easier to sustain than trying to force down three huge ones — especially if a small appetite has made gaining weight difficult in the past.',
        'If you\'re training, a combination of milk and a carbohydrate source (like banana) within 30 minutes after a workout supports muscle repair better than either food alone.',
        'Progress is best tracked weekly, not daily — body weight naturally fluctuates with hydration and digestion, so a single day\'s number can be misleading.',
      ],
    },
    {
      id: 'diabetes-carb-quality',
      title: 'Diabetes management: carb quality over carb elimination',
      category: 'Chronic Conditions',
      tags: ['diabetes'],
      read_min: 4,
      summary: 'Why the type and pairing of carbohydrates matters more than cutting them out entirely.',
      body: [
        'Managing blood sugar isn\'t about eliminating carbohydrates — it\'s about choosing carbohydrates that raise blood glucose more slowly and pairing them with protein or fibre.',
        'Nsima made from refined maize flour digests quickly and can spike blood sugar. Choosing whole-grain options where available, or simply pairing nsima with a generous portion of vegetables and protein, slows that spike considerably.',
        'Sweet potato has a lower glycaemic impact than white nsima for a similar amount of carbohydrate, and adds beta-carotene as a bonus.',
        'Consistent meal timing matters as much as meal content — irregular, skipped, or very large meals make blood sugar harder to predict and manage than smaller, regularly spaced ones.',
        'This is educational information, not medical advice — always follow the specific guidance your clinician has given you for your treatment plan.',
      ],
    },
    {
      id: 'hypertension-sodium',
      title: 'Hypertension: the sodium most people miss',
      category: 'Chronic Conditions',
      tags: ['hypertension', 'heart_health'],
      read_min: 3,
      summary: 'Bouillon cubes and processed seasonings are often the biggest hidden sodium source — not the salt shaker.',
      body: [
        'When people think about reducing salt, they usually picture the salt shaker at the table. In practice, bouillon cubes, processed relishes, and packaged seasoning blends are often the largest sodium sources in a day\'s meals.',
        'One bouillon cube can carry well over 1,000mg of sodium — close to half a typical daily limit — before any table salt is added at all. Using fresh herbs, garlic, ginger, and tomato as flavour bases can reduce reliance on cubes without sacrificing taste.',
        'Increasing potassium-rich foods — bananas, sweet potato, beans — helps counterbalance sodium\'s effect on blood pressure, since potassium supports the kidneys in managing fluid balance.',
        'Fresh fruit and vegetables are naturally very low in sodium; the more a meal relies on packaged or preserved ingredients, the more sodium tends to creep in.',
      ],
    },
    {
      id: 'pregnancy-nutrition',
      title: 'Eating well during pregnancy',
      category: 'Life Stages',
      tags: ['pregnancy'],
      read_min: 4,
      summary: 'What actually increases during pregnancy — and it\'s not "eating for two".',
      body: [
        'Pregnancy increases the need for several specific nutrients, but total calorie needs rise much less than the old "eating for two" advice suggests — typically only a modest increase in the second and third trimesters.',
        'Iron needs increase substantially to support the growing blood supply. Dagaa, kapenta, beans, and dark leafy greens are useful local sources — pairing plant iron sources with a vitamin C-rich food (like tomato or citrus) improves absorption.',
        'Folate is critical, especially early in pregnancy. Beans, groundnuts, and dark green vegetables like rape and pumpkin leaves are good sources, alongside any supplement your clinic has prescribed.',
        'Calcium needs also rise to support the baby\'s developing bones — dagaa (eaten whole with bones), milk, and soybeans are useful local sources.',
        'This is general nutrition education — always follow your antenatal clinic\'s specific guidance, especially around supplementation.',
      ],
    },
    {
      id: 'iron-deficiency',
      title: 'Iron: why it\'s so easy to fall short',
      category: 'Micronutrients',
      tags: ['nutrient:Iron'],
      read_min: 3,
      summary: 'The absorption trick most people don\'t know — and why it matters more for menstruating women.',
      body: [
        'Iron deficiency is one of the most common nutritional gaps worldwide, and menstrual blood loss means women of reproductive age need noticeably more of it than men.',
        'Not all iron is absorbed equally. Heme iron, found in liver, dagaa, kapenta, and other animal foods, is absorbed far more efficiently by the body than the non-heme iron found in beans and leafy greens.',
        'If you rely mainly on plant sources of iron, pairing them with vitamin C — a squeeze of lemon, a side of tomato, or a piece of fruit — significantly improves how much iron your body actually absorbs from that meal.',
        'Tea and coffee taken with meals can reduce iron absorption, so if iron intake is a concern, it helps to have those drinks between meals rather than alongside them.',
      ],
    },
    {
      id: 'calcium-bone-health',
      title: 'Calcium and bone health beyond dairy',
      category: 'Micronutrients',
      tags: ['nutrient:Calcium', 'module:bone_health'],
      read_min: 3,
      summary: 'Local, affordable calcium sources for anyone who doesn\'t drink much milk.',
      body: [
        'Dairy is a well-known calcium source, but it\'s far from the only one — useful for anyone who doesn\'t drink milk regularly or affordably.',
        'Dagaa and usipa, eaten whole with their bones, are among the richest local calcium sources available. Matemba and other small dried fish offer similar benefits.',
        'Rape and other leafy greens contribute plant-based calcium alongside iron, making them a strong all-round addition to a Malawian plate.',
        'Bone density peaks in early adulthood and gradually declines with age, which is why calcium intake — combined with weight-bearing activity like walking and moderate sun exposure for vitamin D — matters across the whole lifespan, not just in childhood.',
      ],
    },
    {
      id: 'vitamin-d-sun',
      title: 'Vitamin D: what sunlight does and doesn\'t cover',
      category: 'Micronutrients',
      tags: ['nutrient:Vitamin D'],
      read_min: 2,
      summary: 'Malawi\'s sunlight usually covers vitamin D needs — with one important caveat.',
      body: [
        'Vitamin D is unusual among nutrients because the body can produce it from sunlight exposure on skin, and Malawi\'s year-round sun generally makes deficiency less common here than in countries with long winters.',
        'Around 15–20 minutes of midday sun on your arms and legs a few times a week is generally enough for most people to maintain adequate levels.',
        'That said, people who spend most of the day indoors, cover most of their skin, or have darker skin tones (which naturally produces vitamin D more slowly from the same sun exposure) may still fall short — egg yolk and small fish like kapenta are useful dietary sources to round things out.',
      ],
    },
    {
      id: 'b12-aging',
      title: 'Vitamin B12 and why it matters more after 50',
      category: 'Life Stages',
      tags: ['nutrient:Vitamin B12', 'module:aging'],
      read_min: 3,
      summary: 'Absorption — not intake — is usually the issue for older adults.',
      body: [
        'Vitamin B12 is found almost exclusively in animal foods — meat, fish, eggs, and dairy — which is why it\'s a common concern for anyone eating a mostly plant-based diet.',
        'For older adults, the issue is often not how much B12 they eat, but how well their body absorbs it. Stomach acid, which is needed to release B12 from food, tends to decline with age, reducing absorption even when intake looks adequate on paper.',
        'This is one of the reasons a fortified food source or a supplement is sometimes recommended for adults over 50, even if their diet includes animal products — worth discussing with a healthcare provider if it applies to you.',
      ],
    },
    {
      id: 'oral-health-diet',
      title: 'What your diet has to do with your teeth',
      category: 'Life Stages',
      tags: ['module:oral_health'],
      read_min: 2,
      summary: 'Frequency of sugar exposure matters more than total sugar amount.',
      body: [
        'For dental health, how often you expose your teeth to sugar matters more than the total amount consumed in a day. Sipping a sugary drink slowly over an hour causes more prolonged acid exposure than drinking the same amount quickly with a meal.',
        'Water as your main drink between meals gives your mouth time to recover its natural pH between sugar exposures, which is protective even if your overall diet still includes some sweet foods.',
        'Crunchy fruits and vegetables — carrots, cucumber, apple — stimulate saliva production, which helps neutralize acid and clear food particles naturally.',
      ],
    },
    {
      id: 'sports-fueling',
      title: 'Fueling around a workout',
      category: 'Performance',
      tags: ['module:sports', 'muscle_gain'],
      read_min: 3,
      summary: 'What to eat before and after training, and why timing helps.',
      body: [
        'What you eat around a workout affects how much you get out of it — both in performance during the session and recovery afterward.',
        'A small carbohydrate-containing snack 1–2 hours before training (like a banana or a small serving of nsima) provides accessible energy without leaving you feeling heavy or sluggish.',
        'After training, combining protein and carbohydrate within about 30–60 minutes — milk and a banana, or eggs and sweet potato — supports muscle repair and replenishes energy stores more effectively than either nutrient alone.',
        'Hydration matters as much as food — sweat losses during exercise, especially in Malawi\'s heat, can be significant, so drinking water before, during, and after training helps maintain performance and recovery.',
      ],
    },
    {
      id: 'hydration-basics',
      title: 'How much water do you actually need?',
      category: 'Fundamentals',
      tags: ['general_wellness'],
      read_min: 2,
      summary: 'Individual fluid needs vary more than the "8 glasses a day" rule suggests.',
      body: [
        'The old "8 glasses a day" rule is a reasonable starting point, but actual fluid needs vary with body size, activity level, climate, and diet — someone larger, more active, or in hotter conditions needs meaningfully more.',
        'A simple practical check is urine colour: pale yellow generally indicates good hydration, while consistently dark yellow suggests you need more fluids.',
        'Food contributes to hydration too — fruits and vegetables with high water content, like watermelon, cucumber, and tomato, add to your daily total alongside what you drink directly.',
        'Thirst is a reasonably reliable signal for most healthy adults — the main exception is during and after intense exercise or heat exposure, when it\'s worth drinking proactively rather than waiting to feel thirsty.',
      ],
    },
    {
      id: 'reading-food-labels',
      title: 'Making sense of packaged food labels',
      category: 'Fundamentals',
      tags: ['weight_loss', 'diabetes', 'general_wellness'],
      read_min: 3,
      summary: 'The three numbers worth checking before the rest of the label.',
      body: [
        'Packaged food labels can be overwhelming, but three numbers give you most of the useful information: calories per serving, sugar content, and sodium content.',
        'Check the serving size first — it\'s easy to assume a small package is "one serving" when it\'s actually two or three, which changes every other number on the label proportionally.',
        'For sugar, aim to notice added sugars specifically where labels distinguish them — naturally occurring sugar in plain fruit or milk behaves differently in the body than added sugar in a sweetened drink or snack.',
        'A short ingredient list is generally a reasonable proxy for a less processed food — not a strict rule, but a useful quick check when you don\'t have time to read the full label.',
      ],
    },
  ];

  // ═══════════════════════════════════════════════════════════════════
  // PERSONALIZATION — match articles against a user's saved plan
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Builds the set of tags that apply to a given plan (the object
   * ThanziNutrition.generate() returns). Mirrors the same fields the
   * Goals panel already reads — no new computation.
   */
  function _tagsForPlan(plan) {
    const tags = new Set();
    if (!plan) return tags;

    const goal = plan.energy?.goal || plan.inputs?.goal;
    if (goal) tags.add(goal);

    const interests = plan.health_interests || plan.inputs?.health_interests || [];
    interests.forEach(i => tags.add(i));

    const flags = plan.micronutrients?.flags || [];
    flags.forEach(f => { if (f.nutrient) tags.add(`nutrient:${f.nutrient}`); });

    const modules = plan.modules || {};
    Object.keys(modules).forEach(key => {
      if (modules[key]) tags.add(`module:${key}`);
    });

    return tags;
  }

  /**
   * Returns { forYou: [...matched articles, best first], all: [...everything] }.
   * "For You" is capped at 6 so the panel opens with a focused list rather
   * than dumping the whole library at the top.
   */
  function forUser(plan) {
    const userTags = _tagsForPlan(plan);

    const scored = allArticles().map(a => {
      const matches = a.tags.filter(t => userTags.has(t)).length;
      return { article: a, matches };
    });

    const forYou = scored
      .filter(s => s.matches > 0)
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 6)
      .map(s => s.article);

    return { forYou, all: allArticles() };
  }

  function categories() {
    return [...new Set(allArticles().map(a => a.category))];
  }

  return { forUser, categories, allArticles, refreshLibrary, ARTICLES };

})();
