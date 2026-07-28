const ThanziAuth = (() => {
  const client = new Appwrite.Client()
    .setEndpoint(THANZI_CONFIG.endpoint)
    .setProject(THANZI_CONFIG.projectId);

  const account = new Appwrite.Account(client);

  // ── Trial config ─────────────────────────────────────────────────────────
  const TRIAL_DAYS = 14;
  const TRIAL_MS    = TRIAL_DAYS * 24 * 60 * 60 * 1000;

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
      await account.createEmailPasswordSession(email, password);
      return { success: true };
    } catch (err) {
      console.warn('[ThanziAuth] Account created but session failed:', err.code, err.message);
      return { success: true, sessionFailed: true, error: err.message };
    }
  };

  // ── Guest mode — no account required ────────────────────────────────────
  //
  // Uses Appwrite's anonymous sessions: a real user record with a real $id
  // is created, so guests get full read/write access to their own log and
  // recipe data (Appwrite Database rows are scoped by userId = $id) exactly
  // like a registered user. Nothing to migrate later — see
  // upgradeGuestAccount() below, which converts this same account in place.
  const loginAsGuest = async () => {
    try {
      await account.createAnonymousSession();
    } catch (err) {
      return { success: false, error: err.message };
    }

    // Stamp the trial clock the moment the guest session exists, so it
    // can't be reset by anything the client does afterward.
    await getTrialStatus();

    // Soft, client-side deterrent only — NOT a real abuse guard. A user who
    // clears site data or switches browsers can still start a fresh guest
    // trial. There is no reliable device-level enforcement possible from
    // pure client code; a real guard would need server-side (e.g. IP or
    // device-fingerprint) tracking on the Appwrite/Worker side.
    try { localStorage.setItem('thanzi_guest_used', '1'); } catch (_e) {}

    return { success: true };
  };

  /** True if `user` is an anonymous (guest) session — Appwrite anonymous
   *  accounts always have an empty email string. */
  const isGuest = (user) => !!user && !user.email;

  /**
   * Read (and lazily initialise) the trial clock for the current session,
   * stored in the account's own prefs so it travels with the session and
   * isn't just sitting in localStorage where it could be wiped.
   *
   * @returns {Promise<{start:number|null, daysLeft:number, expired:boolean}>}
   */
  const getTrialStatus = async () => {
    try {
      const prefs = await account.getPrefs();
      let start = prefs.trialStart;

      if (!start) {
        start = Date.now();
        await account.updatePrefs({ ...prefs, trialStart: start });
      }

      const elapsed  = Date.now() - start;
      const daysLeft = Math.max(0, Math.ceil((TRIAL_MS - elapsed) / (24 * 60 * 60 * 1000)));
      return { start, daysLeft, expired: elapsed >= TRIAL_MS };
    } catch (err) {
      console.warn('[ThanziAuth] getTrialStatus() failed:', err.code, err.message);
      // Fail open on read errors (network blip, etc.) rather than locking
      // someone out of an app they're already using.
      return { start: null, daysLeft: TRIAL_DAYS, expired: false };
    }
  };

  /**
   * Convert the currently-active guest (anonymous) session into a real,
   * permanent account — same $id, so all Appwrite Database rows already
   * written under this userId (log entries, recipes) stay attached with
   * nothing to migrate.
   */
  const upgradeGuestAccount = async (name, email, password) => {
    try {
      // Appwrite: calling updateEmail on an anonymous session both sets the
      // email and the password, converting the account to a permanent one.
      await account.updateEmail(email, password);
      if (name) await account.updateName(name);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  const login = async (email, password) => {
    try {
      await account.createEmailPasswordSession(email, password);
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

  // Opens Google sign-in in a popup instead of navigating Thanzi's own tab
  // away. The popup lands back on Thanzi's own URL (it's both the success
  // and failure target), which — since it's the same origin — runs this
  // same app.js again inside the popup. app.js's init() detects it's
  // running as a popup (window.opener is set) and short-circuits: it
  // exchanges the session, tells the opener via postMessage, and closes
  // itself immediately rather than rendering the full UI in that tiny
  // window. This function just opens the popup and waits for that message.
  //
  // We build the OAuth2 token URL by hand (GET /account/tokens/oauth2/google)
  // rather than calling account.createOAuth2Token(), because that SDK method
  // navigates the current window directly — there's no way to get a URL out
  // of it to hand to window.open() instead.
  const loginWithGoogle = () => {
    return new Promise((resolve) => {
      const base = window.location.origin + window.location.pathname;
      const url = `${THANZI_CONFIG.endpoint}/account/tokens/oauth2/google` +
        `?project=${encodeURIComponent(THANZI_CONFIG.projectId)}` +
        `&success=${encodeURIComponent(base)}` +
        `&failure=${encodeURIComponent(base)}`;

      const popup = window.open(url, 'thanziGoogleAuth', 'width=480,height=640');

      if (!popup) {
        // Browser blocked the popup — fall back to the old full-page redirect
        // so sign-in still works, just without the nicer popup UX.
        try {
          account.createOAuth2Token('google', base, base);
        } catch (err) {
          console.error('[ThanziAuth] createOAuth2Token threw:', err);
        }
        resolve(false);
        return;
      }

      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(watchClosed);
        resolve(ok);
      };

      const onMessage = (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data && event.data.type === 'thanzi-oauth-complete') finish(true);
      };
      window.addEventListener('message', onMessage);

      // If the person closes the popup manually without finishing sign-in,
      // stop waiting instead of hanging forever.
      const watchClosed = setInterval(() => {
        if (popup.closed) finish(false);
      }, 500);
    });
  };

  // Handles the Appwrite OAuth callback (token flow).
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
        console.warn('[ThanziAuth] createSession failed:', e.code, e.message);
      }
      // Clean the URL so the params don't re-trigger on refresh
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  return {
    register, login, logout, getUser, updateName, loginWithGoogle, handleOAuthCallback,
    loginAsGuest, isGuest, getTrialStatus, upgradeGuestAccount, TRIAL_DAYS,
  };
})();
