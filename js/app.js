const ThanziApp = (() => {
  let state = {
    caloriesConsumed: 0,
    caloriesGoal: 2000,
    carbsGoal: 250,
    proteinGoal: 100,
    fatGoal: 65,
    carbs: 0,
    protein: 0,
    fat: 0,
    water: 0,
    waterGoal: 2000,
  };

  let selections = { gender: null, activity: null, goal: null };
  let _currentUser = null;
  let _logInited = false;
  let _profileInited = false;

  // ── Theme (dark/light) ───────────────────────────────────────────────────

  const THEME_KEY = 'thanzi_theme';

  const applyTheme = (theme) => {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      const next = theme === 'light' ? 'dark' : 'light';
      const label = `Switch to ${next} mode`;
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  };

  const initTheme = () => {
    let theme;
    try {
      theme = localStorage.getItem(THEME_KEY);
    } catch (e) { /* localStorage unavailable — fall through to default */ }
    if (!theme) {
      theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches)
        ? 'light' : 'dark';
    }
    applyTheme(theme);
  };

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    applyTheme(next);
  };

  // ── Screen / panel helpers ───────────────────────────────────────────────

  const showScreen = (screenId) => {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
    // Show hamburger only on the dashboard — hidden on auth & profile-setup screens
    const hamburger = document.getElementById('hamburger-btn');
    if (hamburger) hamburger.style.display = screenId === 'dashboard-screen' ? 'flex' : 'none';
  };

  const showPanel = (panelId) => {
    document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
    document.getElementById(panelId).style.display = 'block';
  };

  // ── Nutrition & UI updates ───────────────────────────────────────────────

  const applyPlan = (plan) => {
    state.caloriesGoal = plan.energy.target_kcal;
    state.carbsGoal    = plan.macros.carbs.g;
    state.proteinGoal  = plan.macros.protein.g;
    state.fatGoal      = plan.macros.fat.g;
    state.waterGoal    = Math.round(plan.micronutrients.fluid_L * 1000);
  };

  /**
   * Called by ThanziLog whenever the food log changes.
   * Updates the dashboard calorie ring and macros display.
   */
  const updateNutrition = ({ kcal, carbs, protein, fat }) => {
    state.caloriesConsumed = Math.round(kcal);
    state.carbs   = Math.round(carbs   * 10) / 10;
    state.protein = Math.round(protein * 10) / 10;
    state.fat     = Math.round(fat     * 10) / 10;
    updateRing();
  };

  const updateGreeting = (name) => {
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17) greeting = 'Good evening';
    const firstName = (name || '').trim().split(' ')[0] || 'Guest';
    document.getElementById('greeting').textContent = `${greeting}, ${firstName}`;
  };

  const updateRing = () => {
    const consumed      = state.caloriesConsumed;
    const goal          = state.caloriesGoal;
    const circumference = 314;
    const offset = circumference - (Math.min(consumed / goal, 1) * circumference);

    document.getElementById('calorie-ring').style.strokeDashoffset = offset;
    document.getElementById('calories-consumed').textContent = consumed;
    document.getElementById('calories-goal').textContent     = goal;
    document.getElementById('carbs-val').textContent         = state.carbs + 'g';
    document.getElementById('protein-val').textContent       = state.protein + 'g';
    document.getElementById('fat-val').textContent           = state.fat + 'g';

    // ── Remaining badge ──────────────────────────────────────────────────
    const rem   = goal - consumed;
    const remEl = document.getElementById('hd-remaining');
    if (remEl) {
      remEl.textContent = rem >= 0 ? rem + ' kcal left' : Math.abs(rem) + ' kcal over';
      remEl.className   = 'hd-remaining-badge' + (rem < 0 ? ' over' : '');
    }

    // ── Macro progress bars ──────────────────────────────────────────────
    _updateMacroBar('hd-bar-carbs',   state.carbs,   state.carbsGoal,   'hd-carbs-lbl');
    _updateMacroBar('hd-bar-protein', state.protein, state.proteinGoal, 'hd-protein-lbl');
    _updateMacroBar('hd-bar-fat',     state.fat,     state.fatGoal,     'hd-fat-lbl');
  };

  const _updateMacroBar = (barId, val, goal, lblId) => {
    const bar = document.getElementById(barId);
    const lbl = document.getElementById(lblId);
    if (!bar || !lbl) return;
    const pct = goal > 0 ? Math.min((val / goal) * 100, 100) : 0;
    bar.style.width = pct + '%';
    lbl.textContent = val + ' / ' + goal + 'g';
  };

  const updateWater = () => {
    const pct = Math.min((state.water / state.waterGoal) * 100, 100);
    document.getElementById('water-fill').style.width = pct + '%';
    document.getElementById('water-amount').textContent =
      `${state.water} / ${state.waterGoal}ml`;
  };

  const addWater = (ml) => {
    state.water = Math.min(state.water + ml, state.waterGoal);
    updateWater();
    // Persist to water_logs collection
    if (typeof ThanziProgress !== 'undefined') {
      ThanziProgress.saveWater(ml);
    }
  };

  // ── Guest trial banner ───────────────────────────────────────────────────

  const updateTrialBanner = async (user) => {
    const banner = document.getElementById('trial-banner');
    if (!banner) return;

    if (!ThanziAuth.isGuest(user)) {
      banner.style.display = 'none';
      return;
    }

    const { daysLeft } = await ThanziAuth.getTrialStatus();
    const text = daysLeft <= 1
      ? "Last day of your free trial — create an account to keep your data"
      : `${daysLeft} days left in your free trial — create an account anytime`;
    document.getElementById('trial-banner-text').textContent = text;
    banner.style.display = 'flex';
  };

  // ── Dashboard init ───────────────────────────────────────────────────────

  const initDashboard = async (user) => {
    _currentUser = user;
    updateGreeting(user.name);
    updateRing();
    updateWater();
    updateTrialBanner(user);

    // Init the log module — also loads today's logs and syncs the ring
    if (typeof ThanziLog !== 'undefined') {
      await ThanziLog.init(user);
      _logInited = true;
    }

    // Init the profile module — stats, account info, avatar, sub-tabs
    if (typeof ThanziProfile !== 'undefined') {
      ThanziProfile.init(user);
      _profileInited = true;
    }

    // Init the progress module — weight, calorie history, water history
    if (typeof ThanziProgress !== 'undefined') {
      ThanziProgress.init(user);
    }

    // Init the AI assistant module
    if (typeof ThanziAI !== 'undefined') {
      ThanziAI.init(user, () => state);
    }

    // Init the custom foods module
    if (typeof ThanziCustomFoods !== 'undefined') {
      ThanziCustomFoods.init(user);
    }

    // Init the meal templates module
    if (typeof ThanziMealTemplates !== 'undefined') {
      ThanziMealTemplates.init(user);
    }
  };

  // ── Nav panel switching ──────────────────────────────────────────────────

  const bindNav = () => {
    // home → home-panel
    document.getElementById('nav-home').addEventListener('click', () => {
      _setActiveNav('nav-home');
      showPanel('home-panel');
    });

    // diary → diary-panel; refresh energy/consumed/expenditure + diversity each time the tab is opened
    document.getElementById('nav-diary').addEventListener('click', () => {
      _setActiveNav('nav-diary');
      showPanel('diary-panel');
      if (typeof ThanziDiary !== 'undefined') {
        ThanziDiary.refresh();
      }
    });

    // log → log-panel; refresh entries each time the tab is opened
    document.getElementById('nav-log').addEventListener('click', async () => {
      _setActiveNav('nav-log');
      showPanel('log-panel');
      if (_logInited && typeof ThanziLog !== 'undefined') {
        await ThanziLog.refresh();
      }
    });

    // progress — live panel
    document.getElementById('nav-progress').addEventListener('click', async () => {
      _setActiveNav('nav-progress');
      showPanel('progress-panel');
      if (typeof ThanziProgress !== 'undefined') {
        await ThanziProgress.refresh();
      }
    });

    document.getElementById('nav-profile').addEventListener('click', () => {
      _setActiveNav('nav-profile');
      showPanel('profile-panel');
      if (_profileInited && typeof ThanziProfile !== 'undefined') {
        ThanziProfile.refresh();
      }
    });
  };

  const _setActiveNav = (activeId) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(activeId).classList.add('active');
  };

  // ── Event binding ────────────────────────────────────────────────────────

  const bindEvents = () => {
    // Theme toggle
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

    // Profile option buttons
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        document.querySelectorAll(`[data-group="${group}"]`)
          .forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selections[group] = btn.dataset.val;
      });
    });

    // Save profile
    document.getElementById('save-profile-btn').addEventListener('click', async () => {
      const age    = parseInt(document.getElementById('p-age').value);
      const weight = parseFloat(document.getElementById('p-weight').value);
      const height = parseFloat(document.getElementById('p-height').value);
      const { gender, activity, goal } = selections;

      if (!age || !weight || !height || !gender || !activity || !goal) {
        document.getElementById('profile-error').textContent = 'Please fill in all fields';
        return;
      }

      const plan = ThanziNutrition.generate({
        age,
        sex:            gender,
        weight_kg:      weight,
        height_m:       height / 100,
        activity_level: activity,
        goal,
      });

      if (plan.error) {
        document.getElementById('profile-error').textContent = plan.error;
        return;
      }

      const user = await ThanziAuth.getUser();
      localStorage.setItem('thanzi_profile_' + user.$id, JSON.stringify(plan));
      applyPlan(plan);
      showScreen('dashboard-screen');
      await initDashboard(user);
      bindNav();
    });

    // Auth tabs
    document.getElementById('login-tab').addEventListener('click', () => {
      document.getElementById('login-form').style.display = 'block';
      document.getElementById('register-form').style.display = 'none';
      document.getElementById('login-tab').classList.add('active');
      document.getElementById('register-tab').classList.remove('active');
    });

    document.getElementById('register-tab').addEventListener('click', () => {
      document.getElementById('register-form').style.display = 'block';
      document.getElementById('login-form').style.display = 'none';
      document.getElementById('register-tab').classList.add('active');
      document.getElementById('login-tab').classList.remove('active');
    });

    // Login
    document.getElementById('login-btn').addEventListener('click', async () => {
      const email    = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const result   = await ThanziAuth.login(email, password);

      if (result.success) {
        const user    = await ThanziAuth.getUser();
        const profile = localStorage.getItem('thanzi_profile_' + user.$id);

        if (profile) {
          applyPlan(JSON.parse(profile));
          showScreen('dashboard-screen');
          await initDashboard(user);
          bindNav();
        } else {
          showScreen('profile-screen');
        }
      } else {
        document.getElementById('auth-error').textContent = result.error;
      }
    });

    // Register
    document.getElementById('register-btn').addEventListener('click', async () => {
      const name     = document.getElementById('reg-name').value;
      const email    = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const result   = await ThanziAuth.register(name, email, password);

      if (!result.success) {
        document.getElementById('auth-error').textContent = result.error;
        return;
      }

      if (result.sessionFailed) {
        // Account was created but no session — most likely the deployed
        // origin isn't registered as a Web Platform in Appwrite, so the
        // session cookie was rejected. Send them to login instead of
        // profile-screen, since getUser() would fail there anyway.
        document.getElementById('auth-error').textContent =
          'Account created! Please log in to continue.';
        document.getElementById('login-tab').click();
        return;
      }

      // Verify the session actually persisted before moving on — avoids
      // routing to profile-screen only to bounce back to auth-screen on
      // the next reload if the cookie didn't stick.
      const user = await ThanziAuth.getUser();
      if (user) {
        showScreen('profile-screen');
      } else {
        document.getElementById('auth-error').textContent =
          'Account created, but we couldn\'t start your session. Please log in.';
        document.getElementById('login-tab').click();
      }
    });

    // Google OAuth
    const googleBtn = document.getElementById('google-oauth-btn');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => ThanziAuth.loginWithGoogle());
    }

    // Continue as Guest — no account required, starts the 14-day trial
    document.getElementById('guest-btn').addEventListener('click', async () => {
      const result = await ThanziAuth.loginAsGuest();
      if (!result.success) {
        document.getElementById('auth-error').textContent = result.error;
        return;
      }
      const user = await ThanziAuth.getUser();
      if (user) {
        showScreen('profile-screen');
      } else {
        document.getElementById('auth-error').textContent =
          'Could not start a guest session. Please try again.';
      }
    });

    // Trial upgrade — converts the active guest session into a real account
    // in place, so every log/recipe row already tied to this $id stays put.
    document.getElementById('trial-upgrade-btn').addEventListener('click', async () => {
      const name     = document.getElementById('trial-name').value;
      const email    = document.getElementById('trial-email').value;
      const password = document.getElementById('trial-password').value;
      const result   = await ThanziAuth.upgradeGuestAccount(name, email, password);

      if (!result.success) {
        document.getElementById('trial-error').textContent = result.error;
        return;
      }

      const user = await ThanziAuth.getUser();
      if (!user) {
        document.getElementById('trial-error').textContent =
          'Account created, but we couldn\'t verify your session. Please reload and log in.';
        return;
      }

      const profile = localStorage.getItem('thanzi_profile_' + user.$id);
      if (profile) {
        applyPlan(JSON.parse(profile));
        showScreen('dashboard-screen');
        await initDashboard(user);
        bindNav();
      } else {
        showScreen('profile-screen');
      }
    });

    // Trial banner CTA — lets a guest upgrade voluntarily before expiry
    const trialBannerCta = document.getElementById('trial-banner-cta');
    if (trialBannerCta) {
      trialBannerCta.addEventListener('click', () => showUpgradeScreen(false));
    }

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await ThanziAuth.logout();
      _logInited = false;
      _currentUser = null;
      showScreen('auth-screen');
    });
  };

  // ── Trial upgrade screen ─────────────────────────────────────────────────
  //
  // Shared by two paths: a guest whose 14-day trial has expired (blocked,
  // forced to upgrade) and a guest who taps the trial banner to upgrade
  // early, voluntarily, while still inside the trial window.
  const showUpgradeScreen = (expired) => {
    document.getElementById('trial-expired-title').textContent = expired
      ? 'Your free trial has ended'
      : 'Create your Thanzi account';
    document.getElementById('trial-expired-sub').textContent = expired
      ? 'Your 14-day guest trial is over. Create a free account to keep going — ' +
        'all your logged meals and recipes are saved and will carry right over.'
      : 'Save your progress permanently — all your logged meals and recipes carry over.';
    document.getElementById('trial-error').textContent = '';
    showScreen('trial-expired-screen');
  };

  // ── App init ─────────────────────────────────────────────────────────────

  const init = async () => {
    initTheme();

    try {
      // Exchange OAuth callback params for a real session (Appwrite SDK v13+).
      // After Google sign-in, Appwrite redirects back with ?userId=...&secret=...
      // in the URL. handleOAuthCallback() calls account.createSession(userId, secret)
      // to finalise the session, then strips the params from the URL. Without this,
      // account.get() below finds no session and the user appears logged out.
      await ThanziAuth.handleOAuthCallback();

      const user = await ThanziAuth.getUser();

      if (user) {
        // Guests get full access for 14 days; once expired, block the app
        // behind the upgrade screen. Their data isn't touched — upgrading
        // converts this same session into a permanent account.
        if (ThanziAuth.isGuest(user)) {
          const trial = await ThanziAuth.getTrialStatus();
          if (trial.expired) {
            showUpgradeScreen(true);
            bindEvents();
            return;
          }
        }

        const profile = localStorage.getItem('thanzi_profile_' + user.$id);

        if (profile) {
          applyPlan(JSON.parse(profile));
          showScreen('dashboard-screen');
          await initDashboard(user);
          bindNav();
        } else {
          showScreen('profile-screen');
        }
      } else {
        showScreen('auth-screen');
      }
    } catch (err) {
      // Whatever went wrong (network blip, bad session, etc.), never leave
      // the splash screen stuck — fall back to the login form.
      console.warn('[ThanziApp] init() routing failed, falling back to auth screen:', err);
      showScreen('auth-screen');
    }

    bindEvents();
  };

  // ── Expose setWaterGoal for settings.js ─────────────────────────────────
  const setWaterGoal = (ml) => {
    state.waterGoal = ml;
    updateWater();
  };

  // ── Update home meals summary (called by ThanziLog after each change) ────
  const updateHomeMeals = (logs) => {
    const el = document.getElementById('hd-meals-list');
    if (!el) return;

    const groups = { breakfast: [], lunch: [], dinner: [], snack: [] };
    const LABELS = { breakfast: '🌅 Breakfast', lunch: '☀️ Lunch', dinner: '🌙 Dinner', snack: '🍎 Snack' };
    const ORDER  = ['breakfast', 'lunch', 'dinner', 'snack'];

    (logs || []).forEach(l => { if (groups[l.mealType]) groups[l.mealType].push(l); });

    const filled = ORDER.filter(m => groups[m].length > 0);

    if (!filled.length) {
      el.innerHTML = '<div class="hd-meals-empty">No meals logged yet today</div>';
      return;
    }

    el.innerHTML = filled.map(meal => {
      const entries = groups[meal];
      const kcal    = entries.reduce((s, e) => s + (e.calories || 0), 0);
      const names   = entries.slice(0, 2).map(e => e.foodName).join(', ')
                    + (entries.length > 2 ? ` +${entries.length - 2} more` : '');
      return `
        <div class="hd-meal-row">
          <span class="hd-meal-label">${LABELS[meal]}</span>
          <span class="hd-meal-foods">${names}</span>
          <span class="hd-meal-kcal">${kcal} kcal</span>
        </div>`;
    }).join('');
  };

  return { init, addWater, updateNutrition, setWaterGoal, updateHomeMeals };
})();

document.addEventListener('DOMContentLoaded', ThanziApp.init);
