import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { t, getLang, setLang, LANGUAGES } from '../i18n/index.js';

export default function Account() {
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [pw, setPw] = useState({ current: '', next: '', next2: '' });
  const [msg, setMsg] = useState(null);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      await api.patch('/auth/profile', { displayName });
      await refresh();
      setMsg({ ok: t('Display name saved.') });
    } catch (err) {
      setMsg({ err: err.message });
    }
  };
  const changeLanguage = async (language) => {
    try {
      await api.patch('/auth/profile', { language });
      setLang(language); // re-mounts the app in the new language
    } catch (err) {
      setMsg({ err: err.message });
    }
  };
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.next2) return setMsg({ err: t('The new passwords do not match.') });
    try {
      await api.post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', next2: '' });
      setMsg({ ok: t('Password changed.') });
    } catch (err) {
      setMsg({ err: err.message });
    }
  };

  return (
    <div className="page">
      <div className="page-narrow col" style={{ maxWidth: 520, gap: 16 }}>
        <h1>{t('My account')}</h1>
        {msg?.ok && <div className="info-box">{msg.ok}</div>}
        {msg?.err && <div className="error-box">{msg.err}</div>}
        <form className="card col" onSubmit={saveProfile}>
          <h3>{t('Profile')}</h3>
          <div className="muted small">
            {t('Username')}: {user.username}
            {user.isAdmin ? ` · ${t('Administrator')}` : ''}
          </div>
          <label className="field">
            {t('Display name')}
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <div>
            <button className="primary">{t('Save')}</button>
          </div>
        </form>
        <div className="card col">
          <h3>{t('Language')}</h3>
          <div className="row">
            {LANGUAGES.map((l) => (
              <button key={l.code} className={getLang() === l.code ? 'active' : ''} onClick={() => changeLanguage(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
          <span className="muted small">{t('The language is stored in your account and used on every device.')}</span>
        </div>
        <form className="card col" onSubmit={savePw}>
          <h3>{t('Change password')}</h3>
          <label className="field">
            {t('Current password')}
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label className="field">
            {t('New password (at least 8 characters)')}
            <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className="field">
            {t('Repeat new password')}
            <input type="password" autoComplete="new-password" value={pw.next2} onChange={(e) => setPw({ ...pw, next2: e.target.value })} />
          </label>
          <div>
            <button className="primary" disabled={!pw.current || !pw.next}>
              {t('Change password')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
