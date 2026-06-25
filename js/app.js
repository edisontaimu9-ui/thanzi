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
    document.getElementById('greeting').textContent =
      `${greeting}, ${name.split(' ')[0]}`;
  };

  const updateRing = () => {
    const consumed     = state.caloriesConsumed;
    const goal         = state.caloriesGoal;
    const circumference = 314;
    const offset = circumference - (Math.min(consumed / goal, 1) * circumference);

    document.getElementById('calorie-ring').style.strokeDashoffset = offset;
    document.getElementById('calories-consumed').textContent = consumed;
    document.getElementById('calories-goal').textContent     = goal;
    document.getElementById('carbs-val').textContent         = state.carbs + 'g';
    document.getElementById('protein-val').textContent       = state.protein + 'g';
    document.getElementById('fat-val').textContent           = state.fat + 'g';
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

  // ── Dashboard init ───────────────────────────────────────────────────────

  const initDashboard = async (user) => {
    _currentUser = user;
    updateGreeting(user.name);
    updateRing();
    updateWater();

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
  };

  // ── Nav panel switching ──────────────────────────────────────────────────

  const bindNav = () => {
    // home → home-panel
    document.getElementById('nav-home').addEventListener('click', () => {
      _setActiveNav('nav-home');
      showPanel('home-panel');
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

      if (result.success) {
        showScreen('profile-screen');
      } else {
        document.getElementById('auth-error').textContent = result.error;
      }
    });

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await ThanziAuth.logout();
      _logInited = false;
      _currentUser = null;
      showScreen('auth-screen');
    });
  };

  // ── App init ─────────────────────────────────────────────────────────────

  const init = async () => {
    initTheme();

    const user = await ThanziAuth.getUser();

    if (user) {
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

    bindEvents();
  };

  return { init, addWater, updateNutrition };
})();

document.addEventListener('DOMContentLoaded', ThanziApp.init);
