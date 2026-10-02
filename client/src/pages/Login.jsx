import { useState } from 'react';
import { api } from '../api.js';
import { t, getLang, setLang, LANGUAGES } from '../i18n/index.js';

function LangSwitch() {
  return (
    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
      {LANGUAGES.map((l) => (
        <button key={l.code} type="button" className={`small ${getLang() === l.code ? 'active' : 'ghost'}`} onClick={() => setLang(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

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
        <LangSwitch />
        <div className="row">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <h1>CableDesigner2000</h1>
        </div>
        <p className="muted">{t('Please sign in.')}</p>
        {error && <div className="error-box">{error}</div>}
        <label className="field">
          {t('Username')}
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          {t('Password')}
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="primary" disabled={busy || !username || !password}>
          {t('Sign in')}
        </button>
        <p className="muted small">{t('Accounts are created by an administrator.')}</p>
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
    if (form.password !== form.password2) return setError(t('The passwords do not match.'));
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/setup', { username: form.username, displayName: form.displayName, password: form.password, language: getLang() });
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
        <LangSwitch />
        <div className="row">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <h1>{t('Initial setup')}</h1>
        </div>
        <p className="muted">{t('Create the first account. It gets administrator rights and can create further users.')}</p>
        {error && <div className="error-box">{error}</div>}
        <label className="field">
          {t('Username')}
          <input autoFocus value={form.username} onChange={set('username')} autoComplete="username" />
        </label>
        <label className="field">
          {t('Display name')}
          <input value={form.displayName} onChange={set('displayName')} />
        </label>
        <label className="field">
          {t('Password (at least 8 characters)')}
          <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </label>
        <label className="field">
          {t('Repeat password')}
          <input type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" />
        </label>
        <button className="primary" disabled={busy || !form.username || !form.password}>
          {t('Create administrator')}
        </button>
      </form>
    </div>
  );
}
