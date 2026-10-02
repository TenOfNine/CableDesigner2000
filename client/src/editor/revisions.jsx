import { useCallback, useEffect, useState } from 'react';
import { Modal, useDialogs, fmtDate } from '../components/ui.jsx';
import { api } from '../api.js';
import { t } from '../i18n/index.js';
import { normalizeDoc, wireColorLabel, fmtCs, fmtNum } from './model.js';

/** Differences between an older document (a) and the current one (b) */
export function diffDocs(a, b) {
  const out = [];
  const compLabel = (doc, id) => doc.components.find((c) => c.id === id)?.label || '?';
  const pinName = (doc, ref) => {
    const c = doc.components.find((x) => x.id === ref.c);
    const p = c?.pins.find((x) => x.id === ref.p);
    return c ? `${c.label}${p && c.type === 'connector' ? `.${p.name}` : ''}` : '?';
  };
  const byId = (arr) => new Map(arr.map((x) => [x.id, x]));
  const ca = byId(a.components);
  const cb = byId(b.components);
  for (const [id, c] of cb) if (!ca.has(id)) out.push({ kind: 'add', text: t('Component {name} added', { name: c.label }) });
  for (const [id, c] of ca) if (!cb.has(id)) out.push({ kind: 'del', text: t('Component {name} removed', { name: c.label }) });
  for (const [id, c] of cb) {
    const o = ca.get(id);
    if (!o) continue;
    const ch = [];
    if (o.label !== c.label) ch.push(`${o.label} → ${c.label}`);
    if ((o.part?.partNumber || '') !== (c.part?.partNumber || '')) ch.push(`${t('Part')}: ${o.part?.partNumber || '–'} → ${c.part?.partNumber || '–'}`);
    if (o.pins.length !== c.pins.length) ch.push(`${t('Pins')}: ${o.pins.length} → ${c.pins.length}`);
    const fnChanges = c.pins.filter((p) => {
      const op = o.pins.find((x) => x.id === p.id);
      return op && (op.fn !== p.fn || op.name !== p.name);
    }).length;
    if (fnChanges) ch.push(t('{n} pin names/functions', { n: fnChanges }));
    if ((o.mateId || '') !== (c.mateId || '')) ch.push(t('mating changed'));
    if (ch.length) out.push({ kind: 'chg', text: `${c.label}: ${ch.join(', ')}` });
  }
  const wa = byId(a.wires);
  const wb = byId(b.wires);
  for (const [id, w] of wb) if (!wa.has(id)) out.push({ kind: 'add', text: t('Wire {name} added ({from} → {to})', { name: w.label, from: pinName(b, w.from), to: pinName(b, w.to) }) });
  for (const [id, w] of wa) if (!wb.has(id)) out.push({ kind: 'del', text: t('Wire {name} removed ({from} → {to})', { name: w.label, from: pinName(a, w.from), to: pinName(a, w.to) }) });
  for (const [id, w] of wb) {
    const o = wa.get(id);
    if (!o) continue;
    const ch = [];
    if (o.label !== w.label) ch.push(`${o.label} → ${w.label}`);
    if (o.from.p !== w.from.p || o.to.p !== w.to.p) ch.push(`${pinName(a, o.from)}–${pinName(a, o.to)} → ${pinName(b, w.from)}–${pinName(b, w.to)}`);
    if (wireColorLabel(o) !== wireColorLabel(w)) ch.push(`${wireColorLabel(o)} → ${wireColorLabel(w)}`);
    if (o.cs !== w.cs) ch.push(`${fmtCs(o.cs)} → ${fmtCs(w.cs)}`);
    if ((o.cableId || '') !== (w.cableId || '')) ch.push(t('cable assignment'));
    if (ch.length) out.push({ kind: 'chg', text: `${w.label}: ${ch.join(', ')}` });
  }
  const sa = byId(a.segments);
  const sb = byId(b.segments);
  const segName = (doc, s) => `${compLabel(doc, s.a) !== '?' ? compLabel(doc, s.a) : doc.nodes.find((n) => n.id === s.a)?.label || '·'}–${compLabel(doc, s.b) !== '?' ? compLabel(doc, s.b) : doc.nodes.find((n) => n.id === s.b)?.label || '·'}`;
  let segAdd = 0;
  let segDel = 0;
  for (const id of sb.keys()) if (!sa.has(id)) segAdd++;
  for (const id of sa.keys()) if (!sb.has(id)) segDel++;
  if (segAdd) out.push({ kind: 'add', text: t('{n} segments added', { n: segAdd }) });
  if (segDel) out.push({ kind: 'del', text: t('{n} segments removed', { n: segDel }) });
  for (const [id, s] of sb) {
    const o = sa.get(id);
    if (o && Number(o.length) !== Number(s.length)) out.push({ kind: 'chg', text: t('Segment {name}: {a} → {b} mm', { name: segName(b, s), a: fmtNum(o.length), b: fmtNum(s.length) }) });
  }
  const ka = byId(a.cables || []);
  const kb = byId(b.cables || []);
  for (const [id, k] of kb) if (!ka.has(id)) out.push({ kind: 'add', text: t('Cable {name} added', { name: k.label }) });
  for (const [id, k] of ka) if (!kb.has(id)) out.push({ kind: 'del', text: t('Cable {name} removed', { name: k.label }) });
  const keys = ['drawingNumber', 'revision', 'extraPerEnd', 'extraPercent'];
  const sc = keys.filter((k) => String(a.settings[k] ?? '') !== String(b.settings[k] ?? ''));
  if (sc.length) out.push({ kind: 'chg', text: t('Settings changed: {keys}', { keys: sc.join(', ') }) });
  return out;
}

export function RevisionsDialog({ harnessId, doc, readOnly, flush, setRevisionInDoc, onRestored, onClose }) {
  const dialogs = useDialogs();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [compare, setCompare] = useState(null); // { rev, diff }
  const [form, setForm] = useState({ name: '', comment: '', setRev: true });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setList((await api.get(`/harnesses/${harnessId}/revisions`)).revisions);
    } catch (e) {
      setError(e.message);
    }
  }, [harnessId]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = () =>
    run(async () => {
      const name = form.name.trim();
      if (!name) return;
      if (form.setRev) setRevisionInDoc(name);
      await flush();
      await api.post(`/harnesses/${harnessId}/revisions`, { name, comment: form.comment });
      setForm({ name: '', comment: '', setRev: true });
      await load();
    });

  const showCompare = (rev) =>
    run(async () => {
      const { revision } = await api.get(`/harnesses/${harnessId}/revisions/${rev.id}`);
      setCompare({ rev, diff: diffDocs(normalizeDoc(revision.data), doc) });
    });

  const restore = (rev) =>
    run(async () => {
      const label = rev.name || fmtDate(rev.stateAt);
      const ok = await dialogs.confirm(t('Restore the state "{name}"? The current state is kept as an automatic revision first.', { name: label }), {
        okLabel: t('Restore'),
        danger: true,
      });
      if (!ok) return;
      await flush();
      await api.post(`/harnesses/${harnessId}/revisions/${rev.id}/restore`, {});
      await onRestored();
      onClose();
    });

  const rename = (rev) =>
    run(async () => {
      const name = await dialogs.prompt(rev.kind === 'named' ? t('Rename revision') : t('Keep as named revision'), { label: t('Name'), value: rev.name, okLabel: t('Save') });
      if (!name?.trim()) return;
      await api.patch(`/harnesses/${harnessId}/revisions/${rev.id}`, { name });
      await load();
    });

  const remove = (rev) =>
    run(async () => {
      const ok = await dialogs.confirm(t('Delete this revision permanently?'), { okLabel: t('Delete'), danger: true });
      if (!ok) return;
      await api.del(`/harnesses/${harnessId}/revisions/${rev.id}`);
      if (compare?.rev.id === rev.id) setCompare(null);
      await load();
    });

  return (
    <Modal title={t('Revision history')} onClose={onClose} wide>
      <p className="small muted">
        {t('An automatic state is kept at most every 10 minutes while editing (the last 50). Named revisions (e.g. a release) are kept permanently.')}
      </p>
      {error && <div className="error-box">{error}</div>}
      {!readOnly && (
        <div className="card col" style={{ gap: 8, padding: 12 }}>
          <strong className="small">{t('Create named revision of the current state')}</strong>
          <div className="row">
            <input className="grow" placeholder={t('Name, e.g. B or "Release prototype"')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <button className="primary" disabled={busy || !form.name.trim()} onClick={create}>
              {t('Create')}
            </button>
          </div>
          <input placeholder={t('Comment (optional)')} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} />
          <label className="check">
            <input type="checkbox" checked={form.setRev} onChange={(e) => setForm({ ...form, setRev: e.target.checked })} />
            {t('Also use the name as revision in the title block')}
          </label>
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: '42vh' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('Revision')}</th>
              <th>{t('State from')}</th>
              <th>{t('By')}</th>
              <th className="num">{t('Content')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!list && (
              <tr>
                <td colSpan={5} className="muted">
                  {t('Loading …')}
                </td>
              </tr>
            )}
            {list?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  {t('No revisions yet.')}
                </td>
              </tr>
            )}
            {list?.map((r) => (
              <tr key={r.id} className={compare?.rev.id === r.id ? 'selected' : ''}>
                <td>
                  {r.kind === 'named' ? <span className="badge accent">{t('named')}</span> : <span className="badge">{t('automatic')}</span>}{' '}
                  <strong>{r.name}</strong>
                  {r.comment && <div className="small muted">{r.comment}</div>}
                </td>
                <td className="small nowrap">{fmtDate(r.stateAt)}</td>
                <td className="small">{r.createdByName || '–'}</td>
                <td className="num small muted nowrap">{r.counts ? t('{c} comp. · {w} wires', { c: r.counts.components, w: r.counts.wires }) : ''}</td>
                <td className="nowrap">
                  <div className="row" style={{ gap: 4 }}>
                    <button className="small" onClick={() => showCompare(r)} disabled={busy}>
                      {t('Compare')}
                    </button>
                    {!readOnly && (
                      <>
                        <button className="small" onClick={() => restore(r)} disabled={busy}>
                          {t('Restore')}
                        </button>
                        <button className="small ghost" onClick={() => rename(r)} title={r.kind === 'named' ? t('Rename') : t('Keep as named revision')}>
                          ✎
                        </button>
                        <button className="small ghost danger" onClick={() => remove(r)} title={t('Delete')}>
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compare && (
        <div className="card col" style={{ gap: 4, padding: 12 }}>
          <strong className="small">
            {t('Changes from "{name}" to the current state', { name: compare.rev.name || fmtDate(compare.rev.stateAt) })}
          </strong>
          {compare.diff.length === 0 && <div className="small muted">{t('No differences.')}</div>}
          <div style={{ maxHeight: 220, overflow: 'auto' }}>
            {compare.diff.map((d, i) => (
              <div key={i} className="small" style={{ color: d.kind === 'add' ? 'var(--ok)' : d.kind === 'del' ? 'var(--danger)' : 'var(--text-2)' }}>
                {d.kind === 'add' ? '＋ ' : d.kind === 'del' ? '− ' : '~ '}
                {d.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
