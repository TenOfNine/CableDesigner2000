import { useEditor } from './store.js';
import { TextField, NumberField } from './fields.jsx';
import {
  WIRE_COLORS, CROSS_SECTIONS, colorByCode, awgFor, fmtCs, fmtLen, fmtNum, TERMINAL_SUBTYPES, DEVICE_SUBTYPES,
  COMPONENT_TYPE_LABEL, partSummary, designationsFor, uid, wireColorName, snapshotPart,
} from './model.js';
import { pinRef } from './derive.js';
import { deleteSelection, assignPart, setMate, removeNode, wiresLostByPart } from './actions.js';
import { FaceView } from '../components/parts.jsx';
import { useDialogs } from '../components/ui.jsx';
import { faceRowsOf } from './LayoutScene.jsx';

function useUpdate() {
  return useEditor((s) => s.update);
}

export default function Inspector({ derived, openPartPicker }) {
  const selection = useEditor((s) => s.selection);
  const doc = useEditor((s) => s.doc);
  const readOnly = useEditor((s) => s.permission === 'read');

  if (selection.length === 0) return <DocSummary derived={derived} doc={doc} />;
  if (selection.length > 1) {
    return (
      <div className="insp-section">
        <h4>Mehrfachauswahl</h4>
        <div>{selection.length} Elemente ausgewählt</div>
        {!readOnly && (
          <button className="danger" onClick={deleteSelection}>
            Auswahl löschen
          </button>
        )}
      </div>
    );
  }
  const s = selection[0];
  if (s.kind === 'component') {
    const c = doc.components.find((x) => x.id === s.id);
    return c ? <ComponentPanel key={c.id} c={c} derived={derived} readOnly={readOnly} openPartPicker={openPartPicker} /> : null;
  }
  if (s.kind === 'wire') {
    const w = doc.wires.find((x) => x.id === s.id);
    return w ? <WirePanel key={w.id} w={w} derived={derived} readOnly={readOnly} openPartPicker={openPartPicker} /> : null;
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

function DocSummary({ derived, doc }) {
  const setView = useEditor((s) => s.setView);
  const total = [...derived.wireInfo.values()].reduce((a, i) => a + (i.length || 0), 0);
  const warn = derived.warnings.filter((w) => w.level === 'warn').length;
  return (
    <>
      <div className="insp-section">
        <h4>Übersicht</h4>
        <div className="insp-kv">
          <span className="k">Bauteile</span>
          <span>{doc.components.length}</span>
          <span className="k">Leitungen</span>
          <span>{derived.validWires.length}</span>
          <span className="k">Segmente</span>
          <span>{doc.segments.length}</span>
          <span className="k">Leitungslänge</span>
          <span>{fmtNum(total / 1000, 2)} m</span>
        </div>
        {warn > 0 ? (
          <button className="small" onClick={() => setView('tables')}>
            ⚠ {warn} Prüfhinweis{warn === 1 ? '' : 'e'} ansehen
          </button>
        ) : (
          <span className="badge ok">Keine Warnungen</span>
        )}
      </div>
      <div className="insp-section small muted">
        <h4>Tastenkürzel</h4>
        <div>Entf – Auswahl löschen</div>
        <div>Strg+Z / Strg+Y – Rückgängig / Wiederholen</div>
        <div>Strg+D – Bauteile duplizieren</div>
        <div>Strg+A – alles auswählen</div>
        <div>F – Ansicht einpassen</div>
        <div>1 / 2 / 3 – Schaltplan / Layout / Listen</div>
        <div>V / S – Layout: Auswählen / Segment zeichnen</div>
      </div>
    </>
  );
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

// ---------- Bauteil ----------
function ComponentPanel({ c, derived, readOnly, openPartPicker }) {
  const update = useUpdate();
  const dialogs = useDialogs();
  const doc = useEditor((s) => s.doc);
  const view = useEditor((s) => s.view);
  const select = useEditor((s) => s.select);
  const upd = (fn) => update((d) => {
    fn(d.components.find((x) => x.id === c.id), d);
  });

  const connectors = doc.components.filter((x) => x.type === 'connector' && x.id !== c.id);
  const wires = c.pins.flatMap((p) => (derived.pinWires.get(p.id) || []).map((w) => ({ pin: p, w })));
  const category = c.type === 'device' ? 'device' : c.type;

  const pickPart = () =>
    openPartPicker(category, async (part) => {
      const lost = wiresLostByPart(doc, c.id, part);
      if (lost > 0) {
        const ok = await dialogs.confirm(
          `Das Teil hat weniger Kammern als der Steckverbinder Pins. Dabei werden ${lost} Leitung(en) an überzähligen Pins gelöscht. Fortfahren?`,
          { okLabel: 'Zuordnen', danger: true }
        );
        if (!ok) return;
      }
      assignPart(c.id, part);
    });

  const renumber = async (style) => {
    upd((x) => {
      const names = designationsFor(x.pins.length, style);
      x.pins.forEach((p, i) => (p.name = names[i]));
    });
  };

  return (
    <>
      <Section title={COMPONENT_TYPE_LABEL[c.type]}>
        <div className="insp-kv">
          <span className="k">Bezeichnung</span>
          <TextField value={c.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v.trim() || x.label))} />
          {c.type === 'terminal' && (
            <>
              <span className="k">Art</span>
              <select value={c.subtype} disabled={readOnly} onChange={(e) => upd((x) => (x.subtype = e.target.value))}>
                {TERMINAL_SUBTYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.symbol} {t.label}
                  </option>
                ))}
              </select>
              <span className="k">Funktion</span>
              <TextField value={c.pins[0]?.fn} disabled={readOnly} placeholder="z. B. GND" onCommit={(v) => upd((x) => (x.pins[0].fn = v))} />
            </>
          )}
          {c.type === 'device' && (
            <>
              <span className="k">Art</span>
              <select
                value={c.subtype}
                disabled={readOnly}
                onChange={(e) =>
                  upd((x) => {
                    x.subtype = e.target.value;
                    const st = DEVICE_SUBTYPES.find((s) => s.value === x.subtype);
                    x.pins.forEach((p, i) => (p.name = st.pins[i] || p.name));
                  })
                }
              >
                {DEVICE_SUBTYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="k">Wert</span>
              <TextField value={c.value} disabled={readOnly} onCommit={(v) => upd((x) => (x.value = v))} />
            </>
          )}
          {c.type === 'connector' && (
            <>
              <span className="k">Gegenstück</span>
              <select value={c.mateId || ''} disabled={readOnly} onChange={(e) => setMate(c.id, e.target.value || null)}>
                <option value="">— nicht gesteckt —</option>
                {connectors.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                    {x.mateId && x.mateId !== c.id ? ' (bereits gepaart)' : ''}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
        <label className="check">
          <input type="checkbox" disabled={readOnly} checked={!c.excludeFromBom} onChange={(e) => upd((x) => (x.excludeFromBom = !e.target.checked))} />
          In Stückliste aufnehmen
        </label>
      </Section>

      <Section
        title="Teil"
        right={
          !readOnly && (
            <div className="row" style={{ gap: 4 }}>
              <button className="small" onClick={pickPart}>
                {c.part ? 'Ändern' : 'Zuordnen …'}
              </button>
              {c.part && (
                <button className="small ghost" onClick={() => assignPart(c.id, null)} title="Zuordnung entfernen">
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
            <div className="small muted">{c.part.description}</div>
            <div className="small muted">{partSummary(c.part)}</div>
            {c.part.data?.contactPart && (
              <div className="small">
                Kontakt: <span className="mono">{c.part.data.contactPart}</span> {c.part.data.contactRange ? `(${c.part.data.contactRange})` : ''}
              </div>
            )}
            {c.part.data?.lockPart && (
              <div className="small">
                Zubehör: <span className="mono">{c.part.data.lockPart}</span>
              </div>
            )}
            {c.part.data?.matingPart && <div className="small muted">Gegenstück lt. Bibliothek: {c.part.data.matingPart}</div>}
            {c.part.data?.url && /^https?:\/\//i.test(c.part.data.url) && (
              <a className="small" href={c.part.data.url} target="_blank" rel="noreferrer noopener">
                Datenblatt/Link ↗
              </a>
            )}
          </div>
        ) : (
          <div className="small muted">Kein Bibliotheksteil zugeordnet.</div>
        )}
      </Section>

      {c.type === 'connector' && (
        <Section
          title={`Pins (${c.pins.length})`}
          right={
            !readOnly && (
              <div className="row" style={{ gap: 4 }}>
                <button className="small ghost" title="Ziffern" onClick={() => renumber('numeric')}>
                  1 2 3
                </button>
                <button className="small ghost" title="Buchstaben" onClick={() => renumber('alpha')}>
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
                      <TextField value={p.fn} placeholder="Funktion" disabled={readOnly} onCommit={(v) => upd((x) => (x.pins[i].fn = v))} />
                    </td>
                    <td style={{ width: 24 }} className="small muted" title="Anzahl Leitungen">
                      {n || ''}
                    </td>
                    <td style={{ width: 26 }}>
                      {!readOnly && (
                        <button
                          className="ghost icon small"
                          title="Pin entfernen"
                          disabled={c.pins.length <= 1}
                          onClick={async () => {
                            if (n && !(await dialogs.confirm(`Pin ${p.name} hat ${n} Leitung(en). Pin samt Leitungen löschen?`, { okLabel: 'Löschen', danger: true }))) return;
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
              ＋ Pin
            </button>
          )}
          {c.part && c.pins.length !== Number(c.part.data?.cavities) && (
            <div className="warn-box small">Pinanzahl weicht von den {c.part.data?.cavities} Kammern des Teils ab.</div>
          )}
        </Section>
      )}

      {c.type === 'connector' && (
        <Section title="Layout-Darstellung">
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!c.show?.image} onChange={(e) => upd((x) => (x.show = { ...x.show, image: e.target.checked }))} />
            Teilebild anzeigen {!c.part?.hasImage && <span className="muted small">(kein Bild vorhanden)</span>}
          </label>
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!c.show?.face} onChange={(e) => upd((x) => (x.show = { ...x.show, face: e.target.checked }))} />
            Steckgesicht anzeigen
          </label>
          <label className="check">
            <input type="checkbox" disabled={readOnly} checked={!!c.show?.table} onChange={(e) => upd((x) => (x.show = { ...x.show, table: e.target.checked }))} />
            Leitungstabelle anzeigen
          </label>
          {!c.part && (
            <div className="insp-kv">
              <span className="k">Reihen (Steckgesicht)</span>
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
          {view !== 'layout' && <div className="small muted">Die Darstellung erscheint in der Layout-Ansicht und im Druck.</div>}
        </Section>
      )}

      <Section title={`Leitungen (${wires.length})`}>
        {wires.length === 0 && <div className="small muted">Keine Leitungen angeschlossen.</div>}
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

      <Section title="Notizen">
        <TextField multiline value={c.notes} disabled={readOnly} onCommit={(v) => upd((x) => (x.notes = v))} />
      </Section>

      {!readOnly && (
        <div className="insp-section">
          <button className="danger" onClick={deleteSelection}>
            Bauteil löschen
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Leitung ----------
function WirePanel({ w, derived, readOnly, openPartPicker }) {
  const update = useUpdate();
  const select = useEditor((s) => s.select);
  const setWireDefaults = useEditor((s) => s.setWireDefaults);
  const wireDefaults = useEditor((s) => s.wireDefaults);
  const settings = useEditor((s) => s.doc.settings);
  const info = derived.wireInfo.get(w.id);
  const upd = (fn) => update((d) => {
    fn(d.wires.find((x) => x.id === w.id), d);
  });
  if (!info) {
    return (
      <Section title="Leitung">
        <div className="warn-box">Diese Leitung verweist auf einen nicht mehr vorhandenen Pin.</div>
        {!readOnly && (
          <button className="danger" onClick={deleteSelection}>
            Löschen
          </button>
        )}
      </Section>
    );
  }
  const awg = awgFor(w.cs);
  const routeText = info.route ? info.route.nodeIds.map((id) => derived.nodeLabel(id)).join(' → ') : null;

  return (
    <>
      <Section title="Leitung">
        <div className="insp-kv">
          <span className="k">Bezeichnung</span>
          <TextField value={w.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v.trim() || x.label))} />
          <span className="k">Signal</span>
          <TextField value={w.signal} disabled={readOnly} placeholder={info.from.pin.fn || info.to.pin.fn || ''} onCommit={(v) => upd((x) => (x.signal = v))} />
          <span className="k">Von</span>
          <a href="#" onClick={(e) => (e.preventDefault(), select([{ kind: 'component', id: info.from.comp.id }]))}>
            {pinRef(info.from)} {info.from.pin.fn && <span className="muted">({info.from.pin.fn})</span>}
          </a>
          <span className="k">Nach</span>
          <a href="#" onClick={(e) => (e.preventDefault(), select([{ kind: 'component', id: info.to.comp.id }]))}>
            {pinRef(info.to)} {info.to.pin.fn && <span className="muted">({info.to.pin.fn})</span>}
          </a>
        </div>
      </Section>

      <Section title="Ausführung">
        <div className="col" style={{ gap: 6 }}>
          <span className="small muted">Farbe: {wireColorName(w)}</span>
          <div className="row wrap" style={{ gap: 4 }}>
            {WIRE_COLORS.map((c) => (
              <button
                key={c.code}
                disabled={readOnly}
                className={`icon small ${w.color === c.code ? 'active' : ''}`}
                title={`${c.name} (${c.code})`}
                onClick={() => upd((x) => (x.color = c.code))}
                style={{ padding: 0 }}
              >
                <span className="swatch" style={{ background: c.hex }} />
              </button>
            ))}
          </div>
        </div>
        <div className="insp-kv">
          <span className="k">Kennfarbe</span>
          <select value={w.stripe || ''} disabled={readOnly} onChange={(e) => upd((x) => (x.stripe = e.target.value || null))}>
            <option value="">— keine —</option>
            {WIRE_COLORS.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          <span className="k">Querschnitt</span>
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
          <span className="k">Leitungstyp</span>
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
              Leitung aus Bibliothek …
            </button>
            <button
              className="small"
              title="Farbe, Querschnitt und Typ für neue Leitungen übernehmen"
              onClick={() => setWireDefaults({ color: w.color, stripe: w.stripe, cs: w.cs, type: w.type, part: w.part || null })}
            >
              Als Vorgabe für neue Leitungen
            </button>
          </div>
        )}
        {wireDefaults && (
          <div className="small muted">
            Vorgabe: {colorByCode(wireDefaults.color).name}, {fmtCs(wireDefaults.cs)}, {wireDefaults.type}
          </div>
        )}
        {w.part && <div className="small muted">Bibliotheksteil: {w.part.partNumber || w.part.description}</div>}
      </Section>

      <Section title="Länge">
        <div className="insp-kv">
          <span className="k">Ergebnis</span>
          <strong>{fmtLen(info.length)}</strong>
          <span className="k">Weg im Layout</span>
          <span>{info.routed ? fmtLen(info.baseLength) : <span style={{ color: 'var(--warn)' }}>nicht verlegt</span>}</span>
          <span className="k">Zusatzlänge</span>
          <NumberField value={w.lengthExtra || 0} disabled={readOnly} onCommit={(v) => upd((x) => (x.lengthExtra = v || 0))} placeholder="mm" />
          <span className="k">Feste Länge</span>
          <NumberField value={w.lengthOverride} allowEmpty disabled={readOnly} onCommit={(v) => upd((x) => (x.lengthOverride = v))} placeholder="automatisch" />
        </div>
        <div className="small muted">
          Länge = Weg × (1 + {fmtNum(settings.extraPercent)} %) + 2 × {fmtNum(settings.extraPerEnd)} mm + Zusatzlänge. Zugaben in den
          Kabelbaum-Einstellungen.
        </div>
        {routeText && <div className="small">Verlauf: {routeText}</div>}
        {!info.routed && !info.overridden && (
          <div className="warn-box small">Verbinde {info.from.comp.label} und {info.to.comp.label} in der Layout-Ansicht über Segmente, damit die Länge berechnet wird.</div>
        )}
      </Section>

      <Section title="Notizen">
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
            Richtung tauschen
          </button>
          {typeof w.schMid === 'number' && (
            <button className="small" onClick={() => upd((x) => delete x.schMid)}>
              Verlauf zurücksetzen
            </button>
          )}
          <button className="small danger" onClick={deleteSelection}>
            Löschen
          </button>
        </div>
      )}
    </>
  );
}

// ---------- Segment ----------
function SegmentPanel({ s, derived, readOnly, openPartPicker }) {
  const update = useUpdate();
  const select = useEditor((st) => st.select);
  const setHover = useEditor((st) => st.setHover);
  const info = derived.segInfo.get(s.id);
  const upd = (fn) => update((d) => {
    fn(d.segments.find((x) => x.id === s.id), d);
  });
  return (
    <>
      <Section title="Segment">
        <div className="insp-kv">
          <span className="k">Von</span>
          <span>{info?.fromLabel}</span>
          <span className="k">Nach</span>
          <span>{info?.toLabel}</span>
          <span className="k">Länge (mm)</span>
          <NumberField value={s.length} disabled={readOnly} onCommit={(v) => upd((x) => (x.length = v ?? 0))} />
          <span className="k">Bezeichnung</span>
          <TextField value={s.label} disabled={readOnly} onCommit={(v) => upd((x) => (x.label = v))} />
          <span className="k">Bündel-Ø</span>
          <span>{info?.bundleDiameter ? `≈ ${fmtNum(info.bundleDiameter, 1)} mm (Schätzung)` : '–'}</span>
          <span className="k">Knickpunkte</span>
          <span className="row">
            {s.points.length}
            {!readOnly && s.points.length > 0 && (
              <button className="small ghost" onClick={() => upd((x) => (x.points = []))}>
                entfernen
              </button>
            )}
          </span>
        </div>
      </Section>
      <Section
        title="Ummantelung"
        right={
          !readOnly && (
            <div className="row" style={{ gap: 4 }}>
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
                ＋ Bibliothek
              </button>
            </div>
          )
        }
      >
        {(s.coverings || []).length === 0 && <div className="small muted">Keine Ummantelung.</div>}
        {(s.coverings || []).map((cv, i) => (
          <div key={cv.id || i} className="row small">
            <span className="grow">{cv.part ? `${cv.part.partNumber ? `${cv.part.partNumber} – ` : ''}${cv.part.description}` : cv.label}</span>
            {!readOnly && (
              <button className="ghost small" onClick={() => upd((x) => x.coverings.splice(i, 1))}>
                ✕
              </button>
            )}
          </div>
        ))}
        {info?.bundleDiameter > 0 && (s.coverings || []).some((cv) => cv.part?.data?.innerDiameter && cv.part.data.innerDiameter < info.bundleDiameter) && (
          <div className="warn-box small">Der geschätzte Bündeldurchmesser ist größer als der Innendurchmesser der Ummantelung.</div>
        )}
      </Section>
      <Section title={`Leitungen im Segment (${info?.wires.length || 0})`}>
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
              </span>
              <span className="muted">{fmtCs(wi.wire.cs)}</span>
            </div>
          );
        })}
        {info?.wires.length > 0 && (
          <button className="small" onMouseEnter={() => setHover({ key: `s:${s.id}`, wireIds: info.wires })} onMouseLeave={() => setHover(null)}>
            Alle hervorheben (Maus darüber)
          </button>
        )}
      </Section>
      {!readOnly && (
        <div className="insp-section">
          <button className="danger" onClick={deleteSelection}>
            Segment löschen
          </button>
        </div>
      )}
    </>
  );
}

function NodePanel({ n, doc, derived, readOnly }) {
  const update = useUpdate();
  const clearSelection = useEditor((s) => s.clearSelection);
  const attached = doc.segments.filter((s) => s.a === n.id || s.b === n.id);
  return (
    <>
      <Section title="Abzweigpunkt">
        <div className="insp-kv">
          <span className="k">Bezeichnung</span>
          <TextField value={n.label} disabled={readOnly} placeholder="optional" onCommit={(v) => update((d) => (d.nodes.find((x) => x.id === n.id).label = v))} />
          <span className="k">Segmente</span>
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
            {attached.length === 2 ? 'Entfernen (Segmente zusammenführen)' : 'Abzweigpunkt löschen'}
          </button>
        </div>
      )}
    </>
  );
}

function NotePanel({ n, readOnly }) {
  const update = useUpdate();
  return (
    <>
      <Section title="Notiz">
        <TextField multiline rows={6} value={n.text} disabled={readOnly} onCommit={(v) => update((d) => (d.notes.find((x) => x.id === n.id).text = v))} />
      </Section>
      {!readOnly && (
        <div className="insp-section">
          <button className="danger" onClick={deleteSelection}>
            Notiz löschen
          </button>
        </div>
      )}
    </>
  );
}
