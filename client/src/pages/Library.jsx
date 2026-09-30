import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../App.jsx';
import { useParts, PartEditor, PartThumb, matchPart, invalidatePartsCache } from '../components/parts.jsx';
import { CATEGORY_LABELS, partSummary } from '../editor/model.js';

export default function Library() {
  const { user } = useAuth();
  const { parts, error, reload } = useParts();
  const [category, setCategory] = useState('connector');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  const [editing, setEditing] = useState(null);
  const [msg, setMsg] = useState('');

  const counts = useMemo(() => {
    const c = {};
    for (const p of parts || []) c[p.category] = (c[p.category] || 0) + 1;
    return c;
  }, [parts]);

  const list = useMemo(
    () =>
      (parts || []).filter(
        (p) => p.category === category && (scope === 'all' || p.scope === scope) && matchPart(p, q)
      ),
    [parts, category, scope, q]
  );

  const copyAsOwn = async (p) => {
    try {
      const { part } = await api.post('/parts', {
        category: p.category,
        partNumber: p.partNumber,
        manufacturer: p.manufacturer,
        description: p.description,
        data: p.data,
        scope: 'own',
      });
      invalidatePartsCache();
      await reload();
      setMsg(`„${p.partNumber || p.description}“ wurde in deine Bibliothek kopiert.`);
      setEditing(part);
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 14, maxWidth: 1200 }}>
        <div className="row">
          <h1 className="grow">Bauteilbibliothek</h1>
          <button className="primary" onClick={() => setEditing({ new: true })}>
            ＋ Neues Teil
          </button>
        </div>
        <p className="muted small">
          Globale Teile stehen allen Konten zur Verfügung{user.isAdmin ? ' und können von Administratoren gepflegt werden' : ''}. Eigene Teile
          sieht nur dein Konto. Beim Zuordnen im Kabelbaum wird eine Kopie der Teiledaten im Kabelbaum gespeichert.
        </p>
        {error && <div className="error-box">{error}</div>}
        {msg && <div className="info-box">{msg}</div>}
        <div className="tabs-line">
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <button key={k} className={category === k ? 'on' : ''} onClick={() => setCategory(k)}>
              {v} <span className="muted small">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <input className="grow" placeholder="Suchen … (z. B. „DT06“, „polig:6“, „hersteller:jst“)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">Alle</option>
            <option value="global">Nur global</option>
            <option value="own">Nur eigene</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Bild</th>
                <th>Teilenummer</th>
                <th>Hersteller</th>
                <th>Beschreibung</th>
                <th>Eckdaten</th>
                <th>Ablage</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!parts && (
                <tr>
                  <td colSpan={7} className="muted">
                    Lade …
                  </td>
                </tr>
              )}
              {parts && list.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Keine Teile gefunden.
                  </td>
                </tr>
              )}
              {list.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setEditing(p)}>
                  <td>
                    <PartThumb part={p} size={40} />
                  </td>
                  <td className="mono nowrap">{p.partNumber || '—'}</td>
                  <td className="nowrap">{p.manufacturer}</td>
                  <td>{p.description}</td>
                  <td className="small muted nowrap">{partSummary(p)}</td>
                  <td>{p.scope === 'global' ? <span className="badge">Global</span> : <span className="badge accent">Eigen</span>}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    {p.scope === 'global' && (
                      <button className="small" onClick={() => copyAsOwn(p)} title="Als eigenes Teil kopieren">
                        Als eigenes Teil kopieren
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editing && (
        <PartEditor
          part={editing.new ? null : editing}
          isAdmin={user.isAdmin}
          defaultCategory={category}
          onClose={() => setEditing(null)}
          onSaved={async (p) => {
            setEditing(null);
            setCategory(p.category);
            setMsg('');
            await reload();
          }}
          onDeleted={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}
