const ThanziAuth = (() => {
  const client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const account = new Appwrite.Account(client);

  const register = async (name, email, password) => {
    try {
      await account.create(Appwrite.ID.unique(), email, password, name);
      await account.createEmailSession(email, password);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
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
    } catch {
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
