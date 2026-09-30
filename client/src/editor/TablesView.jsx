import { useMemo, useState } from 'react';
import { useEditor } from './store.js';
import { wireListRows, pinoutRows, segmentRows, bomRows } from './tables.js';
import { fmtNum, fmtCs } from './model.js';

const TABS = [
  ['wires', 'Leitungsliste'],
  ['bom', 'Stückliste'],
  ['pinout', 'Pinbelegung'],
  ['segments', 'Segmente'],
  ['checks', 'Prüfung'],
];

export default function TablesView({ derived }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const setHover = useEditor((s) => s.setHover);
  const [tab, setTab] = useState('wires');
  const selIds = new Set(selection.map((s) => s.id));

  const wires = useMemo(() => wireListRows(doc, derived), [doc, derived]);
  const pins = useMemo(() => pinoutRows(doc, derived), [doc, derived]);
  const segs = useMemo(() => segmentRows(doc, derived), [doc, derived]);
  const bom = useMemo(() => bomRows(derived), [derived]);
  const warnCount = derived.warnings.filter((w) => w.level === 'warn').length;

  const rowProps = (kind, id) =>
    id
      ? {
          className: selIds.has(id) ? 'selected' : '',
          style: { cursor: 'pointer' },
          onClick: () => select([{ kind, id }]),
          onMouseEnter: kind === 'wire' ? () => setHover({ key: `w:${id}`, wireIds: [id] }) : undefined,
          onMouseLeave: kind === 'wire' ? () => setHover(null) : undefined,
        }
      : {};

  return (
    <div className="tables-view">
      <div className="tabs-line">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
            {k === 'checks' && warnCount > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{warnCount}</span>}
          </button>
        ))}
      </div>

      {tab === 'wires' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Signal</th>
                <th>Von</th>
                <th>Pin</th>
                <th>Nach</th>
                <th>Pin</th>
                <th>Farbe</th>
                <th className="num">Querschnitt</th>
                <th className="num">AWG</th>
                <th>Typ</th>
                <th className="num">Länge</th>
                <th>Verlauf</th>
                <th>Bemerkung</th>
              </tr>
            </thead>
            <tbody>
              {wires.length === 0 && (
                <tr>
                  <td colSpan={13} className="muted">
                    Noch keine Leitungen. Leitungen ziehst du im Schaltplan von Pin zu Pin.
                  </td>
                </tr>
              )}
              {wires.map((r) => (
                <tr key={r.wireId} {...rowProps('wire', r.wireId)}>
                  <td className="nowrap">{r.label}</td>
                  <td>{r.signal}</td>
                  <td className="nowrap">{r.fromComp}</td>
                  <td>{r.fromPin}</td>
                  <td className="nowrap">{r.toComp}</td>
                  <td>{r.toPin}</td>
                  <td className="nowrap">
                    <span className="wire-chip">
                      <span className="bar" style={{ background: r.stripeHex ? `repeating-linear-gradient(90deg, ${r.colorHex} 0 5px, ${r.stripeHex} 5px 8px)` : r.colorHex }} />
                      {r.color}
                    </span>
                  </td>
                  <td className="num nowrap">{fmtCs(r.cs)}</td>
                  <td className="num">{r.awg}</td>
                  <td>{r.type}</td>
                  <td className="num nowrap">
                    {r.length === null ? <span style={{ color: 'var(--warn)' }}>–</span> : `${fmtNum(r.length, 0)} mm`}
                    {r.overridden && <span className="muted small"> (fest)</span>}
                  </td>
                  <td className="small muted">{r.route}</td>
                  <td className="small">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bom' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">Pos.</th>
                <th>Gruppe</th>
                <th>Teilenummer</th>
                <th>Hersteller</th>
                <th>Beschreibung</th>
                <th className="num">Menge</th>
                <th>Einheit</th>
                <th>Verwendung</th>
                <th>Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {bom.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    Stückliste ist leer.
                  </td>
                </tr>
              )}
              {bom.map((r) => (
                <tr key={r.pos}>
                  <td className="num">{r.pos}</td>
                  <td className="nowrap">{r.group}</td>
                  <td className="mono nowrap">{r.partNumber || '—'}</td>
                  <td className="nowrap">{r.manufacturer}</td>
                  <td>
                    {r.description}
                    {r.unassigned && <span className="badge warn" style={{ marginLeft: 6 }}>ohne Teil</span>}
                  </td>
                  <td className="num nowrap">{r.unit === 'm' ? fmtNum(r.qty, 2) : r.qty}</td>
                  <td>{r.unit}</td>
                  <td className="small muted">{r.refs}</td>
                  <td className="small" style={{ color: 'var(--warn)' }}>{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small muted" style={{ padding: 10 }}>
            Leitungslängen inkl. der eingestellten Zugaben. Kontakte werden je belegter Kammer gezählt (Kontakt-Teilenummer aus der Bibliothek).
          </div>
        </div>
      )}

      {tab === 'pinout' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Bauteil</th>
                <th>Teil</th>
                <th>Pin</th>
                <th>Funktion</th>
                <th>Leitung</th>
                <th>Farbe</th>
                <th className="num">Querschnitt</th>
                <th>Ziel</th>
                <th className="num">Länge</th>
              </tr>
            </thead>
            <tbody>
              {pins.map((r, i) => {
                const first = i === 0 || pins[i - 1].compId !== r.compId;
                return (
                  <tr key={i} {...rowProps('wire', r.wireId)} style={{ ...(rowProps('wire', r.wireId).style || {}), borderTop: first ? '2px solid var(--border-2)' : undefined }}>
                    <td className="nowrap">
                      {first && (
                        <>
                          <strong>{r.comp}</strong>
                          {r.mate && <span className="muted small"> ⇄ {r.mate}</span>}
                        </>
                      )}
                    </td>
                    <td className="mono small">{first ? r.part : ''}</td>
                    <td>{r.pin}</td>
                    <td>{r.fn}</td>
                    <td>{r.wire}</td>
                    <td className="nowrap">
                      {r.colorHex && <span className="swatch" style={{ background: r.colorHex, marginRight: 6 }} />}
                      {r.color}
                    </td>
                    <td className="num nowrap">{r.cs ? fmtCs(r.cs) : ''}</td>
                    <td className="nowrap">
                      {r.dest}
                      {r.destFn && <span className="muted small"> ({r.destFn})</span>}
                    </td>
                    <td className="num nowrap">{r.length === null ? (r.wire ? '–' : '') : `${fmtNum(r.length, 0)} mm`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'segments' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Von</th>
                <th>Nach</th>
                <th>Bezeichnung</th>
                <th className="num">Länge</th>
                <th className="num">Leitungen</th>
                <th className="num">Bündel-Ø ≈</th>
                <th>Ummantelung</th>
                <th>Leitungen</th>
              </tr>
            </thead>
            <tbody>
              {segs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Noch keine Segmente. Segmente zeichnest du in der Layout-Ansicht.
                  </td>
                </tr>
              )}
              {segs.map((r) => (
                <tr key={r.segId} {...rowProps('segment', r.segId)}>
                  <td>{r.from}</td>
                  <td>{r.to}</td>
                  <td>{r.label}</td>
                  <td className="num nowrap">{r.length ? `${fmtNum(r.length, 1)} mm` : <span style={{ color: 'var(--warn)' }}>–</span>}</td>
                  <td className="num">{r.wires}</td>
                  <td className="num">{r.bundle ? `${fmtNum(r.bundle, 1)} mm` : '–'}</td>
                  <td>{r.coverings}</td>
                  <td className="small muted">{r.wireLabels}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'checks' && (
        <div className="col" style={{ gap: 6 }}>
          {derived.warnings.length === 0 && <div className="info-box">Keine Auffälligkeiten gefunden.</div>}
          {derived.warnings
            .slice()
            .sort((a, b) => (a.level === b.level ? 0 : a.level === 'warn' ? -1 : 1))
            .map((w, i) => (
              <div
                key={i}
                className={w.level === 'warn' ? 'warn-box' : 'info-box'}
                style={w.wireId || w.segmentId ? { cursor: 'pointer' } : undefined}
                onClick={() => {
                  if (w.wireId) select([{ kind: 'wire', id: w.wireId }]);
                  if (w.segmentId) select([{ kind: 'segment', id: w.segmentId }]);
                }}
              >
                {w.level === 'warn' ? '⚠ ' : 'ℹ '}
                {w.text}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
