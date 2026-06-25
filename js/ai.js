/**
 * ai.js — Thanzi AI Nutrition Assistant
 *
 * Calls an Appwrite Function (THANZI_CONFIG.functions.aiAssistant) that
 * proxies to OpenRouter / Groq / OpenAI / Anthropic on the server side.
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
    icon.textContent = role === 'user' ? '👤' : '🌿';

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
    icon.textContent = '🌿';

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

  // ── Appwrite Function call ─────────────────────────────────────────────────

  async function _callAI(userMessage) {
    // Add to history
    _history.push({ role: 'user', content: userMessage });

    const payload = {
      messages: _history,
      context:  _buildContext(),
    };

    const functionId = THANZI_CONFIG.functions && THANZI_CONFIG.functions.aiAssistant;
    if (!functionId) {
      throw new Error('AI function not configured. Set THANZI_CONFIG.functions.aiAssistant in config.js');
    }

    const res = await fetch(
      `${THANZI_CONFIG.endpoint}/functions/${functionId}/executions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': THANZI_CONFIG.projectId,
        },
        body: JSON.stringify(payload),
        credentials: 'include',   // sends session cookie
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Function error (${res.status}): ${err}`);
    }

    const execution = await res.json();

    // Appwrite wraps the function's return value in responseBody
    let reply;
    try {
      const parsed = JSON.parse(execution.responseBody);
      reply = parsed.reply || parsed.content || parsed.text || JSON.stringify(parsed);
    } catch {
      reply = execution.responseBody;
    }

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
