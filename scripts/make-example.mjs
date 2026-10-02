#!/usr/bin/env node
// Generates examples/example-injection-ignition.harness.json – an example harness modelled on the
// harness.design demo: injection/ignition with a bulkhead connector, two ECUs and a dashboard.
// Part snapshots are taken from the built-in library (server/seed-parts.js), so the example always
// matches the seeded parts. Run: node scripts/make-example.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedParts } from '../server/seed-parts.js';

let nextId = 1;
const uid = (prefix) => `${prefix}ex${nextId++}`;

/** Snapshot of a library part as stored in a harness document */
function part(seedKey) {
  const p = seedParts.find((x) => x.data.seedKey === seedKey);
  if (!p) throw new Error(`Unknown seed part ${seedKey}`);
  const { seedKey: _omit, ...data } = p.data;
  return {
    id: null, category: p.category, partNumber: p.partNumber, manufacturer: p.manufacturer,
    description: p.description, hasImage: false, imageVersion: '', data,
  };
}

const RING_M6 = part('term-ring-m6-red');
const SPLICE = part('splice-butt-red');
const CORRUGATED10 = part('cov-corrugated-nw10');
const TAPE = part('cov-tape-pet-19');

const comps = [];
const wires = [];
const nodes = [];
const segs = [];
const cables = [];
const byName = new Map();

function comp(type, label, pins, sch, lay, partSnap = null, extra = {}) {
  const c = {
    id: uid('c'), type, label, part: partSnap,
    pins: pins.map(([name, fn]) => ({ id: uid('p'), name, fn })),
    sch: { x: sch[0], y: sch[1] }, lay: { x: lay[0], y: lay[1] },
    show: {}, callouts: {}, excludeFromBom: false, notes: '',
    ...(type === 'connector' ? { mateId: null } : {}),
    ...extra,
  };
  comps.push(c);
  byName.set(label, c);
  return c;
}

const pin = (label, name) => {
  const c = byName.get(label);
  return { c: c.id, p: c.pins.find((p) => p.name === name).id };
};

let wireNo = 1;
function wire(a, b, color, cs, signal = '', stripe = null) {
  const w = {
    id: uid('w'), label: `W${wireNo++}`, from: a, to: b, signal, color, stripe, cs, type: 'FLRY-B',
    part: null, lengthExtra: 0, lengthOverride: null, notes: '',
  };
  wires.push(w);
  return w;
}

function node(key, x, y) {
  const n = { id: uid('n'), x, y, label: `A${nodes.length + 1}` };
  nodes.push(n);
  byName.set(key, n);
}

function seg(a, b, length, coverings = []) {
  segs.push({
    id: uid('s'), a: byName.get(a).id, b: byName.get(b).id, length, points: [],
    coverings: coverings.map((cv) => ({ id: uid('v'), part: cv, label: '' })), label: '',
  });
}

const TABLE = { table: true };
// ---------- Components (schematic position, layout position) ----------
comp('connector', 'Injector 1', [['1', 'BAT +'], ['2', 'INJ 1']], [0, 0], [-760, -330], part('te-dt04-2P'), { show: TABLE });
comp('connector', 'Coil 1', [['1', 'IGN 1'], ['2', 'GND'], ['3', 'BAT +']], [0, 110], [-340, -330], part('te-dt04-3P'), { show: TABLE });
comp('connector', 'Injector 2', [['1', 'BAT +'], ['2', 'INJ 2']], [0, 240], [340, -330], part('te-dt04-2P'), { show: TABLE });
comp('connector', 'Coil 2', [['1', 'IGN 2'], ['2', 'GND'], ['3', 'BAT +']], [0, 350], [760, -330], part('te-dt04-3P'), { show: TABLE });
comp('terminal', 'GND Engine', [['1', 'GND']], [0, 500], [-900, 0], RING_M6, { subtype: 'ring' });
comp('splice', 'S1', [['S', 'BAT +']], [330, 380], [0, 80], SPLICE);
const sixPins = [['1', 'INJ 1'], ['2', 'INJ 2'], ['3', 'IGN 1'], ['4', 'IGN 2'], ['5', 'BAT +'], ['6', '']];
comp('connector', 'Bulkhead E', sixPins, [420, 60], [0, 170], part('te-dt04-6P'), { show: { face: true } });
comp('connector', 'Bulkhead C', sixPins, [720, 60], [0, 290], part('te-dt06-6S'), { show: { face: true, table: true } });
comp('connector', 'ECU 2', [['1', 'BAT +'], ['2', 'INJ 1'], ['3', 'INJ 2'], ['4', 'IGN 1'], ['5', 'IGN 2'], ['6', 'GND']], [1060, 0], [-460, 560], part('te-dt06-6S'), { show: { face: true } });
comp('connector', 'ECU 1', [['1', 'CAN H'], ['2', 'CAN L']], [1060, 220], [-460, 720], part('te-dt06-2S'));
comp('connector', 'Dashboard', [['1', 'BAT +'], ['2', 'CAN H'], ['3', 'CAN L'], ['4', 'GND']], [1060, 340], [-460, 900], part('te-dt06-4S'), { show: { face: true } });
comp('splice', 'S2', [['S', 'BAT +']], [930, 520], [0, 1000], SPLICE);
comp('splice', 'S3', [['S', 'GND']], [930, 600], [0, 1060], SPLICE);
comp('terminal', 'BAT +', [['1', 'BAT +']], [1100, 500], [-130, 1240], RING_M6, { subtype: 'ring' });
comp('terminal', 'BAT -', [['1', 'GND']], [1100, 580], [130, 1240], RING_M6, { subtype: 'ring' });

byName.get('Bulkhead E').mateId = byName.get('Bulkhead C').id;
byName.get('Bulkhead C').mateId = byName.get('Bulkhead E').id;
byName.get('Bulkhead E').callouts = { face: { dx: -140, dy: -36 } };
byName.get('Bulkhead C').callouts = { face: { dx: -140, dy: -20 }, table: { dx: 150, dy: 20 } };
byName.get('ECU 2').callouts = { face: { dx: -150, dy: -36 } };
byName.get('Dashboard').callouts = { face: { dx: -150, dy: -36 } };
for (const label of ['Injector 1', 'Coil 1', 'Injector 2', 'Coil 2']) byName.get(label).callouts = { table: { dx: -169, dy: -150 } };

// ---------- Wires ----------
wire(pin('Injector 1', '1'), pin('S1', 'S'), 'RD', 0.75, 'BAT +');
wire(pin('Injector 1', '2'), pin('Bulkhead E', '1'), 'OG', 0.75, 'INJ 1');
wire(pin('Coil 1', '1'), pin('Bulkhead E', '3'), 'GN', 0.75, 'IGN 1');
wire(pin('Coil 1', '2'), pin('GND Engine', '1'), 'BK', 1.0, 'GND');
wire(pin('Coil 1', '3'), pin('S1', 'S'), 'RD', 0.75, 'BAT +');
wire(pin('Injector 2', '1'), pin('S1', 'S'), 'RD', 0.75, 'BAT +');
wire(pin('Injector 2', '2'), pin('Bulkhead E', '2'), 'YE', 0.75, 'INJ 2');
wire(pin('Coil 2', '1'), pin('Bulkhead E', '4'), 'BU', 0.75, 'IGN 2');
wire(pin('Coil 2', '2'), pin('GND Engine', '1'), 'BK', 1.0, 'GND');
wire(pin('Coil 2', '3'), pin('S1', 'S'), 'RD', 0.75, 'BAT +');
wire(pin('S1', 'S'), pin('Bulkhead E', '5'), 'RD', 1.5, 'BAT +');
wire(pin('Bulkhead C', '1'), pin('ECU 2', '2'), 'OG', 0.75, 'INJ 1');
wire(pin('Bulkhead C', '2'), pin('ECU 2', '3'), 'YE', 0.75, 'INJ 2');
wire(pin('Bulkhead C', '3'), pin('ECU 2', '4'), 'GN', 0.75, 'IGN 1');
wire(pin('Bulkhead C', '4'), pin('ECU 2', '5'), 'BU', 0.75, 'IGN 2');
wire(pin('Bulkhead C', '5'), pin('S2', 'S'), 'RD', 1.5, 'BAT +');
wire(pin('ECU 2', '1'), pin('S2', 'S'), 'RD', 0.75, 'BAT +');
wire(pin('ECU 2', '6'), pin('S3', 'S'), 'BK', 0.75, 'GND');
const canH = wire(pin('ECU 1', '1'), pin('Dashboard', '2'), 'VT', 0.5, 'CAN H');
const canL = wire(pin('ECU 1', '2'), pin('Dashboard', '3'), 'WH', 0.5, 'CAN L', 'VT');
wire(pin('Dashboard', '1'), pin('S2', 'S'), 'RD', 0.75, 'BAT +');
wire(pin('Dashboard', '4'), pin('S3', 'S'), 'BK', 0.75, 'GND');
wire(pin('S2', 'S'), pin('BAT +', '1'), 'RD', 1.5, 'BAT +');
wire(pin('S3', 'S'), pin('BAT -', '1'), 'BK', 1.5, 'GND');

// CAN bus as twisted pair
const twist = {
  id: uid('k'), label: 'TW1', kind: 'twist', part: null, type: '', cores: null, shield: false,
  layLength: 25, outerDiameter: null, excludeFromBom: false, notes: '',
};
cables.push(twist);
for (const w of [canH, canL]) Object.assign(w, { cableId: twist.id, cableRole: 'core' });

// ---------- Layout ----------
node('L', -550, -180);
node('R', 550, -180);
node('LL', -550, 0);
node('RR', 550, 0);
node('C', 0, 0);
node('D2', 0, 560);
node('E12', -240, 640);
node('D3', 0, 900);
node('D4', 0, 1140);
seg('Injector 1', 'L', 200, [TAPE]);
seg('Coil 1', 'L', 200, [TAPE]);
seg('Injector 2', 'R', 200, [TAPE]);
seg('Coil 2', 'R', 200, [TAPE]);
seg('L', 'LL', 300, [CORRUGATED10]);
seg('R', 'RR', 300, [CORRUGATED10]);
seg('GND Engine', 'LL', 300);
seg('LL', 'C', 700, [CORRUGATED10]);
seg('RR', 'C', 700, [CORRUGATED10]);
seg('C', 'S1', 150, [CORRUGATED10]);
seg('S1', 'Bulkhead E', 150, [CORRUGATED10]);
seg('Bulkhead C', 'D2', 500, [CORRUGATED10]);
seg('D2', 'E12', 600, [CORRUGATED10]);
seg('E12', 'ECU 2', 100);
seg('E12', 'ECU 1', 100);
seg('D2', 'D3', 400, [CORRUGATED10]);
seg('D3', 'Dashboard', 800, [CORRUGATED10]);
seg('D3', 'S2', 400, [CORRUGATED10]);
seg('S2', 'S3', 50);
seg('S3', 'D4', 150);
seg('D4', 'BAT +', 200);
seg('D4', 'BAT -', 200);

const doc = {
  schemaVersion: 2,
  settings: {
    drawingNumber: 'KB-001', revision: 'A', author: '', extraPerEnd: 15, extraPercent: 2,
    defaultCrossSection: 0.75, defaultWireType: 'FLRY-B', defaultColor: 'BK',
  },
  components: comps, wires, cables, nodes, segments: segs,
  notes: [
    { id: uid('n'), view: 'sch', x: 0, y: -110, text: 'Example: injection & ignition\nEngine side left, vehicle side right (via bulkhead connector E/C)' },
    { id: uid('n'), view: 'lay', x: 260, y: 1120, text: 'Battery connection\nRing terminals M6' },
  ],
};

const out = {
  format: 'cabledesigner2000', formatVersion: 1, name: 'Example – injection & ignition',
  description: 'Example harness with bulkhead connector, two ECUs, dashboard, splices and a twisted CAN pair.',
  data: doc,
};
const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'examples', 'example-injection-ignition.harness.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
console.log(`written: ${path.normalize(file)} – ${comps.length} components, ${wires.length} wires, ${segs.length} segments`);
