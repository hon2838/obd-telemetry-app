import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { apiFetch, applyAuthResponse } from '../api';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (router.query.reason === 'session') setError('Your session expired. Please sign in again.');
  }, [router.query.reason]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Sign in failed (HTTP ${response.status})`);
      applyAuthResponse(body);
      const destination = typeof router.query.next === 'string' && router.query.next.startsWith('/') ? router.query.next : '/';
      await router.replace(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  };

  return <>
    <Head><title>Sign in | OBD Telemetry</title></Head>
    <main className="login-page">
      <section className="glass-panel-static login-card">
        <div className="brand-block"><h1>OBD Telemetry</h1><p>Vehicle telemetry & fleet hub</p></div>
        <h2>Sign in</h2>
        <p className="login-subtitle">Use your dashboard account to continue.</p>
        {error && <div className="login-error" role="alert">{error}</div>}
        <form onSubmit={submit} className="login-form">
          <label htmlFor="login-username">Username</label>
          <input id="login-username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required />
          <label htmlFor="login-password">Password</label>
          <input id="login-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
          <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  </>;
}
