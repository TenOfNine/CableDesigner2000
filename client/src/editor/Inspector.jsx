import { useEditor } from './store.js';
import { TextField, NumberField } from './fields.jsx';
import {
  WIRE_COLORS, CROSS_SECTIONS, colorByCode, awgFor, fmtCs, fmtLen, fmtNum, terminalSubtypes, deviceSubtypes, DEVICE_DEFS,
  componentTypeLabel, partSummary, partDescription, partNotes, designationsFor, uid, wireColorName, snapshotPart, cableKindLabel,
} from './model.js';
import { pinRef } from './derive.js';
import { deleteSelection, assignPart, setMate, removeNode, wiresLostByPart, setWireCable } from './actions.js';
import { FaceView } from '../components/parts.jsx';
import { useDialogs } from '../components/ui.jsx';
import { faceRowsOf } from './LayoutScene.jsx';
import { t } from '../i18n/index.js';

export default function Inspector({ derived, openPartPicker, onOpenHarness, onReloadEmbeds }) {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const readOnly = useEditor((s) => s.permission === 'read');

  if (selection.length === 0) return <DocSummary derived={derived} doc={doc} />;
  if (selection.length > 1) return <MultiPanel selection={selection} readOnly={readOnly} />;
  const s = selection[0];
  if (s.kind === 'component') {
    const c = doc.components.find((x) => x.id === s.id);
    if (!c) return null;
    if (c.type === 'subharness') {
      return <SubharnessPanel key={c.id} c={c} derived={derived} readOnly={readOnly} onOpenHarness={onOpenHarness} onReloadEmbeds={onReloadEmbeds} />;
    }
    return <ComponentPanel key={c.id} c={c} derived={derived} readOnly={readOnly} openPartPicker={openPartPicker} />;
  }
  if (s.kind === 'wire') {
    const w = doc.wires.find((x) => x.id === s.id);
    return w ? <WirePanel key={w.id} w={w} derived={derived} readOnly={readOnly} openPartPicker={openPartPicker} /> : null;
  }
  if (s.kind === 'cable') {
    const k = (doc.cables || []).find((x) => x.id === s.id);
    return k ? <CablePanel key={k.id} k={k} derived={derived} readOnly={readOnly} openPartPicker={openPartPicker} /> : null;
  }
  if (s.kind === 'segment') {
    const sg = doc.segments.find((x) => x.id === s.id);
    return sg ? <SegmentPanel key={sg.id} s={sg} derived={derived} readOnly={readOnly} openPartPicker={openPartPicker} /> : null;
  }
  if (s.kind === 'node') {
    const n = doc.nodes.find((x) => x.id === s.id);
    return n ? <NodePanel key={n.id} n={n} doc={doc} derived={derived} readOnly={readOnly} /> : null;
  }
  if (s.kind === 'note') {
    const n = doc.notes.find((x) => x.id === s.id);
    return n ? <NotePanel key={n.id} n={n} readOnly={readOnly} /> : null;
  }
  return null;
}

function Section({ title, children, right }) {
  return (
    <div className="insp-section">
      {(title || right) && (
        <div className="row">
          <h4 className="grow">{title}</h4>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function DeleteButton({ label }) {
  return (
    <div className="insp-section">
      <button className="danger" onClick={deleteSelection}>
        {label}
      </button>
    </div>
  );
}

function DocSummary({ derived, doc }) {
  const setView = useEditor((s) => s.setView);
  const total = [...derived.wireInfo.values()].reduce((a, i) => a + (i.length || 0), 0);
  const warn = derived.warnings.filter((w) => w.level === 'warn').length;
  return (
    <>
      <Section title={t('Overview')}>
        <div className="insp-kv">
          <span className="k">{t('Components')}</span>
          <span>{doc.components.length}</span>
          <span className="k">{t('Wires')}</span>
          <span>{derived.validWires.length}</span>
          <span className="k">{t('Cables')}</span>
          <span>{(doc.cables || []).length}</span>
          <span className="k">{t('Segments')}</span>
          <span>{doc.segments.length}</span>
          <span className="k">{t('Wire length')}</span>
          <span>{fmtNum(total / 1000, 2)} m</span>
        </div>
        {warn > 0 ? (
          <button className="small" onClick={() => setView('tables')}>
            ⚠ {warn === 1 ? t('Show 1 check result') : t('Show {n} check results', { n: warn })}
          </button>
        ) : (
          <span className="badge ok">{t('No warnings')}</span>
        )}
      </Section>
      <Section title={t('Keyboard shortcuts')}>
        <div className="small muted col" style={{ gap: 2 }}>
          <div>{t('Del – delete selection')}</div>
          <div>{t('Ctrl+Z / Ctrl+Y – undo / redo')}</div>
          <div>{t('Ctrl+D – duplicate components')}</div>
          <div>{t('Ctrl+A – select all')}</div>
          <div>{t('F – fit view')}</div>
          <div>{t('1 / 2 / 3 – schematic / layout / lists')}</div>
          <div>{t('V / S – layout: select / draw segment')}</div>
        </div>
      </Section>
    </>
  );
}

function MultiPanel({ selection, readOnly }) {
  const wireIds = selection.filter((s) => s.kind === 'wire').map((s) => s.id);
  return (
    <Section title={t('Multiple selection')}>
      <div>{t('{n} elements selected', { n: selection.length })}</div>
      {wireIds.length >= 2 && !readOnly && <div className="small muted">{t('Right-click a selected wire to combine the wires into a multi-core cable or a twisted group.')}</div>}
      {!readOnly && (
        <button className="danger" onClick={deleteSelection}>
          {t('Delete selection')}
        </button>
      )}
    </Section>
  );
}

// ---------- Component ----------
function ComponentPanel({ c, derived, readOnly, openPartPicker }) {
  const update = useEditor((s) => s.update);
  const dialogs = useDialogs();
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const select = useEditor((s) => s.select);
  const upd = (fn) =>
    update((d) => {
      fn(d.components.find((x) => x.id === c.id), d);
    });

  // own connectors plus interface connectors of embedded sub-harnesses
  const mateCandidates = derived.allConnectors.filter((x) => x.id !== c.id);
  const wires = c.pins.flatMap((p) => (derived.pinWires.get(p.id) || []).map((w) => ({ pin: p, w })));
  const category = c.type === 'device' ? 'device' : c.type;

  const pickPart = () =>
    openPartPicker(category, async (part) => {
      const lost = wiresLostByPart(doc, c.id, part);
      if (lost > 0) {
        const ok = await dialogs.confirm(
          t('The part has fewer cavities than the connector has pins. {n} wire(s) on surplus pins will be deleted. Continue?', { n: lost }),
          { okLabel: t('Assign'), danger: true }
        );
        if (!ok) return;
      }
      assignPart(c.id, part);
    });

  const renumber = (style) =>
    upd((x) => {
      const names = designationsFor(x.pins.length, style);
      x.pins.forEach((p, i) => (p.name = names[i]));
    });

  return (
    <>
      <Section title={componentTypeLabel(c.type)}>
        <div className="insp-kv">
          <span className="k">{t('Designation')}</span>
          <TextField value={c.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v.trim() || x.label))} />
          {c.type === 'terminal' && (
            <>
              <span className="k">{t('Type')}</span>
              <select value={c.subtype} disabled={readOnly} onChange={(e) => upd((x) => (x.subtype = e.target.value))}>
                {terminalSubtypes().map((ts) => (
                  <option key={ts.value} value={ts.value}>
                    {ts.symbol} {ts.label}
                  </option>
                ))}
              </select>
              <span className="k">{t('Function')}</span>
              <TextField value={c.pins[0]?.fn} disabled={readOnly} placeholder={t('e.g. GND')} onCommit={(v) => upd((x) => (x.pins[0].fn = v))} />
            </>
          )}
          {c.type === 'device' && (
            <>
              <span className="k">{t('Type')}</span>
              <select
                value={c.subtype}
                disabled={readOnly}
                onChange={(e) =>
                  upd((x) => {
                    x.subtype = e.target.value;
                    const st = DEVICE_DEFS.find((s) => s.value === x.subtype);
                    x.pins.forEach((p, i) => (p.name = st.pins[i] || p.name));
                  })
                }
              >
                {deviceSubtypes().map((ds) => (
                  <option key={ds.value} value={ds.value}>
                    {ds.label}
                  </option>
                ))}
              </select>
              <span className="k">{t('Value')}</span>
              <TextField value={c.value} disabled={readOnly} onCommit={(v) => upd((x) => (x.value = v))} />
            </>
          )}
          {c.type === 'connector' && (
            <>
              <span className="k">{t('Mating part')}</span>
              <select value={c.mateId || ''} disabled={readOnly} onChange={(e) => setMate(c.id, e.target.value || null)}>
                <option value="">{t('— not mated —')}</option>
                {mateCandidates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                    {x.virtual ? ` (${t('sub-harness')})` : ''}
                    {x.mateId && x.mateId !== c.id ? ` (${t('already mated')})` : ''}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" disabled={readOnly} checked={!c.excludeFromBom} onChange={(e) => upd((x) => (x.excludeFromBom = !e.target.checked))} />
          {t('Include in bill of materials')}
        </label>
        {['connector', 'terminal', 'splice'].includes(c.type) && (
          <label className="check" title={t('When this harness is embedded into another one, only interface components are shown there.')}>
            <input type="checkbox" disabled={readOnly} checked={!!c.interface} onChange={(e) => upd((x) => (x.interface = e.target.checked))} />
            {t('Interface (for embedding)')}
          </label>
        )}
      </Section>

      <Section
        title={t('Part')}
        right={
          !readOnly && (
            <div className="row" style={{ gap: 4 }}>
              <button className="small" onClick={pickPart}>
                {c.part ? t('Change') : t('Assign …')}
              </button>
              {c.part && (
                <button className="small ghost" onClick={() => assignPart(c.id, null)} title={t('Remove assignment')}>
                  ✕
                </button>
              )}
            </div>
          )
        }
      >
        {c.part ? (
          <div className="col" style={{ gap: 4 }}>
            <div className="mono">{c.part.partNumber || '—'}</div>
            <div className="small">{c.part.manufacturer}</div>
            <div className="small muted">{partDescription(c.part)}</div>
            <div className="small muted">{partSummary(c.part)}</div>
            {c.part.data?.contactPart && (
              <div className="small">
                {t('Contact')}: <span className="mono">{c.part.data.contactPart}</span> {c.part.data.contactRange ? `(${c.part.data.contactRange})` : ''}
              </div>
            )}
            {c.part.data?.lockPart && (
              <div className="small">
                {t('Accessory')}: <span className="mono">{c.part.data.lockPart}</span>
              </div>
            )}
            {c.part.data?.matingPart && <div className="small muted">{t('Mating part (library)')}: {c.part.data.matingPart}</div>}
            {c.part.data?.usedBy?.length > 0 && <div className="small muted">{t('Typical use')}: {c.part.data.usedBy.join(', ')}</div>}
            {partNotes(c.part) && <div className="small muted">{partNotes(c.part)}</div>}
            {c.part.data?.url && /^https?:\/\//i.test(c.part.data.url) && (
              <a className="small" href={c.part.data.url} target="_blank" rel="noreferrer noopener">
                {t('Datasheet / link')} ↗
              </a>
            )}
          </div>
        ) : (
          <div className="small muted">{t('No library part assigned.')}</div>
        )}
      </Section>

      {c.type === 'connector' && (
        <Section
          title={t('Pins ({n})', { n: c.pins.length })}
          right={
            !readOnly && (
              <div className="row" style={{ gap: 4 }}>
                <button className="small ghost" title={t('Digits')} onClick={() => renumber('numeric')}>
                  1 2 3
                </button>
                <button className="small ghost" title={t('Letters')} onClick={() => renumber('alpha')}>
                  A B C
                </button>
              </div>
            )
          }
        >
          <table className="pin-table">
            <tbody>
              {c.pins.map((p, i) => {
                const n = (derived.pinWires.get(p.id) || []).length;
                return (
                  <tr key={p.id}>
                    <td style={{ width: 48 }}>
                      <TextField value={p.name} disabled={readOnly} onCommit={(v) => upd((x) => (x.pins[i].name = v.trim() || x.pins[i].name))} />
                    </td>
                    <td>
                      <TextField value={p.fn} placeholder={t('Function')} disabled={readOnly} onCommit={(v) => upd((x) => (x.pins[i].fn = v))} />
                    </td>
                    <td style={{ width: 24 }} className="small muted" title={t('Number of wires')}>
                      {n || ''}
                    </td>
                    <td style={{ width: 26 }}>
                      {!readOnly && (
                        <button
                          className="ghost icon small"
                          title={t('Remove pin')}
                          disabled={c.pins.length <= 1}
                          onClick={async () => {
                            if (n && !(await dialogs.confirm(t('Pin {pin} has {n} wire(s). Delete the pin including its wires?', { pin: p.name, n }), { okLabel: t('Delete'), danger: true }))) return;
                            update((d) => {
                              const x = d.components.find((q) => q.id === c.id);
                              x.pins.splice(i, 1);
                              d.wires = d.wires.filter((w) => w.from.p !== p.id && w.to.p !== p.id);
                            });
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!readOnly && (
            <button
              className="small"
              onClick={() =>
                upd((x) => {
                  const style = x.pins.length && /^[A-Z]+$/.test(x.pins[x.pins.length - 1].name) ? 'alpha' : 'numeric';
                  const names = designationsFor(x.pins.length + 1, style);
                  x.pins.push({ id: uid('p'), name: names[x.pins.length], fn: '' });
                })
              }
            >
              ＋ {t('Pin')}
            </button>
          )}
          {c.part && c.pins.length !== Number(c.part.data?.cavities) && (
            <div className="warn-box small">{t('The number of pins differs from the {n} cavities of the part.', { n: c.part.data?.cavities })}</div>
          )}
        </Section>
      )}

      {c.type === 'connector' && (
        <Section title={t('Layout display')}>
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!c.show?.image} onChange={(e) => upd((x) => (x.show = { ...x.show, image: e.target.checked }))} />
            {t('Show part image')} {!c.part?.hasImage && <span className="muted small">({t('no image available')})</span>}
          </label>
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!c.show?.face} onChange={(e) => upd((x) => (x.show = { ...x.show, face: e.target.checked }))} />
            {t('Show mating face')}
          </label>
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!c.show?.table} onChange={(e) => upd((x) => (x.show = { ...x.show, table: e.target.checked }))} />
            {t('Show wire table')}
          </label>
          {!c.part && (
            <div className="insp-kv">
              <span className="k">{t('Rows (mating face)')}</span>
              <NumberField value={faceRowsOf(c)} disabled={readOnly} min={1} onCommit={(v) => upd((x) => (x.faceRows = Math.max(1, Math.round(v))))} />
            </div>
          )}
          <div>
            <FaceView
              count={c.pins.length}
              rows={faceRowsOf(c)}
              numbering={c.part?.data?.numbering}
              names={c.pins.map((p) => p.name)}
              used={new Set(c.pins.map((p, i) => ((derived.pinWires.get(p.id) || []).length ? i : -1)))}
              size={24}
            />
          </div>
          {view !== 'layout' && <div className="small muted">{t('This display appears in the layout view and in print.')}</div>}
        </Section>
      )}

      <Section title={t('Wires ({n})', { n: wires.length })}>
        {wires.length === 0 && <div className="small muted">{t('No wires connected.')}</div>}
        {wires.map(({ pin, w }) => {
          const info = derived.wireInfo.get(w.id);
          const other = w.from.p === pin.id ? info.to : info.from;
          return (
            <div
              key={`${pin.id}-${w.id}`}
              className="row small"
              style={{ cursor: 'pointer' }}
              onClick={() => select([{ kind: 'wire', id: w.id }])}
              onMouseEnter={() => useEditor.getState().setHover({ key: `w:${w.id}`, wireIds: [w.id] })}
              onMouseLeave={() => useEditor.getState().setHover(null)}
            >
              <span className="muted" style={{ width: 30 }}>
                {pin.name}
              </span>
              <span className="swatch" style={{ background: colorByCode(w.color).hex }} />
              <span className="grow">
                {w.label} → {pinRef(other)}
              </span>
              <span className="muted">{fmtLen(info.length)}</span>
            </div>
          );
        })}
      </Section>

      <Section title={t('Notes')}>
        <TextField multiline value={c.notes} disabled={readOnly} onCommit={(v) => upd((x) => (x.notes = v))} />
      </Section>

      {!readOnly && <DeleteButton label={t('Delete component')} />}
    </>
  );
}

// ---------- Sub-harness ----------
function SubharnessPanel({ c, derived, readOnly, onOpenHarness, onReloadEmbeds }) {
  const update = useEditor((s) => s.update);
  const sub = derived.subs.get(c.id);
  const upd = (fn) =>
    update((d) => {
      fn(d.components.find((x) => x.id === c.id));
    });
  const mates = (sub?.virtuals || []).map((v) => ({ v, mate: derived.matePairs.find(([, b]) => b.id === v.id)?.[0] }));
  return (
    <>
      <Section title={t('Sub-harness (linked)')}>
        <div className="insp-kv">
          <span className="k">{t('Designation')}</span>
          <TextField value={c.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v.trim() || x.label))} />
          <span className="k">{t('Harness')}</span>
          <span>{sub?.name || c.ref?.name || '?'}</span>
        </div>
        {sub?.missing && <div className="warn-box small">{t('The embedded harness is not available (deleted or no access).')}</div>}
        <div className="row wrap" style={{ gap: 6 }}>
          <button className="small" onClick={() => onOpenHarness(c.ref?.harnessId)} disabled={sub?.missing}>
            {t('Open harness')} ↗
          </button>
          <button className="small" onClick={onReloadEmbeds}>
            ↻ {t('Reload')}
          </button>
        </div>
        <label className="check">
          <input type="checkbox" disabled={readOnly} checked={!c.excludeFromBom} onChange={(e) => upd((x) => (x.excludeFromBom = !e.target.checked))} />
          {t('Include in bill of materials')}
        </label>
        <div className="small muted">
          {t('Changes to the original harness appear here automatically. Mate your connectors with the interface connectors below to connect circuits.')}
        </div>
      </Section>
      <Section title={t('Interface connectors ({n})', { n: sub?.virtuals.length || 0 })}>
        {mates.map(({ v, mate }) => (
          <div key={v.id} className="row small">
            <span className="grow">
              {v.shortLabel} <span className="muted">{v.part?.partNumber || ''}</span>
            </span>
            <span className="muted">{mate ? `⇄ ${mate.label}` : t('not mated')}</span>
          </div>
        ))}
        {sub && !sub.missing && !sub.virtuals.length && <div className="small muted">{t('The embedded harness has no connectors or terminals.')}</div>}
      </Section>
      <Section title={t('Notes')}>
        <TextField multiline value={c.notes} disabled={readOnly} onCommit={(v) => upd((x) => (x.notes = v))} />
      </Section>
      {!readOnly && <DeleteButton label={t('Remove sub-harness')} />}
    </>
  );
}

// ---------- Wire ----------
function WirePanel({ w, derived, readOnly, openPartPicker }) {
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const setWireDefaults = useEditor((s) => s.setWireDefaults);
  const wireDefaults = useEditor((s) => s.wireDefaults);
  const doc = useEditor((s) => s.doc);
  const settings = doc.settings;
  const info = derived.wireInfo.get(w.id);
  const upd = (fn) =>
    update((d) => {
      fn(d.wires.find((x) => x.id === w.id), d);
    });
  if (!info) {
    return (
      <Section title={t('Wire')}>
        <div className="warn-box">{t('This wire refers to a pin that no longer exists.')}</div>
        {!readOnly && (
          <button className="danger" onClick={deleteSelection}>
            {t('Delete')}
          </button>
        )}
      </Section>
    );
  }
  const awg = awgFor(w.cs);
  const routeText = info.route ? info.route.nodeIds.map((id) => derived.nodeLabel(id)).join(' → ') : null;
  const selectComp = (comp) => select([{ kind: 'component', id: comp.subId || comp.id }]);

  return (
    <>
      <Section title={t('Wire')}>
        <div className="insp-kv">
          <span className="k">{t('Designation')}</span>
          <TextField value={w.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v.trim() || x.label))} />
          <span className="k">{t('Signal')}</span>
          <TextField value={w.signal} disabled={readOnly} placeholder={info.from.pin.fn || info.to.pin.fn || ''} onCommit={(v) => upd((x) => (x.signal = v))} />
          <span className="k">{t('From')}</span>
          <a href="#" onClick={(e) => (e.preventDefault(), selectComp(info.from.comp))}>
            {pinRef(info.from)} {info.from.pin.fn && <span className="muted">({info.from.pin.fn})</span>}
          </a>
          <span className="k">{t('To')}</span>
          <a href="#" onClick={(e) => (e.preventDefault(), selectComp(info.to.comp))}>
            {pinRef(info.to)} {info.to.pin.fn && <span className="muted">({info.to.pin.fn})</span>}
          </a>
          <span className="k">{t('Cable / twist')}</span>
          <select value={w.cableId || ''} disabled={readOnly} onChange={(e) => setWireCable(w.id, e.target.value || null)}>
            <option value="">{t('— none —')}</option>
            {(doc.cables || []).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label} ({cableKindLabel(k.kind)})
              </option>
            ))}
          </select>
          {w.cableId && (
            <>
              <span className="k">{t('Role')}</span>
              <select value={w.cableRole || 'core'} disabled={readOnly} onChange={(e) => upd((x) => (x.cableRole = e.target.value))}>
                <option value="core">{t('Core')}</option>
                <option value="shield">{t('Shield / drain wire')}</option>
              </select>
            </>
          )}
        </div>
      </Section>

      <Section title={t('Execution')}>
        <div className="col" style={{ gap: 6 }}>
          <span className="small muted">
            {t('Colour')}: {wireColorName(w)}
          </span>
          <div className="row wrap" style={{ gap: 4 }}>
            {WIRE_COLORS.map((c) => {
              const cc = colorByCode(c.code);
              return (
                <button
                  key={c.code}
                  disabled={readOnly}
                  className={`icon small ${w.color === c.code ? 'active' : ''}`}
                  title={`${cc.name} (${c.code})`}
                  onClick={() => upd((x) => (x.color = c.code))}
                  style={{ padding: 0 }}
                >
                  <span className="swatch" style={{ background: c.hex }} />
                </button>
              );
            })}
          </div>
        </div>
        <div className="insp-kv">
          <span className="k">{t('Stripe colour')}</span>
          <select value={w.stripe || ''} disabled={readOnly} onChange={(e) => upd((x) => (x.stripe = e.target.value || null))}>
            <option value="">{t('— none —')}</option>
            {WIRE_COLORS.map((c) => (
              <option key={c.code} value={c.code}>
                {colorByCode(c.code).name} ({c.code})
              </option>
            ))}
          </select>
          <span className="k">{t('Cross-section')}</span>
          <div className="row">
            <select className="grow" value={w.cs} disabled={readOnly} onChange={(e) => upd((x) => (x.cs = Number(e.target.value)))}>
              {!CROSS_SECTIONS.includes(w.cs) && <option value={w.cs}>{fmtCs(w.cs)}</option>}
              {CROSS_SECTIONS.map((c) => (
                <option key={c} value={c}>
                  {fmtCs(c)}
                </option>
              ))}
            </select>
            <span className="small muted nowrap">≈ AWG {awg}</span>
          </div>
          <span className="k">{t('Wire type')}</span>
          <TextField value={w.type} disabled={readOnly} onCommit={(v) => upd((x) => (x.type = v))} />
        </div>
        {!readOnly && (
          <div className="row wrap" style={{ gap: 4 }}>
            <button
              className="small"
              onClick={() =>
                openPartPicker('wire', (part) =>
                  upd((x) => {
                    x.part = snapshotPart(part);
                    if (part.data?.crossSection) x.cs = Number(part.data.crossSection);
                    if (part.data?.type) x.type = part.data.type;
                    if (part.data?.outerDiameter) x.outerDiameter = Number(part.data.outerDiameter);
                  })
                )
              }
            >
              {t('Wire from library …')}
            </button>
            <button className="small" title={t('Use colour, cross-section and type for new wires')} onClick={() => setWireDefaults({ color: w.color, stripe: w.stripe, cs: w.cs, type: w.type, part: w.part || null })}>
              {t('Use as default for new wires')}
            </button>
          </div>
        )}
        {wireDefaults && (
          <div className="small muted">
            {t('Default')}: {colorByCode(wireDefaults.color).name}, {fmtCs(wireDefaults.cs)}, {wireDefaults.type}
          </div>
        )}
        {w.part && <div className="small muted">{t('Library part')}: {w.part.partNumber || partDescription(w.part)}</div>}
      </Section>

      <Section title={t('Length')}>
        <div className="insp-kv">
          <span className="k">{t('Result')}</span>
          <strong>{fmtLen(info.length)}</strong>
          <span className="k">{t('Path in layout')}</span>
          <span>{info.routed ? fmtLen(info.baseLength) : <span style={{ color: 'var(--warn)' }}>{t('not routed')}</span>}</span>
          {info.twistFactor > 1 && (
            <>
              <span className="k">{t('Twist factor')}</span>
              <span>× {fmtNum(info.twistFactor, 3)}</span>
            </>
          )}
          <span className="k">{t('Extra length')}</span>
          <NumberField value={w.lengthExtra || 0} disabled={readOnly} onCommit={(v) => upd((x) => (x.lengthExtra = v || 0))} placeholder="mm" />
          <span className="k">{t('Fixed length')}</span>
          <NumberField value={w.lengthOverride} allowEmpty disabled={readOnly} onCommit={(v) => upd((x) => (x.lengthOverride = v))} placeholder={t('automatic')} />
        </div>
        <div className="small muted">
          {t('Length = path × (1 + {pct} %) × twist factor + 2 × {end} mm + extra length. Allowances in the harness settings.', {
            pct: fmtNum(settings.extraPercent),
            end: fmtNum(settings.extraPerEnd),
          })}
        </div>
        {routeText && (
          <div className="small">
            {t('Route')}: {routeText}
          </div>
        )}
        {!info.routed && !info.overridden && (
          <div className="warn-box small">{t('Connect {a} and {b} via segments in the layout view so the length can be calculated.', { a: info.from.comp.label, b: info.to.comp.label })}</div>
        )}
      </Section>

      <Section title={t('Notes')}>
        <TextField multiline value={w.notes} disabled={readOnly} onCommit={(v) => upd((x) => (x.notes = v))} />
      </Section>

      {!readOnly && (
        <div className="insp-section row wrap" style={{ gap: 6 }}>
          <button
            className="small"
            onClick={() =>
              upd((x) => {
                const f = x.from;
                x.from = x.to;
                x.to = f;
              })
            }
          >
            {t('Swap direction')}
          </button>
          {typeof w.schMid === 'number' && (
            <button className="small" onClick={() => upd((x) => delete x.schMid)}>
              {t('Reset path')}
            </button>
          )}
          <button className="small danger" onClick={deleteSelection}>
            {t('Delete')}
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Cable / twisted group ----------
function CablePanel({ k, derived, readOnly, openPartPicker }) {
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const setHover = useEditor((s) => s.setHover);
  const dialogs = useDialogs();
  const ci = derived.cableInfo.get(k.id);
  const upd = (fn) =>
    update((d) => {
      fn((d.cables || []).find((x) => x.id === k.id), d);
    });
  const isCable = k.kind === 'cable';

  const applyPart = (part) =>
    update((d) => {
      const x = d.cables.find((q) => q.id === k.id);
      x.part = snapshotPart(part);
      const pd = part.data || {};
      if (pd.type) x.type = pd.type;
      if (pd.cores) x.cores = pd.cores;
      x.shield = !!pd.shield;
      if (pd.outerDiameter) x.outerDiameter = pd.outerDiameter;
      const colors = pd.coreColors || [];
      const members = d.wires.filter((w) => w.cableId === k.id && w.cableRole !== 'shield');
      members.forEach((w, i) => {
        if (colors[i]) {
          w.color = colors[i];
          w.stripe = null;
        }
        if (pd.crossSection) w.cs = Number(pd.crossSection);
        if (pd.type) w.type = pd.type;
      });
    });

  return (
    <>
      <Section title={cableKindLabel(k.kind)}>
        <div className="insp-kv">
          <span className="k">{t('Designation')}</span>
          <TextField value={k.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v.trim() || x.label))} />
          <span className="k">{t('Kind')}</span>
          <select value={k.kind} disabled={readOnly} onChange={(e) => upd((x) => (x.kind = e.target.value))}>
            <option value="cable">{t('Multi-core cable')}</option>
            <option value="twist">{t('Twisted wires')}</option>
          </select>
          {isCable && (
            <>
              <span className="k">{t('Cable type')}</span>
              <TextField value={k.type} disabled={readOnly} placeholder={t('e.g. LiYCY')} onCommit={(v) => upd((x) => (x.type = v))} />
              <span className="k">{t('Number of cores')}</span>
              <NumberField value={k.cores} allowEmpty min={1} disabled={readOnly} onCommit={(v) => upd((x) => (x.cores = v ? Math.round(v) : null))} />
              <span className="k">{t('Outer diameter')}</span>
              <NumberField value={k.outerDiameter} allowEmpty disabled={readOnly} placeholder={ci?.odEstimated ? `≈ ${fmtNum(ci.outerDiameter, 1)}` : ''} onCommit={(v) => upd((x) => (x.outerDiameter = v))} />
            </>
          )}
          {!isCable && (
            <>
              <span className="k">{t('Lay length (mm)')}</span>
              <NumberField value={k.layLength} allowEmpty min={1} disabled={readOnly} onCommit={(v) => upd((x) => (x.layLength = v))} />
              <span className="k">{t('Twist factor')}</span>
              <span>× {fmtNum(ci?.twistFactor || 1, 3)}</span>
            </>
          )}
          <span className="k">{t('Length')}</span>
          <strong>{fmtLen(ci?.length)}</strong>
        </div>
        {isCable && (
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!k.shield} onChange={(e) => upd((x) => (x.shield = e.target.checked))} />
            {t('Shielded')}
          </label>
        )}
        {isCable && (
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!k.excludeFromBom} onChange={(e) => upd((x) => (x.excludeFromBom = !e.target.checked))} />
            {t('Include in bill of materials')}
          </label>
        )}
        {!isCable && <div className="small muted">{t('Twisting lengthens the wires by the twist factor √(1 + (π·d / lay length)²).')}</div>}
      </Section>
      {isCable && (
        <Section
          title={t('Part')}
          right={
            !readOnly && (
              <button className="small" onClick={() => openPartPicker('cable', applyPart)}>
                {k.part ? t('Change') : t('Assign …')}
              </button>
            )
          }
        >
          {k.part ? (
            <div className="small">
              <div className="mono">{k.part.partNumber}</div>
              <div className="muted">{partDescription(k.part)}</div>
              <div className="muted">{t('Assigning applies the core colours of the cable to its cores (in order).')}</div>
            </div>
          ) : (
            <div className="small muted">{t('No library part assigned.')}</div>
          )}
        </Section>
      )}
      <Section title={t('Wires ({n})', { n: ci?.members.length || 0 })}>
        {(ci?.members || []).map((w) => {
          const wi = derived.wireInfo.get(w.id);
          return (
            <div
              key={w.id}
              className="row small"
              style={{ cursor: 'pointer' }}
              onClick={() => select([{ kind: 'wire', id: w.id }])}
              onMouseEnter={() => setHover({ key: `w:${w.id}`, wireIds: [w.id] })}
              onMouseLeave={() => setHover(null)}
            >
              <span className="swatch" style={{ background: colorByCode(w.color).hex }} />
              <span className="grow">
                {w.label} {pinRef(wi.from)} → {pinRef(wi.to)}
                {w.cableRole === 'shield' ? ` (${t('shield')})` : ''}
              </span>
              <span className="muted">{fmtLen(wi.length)}</span>
            </div>
          );
        })}
        <div className="small muted">{t('Add wires via the wire properties ("Cable / twist").')}</div>
      </Section>
      <Section title={t('Notes')}>
        <TextField multiline value={k.notes} disabled={readOnly} onCommit={(v) => upd((x) => (x.notes = v))} />
      </Section>
      {!readOnly && (
        <div className="insp-section">
          <button
            className="danger"
            onClick={async () => {
              if (await dialogs.confirm(t('Dissolve {name}? The wires are kept.', { name: k.label }), { okLabel: t('Dissolve'), danger: true })) deleteSelection();
            }}
          >
            {t('Dissolve group')}
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Segment ----------
function SegmentPanel({ s, derived, readOnly, openPartPicker }) {
  const update = useEditor((st) => st.update);
  const select = useEditor((st) => st.select);
  const setHover = useEditor((st) => st.setHover);
  const info = derived.segInfo.get(s.id);
  const upd = (fn) =>
    update((d) => {
      fn(d.segments.find((x) => x.id === s.id), d);
    });
  return (
    <>
      <Section title={t('Segment')}>
        <div className="insp-kv">
          <span className="k">{t('From')}</span>
          <span>{info?.fromLabel}</span>
          <span className="k">{t('To')}</span>
          <span>{info?.toLabel}</span>
          <span className="k">{t('Length (mm)')}</span>
          <NumberField value={s.length} disabled={readOnly} onCommit={(v) => upd((x) => (x.length = v ?? 0))} />
          <span className="k">{t('Designation')}</span>
          <TextField value={s.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v))} />
          <span className="k">{t('Bundle Ø')}</span>
          <span>{info?.bundleDiameter ? t('≈ {d} mm (estimate)', { d: fmtNum(info.bundleDiameter, 1) }) : '–'}</span>
          <span className="k">{t('Bend points')}</span>
          <span className="row">
            {s.points.length}
            {!readOnly && s.points.length > 0 && (
              <button className="small ghost" onClick={() => upd((x) => (x.points = []))}>
                {t('remove')}
              </button>
            )}
          </span>
        </div>
      </Section>
      <Section
        title={t('Covering')}
        right={
          !readOnly && (
            <button
              className="small"
              onClick={() =>
                openPartPicker('covering', (part) =>
                  upd((x) => {
                    x.coverings = [...(x.coverings || []), { id: uid('v'), part: snapshotPart(part), label: '' }];
                  })
                )
              }
            >
              ＋ {t('Library')}
            </button>
          )
        }
      >
        {(s.coverings || []).length === 0 && <div className="small muted">{t('No covering.')}</div>}
        {(s.coverings || []).map((cv, i) => (
          <div key={cv.id || i} className="row small">
            <span className="grow">{cv.part ? `${cv.part.partNumber ? `${cv.part.partNumber} – ` : ''}${partDescription(cv.part)}` : cv.label}</span>
            {!readOnly && (
              <button className="ghost small" onClick={() => upd((x) => x.coverings.splice(i, 1))}>
                ✕
              </button>
            )}
          </div>
        ))}
        {info?.bundleDiameter > 0 && (s.coverings || []).some((cv) => cv.part?.data?.innerDiameter && cv.part.data.innerDiameter < info.bundleDiameter) && (
          <div className="warn-box small">{t('The estimated bundle diameter is larger than the inner diameter of the covering.')}</div>
        )}
      </Section>
      <Section title={t('Wires in segment ({n})', { n: info?.wires.length || 0 })}>
        {(info?.wires || []).map((id) => {
          const wi = derived.wireInfo.get(id);
          return (
            <div
              key={id}
              className="row small"
              style={{ cursor: 'pointer' }}
              onClick={() => select([{ kind: 'wire', id }])}
              onMouseEnter={() => setHover({ key: `w:${id}`, wireIds: [id] })}
              onMouseLeave={() => setHover(null)}
            >
              <span className="swatch" style={{ background: colorByCode(wi.wire.color).hex }} />
              <span className="grow">
                {wi.wire.label} {pinRef(wi.from)} → {pinRef(wi.to)}
                {wi.cable ? ` · ${wi.cable.label}` : ''}
              </span>
              <span className="muted">{fmtCs(wi.wire.cs)}</span>
            </div>
          );
        })}
        {info?.wires.length > 0 && (
          <button className="small" onMouseEnter={() => setHover({ key: `s:${s.id}`, wireIds: info.wires })} onMouseLeave={() => setHover(null)}>
            {t('Highlight all (hover)')}
          </button>
        )}
      </Section>
      {!readOnly && <DeleteButton label={t('Delete segment')} />}
    </>
  );
}

function NodePanel({ n, doc, derived, readOnly }) {
  const update = useEditor((s) => s.update);
  const clearSelection = useEditor((s) => s.clearSelection);
  const attached = doc.segments.filter((s) => s.a === n.id || s.b === n.id);
  return (
    <>
      <Section title={t('Branch point')}>
        <div className="insp-kv">
          <span className="k">{t('Designation')}</span>
          <TextField value={n.label} disabled={readOnly} placeholder={t('optional')} onCommit={(v) => update((d) => void (d.nodes.find((x) => x.id === n.id).label = v))} />
          <span className="k">{t('Segments')}</span>
          <span>{attached.length}</span>
        </div>
        {attached.map((s) => (
          <div key={s.id} className="small muted">
            → {derived.nodeLabel(s.a === n.id ? s.b : s.a)} ({fmtLen(s.length)})
          </div>
        ))}
      </Section>
      {!readOnly && (
        <div className="insp-section">
          <button
            className="danger"
            onClick={() => {
              update((d) => removeNode(d, n.id));
              clearSelection();
            }}
          >
            {attached.length === 2 ? t('Remove (merge segments)') : t('Delete branch point')}
          </button>
        </div>
      )}
    </>
  );
}

function NotePanel({ n, readOnly }) {
  const update = useEditor((s) => s.update);
  return (
    <>
      <Section title={t('Note')}>
        <TextField multiline rows={6} value={n.text} disabled={readOnly} onCommit={(v) => update((d) => void (d.notes.find((x) => x.id === n.id).text = v))} />
      </Section>
      {!readOnly && <DeleteButton label={t('Delete note')} />}
    </>
  );
}
