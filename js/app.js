const ThanziApp = (() => {
  let state = {
    caloriesConsumed: 0,
    caloriesGoal: 2000,
    carbs: 0,
    protein: 0,
    fat: 0,
    water: 0,
    waterGoal: 2000
  };

  const init = async () => {
    const user = await ThanziAuth.getUser();
    if (user) {
      showScreen('dashboard-screen');
      updateGreeting(user.name);
      updateRing();
      updateWater();
    } else {
      showScreen('auth-screen');
    }
    bindEvents();
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
        showScreen('dashboard-screen');
        updateGreeting(user.name);
        updateRing();
        updateWater();
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
        const user = await ThanziAuth.getUser();
        showScreen('dashboard-screen');
        updateGreeting(user.name);
        updateRing();
        updateWater();
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
