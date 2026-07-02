const ThanziAuth = (() => {
  const client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const account = new Appwrite.Account(client);

  const register = async (name, email, password) => {
    try {
      await account.create(Appwrite.ID.unique(), email, password, name);
    } catch (err) {
      return { success: false, error: err.message };
    }

    // Account was created — now try to establish a session. If this step
    // fails (e.g. current origin isn't a registered Web Platform in the
    // Appwrite console), the account still exists, so tell the caller the
    // account was made but ask them to log in manually rather than showing
    // a generic register error.
    try {
      await account.createEmailSession(email, password);
      return { success: true };
    } catch (err) {
      console.warn('[ThanziAuth] Account created but session failed:', err.code, err.message);
      return { success: true, sessionFailed: true, error: err.message };
    }
  };

  const login = async (email, password) => {
    try {
      await account.createEmailSession(email, password);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      await account.deleteSession('current');
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const getUser = async () => {
    try {
      return await account.get();
    } catch (err) {
      // Surface the real reason in dev tools instead of failing silently.
      // The most common cause of "auth screen reappears after register/login"
      // is that the deployed origin (e.g. your GitHub Pages URL) isn't listed
      // as a Web Platform in the Appwrite console — Appwrite refuses to set
      // the session cookie for unregistered origins, so account.get() always
      // 401s even though createEmailSession() reported success.
      console.warn('[ThanziAuth] getUser() failed:', err.code, err.message);
      return null;
    }
  };

  const updateName = async (name) => {
    try {
      const user = await account.updateName(name);
      return { success: true, user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // Fixed: use origin+pathname so stale query params never pollute the OAuth redirect URL
  const loginWithGoogle = () => {
    const base = window.location.origin + window.location.pathname;
    account.createOAuth2Session('google', base, base);
  };

  // Handles the Appwrite OAuth callback in SDK v13+.
  // After the Google redirect, Appwrite appends ?userId=...&secret=... to the URL.
  // We must call account.createSession(userId, secret) to exchange them for a real
  // session — without this, account.get() finds nothing and the user appears logged out.
  const handleOAuthCallback = async () => {
    const params = new URLSearchParams(window.location.search);
    const userId = params.get('userId');
    const secret = params.get('secret');

    if (userId && secret) {
      try {
        await account.createSession(userId, secret);
      } catch (e) {
        // Session may already exist if the page reloaded — safe to ignore
      }
      // Clean the URL so the params don't re-trigger on refresh
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  return { register, login, logout, getUser, updateName, loginWithGoogle, handleOAuthCallback };
})();
