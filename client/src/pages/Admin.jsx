import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { Modal, useDialogs, fmtDate } from '../components/ui.jsx';
import { t, LANGUAGES } from '../i18n/index.js';

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
    const pw = await dialogs.prompt(t('New password for "{name}"', { name: u.username }), {
      label: t('New password (at least 8 characters)'),
      okLabel: t('Set'),
    });
    if (!pw) return;
    await patch(u, { password: pw });
  };

  const rename = async (u) => {
    const dn = await dialogs.prompt(t('Change display name'), { label: t('Display name'), value: u.displayName, okLabel: t('Save') });
    if (!dn) return;
    await patch(u, { displayName: dn });
  };

  const remove = async (u) => {
    const ok = await dialogs.confirm(
      t('Delete user "{name}"?\n\nThis also permanently deletes all projects, harnesses and own library parts of this account.', { name: u.username }),
      { okLabel: t('Delete permanently'), danger: true }
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
          <h1 className="grow">{t('Administration')}</h1>
          <a className="btn" href="/api/admin/backup" download>
            ⇩ {t('Database backup')}
          </a>
          <button className="primary" onClick={() => setCreating(true)}>
            ＋ {t('Create user')}
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Username')}</th>
                <th>{t('Display name')}</th>
                <th>{t('Role')}</th>
                <th>{t('Status')}</th>
                <th className="num">{t('Projects')}</th>
                <th>{t('Last sign-in')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!users && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t('Loading …')}
                  </td>
                </tr>
              )}
              {users?.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.username}</td>
                  <td>{u.displayName}</td>
                  <td>{u.isAdmin ? <span className="badge accent">{t('Administrator')}</span> : <span className="badge">{t('User')}</span>}</td>
                  <td>{u.disabled ? <span className="badge warn">{t('Disabled')}</span> : <span className="badge ok">{t('Active')}</span>}</td>
                  <td className="num">{u.projectCount}</td>
                  <td className="small muted">{u.lastLoginAt ? fmtDate(u.lastLoginAt) : '—'}</td>
                  <td className="nowrap">
                    <div className="row" style={{ gap: 4 }}>
                      <button className="small" onClick={() => rename(u)}>
                        {t('Name')}
                      </button>
                      <button className="small" onClick={() => resetPassword(u)}>
                        {t('Password')}
                      </button>
                      <button className="small" onClick={() => patch(u, { isAdmin: !u.isAdmin })}>
                        {u.isAdmin ? t('Revoke admin') : t('Make admin')}
                      </button>
                      {u.id !== user.id && (
                        <button className="small" onClick={() => patch(u, { disabled: !u.disabled })}>
                          {u.disabled ? t('Enable') : t('Disable')}
                        </button>
                      )}
                      {u.id !== user.id && (
                        <button className="small danger" onClick={() => remove(u)}>
                          {t('Delete')}
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
          {t('Administrators manage accounts and the global library. Even administrators can only access other users’ projects through shares.')}
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
  const [form, setForm] = useState({ username: '', displayName: '', password: '', isAdmin: false, language: 'de' });
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
      title={t('Create user')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" onClick={submit} disabled={!form.username || !form.password}>
            {t('Create')}
          </button>
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <label className="field">
        {t('Username')}
        <input autoFocus value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </label>
      <label className="field">
        {t('Display name')}
        <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </label>
      <label className="field">
        {t('Initial password (at least 8 characters)')}
        <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="off" />
      </label>
      <label className="field">
        {t('Language')}
        <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
        {t('Administrator')}
      </label>
      <p className="muted small">{t('The user can change the password after signing in under "My account".')}</p>
    </Modal>
  );
}
