import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Modal, useDialogs, fmtDate } from '../components/ui.jsx';

export default function Admin() {
  const { user } = useAuth();
  const dialogs = useDialogs();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setUsers((await api.get('/admin/users')).users);
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const patch = async (u, body) => {
    setError('');
    try {
      setUsers((await api.patch(`/admin/users/${u.id}`, body)).users);
    } catch (e) {
      setError(e.message);
    }
  };

  const resetPassword = async (u) => {
    const pw = await dialogs.prompt(`Neues Passwort für „${u.username}“`, { label: 'Neues Passwort (mind. 8 Zeichen)', okLabel: 'Setzen' });
    if (!pw) return;
    await patch(u, { password: pw });
  };

  const rename = async (u) => {
    const dn = await dialogs.prompt('Anzeigename ändern', { label: 'Anzeigename', value: u.displayName, okLabel: 'Speichern' });
    if (!dn) return;
    await patch(u, { displayName: dn });
  };

  const remove = async (u) => {
    const ok = await dialogs.confirm(
      `Benutzer „${u.username}“ löschen?\n\nDabei werden auch alle Projekte, Kabelbäume und eigenen Bibliotheksteile dieses Kontos endgültig gelöscht.`,
      { okLabel: 'Endgültig löschen', danger: true }
    );
    if (!ok) return;
    setError('');
    try {
      setUsers((await api.del(`/admin/users/${u.id}`)).users);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 14 }}>
        <div className="row">
          <h1 className="grow">Verwaltung</h1>
          <a className="btn" href="/api/admin/backup" download>
            ⇩ Datenbank-Backup
          </a>
          <button className="primary" onClick={() => setCreating(true)}>
            ＋ Benutzer anlegen
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Benutzername</th>
                <th>Anzeigename</th>
                <th>Rolle</th>
                <th>Status</th>
                <th className="num">Projekte</th>
                <th>Letzte Anmeldung</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!users && (
                <tr>
                  <td colSpan={7} className="muted">
                    Lade …
                  </td>
                </tr>
              )}
              {users?.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>{u.isAdmin ? <span className="badge accent">Administrator</span> : <span className="badge">Benutzer</span>}</td>
                  <td>{u.disabled ? <span className="badge warn">Deaktiviert</span> : <span className="badge ok">Aktiv</span>}</td>
                  <td className="num">{u.projectCount}</td>
                  <td className="small muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</td>
                  <td className="nowrap">
                    <div className="row" style={{ gap: 4 }}>
                      <button className="small" onClick={() => rename(u)}>
                        Name
                      </button>
                      <button className="small" onClick={() => resetPassword(u)}>
                        Passwort
                      </button>
                      <button className="small" onClick={() => patch(u, { isAdmin: !u.isAdmin })}>
                        {u.isAdmin ? 'Admin entziehen' : 'Zum Admin'}
                      </button>
                      {u.id !== user.id && (
                        <button className="small" onClick={() => patch(u, { disabled: !u.disabled })}>
                          {u.disabled ? 'Aktivieren' : 'Deaktivieren'}
                        </button>
                      )}
                      {u.id !== user.id && (
                        <button className="small danger" onClick={() => remove(u)}>
                          Löschen
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          Administratoren verwalten Konten und die globale Bibliothek. Auf Projekte anderer Benutzer haben auch Administratoren nur über
          Freigaben Zugriff.
        </p>
      </div>
      {creating && (
        <CreateUser
          onClose={() => setCreating(false)}
          onCreated={(list) => {
            setUsers(list);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function CreateUser({ onClose, onCreated }) {
  const [form, setForm] = useState({ username: '', displayName: '', password: '', isAdmin: false });
  const [error, setError] = useState('');
  const submit = async () => {
    setError('');
    try {
      onCreated((await api.post('/admin/users', form)).users);
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Modal
      title="Benutzer anlegen"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Abbrechen</button>
          <button className="primary" onClick={submit} disabled={!form.username || !form.password}>
            Anlegen
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <label className="field">
        Benutzername
        <input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </label>
      <label className="field">
        Anzeigename
        <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </label>
      <label className="field">
        Startpasswort (mind. 8 Zeichen)
        <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
      </label>
      <label className="check">
        <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
        Administrator
      </label>
      <p className="muted small">Der Benutzer kann sein Passwort nach der Anmeldung unter „Mein Konto“ ändern.</p>
    </Modal>
  );
}
