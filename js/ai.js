/**
 * ai.js — Thanzi AI Nutrition Assistant
 *
 * Calls the Render proxy (thanzi-proxy.onrender.com/groq) which
 * proxies to Groq on the server side, keeping API keys off the client.
 *
 * Nutrition/calorie lookups (e.g. "how many calories in Twisties?") are
 * grounded against the Chakudya Nutrition Registry (CNR) with a 3-step
 * cascade, stopping at the first hit:
 *   1. POST /rag/retrieve  — curated semantic knowledge base
 *   2. GET  /foods         — whole-food / Malawi FCT database
 *   3. GET  /packaged      — packaged/branded product database
 * Steps 2–3 reuse ThanziFood.search(), which already implements the
 * /foods → /packaged fallback internally.
 *
 * Public API:
 *   ThanziAI.init(user, getAppState)   — call from app.js after dashboard init
 *   ThanziAI.onFocus()                 — called when the AI panel opens (from drawer)
 */
const ThanziAI = (() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let _user        = null;
  let _getAppState = null;   // function that returns { caloriesConsumed, caloriesGoal, carbs, protein, fat, waterGoal, water }
  let _history     = [];     // [{ role: 'user'|'assistant', content: string }]
  let _busy        = false;
  let _inited      = false;

  // ── Proxy config ───────────────────────────────────────────────────────────
  const PROXY_URL   = 'https://thanzi-ai-proxy.edisontaimu9.workers.dev/v1/groq/v1/chat/completions';
  const THANZI_KEY  = 'thanzi_app001';
  const AI_MODEL    = 'llama-3.3-70b-versatile';
  const RAG_URL     = 'https://chakudya-api.edisontaimu9.workers.dev/rag/retrieve';

  const QUICK_ACTIONS = [
    { icon: '🍽️', label: 'Meal Ideas',     prompt: 'Suggest 3 meal ideas that fit my remaining macros for today.' },
    { icon: '📅', label: 'Plan My Day',    prompt: 'Create a full-day meal plan for me based on my nutrition goals.' },
    { icon: '💪', label: 'High Protein',   prompt: 'Suggest high-protein meal or snack options suitable for my goal.' },
    { icon: '👨‍🍳', label: 'Get Recipe',    prompt: 'Generate a healthy complete recipe with ingredients and steps.' },
    { icon: '🔄', label: 'Substitutes',    prompt: 'Suggest healthy food substitutions I can use in my daily meals.' },
    { icon: '📚', label: 'Nutrition Tips', prompt: 'Give me 3 evidence-based nutrition tips relevant to my goal.' },
  ];

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _fmt(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function _messagesEl()    { return document.getElementById('ai-messages'); }
  function _inputEl()       { return document.getElementById('ai-input'); }
  function _sendBtnEl()     { return document.getElementById('ai-send-btn'); }
  function _quickSectionEl(){ return document.getElementById('ai-quick-section'); }

  function _scrollToBottom() {
    const el = _messagesEl();
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ── Build nutrition context string sent to AI ──────────────────────────────

  function _buildContext() {
    const firstName = _user ? _user.name.split(' ')[0] : 'the user';
    const s = _getAppState ? _getAppState() : {};

    const remaining = {
      kcal:    (s.caloriesGoal    || 0) - (s.caloriesConsumed || 0),
      carbs:   (s.carbsGoal       || 0) - (s.carbs            || 0),
      protein: (s.proteinGoal     || 0) - (s.protein          || 0),
      fat:     (s.fatGoal         || 0) - (s.fat              || 0),
    };

    return `
USER PROFILE:
- Name: ${firstName}
- App: Thanzi (nutrition tracker, Malawi)

TODAY'S NUTRITION STATUS:
- Calories consumed: ${s.caloriesConsumed || 0} / ${s.caloriesGoal || 0} kcal (${remaining.kcal} remaining)
- Carbs:   ${s.carbs    || 0}g consumed, ${remaining.carbs}g remaining (goal: ${s.carbsGoal   || 0}g)
- Protein: ${s.protein  || 0}g consumed, ${remaining.protein}g remaining (goal: ${s.proteinGoal || 0}g)
- Fat:     ${s.fat      || 0}g consumed, ${remaining.fat}g remaining (goal: ${s.fatGoal      || 0}g)
- Water:   ${s.water    || 0}ml / ${s.waterGoal || 0}ml

INSTRUCTIONS:
- You are Thandizo, Thanzi's AI nutrition assistant.
- Give practical, concise, evidence-based advice.
- When suggesting meals, prefer foods commonly available in Malawi and southern Africa (nsima, beans, vegetables, fish, etc.) but also include international options.
- Keep responses friendly, clear, and mobile-friendly (avoid overly long walls of text).
- Always be supportive of the user's nutrition goals.
`.trim();
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function _appendMessage(role, text, isError = false) {
    const el = _messagesEl();
    if (!el) return;

    const wrap = document.createElement('div');
    wrap.className = `ai-msg ai-msg--${role}${isError ? ' ai-error-bubble' : ''}`;

    const icon = document.createElement('div');
    icon.className = 'ai-msg-icon';
    icon.innerHTML = role === 'user' ? '👤' : '<img src="/thanzi/icons/web-app-manifest-192x192.png" class="ai-msg-logo" alt="Thandizo">';

    const body = document.createElement('div');
    body.className = 'ai-msg-body';

    const bubble = document.createElement('div');
    bubble.className = 'ai-msg-bubble';
    bubble.textContent = text;   // textContent — safe, no XSS

    const time = document.createElement('div');
    time.className = 'ai-msg-time';
    time.textContent = _fmt(new Date());

    body.appendChild(bubble);
    body.appendChild(time);
    wrap.appendChild(icon);
    wrap.appendChild(body);
    el.appendChild(wrap);
    _scrollToBottom();
    return bubble; // caller can update text for streaming
  }

  function _showTyping() {
    const el = _messagesEl();
    if (!el) return null;

    const wrap = document.createElement('div');
    wrap.className = 'ai-msg ai-msg--assistant';
    wrap.id = '_ai-typing';

    const icon = document.createElement('div');
    icon.className = 'ai-msg-icon';
    icon.innerHTML = '<img src="/thanzi/icons/web-app-manifest-192x192.png" class="ai-msg-logo" alt="Thandizo">';

    const body = document.createElement('div');
    body.className = 'ai-msg-body';

    const bubble = document.createElement('div');
    bubble.className = 'ai-msg-bubble ai-typing-indicator';
    bubble.innerHTML = `
      <div class="ai-typing-dot"></div>
      <div class="ai-typing-dot"></div>
      <div class="ai-typing-dot"></div>`;

    body.appendChild(bubble);
    wrap.appendChild(icon);
    wrap.appendChild(body);
    el.appendChild(wrap);
    _scrollToBottom();
    return wrap;
  }

  function _removeTyping() {
    const t = document.getElementById('_ai-typing');
    if (t) t.remove();
  }

  // ── Hide quick actions after first user message ────────────────────────────

  function _hideQuickActions() {
    const qs = _quickSectionEl();
    if (qs) qs.style.display = 'none';
  }

  // ── Recipe request detection ───────────────────────────────────────────────
  const _RECIPE_TRIGGERS = [
    /recipe\s+for/i, /help\s+me\s+make/i, /how\s+to\s+(make|cook|prepare)/i,
    /show\s+me\s+how\s+to\s+(make|cook|prepare)/i, /ingredients\s+for/i,
    /make\s+me\s+a\s+recipe/i, /give\s+me\s+a\s+recipe/i,
    /cook\s+.*\s+for\s+me/i,
  ];

  function _isRecipeRequest(text) {
    return _RECIPE_TRIGGERS.some(r => r.test(text));
  }

  async function _fetchRecipeStructured(userMessage) {
    const prompt = `The user asked: "${userMessage}"

Extract a structured recipe from this request. Respond ONLY with valid JSON, no markdown:
{
  "name": "Recipe name",
  "servings": 2,
  "ingredients": [
    {"name": "ingredient", "qty": 100, "unit": "g", "calories": 120, "carbs": 25, "protein": 3, "fat": 1}
  ]
}

Use Malawian/Southern African food portions where relevant. Be realistic with quantities.`;

    const res = await fetch(PROXY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Thanzi-Key': THANZI_KEY },
      body: JSON.stringify({
        model:       AI_MODEL,
        messages:    [
          { role: 'system', content: 'You are a nutrition assistant. Respond only with valid JSON. No markdown.' },
          { role: 'user',   content: prompt },
        ],
        temperature: 0.2,
        max_tokens:  600,
      }),
    });

    const data  = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? '';
    const clean = reply.replace(/```json|```/g, '').trim();

    try {
      return JSON.parse(clean);
    } catch {
      const m = clean.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    }
  }

  function _appendSaveRecipeBtn(recipeData) {
    const el = _messagesEl();
    if (!el) return;

    const btn = document.createElement('button');
    btn.className   = 'ai-recipe-save-btn';
    btn.textContent = '🍳 Save to Recipe Builder →';
    btn.addEventListener('click', () => {
      if (typeof ThanziRecipe !== 'undefined' && ThanziRecipe.openWithData) {
        ThanziRecipe.openWithData(recipeData);
        // Navigate to recipe builder panel
        document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
        const rbPanel = document.getElementById('recipe-builder-panel');
        if (rbPanel) rbPanel.style.display = 'block';
      } else {
        alert('Recipe Builder not available yet.');
      }
    });

    el.appendChild(btn);
    _scrollToBottom();
  }

  // ── RAG retrieval from Chakudya API ───────────────────────────────────────

  async function _retrieveRAG(query) {
    try {
      const res = await fetch(RAG_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context: 'both', top_k: 5 }),
      });
      if (!res.ok) return '';
      const data = await res.json();
      const chunks = data?.data || data?.chunks || [];
      if (!chunks.length) return '';
      return chunks.map(c => c.content).join('\n');
    } catch {
      return ''; // RAG failure is non-fatal — AI still answers
    }
  }

  // ── Nutrition/calorie lookup detection ──────────────────────────────────────
  // Recognises direct "what's the nutrition value of X" style questions so we
  // know when to fall through to structured CNR data (steps 2–3 of the
  // cascade), rather than running food/packaged searches on every message.

  const _NUTRITION_TRIGGERS = [
    /how many calories/i,
    /calories?\s+(in|for|of|does|do)\b/i,
    /kcal\s+(in|for|of)\b/i,
    /nutrition(al)?\s+(facts|info|information|value|content)/i,
    /macros?\s+(in|for|of)\b/i,
    /how\s+much\s+(protein|fat|carbs?|sugar|sodium|fibre|fiber)\s+(is\s+)?(in|does)\b/i,
  ];

  function _isNutritionQuery(text) {
    return _NUTRITION_TRIGGERS.some(r => r.test(text));
  }

  /** Strip the question wrapper to leave (roughly) just the food name, since
   *  CNR /foods and /packaged do literal/substring search — passing the
   *  whole sentence would often return nothing. */
  function _extractFoodQuery(text) {
    return text
      .replace(/how many calories\s+(are|is)?\s*(in|for|does|do)?\s*/i, '')
      .replace(/calories?\s+(in|for|of|does|do)\s*/i, '')
      .replace(/kcal\s+(in|for|of)\s*/i, '')
      .replace(/nutrition(al)?\s+(facts|info|information|value|content)\s*(for|of|in)?\s*/i, '')
      .replace(/macros?\s+(in|for|of)\s*/i, '')
      .replace(/how\s+much\s+(protein|fat|carbs?|sugar|sodium|fibre|fiber)\s+(is\s+)?(in|does)\s*/i, '')
      .replace(/\bhave\b/gi, '')
      .replace(/[?.!]+\s*$/, '')
      .trim();
  }

  /**
   * Ground a nutrition/calorie question in real data, trying sources in
   * order and stopping at the first hit:
   *   1. RAG semantic knowledge base
   *   2. CNR /foods (whole-food / Malawi FCT)
   *   3. CNR /packaged (branded/packaged products) — e.g. "Twisties"
   *
   * @returns {Promise<{source: string, text: string}|null>}
   */
  async function _lookupNutritionData(query) {
    // 1 — RAG
    const rag = await _retrieveRAG(query);
    if (rag) return { source: 'rag', text: rag };

    // 2 & 3 — CNR structured data. ThanziFood.search() already tries
    // GET /foods first and falls back to GET /packaged internally, so one
    // call here covers both remaining steps of the cascade.
    if (typeof ThanziFood !== 'undefined') {
      const results = await ThanziFood.search(query, { multi: true, limit: 3 });
      if (Array.isArray(results) && results.length) {
        const text = results.map(f => {
          const label = f.brand ? `${f.name} (${f.brand})` : f.name;
          const bits  = [`${f.kcal ?? '?'} kcal`];
          if (f.pro != null) bits.push(`${f.pro}g protein`);
          if (f.cho != null) bits.push(`${f.cho}g carbs`);
          if (f.fat != null) bits.push(`${f.fat}g fat`);
          return `${label} — ${bits.join(', ')} per 100g (Chakudya Nutrition Registry)`;
        }).join('\n');
        return { source: 'chakudya', text };
      }
    }

    return null;
  }

  // ── Render proxy call ──────────────────────────────────────────────────────

  async function _callAI(userMessage) {
    // Add to history
    _history.push({ role: 'user', content: userMessage });

    // For explicit nutrition/calorie lookups, run the full cascade
    // (RAG → CNR /foods → CNR /packaged) against just the food name.
    // For everything else, RAG alone is enough general context.
    let knowledge = null;
    if (_isNutritionQuery(userMessage)) {
      const foodQuery = _extractFoodQuery(userMessage) || userMessage;
      knowledge = await _lookupNutritionData(foodQuery);
    } else {
      const rag = await _retrieveRAG(userMessage);
      if (rag) knowledge = { source: 'rag', text: rag };
    }

    // Build system prompt — inject grounding knowledge if available
    const systemContent = knowledge
      ? `${_buildContext()}

RELEVANT NUTRITION KNOWLEDGE (source: ${
        knowledge.source === 'rag' ? 'Chakudya knowledge base' : 'Chakudya Nutrition Registry — structured food data'
      }):
${knowledge.text}

Use the above knowledge to ground your answer in real Malawian food data where relevant. If it directly answers the user's question (e.g. a calorie or nutrition-value lookup), state the figures plainly and note they're from the Chakudya Nutrition Registry.`
      : _buildContext();

    // Build messages: system context + full conversation history
    const messages = [
      { role: 'system', content: systemContent },
      ..._history,
    ];

    const res = await fetch(PROXY_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Thanzi-Key': THANZI_KEY,
      },
      body: JSON.stringify({
        model:       AI_MODEL,
        messages:    messages,
        temperature: 0.7,
        max_tokens:  1024,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Proxy error (${res.status}): ${err}`);
    }

    const data  = await res.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;

    if (!reply) throw new Error('Empty response from AI');

    _history.push({ role: 'assistant', content: reply });
    // Keep history bounded to last 20 turns to avoid large payloads
    if (_history.length > 20) _history = _history.slice(_history.length - 20);

    return reply;
  }

  // ── Send flow ──────────────────────────────────────────────────────────────

  async function sendMessage(text) {
    text = text.trim();
    if (!text || _busy) return;
    _busy = true;

    const input   = _inputEl();
    const sendBtn = _sendBtnEl();
    if (input)   { input.value = ''; input.style.height = 'auto'; }
    if (sendBtn) sendBtn.disabled = true;

    _hideQuickActions();
    _appendMessage('user', text);

    const typingEl = _showTyping();

    try {
      const reply = await _callAI(text);
      _removeTyping();
      _appendMessage('assistant', reply);

      // If recipe request → fetch structured data and show Save button
      if (_isRecipeRequest(text)) {
        try {
          const recipeData = await _fetchRecipeStructured(text);
          if (recipeData && recipeData.name && recipeData.ingredients?.length) {
            _appendSaveRecipeBtn(recipeData);
          }
        } catch { /* silently skip if structured fetch fails */ }
      }
    } catch (err) {
      _removeTyping();
      _appendMessage('assistant', `Sorry, I couldn't reach the AI right now. Please try again.\n\n(${err.message})`, true);
      // Remove failed user message from history so retry is clean
      _history.pop();
    } finally {
      _busy = false;
      if (sendBtn) sendBtn.disabled = false;
      if (input) input.focus();
    }
  }

  // ── Welcome message ────────────────────────────────────────────────────────

  function _showWelcome() {
    const firstName = _user ? _user.name.split(' ')[0] : 'there';
    const welcome = `Hi ${firstName}! 👋 I'm Thandizo, your Thanzi nutrition assistant.

I can help you with:
🍽️ Smart meal suggestions based on your remaining macros
👨‍🍳 Complete recipes with ingredients & steps
📅 Full-day meal plans
🔄 Healthy food substitutions
📚 Evidence-based nutrition guidance

Try a quick action below or just ask me anything!`;

    _appendMessage('assistant', welcome);
    _history.push({ role: 'assistant', content: welcome });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init(user, getAppState) {
    _user        = user;
    _getAppState = getAppState;

    if (_inited) return;
    _inited = true;

    // Render quick action buttons
    const qs = _quickSectionEl();
    if (qs) {
      qs.innerHTML = `<p class="ai-quick-label">Quick Actions</p><div class="ai-quick-grid" id="ai-quick-grid"></div>`;
      const grid = document.getElementById('ai-quick-grid');
      QUICK_ACTIONS.forEach(({ icon, label, prompt }) => {
        const btn = document.createElement('button');
        btn.className = 'ai-quick-btn';
        btn.innerHTML = `<span class="qi">${icon}</span>${label}`;
        btn.addEventListener('click', () => sendMessage(prompt));
        grid.appendChild(btn);
      });
    }

    // Input auto-resize
    const input = _inputEl();
    if (input) {
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(input.value);
        }
      });
    }

    // Send button
    const sendBtn = _sendBtnEl();
    if (sendBtn) {
      sendBtn.addEventListener('click', () => sendMessage(input ? input.value : ''));
    }

    // Show welcome
    _showWelcome();
  }

  // Called when the AI panel is opened from the drawer
  function onFocus() {
    const input = _inputEl();
    if (input) setTimeout(() => input.focus(), 200);
  }

  return { init, onFocus, sendMessage };
})();
