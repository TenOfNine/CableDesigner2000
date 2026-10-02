import { useEffect, useMemo, useRef, useState } from 'react';
import { api, partImageUrl } from '../api.js';
import { Modal, useDialogs } from './ui.jsx';
import {
  categoryLabel, categorySingular, terminalSubtypes, coveringSubtypes, deviceSubtypes, CROSS_SECTIONS, CATEGORIES,
  designationsFor, faceGrid, partSummary, partDescription, fmtCs,
} from '../editor/model.js';
import { t, getLang } from '../i18n/index.js';

// ---------- Mating face (HTML) ----------
export function FaceView({ count, rows, numbering, names, used = new Set(), highlight = new Set(), size = 28 }) {
  const grid = faceGrid(count, rows, numbering);
  const cols = grid[0]?.length || 1;
  return (
    <div className="face-view" style={{ gridTemplateColumns: `repeat(${cols}, ${size}px)` }}>
      {grid.flat().map((idx, i) =>
        idx === null ? (
          <div key={i} />
        ) : (
          <div
            key={i}
            className={`face-cav ${used.has(idx) ? 'used' : ''}`}
            style={{ width: size, height: size, ...(highlight.has(idx) ? { background: '#f2c230', color: '#111', borderColor: '#f2c230' } : null) }}
            title={names[idx]}
          >
            {names[idx]}
          </div>
        )
      )}
    </div>
  );
}

export function PartThumb({ part, size = 44 }) {
  const url = partImageUrl(part);
  if (!url) return <span className="part-thumb empty" style={{ width: size, height: size }}>—</span>;
  return <img className="part-thumb" src={url} alt="" style={{ width: size, height: size }} loading="lazy" />;
}

// Natural sort (DT06-2S before DT06-12SA)
export function sortParts(list) {
  const key = (p) => `${p.partNumber || '~'} ${p.description}`;
  return [...list].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true, sensitivity: 'base' }));
}

// ---------- Hook: load library ----------
let cache = null;
let cachePromise = null;
export function invalidatePartsCache() {
  cache = null;
  cachePromise = null;
}
export function useParts() {
  const [parts, setParts] = useState(cache);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      if (!cachePromise) cachePromise = api.get('/parts').then((r) => sortParts(r.parts));
      cache = await cachePromise;
      setParts(cache);
    } catch (e) {
      cachePromise = null;
      setError(e.message);
    }
  };
  const reload = async () => {
    invalidatePartsCache();
    return load();
  };
  useEffect(() => {
    load();
  }, []);
  return { parts, error, reload, setParts };
}

// ---------- Search ----------
// Supports free text plus filters like "cavities:4" / "polig:4", "manufacturer:molex" / "hersteller:molex", "oem:vw"
export function matchPart(p, q) {
  if (!q) return true;
  const d = p.data || {};
  const hay = `${p.partNumber} ${p.manufacturer} ${p.description} ${d.descriptionDe || ''} ${d.series || ''} ${(d.usedBy || []).join(' ')} ${d.application || ''} ${d.applicationDe || ''} ${(d.oemNumbers || []).join(' ')} ${partSummary(p)}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => {
      const m = /^(\w+):(.+)$/.exec(tok);
      if (m) {
        const [, key, val] = m;
        if (key === 'polig' || key === 'cavities' || key === 'pins') return String(d.cavities || '') === val;
        if (key === 'hersteller' || key === 'manufacturer') return p.manufacturer.toLowerCase().includes(val);
        if (key === 'oem' || key === 'make') return (d.usedBy || []).some((u) => u.toLowerCase().includes(val));
      }
      return hay.includes(tok);
    });
}

export function allMakes(parts) {
  const s = new Set();
  for (const p of parts || []) for (const u of p.data?.usedBy || []) s.add(u);
  return [...s].sort((a, b) => a.localeCompare(b));
}

// ---------- Part picker (dialog) ----------
export function PartPicker({ category, title, onPick, onClose, filter }) {
  const { parts, error } = useParts();
  const [q, setQ] = useState('');
  const [make, setMake] = useState('');
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);
  const inCat = useMemo(() => (parts || []).filter((p) => p.category === category), [parts, category]);
  const makes = useMemo(() => allMakes(inCat), [inCat]);
  const list = useMemo(
    () => inCat.filter((p) => (!filter || filter(p)) && (!make || (p.data?.usedBy || []).includes(make)) && matchPart(p, q)),
    [inCat, q, make, filter]
  );
  return (
    <Modal title={title || t('Choose {what} from library', { what: categorySingular(category) })} onClose={onClose} wide>
      <div className="row">
        <input ref={inputRef} className="grow" placeholder={t('Search … (e.g. "DT06 6", "cavities:4", "manufacturer:molex")')} value={q} onChange={(e) => setQ(e.target.value)} />
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
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="table-wrap" style={{ maxHeight: '55vh' }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 56 }}></th>
              <th>{t('Part number')}</th>
              <th>{t('Manufacturer')}</th>
              <th>{t('Description')}</th>
              <th>{t('Key data')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {!parts && (
              <tr>
                <td colSpan={6} className="muted">
                  {t('Loading …')}
                </td>
              </tr>
            )}
            {parts && list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {t('No matching parts. Create new parts under "Library".')}
                </td>
              </tr>
            )}
            {list.map((p) => (
              <tr key={p.id} style={{ cursor: 'pointer' }} onDoubleClick={() => onPick(p)}>
                <td>
                  <PartThumb part={p} size={40} />
                </td>
                <td className="mono nowrap">{p.partNumber || '—'}</td>
                <td className="nowrap">{p.manufacturer}</td>
                <td>
                  {partDescription(p)}
                  {p.data?.usedBy?.length > 0 && <div className="small muted">{p.data.usedBy.join(', ')}</div>}
                </td>
                <td className="nowrap small muted">{partSummary(p)}</td>
                <td className="nowrap">
                  {p.scope === 'own' && <span className="badge accent">{t('Own')}</span>}{' '}
                  <button className="small primary" onClick={() => onPick(p)}>
                    {t('Assign')}
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

// ---------- Create / edit part ----------
const EMPTY_DATA = {
  connector: { cavities: 2, designation: 'numeric', rows: 1, numbering: 'rowwise', gender: 'female', color: { name: 'Black', nameDe: 'Schwarz', hex: '#2a2a2a' } },
  terminal: { subtype: 'ring' },
  wire: { type: 'FLRY-B', crossSection: 0.5 },
  cable: { type: 'LiYY', cores: 2, crossSection: 0.25, shield: false, coreColors: ['WH', 'BN'] },
  splice: {},
  covering: { subtype: 'corrugated' },
  device: { subtype: 'diode' },
};

const listText = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');
const parseList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export function PartEditor({ part, isAdmin, defaultCategory = 'connector', onClose, onSaved, onDeleted }) {
  const dialogs = useDialogs();
  const isNew = !part?.id;
  const readOnly = !isNew && !part.editable;
  const [form, setForm] = useState(() =>
    isNew
      ? { category: defaultCategory, partNumber: '', manufacturer: '', description: '', data: { ...EMPTY_DATA[defaultCategory] }, scope: 'own' }
      : { ...part, data: { ...part.data } }
  );
  const [texts, setTexts] = useState(() => ({
    designations: listText(part?.data?.designations),
    usedBy: listText(part?.data?.usedBy),
    coreColors: listText(part?.data?.coreColors || EMPTY_DATA.cable.coreColors),
    oemNumbers: listText(part?.data?.oemNumbers),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    if (!imageFile) return setImagePreview(null);
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setD = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const d = form.data;
  const de = getLang() === 'de';

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const data = { ...form.data };
      if (form.category === 'connector') {
        data.designations = parseList(texts.designations);
        data.usedBy = parseList(texts.usedBy);
        data.oemNumbers = parseList(texts.oemNumbers);
        if (!data.usedBy.length) delete data.usedBy;
        if (!data.oemNumbers.length) delete data.oemNumbers;
      }
      if (form.category === 'cable') data.coreColors = parseList(texts.coreColors).map((c) => c.toUpperCase());
      const body = { category: form.category, partNumber: form.partNumber, manufacturer: form.manufacturer, description: form.description, data, scope: form.scope };
      let saved = isNew ? (await api.post('/parts', body)).part : (await api.put(`/parts/${part.id}`, body)).part;
      if (imageFile) saved = (await api.upload(`/parts/${saved.id}/image`, imageFile)).part;
      else if (removeImage && part?.hasImage) {
        await api.del(`/parts/${saved.id}/image`);
        saved = { ...saved, hasImage: false };
      }
      invalidatePartsCache();
      onSaved?.(saved);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    const ok = await dialogs.confirm(t('Delete the part from the library permanently? Harnesses that use it keep their copy of the part data.'), {
      okLabel: t('Delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/parts/${part.id}`);
      invalidatePartsCache();
      onDeleted?.(part);
    } catch (e) {
      setError(e.message);
    }
  };

  const names = form.category === 'connector' ? designationsFor(Number(d.cavities) || 0, d.designation, parseList(texts.designations)) : [];
  const currentImage = !removeImage && !imagePreview && part?.hasImage ? partImageUrl(part) : null;

  return (
    <Modal
      title={isNew ? t('New part') : readOnly ? t('View part') : t('Edit part')}
      onClose={onClose}
      wide
      footer={
        <>
          {!isNew && !readOnly && (
            <button className="danger" onClick={del} style={{ marginRight: 'auto' }}>
              {t('Delete')}
            </button>
          )}
          <button onClick={onClose}>{readOnly ? t('Close') : t('Cancel')}</button>
          {!readOnly && (
            <button className="primary" onClick={save} disabled={busy}>
              {t('Save')}
            </button>
          )}
        </>
      }
    >
      {error && <div className="error-box">{error}</div>}
      {readOnly && <div className="info-box">{t('Only administrators can change global parts. Use "Copy as own part" in the library to create an editable copy.')}</div>}
      <fieldset disabled={readOnly} style={{ border: 'none', padding: 0, margin: 0 }}>
        <div className="form-grid">
          {isNew && (
            <label className="field">
              {t('Category')}
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value, data: { ...EMPTY_DATA[e.target.value] } }))}>
                {CATEGORIES.map((k) => (
                  <option key={k} value={k}>
                    {categorySingular(k)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isNew && (
            <label className="field">
              {t('Storage')}
              <select value={form.scope} onChange={(e) => set('scope', e.target.value)}>
                <option value="own">{t('Own library')}</option>
                {isAdmin && <option value="global">{t('Global library (for everyone)')}</option>}
              </select>
            </label>
          )}
          <label className="field">
            {t('Part number')}
            <input value={form.partNumber} onChange={(e) => set('partNumber', e.target.value)} />
          </label>
          <label className="field">
            {t('Manufacturer')}
            <input value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
          </label>
          <label className="field full">
            {t('Description')}
            <input value={form.description} onChange={(e) => set('description', e.target.value)} />
          </label>
          {(de || d.descriptionDe) && (
            <label className="field full">
              {t('Description (German)')}
              <input value={d.descriptionDe || ''} onChange={(e) => setD('descriptionDe', e.target.value)} placeholder={t('optional – shown when the interface is German')} />
            </label>
          )}
          <label className="field full">
            {t('Link (datasheet / shop)')}
            <input value={d.url || ''} onChange={(e) => setD('url', e.target.value)} placeholder="https://…" />
          </label>

          {form.category === 'connector' && (
            <>
              <label className="field">
                {t('Series')}
                <input value={d.series || ''} onChange={(e) => setD('series', e.target.value)} />
              </label>
              <label className="field">
                {t('Number of cavities')}
                <input type="number" min={1} max={200} value={d.cavities ?? ''} onChange={(e) => setD('cavities', Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
              </label>
              <label className="field">
                {t('Cavity designation')}
                <select value={d.designation || 'numeric'} onChange={(e) => setD('designation', e.target.value)}>
                  <option value="numeric">{t('Digits (1, 2, 3 …)')}</option>
                  <option value="alpha">{t('Letters (A, B, C …)')}</option>
                  <option value="custom">{t('Custom list')}</option>
                </select>
              </label>
              {d.designation === 'custom' ? (
                <label className="field">
                  {t('Designations (comma separated)')}
                  <input value={texts.designations} onChange={(e) => setTexts({ ...texts, designations: e.target.value })} />
                </label>
              ) : (
                <div />
              )}
              <label className="field">
                {t('Contact type')}
                <select value={d.gender || 'female'} onChange={(e) => setD('gender', e.target.value)}>
                  <option value="male">{t('Pin contacts (male)')}</option>
                  <option value="female">{t('Socket contacts (female)')}</option>
                </select>
              </label>
              <label className="field">
                {t('Housing colour')}
                <div className="row">
                  <input type="color" value={d.color?.hex || '#2a2a2a'} onChange={(e) => setD('color', { ...(d.color || {}), hex: e.target.value })} />
                  <input
                    className="grow"
                    placeholder={t('Name')}
                    value={(de ? d.color?.nameDe : d.color?.name) || d.color?.name || ''}
                    onChange={(e) => setD('color', { ...(d.color || {}), [de ? 'nameDe' : 'name']: e.target.value })}
                  />
                </div>
              </label>
              <label className="field">
                {t('Mating face: rows')}
                <input type="number" min={1} max={20} value={d.rows ?? 1} onChange={(e) => setD('rows', Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field">
                {t('Mating face: numbering')}
                <select value={d.numbering || 'rowwise'} onChange={(e) => setD('numbering', e.target.value)}>
                  <option value="rowwise">{t('Row by row')}</option>
                  <option value="serpentine">{t('Serpentine (2nd row backwards)')}</option>
                </select>
              </label>
              <label className="field">
                {t('Contact (part number)')}
                <input value={d.contactPart || ''} onChange={(e) => setD('contactPart', e.target.value)} />
              </label>
              <label className="field">
                {t('Contact: wire range')}
                <input value={d.contactRange || ''} onChange={(e) => setD('contactRange', e.target.value)} placeholder={t('e.g. 0.5–1.0 mm²')} />
              </label>
              <label className="field">
                {t('Single wire seal (per wire)')}
                <input value={d.sealPart || ''} onChange={(e) => setD('sealPart', e.target.value)} />
              </label>
              <label className="field">
                {t('Secondary lock / accessory')}
                <input value={d.lockPart || ''} onChange={(e) => setD('lockPart', e.target.value)} />
              </label>
              <label className="field">
                {t('Mating part')}
                <input value={d.matingPart || ''} onChange={(e) => setD('matingPart', e.target.value)} />
              </label>
              <label className="field">
                {t('Pitch')}
                <input value={d.pitch || ''} onChange={(e) => setD('pitch', e.target.value)} />
              </label>
              <label className="field">
                {t('Typical application')}
                <input
                  value={(de && d.applicationDe) || d.application || ''}
                  onChange={(e) => setD(de && d.applicationDe !== undefined ? 'applicationDe' : 'application', e.target.value)}
                  placeholder={t('e.g. injector, sensor')}
                />
              </label>
              <label className="field">
                {t('Typical vehicle makes (comma separated)')}
                <input value={texts.usedBy} onChange={(e) => setTexts({ ...texts, usedBy: e.target.value })} placeholder="VW, BMW, …" />
              </label>
              <label className="field">
                {t('OEM numbers (comma separated)')}
                <input value={texts.oemNumbers} onChange={(e) => setTexts({ ...texts, oemNumbers: e.target.value })} />
              </label>
              <label className="check full">
                <input type="checkbox" checked={!!d.sealed} onChange={(e) => setD('sealed', e.target.checked)} />
                {t('Sealed (watertight)')}
              </label>
              <div className="full col" style={{ gap: 4 }}>
                <span className="muted small">{t('Mating face preview (schematic)')}</span>
                {names.length > 0 && <FaceView count={names.length} rows={d.rows} numbering={d.numbering} names={names} />}
              </div>
            </>
          )}

          {form.category === 'terminal' && (
            <>
              <label className="field">
                {t('Type')}
                <select value={d.subtype || 'ring'} onChange={(e) => setD('subtype', e.target.value)}>
                  {terminalSubtypes().map((ts) => (
                    <option key={ts.value} value={ts.value}>
                      {ts.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t('Stud / size')}
                <input value={d.stud || ''} onChange={(e) => setD('stud', e.target.value)} placeholder={t('e.g. M6')} />
              </label>
              <label className="field">
                {t('Cross-section range')}
                <input value={d.crossSectionRange || ''} onChange={(e) => setD('crossSectionRange', e.target.value)} />
              </label>
            </>
          )}

          {(form.category === 'wire' || form.category === 'cable') && (
            <>
              <label className="field">
                {form.category === 'cable' ? t('Cable type') : t('Wire type')}
                <input value={d.type || ''} onChange={(e) => setD('type', e.target.value)} placeholder={form.category === 'cable' ? t('e.g. LiYCY') : t('e.g. FLRY-B')} />
              </label>
              <label className="field">
                {form.category === 'cable' ? t('Cross-section per core') : t('Cross-section')}
                <select value={d.crossSection || 0.5} onChange={(e) => setD('crossSection', Number(e.target.value))}>
                  {CROSS_SECTIONS.map((c) => (
                    <option key={c} value={c}>
                      {fmtCs(c)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t('Outer diameter (mm)')}
                <input type="number" step="0.1" min={0} value={d.outerDiameter ?? ''} onChange={(e) => setD('outerDiameter', e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            </>
          )}

          {form.category === 'cable' && (
            <>
              <label className="field">
                {t('Number of cores')}
                <input type="number" min={1} max={100} value={d.cores ?? ''} onChange={(e) => setD('cores', Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="field full">
                {t('Core colours in order (codes, comma separated)')}
                <input value={texts.coreColors} onChange={(e) => setTexts({ ...texts, coreColors: e.target.value })} placeholder="WH, BN, GN, YE" />
              </label>
              <label className="check full">
                <input type="checkbox" checked={!!d.shield} onChange={(e) => setD('shield', e.target.checked)} />
                {t('Shielded')}
              </label>
            </>
          )}

          {form.category === 'splice' && (
            <label className="field">
              {t('Cross-section range')}
              <input value={d.crossSectionRange || ''} onChange={(e) => setD('crossSectionRange', e.target.value)} />
            </label>
          )}

          {form.category === 'covering' && (
            <>
              <label className="field">
                {t('Type')}
                <select value={d.subtype || 'corrugated'} onChange={(e) => setD('subtype', e.target.value)}>
                  {coveringSubtypes().map((cs) => (
                    <option key={cs.value} value={cs.value}>
                      {cs.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t('Inner diameter (mm)')}
                <input type="number" step="0.5" min={0} value={d.innerDiameter ?? ''} onChange={(e) => setD('innerDiameter', e.target.value === '' ? undefined : Number(e.target.value))} />
              </label>
            </>
          )}

          {form.category === 'device' && (
            <>
              <label className="field">
                {t('Type')}
                <select value={d.subtype || 'diode'} onChange={(e) => setD('subtype', e.target.value)}>
                  {deviceSubtypes().map((ds) => (
                    <option key={ds.value} value={ds.value}>
                      {ds.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                {t('Value')}
                <input value={d.value || ''} onChange={(e) => setD('value', e.target.value)} placeholder={t('e.g. 120 Ω')} />
              </label>
            </>
          )}

          <label className="field full">
            {t('Notes')}
            <textarea rows={2} value={(de && d.notesDe) || d.notes || ''} onChange={(e) => setD(de && d.notesDe !== undefined ? 'notesDe' : 'notes', e.target.value)} />
          </label>

          <div className="field full">
            <span>{t('Image')}</span>
            <div className="row">
              {imagePreview || currentImage ? (
                <img src={imagePreview || currentImage} alt="" className="part-thumb" style={{ width: 90, height: 90 }} />
              ) : (
                <span className="part-thumb empty" style={{ width: 90, height: 90 }}>
                  {t('no image')}
                </span>
              )}
              {!readOnly && (
                <div className="col" style={{ gap: 6 }}>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => {
                      setImageFile(e.target.files?.[0] || null);
                      setRemoveImage(false);
                    }}
                  />
                  {(part?.hasImage || imageFile) && (
                    <button
                      className="small"
                      onClick={() => {
                        setImageFile(null);
                        setRemoveImage(true);
                      }}
                    >
                      {t('Remove image')}
                    </button>
                  )}
                  <span className="muted small">{t('PNG, JPEG, WebP or GIF, max. 3 MB')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </fieldset>
    </Modal>
  );
}

export { categoryLabel };
