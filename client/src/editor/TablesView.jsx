import { useMemo, useState } from 'react';
import { useEditor } from './store.js';
import { wireListRows, pinoutRows, segmentRows, bomRows, cableRows } from './tables.js';
import { fmtNum, fmtCs } from './model.js';
import { t } from '../i18n/index.js';

export default function TablesView({ derived }) {
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const setHover = useEditor((s) => s.setHover);
  const [tab, setTab] = useState('wires');
  const [exploded, setExploded] = useState(false);
  const selIds = new Set(selection.map((s) => s.id));

  const wires = useMemo(() => wireListRows(doc, derived), [doc, derived]);
  const pins = useMemo(() => pinoutRows(doc, derived), [doc, derived]);
  const segs = useMemo(() => segmentRows(doc, derived), [doc, derived]);
  const cables = useMemo(() => cableRows(doc, derived), [doc, derived]);
  const bom = useMemo(() => bomRows(derived, exploded), [derived, exploded]);
  const warnCount = derived.warnings.filter((w) => w.level === 'warn').length;
  const hasSubs = derived.subs.size > 0;

  const TABS = [
    ['wires', t('Wire list')],
    ['bom', t('Bill of materials')],
    ['pinout', t('Pin assignment')],
    ['cables', t('Cables')],
    ['segments', t('Segments')],
    ['checks', t('Checks')],
  ];

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

  const lenCell = (len, extra) => (len === null ? <span style={{ color: 'var(--warn)' }}>–</span> : <>{`${fmtNum(len, 0)} mm`}{extra}</>);

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
                <th>{t('No.')}</th>
                <th>{t('Signal')}</th>
                <th>{t('From')}</th>
                <th>{t('Pin')}</th>
                <th>{t('To')}</th>
                <th>{t('Pin')}</th>
                <th>{t('Colour')}</th>
                <th className="num">{t('Cross-section')}</th>
                <th className="num">AWG</th>
                <th>{t('Type')}</th>
                <th>{t('Cable')}</th>
                <th className="num">{t('Length')}</th>
                <th>{t('Route')}</th>
                <th>{t('Remark')}</th>
              </tr>
            </thead>
            <tbody>
              {wires.length === 0 && (
                <tr>
                  <td colSpan={14} className="muted">
                    {t('No wires yet. Draw wires in the schematic from pin to pin.')}
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
                  <td>{r.cable}</td>
                  <td className="num nowrap">{lenCell(r.length, r.overridden && <span className="muted small"> ({t('fixed')})</span>)}</td>
                  <td className="small muted">{r.route}</td>
                  <td className="small">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'bom' && (
        <div className="col" style={{ gap: 8 }}>
          {hasSubs && (
            <div className="row">
              <span className="small muted">{t('Sub-harnesses:')}</span>
              <div className="seg-tabs">
                <button className={!exploded ? 'on' : ''} onClick={() => setExploded(false)}>
                  {t('as assembly')}
                </button>
                <button className={exploded ? 'on' : ''} onClick={() => setExploded(true)}>
                  {t('exploded')}
                </button>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">{t('Pos.')}</th>
                  <th>{t('Group')}</th>
                  <th>{t('Part number')}</th>
                  <th>{t('Manufacturer')}</th>
                  <th>{t('Description')}</th>
                  <th className="num">{t('Qty')}</th>
                  <th>{t('Unit')}</th>
                  <th>{t('Used by')}</th>
                  <th>{t('Note')}</th>
                </tr>
              </thead>
              <tbody>
                {bom.length === 0 && (
                  <tr>
                    <td colSpan={9} className="muted">
                      {t('The bill of materials is empty.')}
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
                      {r.unassigned && <span className="badge warn" style={{ marginLeft: 6 }}>{t('no part')}</span>}
                    </td>
                    <td className="num nowrap">{r.isMetre ? fmtNum(r.qty, 2) : r.qty}</td>
                    <td>{r.unit}</td>
                    <td className="small muted">{r.refs}</td>
                    <td className="small" style={{ color: 'var(--warn)' }}>
                      {r.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="small muted" style={{ padding: 10 }}>
              {t('Wire lengths include the configured allowances. Contacts are counted per occupied cavity (contact part number from the library). Cores of multi-core cables are listed as cable.')}
            </div>
          </div>
        </div>
      )}

      {tab === 'pinout' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Component')}</th>
                <th>{t('Part')}</th>
                <th>{t('Pin')}</th>
                <th>{t('Function')}</th>
                <th>{t('Wire')}</th>
                <th>{t('Colour')}</th>
                <th className="num">{t('Cross-section')}</th>
                <th>{t('Destination')}</th>
                <th className="num">{t('Length')}</th>
              </tr>
            </thead>
            <tbody>
              {pins.map((r, i) => {
                const first = i === 0 || pins[i - 1].compId !== r.compId;
                const rp = rowProps('wire', r.wireId);
                return (
                  <tr key={i} {...rp} style={{ ...(rp.style || {}), borderTop: first ? '2px solid var(--border-2)' : undefined }}>
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

      {tab === 'cables' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Designation')}</th>
                <th>{t('Kind')}</th>
                <th>{t('Type')}</th>
                <th>{t('Part number')}</th>
                <th className="num">{t('Cores')}</th>
                <th>{t('Shield')}</th>
                <th>{t('Wires')}</th>
                <th className="num">{t('Lay length')}</th>
                <th className="num">{t('Ø ≈')}</th>
                <th className="num">{t('Length')}</th>
              </tr>
            </thead>
            <tbody>
              {cables.length === 0 && (
                <tr>
                  <td colSpan={10} className="muted">
                    {t('No cables yet. Select several wires in the schematic and choose "Combine into multi-core cable" or "Twist" from the context menu.')}
                  </td>
                </tr>
              )}
              {cables.map((r) => (
                <tr key={r.cableId} {...rowProps('cable', r.cableId)}>
                  <td className="nowrap">{r.label}</td>
                  <td>{r.kind}</td>
                  <td>{r.type}</td>
                  <td className="mono">{r.part}</td>
                  <td className="num">{r.cores}</td>
                  <td>{r.shield ? t('yes') : ''}</td>
                  <td className="small">{r.members}</td>
                  <td className="num">{r.layLength ? `${fmtNum(r.layLength, 0)} mm` : ''}</td>
                  <td className="num">{r.outerDiameter ? `${fmtNum(r.outerDiameter, 1)} mm` : ''}</td>
                  <td className="num nowrap">{lenCell(r.length)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'segments' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('From')}</th>
                <th>{t('To')}</th>
                <th>{t('Designation')}</th>
                <th className="num">{t('Length')}</th>
                <th className="num">{t('Wires')}</th>
                <th className="num">{t('Bundle Ø ≈')}</th>
                <th>{t('Covering')}</th>
                <th>{t('Wires')}</th>
              </tr>
            </thead>
            <tbody>
              {segs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {t('No segments yet. Draw segments in the layout view.')}
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
          {derived.warnings.length === 0 && <div className="info-box">{t('No issues found.')}</div>}
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
