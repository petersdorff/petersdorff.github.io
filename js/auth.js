/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Authentication (Supabase Auth)
   ═══════════════════════════════════════════════════════════ */

const Auth = (() => {
  let supabase = null;
  let currentUser = null;
  let currentMember = null;
  let onAuthChangeCallback = null;
  let onPasswordRecoveryCallback = null;
  let isRecoveryMode = false;

  // Detect recovery mode from URL hash BEFORE Supabase processes it.
  // Supabase recovery links contain type=recovery in the URL hash/params.
  function detectRecoveryFromUrl() {
    const hash = window.location.hash;
    const search = window.location.search;
    const fullUrl = hash + search;
    if (fullUrl.includes('type=recovery') || fullUrl.includes('type=magiclink')) {
      console.log('[Auth] Recovery mode detected from URL');
      isRecoveryMode = true;
    }
  }

  function init(supabaseClient) {
    supabase = supabaseClient;

    // Check URL for recovery tokens FIRST
    detectRecoveryFromUrl();

    // Track whether the initial session check has completed,
    // so we don't double-fire from both checkSession and onAuthStateChange.
    let initialCheckDone = false;

    // Listen for auth state changes (login, logout, token refresh)
    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('[Auth] onAuthStateChange:', event, 'recoveryMode:', isRecoveryMode);

      // Skip INITIAL_SESSION — checkSession handles initial load
      if (event === 'INITIAL_SESSION') return;

      if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentMember = null;
        isRecoveryMode = false;
        if (onAuthChangeCallback) onAuthChangeCallback(null, null);
      } else if (event === 'PASSWORD_RECOVERY') {
        isRecoveryMode = true;
        currentUser = session?.user || null;
        if (onPasswordRecoveryCallback) onPasswordRecoveryCallback();
      } else if (event === 'SIGNED_IN') {
        currentUser = session?.user || null;
        if (isRecoveryMode) {
          console.log('[Auth] SIGNED_IN during recovery → showing password form');
          if (onPasswordRecoveryCallback) onPasswordRecoveryCallback();
          return;
        }
        // If the initial check already fired SIGNED_IN, skip this duplicate.
        // But if initial check showed no session (user was logged out) and
        // user just logged in, this is a real new login — process it.
        if (!initialCheckDone) return; // still loading, checkSession will handle it
        // User just logged in — resolve and notify
        resolveAndNotify(event);
      } else if (event === 'TOKEN_REFRESHED') {
        currentUser = session?.user || null;
        // Just update user, don't re-trigger full flow
        if (onAuthChangeCallback) onAuthChangeCallback(currentUser, currentMember, event);
      }
    });

    // Defer initial session check to next tick so the caller
    // has time to register the onAuthChange callback first
    setTimeout(async () => {
      await checkSession();
      initialCheckDone = true;
    }, 0);
  }

  async function checkSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      console.log('[Auth] getSession:', session?.user?.id || 'no session', 'recoveryMode:', isRecoveryMode);
      if (session?.user) {
        currentUser = session.user;
        // If in recovery mode, show the password form instead of normal flow
        if (isRecoveryMode) {
          console.log('[Auth] checkSession: recovery mode → showing password form');
          if (onPasswordRecoveryCallback) onPasswordRecoveryCallback();
          return;
        }
        await resolveAndNotify();
      } else {
        currentUser = null;
        currentMember = null;
        if (onAuthChangeCallback) onAuthChangeCallback(null, null);
      }
    } catch (err) {
      console.error('[Auth] getSession error:', err);
      if (onAuthChangeCallback) onAuthChangeCallback(null, null);
    }
  }

  async function resolveAndNotify(event) {
    if (!currentUser) {
      if (onAuthChangeCallback) onAuthChangeCallback(null, null, event);
      return;
    }
    try {
      currentMember = await DB.findMemberByUid(currentUser.id);
      console.log('[Auth] member resolved:', currentMember?.id || 'none');
    } catch (err) {
      console.error('[Auth] findMemberByUid failed:', err);
      currentMember = null;
    }
    if (onAuthChangeCallback) onAuthChangeCallback(currentUser, currentMember, event);
  }

  function onAuthChange(callback) {
    onAuthChangeCallback = callback;
  }

  function onPasswordRecovery(callback) {
    onPasswordRecoveryCallback = callback;
  }

  function getUser() {
    return currentUser;
  }

  function getMember() {
    return currentMember;
  }

  function setMember(member) {
    currentMember = member;
  }

  async function loginWithEmail(email, password) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { success: false, error: mapAuthError(error.message) };
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: mapAuthError(err.message) };
    }
  }

  async function registerWithEmail(email, password, displayName) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
        },
      });
      if (error) return { success: false, error: mapAuthError(error.message) };
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: mapAuthError(err.message) };
    }
  }

  async function resetPassword(email) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname,
      });
      if (error) return { success: false, error: mapAuthError(error.message) };
      return { success: true };
    } catch (err) {
      return { success: false, error: mapAuthError(err.message) };
    }
  }

  async function updatePassword(newPassword) {
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) return { success: false, error: mapAuthError(error.message) };
      // Clear recovery mode — user has set a new password
      isRecoveryMode = false;
      // Clean up the URL hash so recovery tokens don't linger
      if (window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  function isInRecoveryMode() {
    return isRecoveryMode;
  }

  async function logout() {
    await supabase.auth.signOut();
    currentUser = null;
    currentMember = null;
  }

  function mapAuthError(message) {
    const msg = message.toLowerCase();
    if (msg.includes('invalid login')) return 'E-Mail oder Passwort falsch.';
    if (msg.includes('already registered')) return 'Diese E-Mail ist bereits registriert.';
    if (msg.includes('password')) return 'Passwort zu schwach (mind. 6 Zeichen).';
    if (msg.includes('invalid email')) return 'Ungültige E-Mail-Adresse.';
    if (msg.includes('rate limit')) return 'Zu viele Versuche. Bitte warte einen Moment.';
    if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('fetch') || msg.includes('load failed'))
      return 'Netzwerkfehler. Bitte prüfe deine Verbindung und versuche es erneut.';
    if (msg.includes('email not confirmed')) return 'Bitte bestätige zuerst deine E-Mail-Adresse.';
    return message;
  }

  return {
    init,
    onAuthChange,
    getUser,
    getMember,
    setMember,
    loginWithEmail,
    registerWithEmail,
    resetPassword,
    updatePassword,
    onPasswordRecovery,
    isInRecoveryMode,
    logout,
  };
})();
