import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, studentEmail, friendlyError, rpc, normIndex } from './supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState('');

  const loadProfile = useCallback(async (sess) => {
    if (!sess) {
      setProfile(null);
      return;
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', sess.user.id).maybeSingle();
    if (error) setProfileError(friendlyError(error));
    else if (!data) setProfileError('Your account is not linked to the class list. Please contact your lecturer.');
    else setProfileError('');
    setProfile(data || null);
  }, []);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (active) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // run outside the auth callback to avoid a deadlock in supabase-js
        setTimeout(() => loadProfile(sess), 0);
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  async function signIn(identifier, password) {
    const id = String(identifier || '').trim();
    const email = id.includes('@') ? id.toLowerCase() : studentEmail(id);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyError(error));
    await loadProfile(data.session);
    return data;
  }

  async function activate(index, password) {
    const status = await rpc('check_index', { p_index: index });
    if (status === 'not_found') {
      throw new Error('That index number is not on any class list yet. Check it, or ask your lecturer to add you.');
    }
    if (status === 'active') {
      throw new Error('This index number already has an account. Sign in instead, or ask your lecturer to reset your password.');
    }
    const { data, error } = await supabase.auth.signUp({
      email: studentEmail(index),
      password,
      options: { data: { index_no: normIndex(index) } },
    });
    if (error) throw new Error(friendlyError(error));
    if (!data.session) {
      throw new Error('Account created, but sign-in did not start. Ask your lecturer to turn off "Confirm email" in Supabase.');
    }
    await loadProfile(data.session);
    return data;
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
  }

  const value = {
    session,
    profile,
    loading,
    profileError,
    isLecturer: profile?.role === 'lecturer',
    signIn,
    activate,
    signOut,
    reloadProfile: () => loadProfile(session),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
