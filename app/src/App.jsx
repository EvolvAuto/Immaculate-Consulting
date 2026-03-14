/**
 * App.jsx
 * Root application shell for IC-BOS.
 * Handles authentication gate and wraps the dashboard in the data provider.
 */

import { useState, useEffect } from 'react';
import { supabase } from './lib/supabaseClient';
import ICBOS from './components/IC-BOS';

// ─── Simple Auth Gate ─────────────────────────────────────────────────────────
// Shows a login screen until Supabase confirms a valid session.
// Phase 4 will replace this with a full auth UI + role-based routing.

function LoginScreen({ onLogin, error }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) return;
    setLoading(true);
    await onLogin(email, password);
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      <div style={{
        background: '#13131a',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: '48px 40px',
        width: 380,
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>
        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: 22,
          }}>⚡</div>
          <h1 style={{ color: '#f9fafb', fontSize: 22, fontWeight: 700, margin: 0 }}>IC-BOS</h1>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: 6 }}>Immaculate Consulting Operations</p>
        </div>

        {/* Email */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 6 }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="leonard@immaculate-consulting.org"
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 8,
              background: '#1c1c28', border: '1px solid rgba(255,255,255,0.1)',
              color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', color: '#9ca3af', fontSize: 12, marginBottom: 6 }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="••••••••"
            style={{
              width: '100%', padding: '10px 14px', borderRadius: 8,
              background: '#1c1c28', border: '1px solid rgba(255,255,255,0.1)',
              color: '#f9fafb', fontSize: 14, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 16,
            color: '#f87171', fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: '100%', padding: '12px', borderRadius: 8, border: 'none',
            background: loading ? '#374151' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s',
          }}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </div>
    </div>
  );
}

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
    return <LoginScreen onLogin={handleLogin} error={authError} />;
  }

  // Logged in — show dashboard
  return <ICBOS />;
}
```
