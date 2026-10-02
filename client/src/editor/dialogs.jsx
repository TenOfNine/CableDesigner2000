import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/ui.jsx';
import { CROSS_SECTIONS, WIRE_COLORS, fmtCs, colorByCode, partDescription } from './model.js';
import { api } from '../api.js';
import { t } from '../i18n/index.js';
import { computeFormboard, computeTiles } from './formboard.jsx';
import { pageGeometry, TILE_HEADER, TILE_OVERLAP } from './PrintView.jsx';
import { useParts, matchPart } from '../components/parts.jsx';

export function AddConnectorDialog({ onClose, onCreate, onPickFromLibrary }) {
  const [label, setLabel] = useState('');
  const [pins, setPins] = useState(2);
  const [style, setStyle] = useState('numeric');
  const submit = () => onCreate({ label: label.trim() || undefined, pinCount: Math.max(1, Math.min(200, Number(pins) || 1)), style });
  return (
    <Modal
      title={t('Add connector')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onPickFromLibrary} style={{ marginRight: 'auto' }}>
            {t('Choose from library …')}
          </button>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" onClick={submit}>
            {t('Add')}
          </button>
        </>
      }
    >
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field full">
          {t('Designation')}
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('e.g. Injector 1, ECU, X1')} />
        </label>
        <label className="field">
          {t('Number of pins')}
          <input type="number" min={1} max={200} value={pins} onChange={(e) => setPins(e.target.value)} />
        </label>
        <label className="field">
          {t('Pin designation')}
          <select value={style} onChange={(e) => setStyle(e.target.value)}>
            <option value="numeric">1, 2, 3 …</option>
            <option value="alpha">A, B, C …</option>
          </select>
        </label>
        <button type="submit" className="hidden" />
      </form>
      <p className="muted small">{t('You can also assign a library part later in the properties panel.')}</p>
    </Modal>
  );
}

export function SettingsDialog({ meta, settings, readOnly, onClose, onSave }) {
  const [name, setName] = useState(meta.name);
  const [description, setDescription] = useState(meta.description || '');
  const [s, setS] = useState({ ...settings });
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const num = (v) => {
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  return (
    <Modal
      title={t('Harness settings')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{readOnly ? t('Close') : t('Cancel')}</button>
          {!readOnly && (
            <button
              className="primary"
              onClick={() =>
                onSave({
                  name: name.trim() || meta.name,
                  description,
                  settings: {
                    ...s,
                    extraPerEnd: Math.max(0, num(s.extraPerEnd)),
                    extraPercent: Math.max(0, num(s.extraPercent)),
                    defaultCrossSection: Number(s.defaultCrossSection),
                  },
                })
              }
            >
              {t('Save')}
            </button>
          )}
        </>
      }
    >
      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="form-grid">
          <label className="field full">
            {t('Name')}
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field full">
            {t('Description')}
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            {t('Drawing number')}
            <input value={s.drawingNumber || ''} onChange={set('drawingNumber')} />
          </label>
          <label className="field">
            {t('Revision')}
            <input value={s.revision || ''} onChange={set('revision')} />
          </label>
          <label className="field full">
            {t('Author (title block)')}
            <input value={s.author || ''} onChange={set('author')} placeholder={t('empty = own display name')} />
          </label>
          <label className="field">
            {t('Length allowance per wire end (mm)')}
            <input inputMode="decimal" value={String(s.extraPerEnd ?? 0)} onChange={set('extraPerEnd')} />
          </label>
          <label className="field">
            {t('Length surcharge (%)')}
            <input inputMode="decimal" value={String(s.extraPercent ?? 0)} onChange={set('extraPercent')} />
          </label>
          <div className="full small muted">
            {t('Wire length = path in layout × (1 + surcharge) × twist factor + 2 × allowance per end + individual extra length. The allowance covers e.g. stripping length and reserve at the connector.')}
          </div>
          <label className="field">
            {t('Default cross-section')}
            <select value={s.defaultCrossSection} onChange={set('defaultCrossSection')}>
              {CROSS_SECTIONS.map((c) => (
                <option key={c} value={c}>
                  {fmtCs(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {t('Default colour')}
            <select value={s.defaultColor} onChange={set('defaultColor')}>
              {WIRE_COLORS.map((c) => (
                <option key={c.code} value={c.code}>
                  {colorByCode(c.code).name} ({c.code})
                </option>
              ))}
            </select>
          </label>
          <label className="field full">
            {t('Default wire type')}
            <input value={s.defaultWireType || ''} onChange={set('defaultWireType')} />
          </label>
        </div>
      </fieldset>
    </Modal>
  );
}

export function PrintDialog({ doc, derived, onClose, onPrint }) {
  const [paper, setPaper] = useState('A4');
  const [orientation, setOrientation] = useState('landscape');
  const [explodeBom, setExplodeBom] = useState(false);
  const [sections, setSections] = useState({
    schematic: true, layout: true, formboard: false, wires: true, bom: true, pinout: false, cables: (doc.cables || []).length > 0, segments: false,
  });
  const toggle = (k) => setSections({ ...sections, [k]: !sections[k] });
  const labels = {
    schematic: t('Schematic'),
    layout: t('Layout / formboard (fitted to page)'),
    formboard: t('Formboard 1:1 on several pages'),
    wires: t('Wire list'),
    bom: t('Bill of materials'),
    pinout: t('Pin assignment'),
    cables: t('Cables'),
    segments: t('Segments'),
  };
  const tileInfo = useMemo(() => {
    if (!sections.formboard) return null;
    const fb = computeFormboard(doc, derived);
    if (fb.empty) return { empty: true };
    const geo = pageGeometry({ paper, orientation });
    const tiles = computeTiles(fb, { pageW: geo.contentW, pageH: geo.contentH - TILE_HEADER, overlap: TILE_OVERLAP });
    return { pages: tiles.used.length, w: Math.round(fb.bounds.w), h: Math.round(fb.bounds.h), warnings: fb.warnings };
  }, [sections.formboard, doc, derived, paper, orientation]);

  return (
    <Modal
      title={t('Print')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" disabled={!Object.values(sections).some(Boolean)} onClick={() => onPrint({ paper, orientation, sections, explodeBom })}>
            {t('Print …')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          {t('Paper size')}
          <select value={paper} onChange={(e) => setPaper(e.target.value)}>
            <option value="A4">A4</option>
            <option value="A3">A3</option>
          </select>
        </label>
        <label className="field">
          {t('Orientation')}
          <select value={orientation} onChange={(e) => setOrientation(e.target.value)}>
            <option value="landscape">{t('Landscape')}</option>
            <option value="portrait">{t('Portrait')}</option>
          </select>
        </label>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span className="small muted">{t('Content')}</span>
        {Object.keys(labels).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={sections[k]} onChange={() => toggle(k)} />
            {labels[k]}
          </label>
        ))}
        {derived.subs.size > 0 && sections.bom && (
          <label className="check" style={{ marginLeft: 22 }}>
            <input type="checkbox" checked={explodeBom} onChange={(e) => setExplodeBom(e.target.checked)} />
            {t('Explode sub-harnesses in the bill of materials')}
          </label>
        )}
      </div>
      {tileInfo && (
        <div className={tileInfo.empty ? 'warn-box small' : 'info-box small'}>
          {tileInfo.empty
            ? t('The layout has no segments yet – there is nothing to print 1:1.')
            : t('Formboard {w} × {h} mm → {n} pages. Print at 100 % ("actual size"), not "fit to page".', { w: tileInfo.w, h: tileInfo.h, n: tileInfo.pages })}
          {tileInfo.warnings?.map((w, i) => (
            <div key={i}>⚠ {w}</div>
          ))}
        </div>
      )}
      <p className="small muted">{t('Drawings are fitted to the page and get a title block. Use the browser print dialog to save as PDF as well.')}</p>
    </Modal>
  );
}

export function ImageDialog({ defaultView, onClose, onExport }) {
  const [view, setView] = useState(defaultView === 'layout' ? 'layout' : 'schematic');
  const [format, setFormat] = useState('png');
  const [theme, setTheme] = useState('light');
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={t('Export as image')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onExport({ view, format, theme, scale });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('Creating …') : t('Export')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          {t('View')}
          <select value={view} onChange={(e) => setView(e.target.value)}>
            <option value="schematic">{t('Schematic')}</option>
            <option value="layout">{t('Layout / formboard')}</option>
          </select>
        </label>
        <label className="field">
          {t('Format')}
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="png">{t('PNG (raster image)')}</option>
            <option value="svg">{t('SVG (vector graphic)')}</option>
          </select>
        </label>
        <label className="field">
          {t('Appearance')}
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="light">{t('Light (white background)')}</option>
            <option value="dark">{t('Dark')}</option>
          </select>
        </label>
        {format === 'png' && (
          <label className="field">
            {t('Resolution')}
            <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              <option value={1}>{t('1× (screen)')}</option>
              <option value={2}>{t('2× (sharp)')}</option>
              <option value={3}>{t('3× (high)')}</option>
            </select>
          </label>
        )}
      </div>
    </Modal>
  );
}

/** Picks another harness to embed as linked sub-harness */
export function HarnessPickerDialog({ currentId, onClose, onPick }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get('/harnesses')
      .then((r) => setList(r.harnesses.filter((h) => String(h.id) !== String(currentId))))
      .catch((e) => setError(e.message));
  }, [currentId]);
  const filtered = (list || []).filter((h) => `${h.name} ${h.projectPath}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={t('Embed sub-harness')} onClose={onClose} wide>
      <p className="small muted">
        {t('The selected harness is linked: its interface connectors appear as a block and changes to the original show up automatically. Mark connectors as "Interface (for embedding)" in the sub-harness to limit what is shown.')}
      </p>
      <input autoFocus placeholder={t('Search …')} value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <div className="error-box">{error}</div>}
      <div className="table-wrap" style={{ maxHeight: '50vh' }}>
        <table className="table">
          <thead>
            <tr>
              <th>{t('Harness')}</th>
              <th>{t('Project')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!list && (
              <tr>
                <td colSpan={3} className="muted">
                  {t('Loading …')}
                </td>
              </tr>
            )}
            {list && filtered.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  {t('No other harnesses available.')}
                </td>
              </tr>
            )}
            {filtered.map((h) => (
              <tr key={h.id} style={{ cursor: 'pointer' }} onDoubleClick={() => onPick(h)}>
                <td>{h.name}</td>
                <td className="small muted">{h.projectPath}</td>
                <td>
                  <button className="small primary" onClick={() => onPick(h)}>
                    {t('Embed')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

/** Combines selected wires into a multi-core cable (optionally from the library) or a twisted group */
export function GroupWiresDialog({ count, kind: initialKind, onClose, onCreate }) {
  const [kind, setKind] = useState(initialKind || 'cable');
  const { parts } = useParts();
  const [q, setQ] = useState('');
  const [partId, setPartId] = useState('');
  const [applyColors, setApplyColors] = useState(true);
  const cables = (parts || []).filter((p) => p.category === 'cable' && matchPart(p, q));
  const part = cables.find((p) => String(p.id) === String(partId)) || null;
  return (
    <Modal
      title={t('Combine {n} wires', { n: count })}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{t('Cancel')}</button>
          <button className="primary" onClick={() => onCreate({ kind, part: kind === 'cable' ? part : null, applyColors })}>
            {t('Create')}
          </button>
        </>
      }
    >
      <div className="seg-tabs">
        <button className={kind === 'cable' ? 'on' : ''} onClick={() => setKind('cable')}>
          {t('Multi-core cable')}
        </button>
        <button className={kind === 'twist' ? 'on' : ''} onClick={() => setKind('twist')}>
          {t('Twisted wires')}
        </button>
      </div>
      {kind === 'cable' ? (
        <>
          <input placeholder={t('Search cable in library (optional) …')} value={q} onChange={(e) => setQ(e.target.value)} />
          <select size={6} value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">{t('— without library part —')}</option>
            {cables.map((p) => (
              <option key={p.id} value={p.id}>
                {p.partNumber} – {partDescription(p)}
              </option>
            ))}
          </select>
          {part && (
            <label className="check">
              <input type="checkbox" checked={applyColors} onChange={(e) => setApplyColors(e.target.checked)} />
              {t('Apply the core colours of the cable ({colors})', { colors: (part.data?.coreColors || []).join(', ') })}
            </label>
          )}
          {part?.data?.cores && part.data.cores < count && <div className="warn-box small">{t('The cable has only {n} cores.', { n: part.data.cores })}</div>}
        </>
      ) : (
        <p className="small muted">{t('Twisted wires stay individual wires; their length is increased by the twist factor (lay length adjustable afterwards).')}</p>
      )}
    </Modal>
  );
}
