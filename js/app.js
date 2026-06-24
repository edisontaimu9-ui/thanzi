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
    waterGoal: 2000
  };

  let selections = { gender: null, activity: null, goal: null };

  const init = async () => {
    const user = await ThanziAuth.getUser();
    if (user) {
      const profile = localStorage.getItem('thanzi_profile_' + user.$id);
      if (profile) {
        const plan = JSON.parse(profile);
        applyPlan(plan);
        showScreen('dashboard-screen');
        updateGreeting(user.name);
        updateRing();
        updateWater();
      } else {
        showScreen('profile-screen');
      }
    } else {
      showScreen('auth-screen');
    }
    bindEvents();
  };

  const applyPlan = (plan) => {
    state.caloriesGoal = plan.energy.target_kcal;
    state.carbsGoal = plan.macros.carbs.g;
    state.proteinGoal = plan.macros.protein.g;
    state.fatGoal = plan.macros.fat.g;
    state.waterGoal = Math.round(plan.micronutrients.fluid_L * 1000);
  };

  const showScreen = (screenId) => {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
  };

  const updateGreeting = (name) => {
    const hour = new Date().getHours();
    let greeting = 'Good morning';
    if (hour >= 12 && hour < 17) greeting = 'Good afternoon';
    else if (hour >= 17) greeting = 'Good evening';
    document.getElementById('greeting').textContent = `${greeting}, ${name.split(' ')[0]}`;
  };

  const updateRing = () => {
    const consumed = state.caloriesConsumed;
    const goal = state.caloriesGoal;
    const circumference = 314;
    const offset = circumference - (Math.min(consumed / goal, 1) * circumference);
    document.getElementById('calorie-ring').style.strokeDashoffset = offset;
    document.getElementById('calories-consumed').textContent = consumed;
    document.getElementById('calories-goal').textContent = goal;
    document.getElementById('carbs-val').textContent = state.carbs + 'g';
    document.getElementById('protein-val').textContent = state.protein + 'g';
    document.getElementById('fat-val').textContent = state.fat + 'g';
  };

  const updateWater = () => {
    const pct = Math.min((state.water / state.waterGoal) * 100, 100);
    document.getElementById('water-fill').style.width = pct + '%';
    document.getElementById('water-amount').textContent = `${state.water} / ${state.waterGoal}ml`;
  };

  const addWater = (ml) => {
    state.water = Math.min(state.water + ml, state.waterGoal);
    updateWater();
  };

  const bindEvents = () => {
    // Option buttons
    document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = btn.dataset.group;
        document.querySelectorAll(`[data-group="${group}"]`).forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selections[group] = btn.dataset.val;
      });
    });

    // Save profile
    document.getElementById('save-profile-btn').addEventListener('click', async () => {
      const age = parseInt(document.getElementById('p-age').value);
      const weight = parseFloat(document.getElementById('p-weight').value);
      const height = parseFloat(document.getElementById('p-height').value);
      const { gender, activity, goal } = selections;

      if (!age || !weight || !height || !gender || !activity || !goal) {
        document.getElementById('profile-error').textContent = 'Please fill in all fields';
        return;
      }

      const plan = ThanziNutrition.generate({
        age,
        sex: gender,
        weight_kg: weight,
        height_m: height / 100,
        activity_level: activity,
        goal
      });

      if (plan.error) {
        document.getElementById('profile-error').textContent = plan.error;
        return;
      }

      const user = await ThanziAuth.getUser();
      localStorage.setItem('thanzi_profile_' + user.$id, JSON.stringify(plan));
      applyPlan(plan);
      showScreen('dashboard-screen');
      updateGreeting(user.name);
      updateRing();
      updateWater();
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

    document.getElementById('login-btn').addEventListener('click', async () => {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const result = await ThanziAuth.login(email, password);
      if (result.success) {
        const user = await ThanziAuth.getUser();
        const profile = localStorage.getItem('thanzi_profile_' + user.$id);
        if (profile) {
          applyPlan(JSON.parse(profile));
          showScreen('dashboard-screen');
          updateGreeting(user.name);
          updateRing();
          updateWater();
        } else {
          showScreen('profile-screen');
        }
      } else {
        document.getElementById('auth-error').textContent = result.error;
      }
    });

    document.getElementById('register-btn').addEventListener('click', async () => {
      const name = document.getElementById('reg-name').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-password').value;
      const result = await ThanziAuth.register(name, email, password);
      if (result.success) {
        showScreen('profile-screen');
      } else {
        document.getElementById('auth-error').textContent = result.error;
      }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await ThanziAuth.logout();
      showScreen('auth-screen');
    });
  };

  return { init, addWater };
})();

document.addEventListener('DOMContentLoaded', ThanziApp.init);
