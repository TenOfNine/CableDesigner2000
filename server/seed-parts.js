// Vorbefüllte globale Bauteilbibliothek.
// Kammeranordnungen sind schematisch – vor der Fertigung immer mit dem Datenblatt abgleichen.

const GRAY = { name: 'Grau', hex: '#8a8f98' };
const BLACK = { name: 'Schwarz', hex: '#2a2a2a' };
const NATURAL = { name: 'Natur', hex: '#e8e2cf' };

const CHECK = 'Kammeranordnung schematisch – vor Fertigung mit Datenblatt abgleichen.';

function dt(cav, suffixP, suffixS, rows) {
  const lockP = `W${cav}P`;
  const lockS = `W${cav}S`;
  return [
    {
      category: 'connector',
      partNumber: `DT04-${suffixP}`,
      manufacturer: 'TE Connectivity DEUTSCH',
      description: `DEUTSCH DT, ${cav}-polig, Gehäuse mit Stiftkontakten (Receptacle), Kontaktgröße 16`,
      data: {
        series: 'DEUTSCH DT', cavities: cav, designation: 'numeric', rows, numbering: 'serpentine',
        gender: 'male', color: GRAY, contactPart: '0460-202-16141', contactRange: '16–20 AWG',
        lockPart: lockP, matingPart: `DT06-${suffixS}`, notes: CHECK,
      },
    },
    {
      category: 'connector',
      partNumber: `DT06-${suffixS}`,
      manufacturer: 'TE Connectivity DEUTSCH',
      description: `DEUTSCH DT, ${cav}-polig, Gehäuse mit Buchsenkontakten (Plug), Kontaktgröße 16`,
      data: {
        series: 'DEUTSCH DT', cavities: cav, designation: 'numeric', rows, numbering: 'serpentine',
        gender: 'female', color: GRAY, contactPart: '0462-201-16141', contactRange: '16–20 AWG',
        lockPart: lockS, matingPart: `DT04-${suffixP}`, notes: CHECK,
      },
    },
  ];
}

function dtm(cav, suffixP, suffixS, rows) {
  return [
    {
      category: 'connector',
      partNumber: `DTM04-${suffixP}`,
      manufacturer: 'TE Connectivity DEUTSCH',
      description: `DEUTSCH DTM, ${cav}-polig, Gehäuse mit Stiftkontakten (Receptacle), Kontaktgröße 20`,
      data: {
        series: 'DEUTSCH DTM', cavities: cav, designation: 'numeric', rows, numbering: 'serpentine',
        gender: 'male', color: GRAY, contactPart: '0460-202-20141', contactRange: '20 AWG',
        lockPart: `WM-${cav}P`, matingPart: `DTM06-${suffixS}`, notes: CHECK,
      },
    },
    {
      category: 'connector',
      partNumber: `DTM06-${suffixS}`,
      manufacturer: 'TE Connectivity DEUTSCH',
      description: `DEUTSCH DTM, ${cav}-polig, Gehäuse mit Buchsenkontakten (Plug), Kontaktgröße 20`,
      data: {
        series: 'DEUTSCH DTM', cavities: cav, designation: 'numeric', rows, numbering: 'serpentine',
        gender: 'female', color: GRAY, contactPart: '0462-201-20141', contactRange: '20 AWG',
        lockPart: `WM-${cav}S`, matingPart: `DTM04-${suffixP}`, notes: CHECK,
      },
    },
  ];
}

function microFit(cav) {
  const n = String(cav).padStart(2, '0');
  return [
    {
      category: 'connector',
      partNumber: `43025-${n}00`,
      manufacturer: 'Molex',
      description: `Micro-Fit 3.0, ${cav}-polig, zweireihig, Buchsengehäuse (Receptacle), Raster 3,0 mm`,
      data: {
        series: 'Molex Micro-Fit 3.0', cavities: cav, designation: 'numeric', rows: 2, numbering: 'rowwise',
        gender: 'female', color: BLACK, contactPart: '43030-0001', contactRange: '20–24 AWG',
        matingPart: `43020-${n}00`, pitch: '3,0 mm', notes: CHECK,
      },
    },
    {
      category: 'connector',
      partNumber: `43020-${n}00`,
      manufacturer: 'Molex',
      description: `Micro-Fit 3.0, ${cav}-polig, zweireihig, Steckergehäuse (Plug), Raster 3,0 mm`,
      data: {
        series: 'Molex Micro-Fit 3.0', cavities: cav, designation: 'numeric', rows: 2, numbering: 'rowwise',
        gender: 'male', color: BLACK, contactPart: '43031-0001', contactRange: '20–24 AWG',
        matingPart: `43025-${n}00`, pitch: '3,0 mm', notes: CHECK,
      },
    },
  ];
}

function jstXh(cav) {
  return {
    category: 'connector',
    partNumber: `XHP-${cav}`,
    manufacturer: 'JST',
    description: `JST XH, ${cav}-polig, Buchsengehäuse für Leitung, Raster 2,5 mm`,
    data: {
      series: 'JST XH', cavities: cav, designation: 'numeric', rows: 1, numbering: 'rowwise',
      gender: 'female', color: NATURAL, contactPart: 'SXH-001T-P0.6', contactRange: '28–22 AWG',
      matingPart: `B${cav}B-XH-A (Platinen-Stiftleiste)`, pitch: '2,5 mm',
    },
  };
}

function jstPh(cav) {
  return {
    category: 'connector',
    partNumber: `PHR-${cav}`,
    manufacturer: 'JST',
    description: `JST PH, ${cav}-polig, Buchsengehäuse für Leitung, Raster 2,0 mm`,
    data: {
      series: 'JST PH', cavities: cav, designation: 'numeric', rows: 1, numbering: 'rowwise',
      gender: 'female', color: NATURAL, contactPart: 'SPH-002T-P0.5S', contactRange: '30–24 AWG',
      matingPart: `B${cav}B-PH-K-S (Platinen-Stiftleiste)`, pitch: '2,0 mm',
    },
  };
}

function flry(cs, od) {
  return {
    category: 'wire',
    partNumber: `FLRY-B ${String(cs).replace('.', ',')}`,
    manufacturer: '',
    description: `Fahrzeugleitung FLRY-B ${String(cs).replace('.', ',')} mm², dünnwandig (ISO 6722)`,
    data: { type: 'FLRY-B', crossSection: cs, outerDiameter: od },
  };
}

const CONNECTORS = [
  ...dt(2, '2P', '2S', 1),
  ...dt(3, '3P', '3S', 1),
  ...dt(4, '4P', '4S', 2),
  ...dt(6, '6P', '6S', 2),
  ...dt(8, '08PA', '08SA', 2),
  ...dt(12, '12PA', '12SA', 2),
  ...dtm(2, '2P', '2S', 1),
  ...dtm(4, '4P', '4S', 2),
  ...dtm(6, '6P', '6S', 2),
  ...microFit(2),
  ...microFit(4),
  ...microFit(6),
  ...microFit(8),
  ...[2, 3, 4, 5, 6].map(jstXh),
  ...[2, 3, 4].map(jstPh),
];

const WIRES = [
  flry(0.35, 1.3),
  flry(0.5, 1.6),
  flry(0.75, 1.9),
  flry(1.0, 2.1),
  flry(1.5, 2.4),
  flry(2.5, 3.0),
  flry(4.0, 3.7),
  flry(6.0, 4.3),
];

const TERMINALS = [
  { partNumber: '', description: 'Ringkabelschuh isoliert M5, 0,5–1,5 mm² (rot)', data: { subtype: 'ring', stud: 'M5', crossSectionRange: '0,5–1,5 mm²' } },
  { partNumber: '', description: 'Ringkabelschuh isoliert M6, 0,5–1,5 mm² (rot)', data: { subtype: 'ring', stud: 'M6', crossSectionRange: '0,5–1,5 mm²' } },
  { partNumber: '', description: 'Ringkabelschuh isoliert M6, 1,5–2,5 mm² (blau)', data: { subtype: 'ring', stud: 'M6', crossSectionRange: '1,5–2,5 mm²' } },
  { partNumber: '', description: 'Ringkabelschuh isoliert M8, 4–6 mm² (gelb)', data: { subtype: 'ring', stud: 'M8', crossSectionRange: '4–6 mm²' } },
  { partNumber: '', description: 'Gabelkabelschuh isoliert M4, 0,5–1,5 mm² (rot)', data: { subtype: 'spade', stud: 'M4', crossSectionRange: '0,5–1,5 mm²' } },
  { partNumber: '', description: 'Flachstecker 6,3 × 0,8 mm isoliert, 0,5–1,5 mm² (rot)', data: { subtype: 'male_qc', crossSectionRange: '0,5–1,5 mm²' } },
  { partNumber: '', description: 'Flachsteckhülse 6,3 × 0,8 mm isoliert, 0,5–1,5 mm² (rot)', data: { subtype: 'female_qc', crossSectionRange: '0,5–1,5 mm²' } },
  { partNumber: '', description: 'Flachsteckhülse 6,3 × 0,8 mm isoliert, 1,5–2,5 mm² (blau)', data: { subtype: 'female_qc', crossSectionRange: '1,5–2,5 mm²' } },
  { partNumber: '', description: 'Aderendhülse isoliert 0,5 mm²', data: { subtype: 'ferrule', crossSectionRange: '0,5 mm²' } },
  { partNumber: '', description: 'Aderendhülse isoliert 0,75 mm²', data: { subtype: 'ferrule', crossSectionRange: '0,75 mm²' } },
  { partNumber: '', description: 'Aderendhülse isoliert 1,0 mm²', data: { subtype: 'ferrule', crossSectionRange: '1,0 mm²' } },
  { partNumber: '', description: 'Aderendhülse isoliert 1,5 mm²', data: { subtype: 'ferrule', crossSectionRange: '1,5 mm²' } },
  { partNumber: '', description: 'Aderendhülse isoliert 2,5 mm²', data: { subtype: 'ferrule', crossSectionRange: '2,5 mm²' } },
].map((t) => ({ category: 'terminal', manufacturer: '', ...t }));

const SPLICES = [
  { description: 'Stoßverbinder isoliert, 0,5–1,5 mm² (rot)', data: { crossSectionRange: '0,5–1,5 mm²' } },
  { description: 'Stoßverbinder isoliert, 1,5–2,5 mm² (blau)', data: { crossSectionRange: '1,5–2,5 mm²' } },
  { description: 'Lötverbinder mit Schrumpfschlauch, 0,5–1,5 mm²', data: { crossSectionRange: '0,5–1,5 mm²' } },
  { description: 'Spleiß (Crimp/Ultraschall) mit Schrumpfschlauch', data: {} },
].map((s) => ({ category: 'splice', partNumber: '', manufacturer: '', ...s }));

const COVERINGS = [
  { description: 'Wellrohr PA, geschlitzt, NW 7', data: { subtype: 'corrugated', innerDiameter: 7 } },
  { description: 'Wellrohr PA, geschlitzt, NW 10', data: { subtype: 'corrugated', innerDiameter: 10 } },
  { description: 'Wellrohr PA, geschlitzt, NW 13', data: { subtype: 'corrugated', innerDiameter: 13 } },
  { description: 'Wellrohr PA, geschlitzt, NW 17', data: { subtype: 'corrugated', innerDiameter: 17 } },
  { description: 'Gewebeklebeband PET, 19 mm breit', data: { subtype: 'tape' } },
  { description: 'Geflechtschlauch PET, 6–10 mm', data: { subtype: 'braid', innerDiameter: 6 } },
  { description: 'Schrumpfschlauch 3:1 mit Kleber, 6 → 2 mm', data: { subtype: 'heatshrink', innerDiameter: 6 } },
  { description: 'Schrumpfschlauch 3:1 mit Kleber, 12 → 4 mm', data: { subtype: 'heatshrink', innerDiameter: 12 } },
].map((c) => ({ category: 'covering', partNumber: '', manufacturer: '', ...c }));

const DEVICES = [
  { partNumber: '1N4007', description: 'Gleichrichterdiode 1 A, 1000 V', data: { subtype: 'diode', value: '1 A / 1000 V' } },
  { partNumber: '1N5408', description: 'Gleichrichterdiode 3 A, 1000 V', data: { subtype: 'diode', value: '3 A / 1000 V' } },
  { partNumber: '', description: 'Widerstand 120 Ω (z. B. CAN-Abschluss)', data: { subtype: 'resistor', value: '120 Ω' } },
].map((d) => ({ category: 'device', manufacturer: '', ...d }));

export const seedParts = [...CONNECTORS, ...WIRES, ...TERMINALS, ...SPLICES, ...COVERINGS, ...DEVICES];
