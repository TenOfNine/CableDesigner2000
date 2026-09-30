import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';

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
      setMsg({ ok: 'Anzeigename gespeichert.' });
    } catch (err) {
      setMsg({ err: err.message });
    }
  };
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.next2) return setMsg({ err: 'Die neuen Passwörter stimmen nicht überein.' });
    try {
      await api.post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', next2: '' });
      setMsg({ ok: 'Passwort geändert.' });
    } catch (err) {
      setMsg({ err: err.message });
    }
  };

  return (
    <div className="page">
      <div className="page-narrow col" style={{ maxWidth: 520, gap: 16 }}>
        <h1>Mein Konto</h1>
        {msg?.ok && <div className="info-box">{msg.ok}</div>}
        {msg?.err && <div className="error-box">{msg.err}</div>}
        <form className="card col" onSubmit={saveProfile}>
          <h3>Profil</h3>
          <div className="muted small">Benutzername: {user.username}{user.isAdmin ? ' · Administrator' : ''}</div>
          <label className="field">
            Anzeigename
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <div>
            <button className="primary">Speichern</button>
          </div>
        </form>
        <form className="card col" onSubmit={savePw}>
          <h3>Passwort ändern</h3>
          <label className="field">
            Aktuelles Passwort
            <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </label>
          <label className="field">
            Neues Passwort (mind. 8 Zeichen)
            <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className="field">
            Neues Passwort wiederholen
            <input type="password" autoComplete="new-password" value={pw.next2} onChange={(e) => setPw({ ...pw, next2: e.target.value })} />
          </label>
          <div>
            <button className="primary" disabled={!pw.current || !pw.next}>
              Passwort ändern
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
