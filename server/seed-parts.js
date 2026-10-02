// Built-in global part library.
// Every part has a stable data.seedKey (used for library updates) and an optional German
// description in data.descriptionDe. Cavity layouts are schematic – always verify against the
// manufacturer datasheet before production.

import { conn, GRAY, BLACK, NATURAL } from './seed-helpers.js';
import { vehicleParts } from './seed-vehicle.js';
import { industrialParts } from './seed-industrial.js';

export const SEED_VERSION = 3;

function dt(cav, suffixP, suffixS, rows) {
  return [
    conn(`te-dt04-${suffixP}`, `DT04-${suffixP}`, 'TE Connectivity DEUTSCH',
      `DEUTSCH DT, ${cav}-way receptacle (pin contacts), contact size 16`,
      `DEUTSCH DT, ${cav}-polig, Gehäuse mit Stiftkontakten (Receptacle), Kontaktgröße 16`,
      { series: 'DEUTSCH DT', cavities: cav, rows, numbering: 'serpentine', gender: 'male', color: GRAY,
        contactPart: '0460-202-16141', contactRange: '16–20 AWG', lockPart: `W${cav}P`, matingPart: `DT06-${suffixS}`,
        sealed: true }),
    conn(`te-dt06-${suffixS}`, `DT06-${suffixS}`, 'TE Connectivity DEUTSCH',
      `DEUTSCH DT, ${cav}-way plug (socket contacts), contact size 16`,
      `DEUTSCH DT, ${cav}-polig, Gehäuse mit Buchsenkontakten (Plug), Kontaktgröße 16`,
      { series: 'DEUTSCH DT', cavities: cav, rows, numbering: 'serpentine', gender: 'female', color: GRAY,
        contactPart: '0462-201-16141', contactRange: '16–20 AWG', lockPart: `W${cav}S`, matingPart: `DT04-${suffixP}`,
        sealed: true }),
  ];
}

function dtm(cav, suffixP, suffixS, rows) {
  return [
    conn(`te-dtm04-${suffixP}`, `DTM04-${suffixP}`, 'TE Connectivity DEUTSCH',
      `DEUTSCH DTM, ${cav}-way receptacle (pin contacts), contact size 20`,
      `DEUTSCH DTM, ${cav}-polig, Gehäuse mit Stiftkontakten (Receptacle), Kontaktgröße 20`,
      { series: 'DEUTSCH DTM', cavities: cav, rows, numbering: 'serpentine', gender: 'male', color: GRAY,
        contactPart: '0460-202-20141', contactRange: '20 AWG', lockPart: `WM-${cav}P`, matingPart: `DTM06-${suffixS}`, sealed: true }),
    conn(`te-dtm06-${suffixS}`, `DTM06-${suffixS}`, 'TE Connectivity DEUTSCH',
      `DEUTSCH DTM, ${cav}-way plug (socket contacts), contact size 20`,
      `DEUTSCH DTM, ${cav}-polig, Gehäuse mit Buchsenkontakten (Plug), Kontaktgröße 20`,
      { series: 'DEUTSCH DTM', cavities: cav, rows, numbering: 'serpentine', gender: 'female', color: GRAY,
        contactPart: '0462-201-20141', contactRange: '20 AWG', lockPart: `WM-${cav}S`, matingPart: `DTM04-${suffixP}`, sealed: true }),
  ];
}

function microFit(cav) {
  const n = String(cav).padStart(2, '0');
  return [
    conn(`molex-43025-${n}00`, `43025-${n}00`, 'Molex',
      `Micro-Fit 3.0, ${cav}-way, dual row, receptacle housing, 3.0 mm pitch`,
      `Micro-Fit 3.0, ${cav}-polig, zweireihig, Buchsengehäuse (Receptacle), Raster 3,0 mm`,
      { series: 'Molex Micro-Fit 3.0', cavities: cav, rows: 2, gender: 'female', color: BLACK,
        contactPart: '43030-0001', contactRange: '20–24 AWG', matingPart: `43020-${n}00`, pitch: '3.0 mm' }),
    conn(`molex-43020-${n}00`, `43020-${n}00`, 'Molex',
      `Micro-Fit 3.0, ${cav}-way, dual row, plug housing, 3.0 mm pitch`,
      `Micro-Fit 3.0, ${cav}-polig, zweireihig, Steckergehäuse (Plug), Raster 3,0 mm`,
      { series: 'Molex Micro-Fit 3.0', cavities: cav, rows: 2, gender: 'male', color: BLACK,
        contactPart: '43031-0001', contactRange: '20–24 AWG', matingPart: `43025-${n}00`, pitch: '3.0 mm' }),
  ];
}

function jstXh(cav) {
  return conn(`jst-xhp-${cav}`, `XHP-${cav}`, 'JST',
    `JST XH, ${cav}-way wire-to-board receptacle housing, 2.5 mm pitch`,
    `JST XH, ${cav}-polig, Buchsengehäuse für Leitung, Raster 2,5 mm`,
    { series: 'JST XH', cavities: cav, rows: 1, gender: 'female', color: NATURAL, contactPart: 'SXH-001T-P0.6',
      contactRange: '28–22 AWG', matingPart: `B${cav}B-XH-A (PCB header)`, pitch: '2.5 mm' });
}

function jstPh(cav) {
  return conn(`jst-phr-${cav}`, `PHR-${cav}`, 'JST',
    `JST PH, ${cav}-way wire-to-board receptacle housing, 2.0 mm pitch`,
    `JST PH, ${cav}-polig, Buchsengehäuse für Leitung, Raster 2,0 mm`,
    { series: 'JST PH', cavities: cav, rows: 1, gender: 'female', color: NATURAL, contactPart: 'SPH-002T-P0.5S',
      contactRange: '30–24 AWG', matingPart: `B${cav}B-PH-K-S (PCB header)`, pitch: '2.0 mm' });
}

const de = (n) => String(n).replace('.', ',');

function flry(cs, od) {
  return {
    category: 'wire',
    partNumber: `FLRY-B ${cs}`,
    manufacturer: '',
    description: `Automotive cable FLRY-B ${cs} mm², thin wall (ISO 6722)`,
    data: { seedKey: `wire-flryb-${cs}`, descriptionDe: `Fahrzeugleitung FLRY-B ${de(cs)} mm², dünnwandig (ISO 6722)`,
      type: 'FLRY-B', crossSection: cs, outerDiameter: od },
  };
}

// Multi-core cables; core colours according to DIN 47100
const DIN47100 = ['WH', 'BN', 'GN', 'YE', 'GY', 'PK', 'BU', 'RD', 'BK', 'VT'];
function multicore(type, cores, cs, shield) {
  const name = `${type} ${cores}x${cs}`;
  return {
    category: 'cable',
    partNumber: name,
    manufacturer: '',
    description: `Control cable ${name} mm²${shield ? ', copper braid shield' : ''}, core colours DIN 47100`,
    data: {
      seedKey: `cable-${type.toLowerCase()}-${cores}x${cs}`,
      descriptionDe: `Steuerleitung ${type} ${cores}×${de(cs)} mm²${shield ? ', Kupfergeflecht-Schirm' : ''}, Aderfarben nach DIN 47100`,
      type, cores, crossSection: cs, shield, coreColors: DIN47100.slice(0, cores),
    },
  };
}

const CONNECTORS = [
  ...dt(2, '2P', '2S', 1), ...dt(3, '3P', '3S', 1), ...dt(4, '4P', '4S', 2),
  ...dt(6, '6P', '6S', 2), ...dt(8, '08PA', '08SA', 2), ...dt(12, '12PA', '12SA', 2),
  ...dtm(2, '2P', '2S', 1), ...dtm(4, '4P', '4S', 2), ...dtm(6, '6P', '6S', 2),
  ...microFit(2), ...microFit(4), ...microFit(6), ...microFit(8),
  ...[2, 3, 4, 5, 6].map(jstXh),
  ...[2, 3, 4].map(jstPh),
];

const WIRES = [flry(0.35, 1.3), flry(0.5, 1.6), flry(0.75, 1.9), flry(1.0, 2.1), flry(1.5, 2.4), flry(2.5, 3.0), flry(4.0, 3.7), flry(6.0, 4.3)];

const CABLES = [
  multicore('LiYY', 2, 0.25, false), multicore('LiYY', 3, 0.25, false), multicore('LiYY', 4, 0.25, false),
  multicore('LiYY', 7, 0.25, false), multicore('LiYY', 2, 0.5, false), multicore('LiYY', 4, 0.5, false),
  multicore('LiYCY', 2, 0.25, true), multicore('LiYCY', 3, 0.25, true), multicore('LiYCY', 4, 0.25, true),
  multicore('LiYCY', 2, 0.5, true), multicore('LiYCY', 4, 0.5, true),
];

function generic(category, key, desc, descDe, data = {}, extra = {}) {
  return { category, partNumber: '', manufacturer: '', description: desc, ...extra, data: { seedKey: key, descriptionDe: descDe, ...data } };
}

const TERMINALS = [
  generic('terminal', 'term-ring-m5-red', 'Insulated ring terminal M5, 0.5–1.5 mm² (red)', 'Ringkabelschuh isoliert M5, 0,5–1,5 mm² (rot)', { subtype: 'ring', stud: 'M5', crossSectionRange: '0.5–1.5 mm²' }),
  generic('terminal', 'term-ring-m6-red', 'Insulated ring terminal M6, 0.5–1.5 mm² (red)', 'Ringkabelschuh isoliert M6, 0,5–1,5 mm² (rot)', { subtype: 'ring', stud: 'M6', crossSectionRange: '0.5–1.5 mm²' }),
  generic('terminal', 'term-ring-m6-blue', 'Insulated ring terminal M6, 1.5–2.5 mm² (blue)', 'Ringkabelschuh isoliert M6, 1,5–2,5 mm² (blau)', { subtype: 'ring', stud: 'M6', crossSectionRange: '1.5–2.5 mm²' }),
  generic('terminal', 'term-ring-m8-yellow', 'Insulated ring terminal M8, 4–6 mm² (yellow)', 'Ringkabelschuh isoliert M8, 4–6 mm² (gelb)', { subtype: 'ring', stud: 'M8', crossSectionRange: '4–6 mm²' }),
  generic('terminal', 'term-spade-m4-red', 'Insulated fork terminal M4, 0.5–1.5 mm² (red)', 'Gabelkabelschuh isoliert M4, 0,5–1,5 mm² (rot)', { subtype: 'spade', stud: 'M4', crossSectionRange: '0.5–1.5 mm²' }),
  generic('terminal', 'term-tab-6.3-red', 'Insulated tab 6.3 × 0.8 mm, 0.5–1.5 mm² (red)', 'Flachstecker 6,3 × 0,8 mm isoliert, 0,5–1,5 mm² (rot)', { subtype: 'male_qc', crossSectionRange: '0.5–1.5 mm²' }),
  generic('terminal', 'term-receptacle-6.3-red', 'Insulated receptacle 6.3 × 0.8 mm, 0.5–1.5 mm² (red)', 'Flachsteckhülse 6,3 × 0,8 mm isoliert, 0,5–1,5 mm² (rot)', { subtype: 'female_qc', crossSectionRange: '0.5–1.5 mm²' }),
  generic('terminal', 'term-receptacle-6.3-blue', 'Insulated receptacle 6.3 × 0.8 mm, 1.5–2.5 mm² (blue)', 'Flachsteckhülse 6,3 × 0,8 mm isoliert, 1,5–2,5 mm² (blau)', { subtype: 'female_qc', crossSectionRange: '1.5–2.5 mm²' }),
  ...[0.5, 0.75, 1.0, 1.5, 2.5].map((cs) =>
    generic('terminal', `term-ferrule-${cs}`, `Insulated ferrule ${cs} mm²`, `Aderendhülse isoliert ${de(cs)} mm²`, { subtype: 'ferrule', crossSectionRange: `${cs} mm²` })
  ),
];

const SPLICES = [
  generic('splice', 'splice-butt-red', 'Insulated butt connector, 0.5–1.5 mm² (red)', 'Stoßverbinder isoliert, 0,5–1,5 mm² (rot)', { crossSectionRange: '0.5–1.5 mm²' }),
  generic('splice', 'splice-butt-blue', 'Insulated butt connector, 1.5–2.5 mm² (blue)', 'Stoßverbinder isoliert, 1,5–2,5 mm² (blau)', { crossSectionRange: '1.5–2.5 mm²' }),
  generic('splice', 'splice-solder-sleeve', 'Solder sleeve with heat shrink, 0.5–1.5 mm²', 'Lötverbinder mit Schrumpfschlauch, 0,5–1,5 mm²', { crossSectionRange: '0.5–1.5 mm²' }),
  generic('splice', 'splice-crimp-ultrasonic', 'Splice (crimp/ultrasonic) with heat shrink', 'Spleiß (Crimp/Ultraschall) mit Schrumpfschlauch', {}),
];

const COVERINGS = [
  ...[7, 10, 13, 17].map((nw) =>
    generic('covering', `cov-corrugated-nw${nw}`, `Corrugated tube PA, slit, NW ${nw}`, `Wellrohr PA, geschlitzt, NW ${nw}`, { subtype: 'corrugated', innerDiameter: nw })
  ),
  generic('covering', 'cov-tape-pet-19', 'PET cloth tape, 19 mm wide', 'Gewebeklebeband PET, 19 mm breit', { subtype: 'tape' }),
  generic('covering', 'cov-braid-pet-6-10', 'PET braided sleeve, 6–10 mm', 'Geflechtschlauch PET, 6–10 mm', { subtype: 'braid', innerDiameter: 6 }),
  generic('covering', 'cov-heatshrink-3to1-6', 'Heat shrink 3:1 with adhesive, 6 → 2 mm', 'Schrumpfschlauch 3:1 mit Kleber, 6 → 2 mm', { subtype: 'heatshrink', innerDiameter: 6 }),
  generic('covering', 'cov-heatshrink-3to1-12', 'Heat shrink 3:1 with adhesive, 12 → 4 mm', 'Schrumpfschlauch 3:1 mit Kleber, 12 → 4 mm', { subtype: 'heatshrink', innerDiameter: 12 }),
];

const DEVICES = [
  generic('device', 'dev-1n4007', 'Rectifier diode 1 A, 1000 V', 'Gleichrichterdiode 1 A, 1000 V', { subtype: 'diode', value: '1 A / 1000 V' }, { partNumber: '1N4007' }),
  generic('device', 'dev-1n5408', 'Rectifier diode 3 A, 1000 V', 'Gleichrichterdiode 3 A, 1000 V', { subtype: 'diode', value: '3 A / 1000 V' }, { partNumber: '1N5408' }),
  generic('device', 'dev-r120', 'Resistor 120 Ω (e.g. CAN termination)', 'Widerstand 120 Ω (z. B. CAN-Abschluss)', { subtype: 'resistor', value: '120 Ω' }),
];

export const seedParts = [
  ...CONNECTORS, ...vehicleParts, ...industrialParts, ...WIRES, ...CABLES, ...TERMINALS, ...SPLICES, ...COVERINGS, ...DEVICES,
];

// Guard against duplicate seed keys (would break library updates)
const seen = new Set();
for (const p of seedParts) {
  if (seen.has(p.data.seedKey)) throw new Error(`Duplicate seedKey ${p.data.seedKey}`);
  seen.add(p.data.seedKey);
}
