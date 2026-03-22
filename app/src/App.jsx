/**
 * App.jsx
 * Root application shell for IC-BOS.
 * Handles authentication gate and wraps the dashboard in the data provider.
 */

import { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import ICBOS from './components/IC-BOS';
import ICBOSLogin from './components/ICBOSLogin';

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [authError, setAuthError] = useState(null);

  // Check for existing session on mount, then listen for auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async (email, password) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
  };

  // Still checking session
  if (session === undefined) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0f',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ color: '#6b7280', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  // Not logged in
  if (!session) {
    return <ICBOSLogin />;
  }

  // Logged in — show dashboard
  return <ICBOS />;
}
