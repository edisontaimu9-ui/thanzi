const ThanziApp = (() => {
  const init = async () => {
    const user = await ThanziAuth.getUser();
    if (user) {
      showScreen('dashboard-screen');
    } else {
      showScreen('auth-screen');
    }
    bindEvents();
  };

  const showScreen = (screenId) => {
    document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
    document.getElementById(screenId).style.display = 'block';
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
        showScreen('dashboard-screen');
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
        showScreen('dashboard-screen');
      } else {
        document.getElementById('auth-error').textContent = result.error;
      }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await ThanziAuth.logout();
      showScreen('auth-screen');
    });
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', ThanziApp.init);
