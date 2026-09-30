import { useState } from 'react';
import { api } from '../api.js';

export function LoginPage({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { username, password });
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="row">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <h1>Harness Designer</h1>
        </div>
        <p className="muted">Bitte melde dich an.</p>
        {error && <div className="error-box">{error}</div>}
        <label className="field">
          Benutzername
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          Passwort
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !username || !password}>
          Anmelden
        </button>
        <p className="muted small">Konten werden von einem Administrator angelegt.</p>
      </form>
    </div>
  );
}

export function SetupPage({ onDone }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', password2: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.password2) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/setup', { username: form.username, displayName: form.displayName, password: form.password });
      await onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="row">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <h1>Ersteinrichtung</h1>
        </div>
        <p className="muted">Lege das erste Konto an. Es erhält Administratorrechte und kann weitere Benutzer anlegen.</p>
        {error && <div className="error-box">{error}</div>}
        <label className="field">
          Benutzername
          <input autoFocus value={form.username} onChange={set('username')} autoComplete="username" />
        </label>
        <label className="field">
          Anzeigename
          <input value={form.displayName} onChange={set('displayName')} />
        </label>
        <label className="field">
          Passwort (mind. 8 Zeichen)
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        <label className="field">
          Passwort wiederholen
          <input type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" />
        </label>
        <button className="primary" disabled={busy || !form.username || !form.password}>
          Administrator anlegen
        </button>
      </form>
    </div>
  );
}
