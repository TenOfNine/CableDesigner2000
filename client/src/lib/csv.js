// CSV import/export of library parts.
// Lists inside a cell (e.g. vehicle makes, core colours) are separated by "|".
import { CATEGORIES } from '../editor/model.js';

export const CSV_COLUMNS = [
  'category', 'partNumber', 'manufacturer', 'description', 'descriptionDe', 'series', 'cavities', 'designation', 'designations',
  'rows', 'numbering', 'gender', 'sealed', 'colorName', 'colorHex', 'contactPart', 'contactRange', 'sealPart', 'lockPart', 'matingPart', 'pitch',
  'application', 'applicationDe', 'usedBy', 'oemNumbers', 'subtype', 'stud', 'crossSectionRange', 'type', 'crossSection', 'outerDiameter', 'cores',
  'coreColors', 'shield', 'innerDiameter', 'value', 'url', 'notes',
];

// header aliases (lower case, without spaces/underscores/hyphens)
const ALIASES = {
  kategorie: 'category', teilenummer: 'partNumber', partno: 'partNumber', artikelnummer: 'partNumber', hersteller: 'manufacturer',
  beschreibung: 'description', beschreibungde: 'descriptionDe', serie: 'series', kammern: 'cavities', polzahl: 'cavities', pins: 'cavities',
  bezeichnung: 'designation', bezeichnungen: 'designations', reihen: 'rows', nummerierung: 'numbering', kontaktart: 'gender',
  abgedichtet: 'sealed', farbe: 'colorName', farbname: 'colorName', farbhex: 'colorHex', kontakt: 'contactPart', kontaktteil: 'contactPart',
  leitungsbereich: 'contactRange', einzeladerabdichtung: 'sealPart', dichtung: 'sealPart', seal: 'sealPart', zubehoer: 'lockPart', zubehör: 'lockPart', sekundaerverriegelung: 'lockPart', gegenstueck: 'matingPart',
  gegenstück: 'matingPart', raster: 'pitch', anwendung: 'application', anwendungde: 'applicationDe', fahrzeughersteller: 'usedBy', verwendung: 'usedBy', oem: 'oemNumbers',
  oemnummern: 'oemNumbers', art: 'subtype', bolzen: 'stud', querschnittsbereich: 'crossSectionRange', typ: 'type', querschnitt: 'crossSection',
  aussendurchmesser: 'outerDiameter', außendurchmesser: 'outerDiameter', adern: 'cores', aderfarben: 'coreColors', schirm: 'shield',
  innendurchmesser: 'innerDiameter', wert: 'value', link: 'url', notizen: 'notes', bemerkung: 'notes',
};
const CANON = new Map(CSV_COLUMNS.map((c) => [c.toLowerCase(), c]));

const CATEGORY_ALIASES = {
  steckverbinder: 'connector', stecker: 'connector', connector: 'connector', terminal: 'terminal', kabelschuh: 'terminal',
  wire: 'wire', leitung: 'wire', ader: 'wire', cable: 'cable', kabel: 'cable', mantelleitung: 'cable', splice: 'splice', spleiss: 'splice',
  spleiß: 'splice', covering: 'covering', ummantelung: 'covering', device: 'device', bauelement: 'device',
};

function normHeader(h) {
  const k = String(h || '').trim().toLowerCase().replace(/[\s_\-()]/g, '');
  return CANON.get(k) || ALIASES[k] || null;
}

/** RFC-4180-ish parser with delimiter detection (; , or tab) */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const counts = { ';': (firstLine.match(/;/g) || []).length, ',': (firstLine.match(/,/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { delim, rows: rows.filter((r) => r.some((c) => String(c).trim() !== '')) };
}

const num = (v) => {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const bool = (v) => ['1', 'true', 'yes', 'ja', 'x', 'y', 'j'].includes(String(v || '').trim().toLowerCase());
const list = (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean);

/** Converts parsed CSV rows into part objects. Returns { parts, errors, unknownColumns } (errors: English messages) */
export function rowsToParts(rows) {
  if (!rows.length) return { parts: [], errors: [], unknownColumns: [] };
  const header = rows[0].map(normHeader);
  const unknownColumns = rows[0].filter((h, i) => !header[i] && String(h).trim());
  const parts = [];
  const errors = [];
  rows.slice(1).forEach((r, idx) => {
    const v = {};
    header.forEach((key, i) => {
      if (key) v[key] = String(r[i] ?? '').trim();
    });
    const catRaw = String(v.category || '').toLowerCase();
    const category = CATEGORIES.includes(catRaw) ? catRaw : CATEGORY_ALIASES[catRaw];
    const line = idx + 2;
    if (!category) {
      errors.push({ line, message: 'Unknown category "{c}".', params: { c: v.category || '' } });
      return;
    }
    if (!v.partNumber && !v.description) {
      errors.push({ line, message: 'Part number or description missing.' });
      return;
    }
    const data = {};
    const put = (k, val) => {
      if (val !== undefined && val !== '' && !(Array.isArray(val) && !val.length)) data[k] = val;
    };
    put('descriptionDe', v.descriptionDe);
    put('url', v.url);
    put('notes', v.notes);
    if (category === 'connector') {
      put('series', v.series);
      put('cavities', num(v.cavities));
      put('designation', ['numeric', 'alpha', 'custom'].includes(v.designation) ? v.designation : v.designations ? 'custom' : 'numeric');
      put('designations', list(v.designations));
      put('rows', num(v.rows));
      put('numbering', v.numbering === 'serpentine' ? 'serpentine' : 'rowwise');
      const g = String(v.gender || '').toLowerCase();
      put('gender', ['male', 'm', 'stift', 'pin', 'pins'].includes(g) ? 'male' : ['female', 'f', 'buchse', 'socket', 'sockets'].includes(g) ? 'female' : undefined);
      if (v.sealed) put('sealed', bool(v.sealed));
      if (v.colorName || v.colorHex) put('color', { name: v.colorName || '', hex: /^#[0-9a-f]{6}$/i.test(v.colorHex) ? v.colorHex : '#8a8f98' });
      put('contactPart', v.contactPart);
      put('contactRange', v.contactRange);
      put('sealPart', v.sealPart);
      put('lockPart', v.lockPart);
      put('matingPart', v.matingPart);
      put('pitch', v.pitch);
      put('application', v.application);
      put('applicationDe', v.applicationDe);
      put('usedBy', list(v.usedBy));
      put('oemNumbers', list(v.oemNumbers));
      if (!data.cavities) {
        errors.push({ line, message: 'Number of cavities missing.' });
        return;
      }
    } else if (category === 'terminal') {
      put('subtype', ['ring', 'spade', 'ferrule', 'male_qc', 'female_qc', 'loose_end'].includes(v.subtype) ? v.subtype : 'ring');
      put('stud', v.stud);
      put('crossSectionRange', v.crossSectionRange);
    } else if (category === 'wire' || category === 'cable') {
      put('type', v.type);
      put('crossSection', num(v.crossSection));
      put('outerDiameter', num(v.outerDiameter));
      if (category === 'cable') {
        put('cores', num(v.cores));
        put('coreColors', list(v.coreColors).map((c) => c.toUpperCase()));
        put('shield', bool(v.shield));
      }
    } else if (category === 'splice') {
      put('crossSectionRange', v.crossSectionRange);
    } else if (category === 'covering') {
      put('subtype', ['corrugated', 'tape', 'braid', 'heatshrink', 'other'].includes(v.subtype) ? v.subtype : 'other');
      put('innerDiameter', num(v.innerDiameter));
    } else if (category === 'device') {
      put('subtype', v.subtype === 'resistor' ? 'resistor' : 'diode');
      put('value', v.value);
    }
    parts.push({ line, category, partNumber: v.partNumber || '', manufacturer: v.manufacturer || '', description: v.description || '', data });
  });
  return { parts, errors, unknownColumns };
}

const esc = (v, delim) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /["\n\r]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Library parts -> CSV text (semicolon separated, UTF-8 BOM for Excel) */
export function partsToCsv(parts, delim = ';') {
  const lines = [CSV_COLUMNS.join(delim)];
  for (const p of parts) {
    const d = p.data || {};
    const v = {
      category: p.category, partNumber: p.partNumber, manufacturer: p.manufacturer, description: p.description,
      descriptionDe: d.descriptionDe, series: d.series, cavities: d.cavities, designation: d.designation,
      designations: (d.designations || []).join('|'), rows: d.rows, numbering: d.numbering, gender: d.gender,
      sealed: d.sealed ? 'yes' : '', colorName: d.color?.name, colorHex: d.color?.hex, contactPart: d.contactPart,
      contactRange: d.contactRange, sealPart: d.sealPart, lockPart: d.lockPart, matingPart: d.matingPart, pitch: d.pitch, application: d.application, applicationDe: d.applicationDe,
      usedBy: (d.usedBy || []).join('|'), oemNumbers: (d.oemNumbers || []).join('|'), subtype: d.subtype, stud: d.stud,
      crossSectionRange: d.crossSectionRange, type: d.type, crossSection: d.crossSection, outerDiameter: d.outerDiameter,
      cores: d.cores, coreColors: (d.coreColors || []).join('|'), shield: d.shield ? 'yes' : '', innerDiameter: d.innerDiameter,
      value: d.value, url: d.url, notes: d.notes,
    };
    lines.push(CSV_COLUMNS.map((c) => esc(v[c], delim)).join(delim));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

export const CSV_TEMPLATE_ROWS = [
  {
    category: 'connector', partNumber: 'DT06-4S', manufacturer: 'TE Connectivity DEUTSCH', description: 'DEUTSCH DT, 4-way plug',
    data: { series: 'DEUTSCH DT', cavities: 4, rows: 2, numbering: 'serpentine', gender: 'female', sealed: true, contactPart: '0462-201-16141', lockPart: 'W4S', usedBy: ['Agricultural', 'Motorsport'] },
  },
  { category: 'cable', partNumber: 'LiYCY 2x0.5', manufacturer: '', description: 'Control cable, shielded', data: { type: 'LiYCY', cores: 2, crossSection: 0.5, shield: true, coreColors: ['WH', 'BN'] } },
  { category: 'terminal', partNumber: '', manufacturer: '', description: 'Ring terminal M8', data: { subtype: 'ring', stud: 'M8' } },
];
