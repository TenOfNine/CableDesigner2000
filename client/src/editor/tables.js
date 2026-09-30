// Tabellendaten für Listenansicht, Druck und Excel-Export
import { colorByCode, wireColorLabel, wireColorName, awgFor, COMPONENT_TYPE_LABEL, terminalSubtype } from './model.js';
import { wireEndsFor } from './derive.js';

const natural = (a, b) => String(a).localeCompare(String(b), 'de', { numeric: true, sensitivity: 'base' });

export function wireListRows(doc, derived) {
  const rows = [];
  for (const w of derived.validWires) {
    const i = derived.wireInfo.get(w.id);
    rows.push({
      wireId: w.id,
      label: w.label,
      signal: i.signal,
      fromComp: i.from.comp.label,
      fromPin: pinCell(i.from),
      toComp: i.to.comp.label,
      toPin: pinCell(i.to),
      color: wireColorLabel(w),
      colorName: wireColorName(w),
      colorHex: colorByCode(w.color).hex,
      stripeHex: w.stripe ? colorByCode(w.stripe).hex : null,
      cs: w.cs,
      awg: awgFor(w.cs),
      type: w.type || '',
      partNumber: w.part?.partNumber || '',
      length: i.length === null ? null : Math.round(i.length),
      routed: i.routed,
      overridden: i.overridden,
      route: i.route ? i.route.nodeIds.map((n) => derived.nodeLabel(n)).join(' → ') : '',
      notes: w.notes || '',
    });
  }
  rows.sort((a, b) => natural(a.label, b.label));
  return rows;
}

function pinCell(end) {
  const c = end.comp;
  if (c.type === 'splice') return '';
  if (c.type === 'terminal') return terminalSubtype(c.subtype).label;
  return end.pin.name;
}

export function pinoutRows(doc, derived) {
  const rows = [];
  const comps = [...doc.components].sort((a, b) => natural(a.label, b.label));
  for (const c of comps) {
    const mate = c.mateId ? derived.comps.get(c.mateId) : null;
    for (const p of c.pins) {
      const ends = wireEndsFor(derived, c.id, p.id);
      const base = {
        compId: c.id,
        comp: c.label,
        type: COMPONENT_TYPE_LABEL[c.type],
        part: c.part?.partNumber || '',
        mate: mate?.label || '',
        pin: p.name,
        fn: p.fn || '',
      };
      if (!ends.length) rows.push({ ...base, wire: '', color: '', colorHex: null, cs: null, dest: '', destFn: '', length: null, wireId: null });
      for (const e of ends) {
        rows.push({
          ...base,
          wireId: e.wire.id,
          wire: e.wire.label,
          color: wireColorLabel(e.wire),
          colorHex: colorByCode(e.wire.color).hex,
          cs: e.wire.cs,
          dest: destLabel(e.other),
          destFn: e.other.pin.fn || '',
          length: e.info.length === null ? null : Math.round(e.info.length),
        });
      }
    }
  }
  return rows;
}

function destLabel(end) {
  const c = end.comp;
  if (c.type === 'terminal' || c.type === 'splice') return c.label;
  return `${c.label}.${end.pin.name}`;
}

export function segmentRows(doc, derived) {
  return doc.segments
    .map((s) => {
      const i = derived.segInfo.get(s.id);
      return {
        segId: s.id,
        label: s.label || '',
        from: i.fromLabel,
        to: i.toLabel,
        length: Number(s.length) || 0,
        wires: i.wires.length,
        bundle: i.bundleDiameter ? Math.round(i.bundleDiameter * 10) / 10 : null,
        coverings: (s.coverings || []).map((c) => c.part?.partNumber || c.part?.description || c.label).filter(Boolean).join(', '),
        wireLabels: i.wires.map((id) => derived.wireInfo.get(id).wire.label).sort(natural).join(', '),
      };
    })
    .sort((a, b) => natural(a.from, b.from) || natural(a.to, b.to));
}

export function bomRows(derived) {
  return derived.bom.map((b) => ({
    pos: b.pos,
    group: b.groupLabel,
    partNumber: b.partNumber,
    manufacturer: b.manufacturer,
    description: b.description,
    qty: b.qty,
    unit: b.unit,
    refs: [...new Set(b.refs)].sort(natural).join(', '),
    notes: b.notes,
    unassigned: !!b.unassigned,
  }));
}
