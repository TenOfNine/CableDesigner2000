// Data model, constants and factory functions for harness documents
import { t, getLang, locale } from '../i18n/index.js';

export const SCHEMA_VERSION = 2;

// Wire colours according to IEC 60757
export const WIRE_COLORS = [
  { code: 'BK', en: 'Black', de: 'Schwarz', hex: '#1c1c1c' },
  { code: 'BN', en: 'Brown', de: 'Braun', hex: '#7a4a22' },
  { code: 'RD', en: 'Red', de: 'Rot', hex: '#e03c3c' },
  { code: 'OG', en: 'Orange', de: 'Orange', hex: '#f08a24' },
  { code: 'YE', en: 'Yellow', de: 'Gelb', hex: '#f2c230' },
  { code: 'GN', en: 'Green', de: 'Grün', hex: '#3fae4a' },
  { code: 'BU', en: 'Blue', de: 'Blau', hex: '#2f73d8' },
  { code: 'VT', en: 'Violet', de: 'Violett', hex: '#8a4fd1' },
  { code: 'GY', en: 'Grey', de: 'Grau', hex: '#8e939b' },
  { code: 'WH', en: 'White', de: 'Weiß', hex: '#f2f2f2' },
  { code: 'PK', en: 'Pink', de: 'Rosa', hex: '#f07aa8' },
  { code: 'TQ', en: 'Turquoise', de: 'Türkis', hex: '#2bb5b0' },
  { code: 'GNYE', en: 'Green-yellow', de: 'Grün-Gelb', hex: '#7fbf3a' },
];
const COLOR_MAP = new Map(WIRE_COLORS.map((c) => [c.code, c]));
export function colorByCode(code) {
  const c = COLOR_MAP.get(code);
  if (!c) return { code: code || '?', name: code || '?', hex: '#999999' };
  return { ...c, name: getLang() === 'de' ? c.de : c.en };
}

export function wireColorLabel(w) {
  const c = colorByCode(w.color);
  return w.stripe ? `${c.code}/${colorByCode(w.stripe).code}` : c.code;
}
export function wireColorName(w) {
  const c = colorByCode(w.color);
  return w.stripe ? `${c.name}/${colorByCode(w.stripe).name}` : c.name;
}

export const CROSS_SECTIONS = [0.14, 0.25, 0.35, 0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50];

// Closest AWG size for a cross-section in mm²
export function awgFor(cs) {
  if (!cs || cs <= 0) return null;
  const d = Math.sqrt((4 * cs) / Math.PI);
  const n = 36 - 39 * (Math.log(d / 0.127) / Math.log(92));
  const r = Math.round(n);
  if (r <= 0) return r === 0 ? '1/0' : `${-r + 1}/0`;
  return String(r);
}

// Typical FLRY-B outer diameters (mm), otherwise an approximation
const OD_FLRY = { 0.35: 1.3, 0.5: 1.6, 0.75: 1.9, 1: 2.1, 1.5: 2.4, 2.5: 3.0, 4: 3.7, 6: 4.3 };
export function outerDiameter(w) {
  if (w.outerDiameter) return w.outerDiameter;
  if (OD_FLRY[w.cs]) return OD_FLRY[w.cs];
  return Math.round((Math.sqrt((4 * (w.cs || 0.5)) / Math.PI) * 1.45 + 0.4) * 10) / 10;
}

export const fmtNum = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '–'
    : Number(n).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const fmtCs = (cs) => (cs ? `${fmtNum(cs, 2)} mm²` : '–');
export const fmtLen = (mm) => (mm === null || mm === undefined ? '–' : `${fmtNum(Math.round(mm), 0)} mm`);

export const CATEGORIES = ['connector', 'terminal', 'wire', 'cable', 'splice', 'covering', 'device'];
export const categoryLabel = (c) =>
  ({
    connector: t('Connectors'),
    terminal: t('Terminals'),
    wire: t('Wires'),
    cable: t('Multi-core cables'),
    splice: t('Splices'),
    covering: t('Coverings'),
    device: t('Devices'),
  })[c] || c;
export const categorySingular = (c) =>
  ({
    connector: t('Connector'),
    terminal: t('Terminal'),
    wire: t('Wire'),
    cable: t('Multi-core cable'),
    splice: t('Splice'),
    covering: t('Covering'),
    device: t('Device'),
  })[c] || c;

const TERMINAL_DEFS = [
  { value: 'ring', label: 'Ring terminal', symbol: '⊸' },
  { value: 'spade', label: 'Fork terminal', symbol: '⫟' },
  { value: 'ferrule', label: 'Ferrule', symbol: '▭' },
  { value: 'male_qc', label: 'Tab (male quick connect)', symbol: '▸' },
  { value: 'female_qc', label: 'Receptacle (female quick connect)', symbol: '◂' },
  { value: 'loose_end', label: 'Loose wire end', symbol: '—' },
];
export const terminalSubtypes = () => TERMINAL_DEFS.map((d) => ({ ...d, label: t(d.label) }));
export const terminalSubtype = (v) => {
  const d = TERMINAL_DEFS.find((x) => x.value === v) || TERMINAL_DEFS[0];
  return { ...d, label: t(d.label) };
};

const COVERING_DEFS = [
  { value: 'corrugated', label: 'Corrugated tube' },
  { value: 'tape', label: 'Tape' },
  { value: 'braid', label: 'Braided sleeve' },
  { value: 'heatshrink', label: 'Heat shrink' },
  { value: 'other', label: 'Other' },
];
export const coveringSubtypes = () => COVERING_DEFS.map((d) => ({ ...d, label: t(d.label) }));

export const DEVICE_DEFS = [
  { value: 'diode', label: 'Diode', pins: ['A', 'K'] },
  { value: 'resistor', label: 'Resistor', pins: ['1', '2'] },
];
export const deviceSubtypes = () => DEVICE_DEFS.map((d) => ({ ...d, label: t(d.label) }));

export const genderLabel = (g) => ({ male: t('Pin contacts (male)'), female: t('Socket contacts (female)') })[g] || '';

export const componentTypeLabel = (type) =>
  ({
    connector: t('Connector'),
    terminal: t('Terminal'),
    splice: t('Splice'),
    device: t('Device'),
    subharness: t('Sub-harness'),
  })[type] || type;

let counter = 0;
export function uid(prefix = 'x') {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

// Cavity designations
export function alphaDesignation(i) {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}
export function designationsFor(count, style = 'numeric', custom = []) {
  const out = [];
  for (let i = 0; i < count; i++) {
    if (style === 'alpha') out.push(alphaDesignation(i));
    else if (style === 'custom' && custom[i]) out.push(String(custom[i]));
    else out.push(String(i + 1));
  }
  return out;
}

// Cavity arrangement for the mating face view (indices into the pin list)
export function faceGrid(count, rows = 1, numbering = 'rowwise') {
  const r = Math.max(1, Math.min(rows || 1, count || 1));
  const cols = Math.ceil(count / r);
  const grid = [];
  for (let i = 0; i < r; i++) {
    let row = [];
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      row.push(idx < count ? idx : null);
    }
    if (numbering === 'serpentine' && i % 2 === 1) row = row.reverse();
    grid.push(row);
  }
  return grid;
}

// ---------- Library parts ----------
export function snapshotPart(part) {
  if (!part) return null;
  return {
    id: part.id,
    category: part.category,
    partNumber: part.partNumber || '',
    manufacturer: part.manufacturer || '',
    description: part.description || '',
    data: part.data || {},
    hasImage: !!part.hasImage,
    imageVersion: part.imageVersion || '',
  };
}

/** Description in the current language (built-in parts carry a German translation) */
export function partDescription(part) {
  if (!part) return '';
  if (getLang() === 'de' && part.data?.descriptionDe) return part.data.descriptionDe;
  return part.description || '';
}
export function partNotes(part) {
  if (!part) return '';
  if (getLang() === 'de' && part.data?.notesDe) return part.data.notesDe;
  return part.data?.notes || '';
}
export function partApplication(part) {
  if (!part) return '';
  if (getLang() === 'de' && part.data?.applicationDe) return part.data.applicationDe;
  return part.data?.application || '';
}
export function partColorName(color) {
  if (!color) return '';
  return getLang() === 'de' && color.nameDe ? color.nameDe : color.name || '';
}

export function partTitle(part) {
  if (!part) return '';
  return part.partNumber || partDescription(part) || '';
}

export function partSummary(part) {
  if (!part) return '';
  const d = part.data || {};
  const bits = [];
  if (part.category === 'connector') {
    if (d.cavities) bits.push(t('{n}-way', { n: d.cavities }));
    if (d.gender) bits.push(d.gender === 'male' ? t('Pins') : t('Sockets'));
    if (d.sealed) bits.push(t('sealed'));
    if (d.color) bits.push(partColorName(d.color));
  } else if (part.category === 'wire') {
    if (d.crossSection) bits.push(fmtCs(d.crossSection));
    if (d.type) bits.push(d.type);
  } else if (part.category === 'cable') {
    if (d.cores) bits.push(`${d.cores} × ${fmtCs(d.crossSection)}`);
    if (d.shield) bits.push(t('shielded'));
  } else if (part.category === 'terminal') {
    bits.push(terminalSubtype(d.subtype).label);
    if (d.stud) bits.push(d.stud);
  } else if (part.category === 'covering') {
    const st = coveringSubtypes().find((s) => s.value === d.subtype);
    if (st) bits.push(st.label);
    if (d.innerDiameter) bits.push(`Ø ${fmtNum(d.innerDiameter)} mm`);
  } else if (part.category === 'device') {
    const st = deviceSubtypes().find((s) => s.value === d.subtype);
    if (st) bits.push(st.label);
    if (d.value) bits.push(d.value);
  }
  return bits.join(' · ');
}

// ---------- Document ----------
export function emptyDoc() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      drawingNumber: '',
      revision: 'A',
      author: '',
      extraPerEnd: 0,
      extraPercent: 0,
      defaultCrossSection: 0.5,
      defaultWireType: 'FLRY-B',
      defaultColor: 'BK',
    },
    components: [],
    wires: [],
    cables: [],
    nodes: [],
    segments: [],
    notes: [],
  };
}

// Completes documents from older or incomplete versions
export function normalizeDoc(doc) {
  const base = emptyDoc();
  const d = { ...base, ...(doc || {}) };
  d.schemaVersion = SCHEMA_VERSION;
  d.settings = { ...base.settings, ...(doc?.settings || {}) };
  for (const k of ['components', 'wires', 'cables', 'nodes', 'segments', 'notes']) if (!Array.isArray(d[k])) d[k] = [];
  for (const c of d.components) {
    c.sch = c.sch || { x: 0, y: 0 };
    c.lay = c.lay || { x: c.sch.x, y: c.sch.y };
    c.pins = Array.isArray(c.pins) ? c.pins : [];
    c.show = c.show || {};
    c.callouts = c.callouts || {};
  }
  for (const s of d.segments) {
    s.points = Array.isArray(s.points) ? s.points : [];
    s.coverings = Array.isArray(s.coverings) ? s.coverings : [];
    if (typeof s.length !== 'number') s.length = 0;
  }
  const cableIds = new Set(d.cables.map((c) => c.id));
  for (const w of d.wires) if (w.cableId && !cableIds.has(w.cableId)) delete w.cableId;
  return d;
}

export function nextLabel(doc, prefix) {
  const used = new Set(doc.components.map((c) => c.label));
  for (const w of doc.wires) used.add(w.label);
  for (const c of doc.cables || []) used.add(c.label);
  let i = 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function makePins(names, fns = []) {
  return names.map((name, i) => ({ id: uid('p'), name, fn: fns[i] || '' }));
}

const baseComponent = (pos) => ({ sch: { ...pos }, lay: { ...pos }, show: {}, callouts: {}, excludeFromBom: false, notes: '' });

export function createConnector({ label, pinCount = 2, style = 'numeric', part = null, pos }) {
  const d = part?.data || {};
  const count = part ? d.cavities || pinCount : pinCount;
  const names = designationsFor(count, part ? d.designation || 'numeric' : style, d.designations || []);
  return { id: uid('c'), type: 'connector', label, part: snapshotPart(part), pins: makePins(names), mateId: null, ...baseComponent(pos) };
}

export function createTerminal({ label, subtype = 'ring', fn = '', part = null, pos }) {
  return {
    id: uid('c'), type: 'terminal', subtype: part?.data?.subtype || subtype, label, part: snapshotPart(part),
    pins: makePins(['1'], [fn]), ...baseComponent(pos),
  };
}

export function createSplice({ label, part = null, pos }) {
  return { id: uid('c'), type: 'splice', label, part: snapshotPart(part), pins: makePins(['S']), ...baseComponent(pos) };
}

export function createDevice({ label, subtype = 'diode', value = '', part = null, pos }) {
  const st = DEVICE_DEFS.find((s) => s.value === (part?.data?.subtype || subtype)) || DEVICE_DEFS[0];
  return {
    id: uid('c'), type: 'device', subtype: st.value, value: part?.data?.value || value, label, part: snapshotPart(part),
    pins: makePins(st.pins), ...baseComponent(pos),
  };
}

/** Linked sub-harness: shows the interface connectors of another harness */
export function createSubharness({ label, harnessId, harnessName, pos }) {
  return { id: uid('c'), type: 'subharness', label, ref: { harnessId, name: harnessName }, part: null, pins: [], ...baseComponent(pos) };
}

export function createWire(doc, from, to, defaults = {}) {
  const s = doc.settings;
  return {
    id: uid('w'),
    label: nextLabel(doc, 'W'),
    from,
    to,
    signal: defaults.signal || '',
    color: defaults.color || s.defaultColor || 'BK',
    stripe: defaults.stripe || null,
    cs: defaults.cs || s.defaultCrossSection || 0.5,
    type: defaults.type || s.defaultWireType || 'FLRY-B',
    part: defaults.part || null,
    lengthExtra: 0,
    lengthOverride: null,
    notes: '',
  };
}

/**
 * Multi-core cable (kind 'cable') or twisted wires (kind 'twist').
 * Member wires reference it via wire.cableId; wire.cableRole is 'core' (default) or 'shield'.
 */
export function createCable(doc, { kind, part = null }) {
  const d = part?.data || {};
  return {
    id: uid('k'),
    label: nextLabel(doc, kind === 'twist' ? 'TW' : 'C'),
    kind,
    part: snapshotPart(part),
    type: d.type || (kind === 'twist' ? '' : ''),
    cores: d.cores || null,
    shield: !!d.shield,
    layLength: kind === 'twist' ? 25 : null,
    outerDiameter: d.outerDiameter || null,
    excludeFromBom: false,
    notes: '',
  };
}

export const cableKindLabel = (k) => (k === 'twist' ? t('Twisted wires') : t('Multi-core cable'));

/** Components of a (child) document that are offered as interface when embedded */
export function interfaceComponents(doc) {
  const candidates = (doc?.components || []).filter((c) => ['connector', 'terminal', 'splice'].includes(c.type));
  const flagged = candidates.filter((c) => c.interface);
  return flagged.length ? flagged : candidates.filter((c) => c.type !== 'splice');
}
