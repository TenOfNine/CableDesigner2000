import { useMemo, useRef, useState } from 'react';
import { api, downloadBlob } from '../api.js';
import { useAuth } from '../App.jsx';
import { useParts, PartEditor, PartThumb, matchPart, invalidatePartsCache, allMakes } from '../components/parts.jsx';
import { Modal } from '../components/ui.jsx';
import { CATEGORIES, categoryLabel, categorySingular, partSummary, partDescription, partApplication } from '../editor/model.js';
import { parseCsv, rowsToParts, partsToCsv, CSV_TEMPLATE_ROWS } from '../lib/csv.js';
import { t } from '../i18n/index.js';

export default function Library() {
  const { user } = useAuth();
  const { parts, error, reload } = useParts();
  const [category, setCategory] = useState('connector');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState('all');
  const [make, setMake] = useState('');
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState('');

  const counts = useMemo(() => {
    const c = {};
    for (const p of parts || []) c[p.category] = (c[p.category] || 0) + 1;
    return c;
  }, [parts]);
  const inCat = useMemo(() => (parts || []).filter((p) => p.category === category), [parts, category]);
  const makes = useMemo(() => allMakes(inCat), [inCat]);
  const list = useMemo(
    () => inCat.filter((p) => (scope === 'all' || p.scope === scope) && (!make || (p.data?.usedBy || []).includes(make)) && matchPart(p, q)),
    [inCat, scope, make, q]
  );

  const copyAsOwn = async (p) => {
    try {
      const { part } = await api.post('/parts', {
        category: p.category, partNumber: p.partNumber, manufacturer: p.manufacturer, description: p.description, data: p.data, scope: 'own',
      });
      invalidatePartsCache();
      await reload();
      setMsg(t('"{name}" was copied into your library.', { name: p.partNumber || p.description }));
      setEditing(part);
    } catch (e) {
      setMsg(e.message);
    }
  };

  const exportCsv = () => downloadBlob(new Blob([partsToCsv(list)], { type: 'text/csv;charset=utf-8' }), `library-${category}.csv`);
  const exportTemplate = () => downloadBlob(new Blob([partsToCsv(CSV_TEMPLATE_ROWS)], { type: 'text/csv;charset=utf-8' }), 'cabledesigner2000-parts-template.csv');

  return (
    <div className="page">
      <div className="page-narrow col" style={{ gap: 14, maxWidth: 1240 }}>
        <div className="row wrap">
          <h1 className="grow">{t('Part library')}</h1>
          <button onClick={() => setImporting(true)}>⇪ {t('Import CSV')}</button>
          <button onClick={exportCsv} disabled={!list.length}>
            ⇩ {t('Export CSV')}
          </button>
          <button className="primary" onClick={() => setEditing({ new: true })}>
            ＋ {t('New part')}
          </button>
        </div>
        <p className="muted small">
          {user.isAdmin
            ? t('Global parts are available to all accounts and can be maintained by administrators. Own parts are only visible to your account. When a part is assigned in a harness, a copy of the part data is stored in the harness.')
            : t('Global parts are available to all accounts. Own parts are only visible to your account. When a part is assigned in a harness, a copy of the part data is stored in the harness.')}
        </p>
        {error && <div className="error-box">{error}</div>}
        {msg && <div className="info-box">{msg}</div>}
        <div className="tabs-line" style={{ overflowX: 'auto' }}>
          {CATEGORIES.map((k) => (
            <button
              key={k}
              className={category === k ? 'on' : ''}
              onClick={() => {
                setCategory(k);
                setMake('');
              }}
            >
              {categoryLabel(k)} <span className="muted small">{counts[k] || 0}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <input className="grow" placeholder={t('Search … (e.g. "DT06", "cavities:6", "manufacturer:jst", "oem:bmw")')} value={q} onChange={(e) => setQ(e.target.value)} />
          {makes.length > 0 && (
            <select value={make} onChange={(e) => setMake(e.target.value)} title={t('Vehicle make')}>
              <option value="">{t('All makes')}</option>
              {makes.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">{t('All')}</option>
            <option value="global">{t('Global only')}</option>
            <option value="own">{t('Own only')}</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>{t('Image')}</th>
                <th>{t('Part number')}</th>
                <th>{t('Manufacturer')}</th>
                <th>{t('Description')}</th>
                <th>{t('Key data')}</th>
                <th>{t('Storage')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!parts && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t('Loading …')}
                  </td>
                </tr>
              )}
              {parts && list.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    {t('No parts found.')}
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
                  <td>
                    {partDescription(p)}
                    {(partApplication(p) || p.data?.usedBy?.length > 0) && (
                      <div className="small muted">{[partApplication(p), (p.data.usedBy || []).join(', ')].filter(Boolean).join(' · ')}</div>
                    )}
                  </td>
                  <td className="small muted nowrap">{partSummary(p)}</td>
                  <td>{p.scope === 'global' ? <span className="badge">{t('Global')}</span> : <span className="badge accent">{t('Own')}</span>}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    {p.scope === 'global' && (
                      <button className="small" onClick={() => copyAsOwn(p)}>
                        {t('Copy as own part')}
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
      {importing && (
        <ImportDialog
          isAdmin={user.isAdmin}
          onTemplate={exportTemplate}
          onClose={() => setImporting(false)}
          onDone={async (text) => {
            setImporting(false);
            setMsg(text);
            invalidatePartsCache();
            await reload();
          }}
        />
      )}
    </div>
  );
}

function ImportDialog({ isAdmin, onClose, onDone, onTemplate }) {
  const fileRef = useRef(null);
  const [parsed, setParsed] = useState(null);
  const [scope, setScope] = useState('own');
  const [mode, setMode] = useState('skip');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onFile = async (f) => {
    setError('');
    try {
      const text = await f.text();
      const { rows } = parseCsv(text);
      setParsed({ name: f.name, ...rowsToParts(rows) });
    } catch (e) {
      setError(e.message);
    }
  };

  const doImport = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/parts/import', { scope, mode, parts: parsed.parts });
      const parts = [t('{n} imported', { n: r.inserted }), r.updated ? t('{n} updated', { n: r.updated }) : '', r.skipped ? t('{n} skipped (already present)', { n: r.skipped }) : '']
        .filter(Boolean)
        .join(', ');
      onDone(`${t('CSV import')}: ${parts}.${r.errors.length ? ` ${t('{n} rows with errors.', { n: r.errors.length })}` : ''}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const byCat = {};
  for (const p of parsed?.parts || []) byCat[p.category] = (byCat[p.category] || 0) + 1;

  return (
    <Modal
      title={t('Import parts from CSV')}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onTemplate} style={{ marginRight: 'auto' }}>
            ⇩ {t('Download template')}
          </button>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" disabled={!parsed?.parts.length || busy} onClick={doImport}>
            {t('Import {n} parts', { n: parsed?.parts.length || 0 })}
          </button>
        </>
      }
    >
      <p className="small muted">
        {t('One part per row. Separator ; , or tab is detected automatically; column names may be English or German (see template). Lists inside a cell (vehicle makes, core colours) are separated by "|". Required: category, part number or description; for connectors also the number of cavities.')}
      </p>
      <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {error && <div className="error-box">{error}</div>}
      {parsed && (
        <>
          <div className="info-box small">
            {t('{file}: {n} valid rows', { file: parsed.name, n: parsed.parts.length })}
            {Object.keys(byCat).length > 0 && ` (${Object.entries(byCat).map(([c, n]) => `${categorySingular(c)}: ${n}`).join(', ')})`}
          </div>
          {parsed.unknownColumns.length > 0 && <div className="warn-box small">{t('Ignored columns: {cols}', { cols: parsed.unknownColumns.join(', ') })}</div>}
          {parsed.errors.length > 0 && (
            <div className="warn-box small" style={{ maxHeight: 120, overflow: 'auto' }}>
              {parsed.errors.map((e, i) => (
                <div key={i}>
                  {t('Line {n}', { n: e.line })}: {t(e.message, e.params)}
                </div>
              ))}
            </div>
          )}
          <div className="table-wrap" style={{ maxHeight: 220 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t('Category')}</th>
                  <th>{t('Part number')}</th>
                  <th>{t('Manufacturer')}</th>
                  <th>{t('Description')}</th>
                  <th>{t('Key data')}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.parts.slice(0, 50).map((p, i) => (
                  <tr key={i}>
                    <td>{categorySingular(p.category)}</td>
                    <td className="mono">{p.partNumber}</td>
                    <td>{p.manufacturer}</td>
                    <td>{p.description}</td>
                    <td className="small muted">{partSummary(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-grid">
            <label className="field">
              {t('Target')}
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="own">{t('Own library')}</option>
                {isAdmin && <option value="global">{t('Global library (for everyone)')}</option>}
              </select>
            </label>
            <label className="field">
              {t('Existing part numbers')}
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="skip">{t('skip')}</option>
                <option value="update">{t('update')}</option>
              </select>
            </label>
          </div>
        </>
      )}
    </Modal>
  );
}
