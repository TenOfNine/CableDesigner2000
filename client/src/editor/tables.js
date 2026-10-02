// Table data for the lists view, printing and the Excel export
import { colorByCode, wireColorLabel, wireColorName, awgFor, componentTypeLabel, terminalSubtype, cableKindLabel, partDescription } from './model.js';
import { wireEndsFor, bomGroupLabel, unitLabel } from './derive.js';

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

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
      cable: i.cable ? i.cable.label : '',
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
  const type = c.origType || c.type;
  if (type === 'splice') return '';
  if (type === 'terminal') return terminalSubtype(c.subtype).label;
  return end.pin.name;
}

export function pinoutRows(doc, derived) {
  const rows = [];
  const comps = [...doc.components.filter((c) => c.type !== 'subharness')].sort((a, b) => natural(a.label, b.label));
  for (const c of comps) {
    const mate = c.mateId ? derived.comps.get(c.mateId) : null;
    for (const p of c.pins) {
      const ends = wireEndsFor(derived, c.id, p.id);
      const base = {
        compId: c.id,
        comp: c.label,
        type: componentTypeLabel(c.type),
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
  const type = c.origType || c.type;
  if (type === 'terminal' || type === 'splice') return c.label;
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
        coverings: (s.coverings || []).map((c) => c.part?.partNumber || (c.part && partDescription(c.part)) || c.label).filter(Boolean).join(', '),
        wireLabels: i.wires.map((id) => derived.wireInfo.get(id).wire.label).sort(natural).join(', '),
      };
    })
    .sort((a, b) => natural(a.from, b.from) || natural(a.to, b.to));
}

export function cableRows(doc, derived) {
  return [...derived.cableInfo.values()]
    .map((ci) => {
      const k = ci.cable;
      return {
        cableId: k.id,
        label: k.label,
        kind: cableKindLabel(k.kind),
        type: k.kind === 'cable' ? k.type || k.part?.data?.type || '' : '',
        part: k.part?.partNumber || '',
        cores: k.kind === 'cable' ? k.cores || ci.cores.length : ci.members.length,
        shield: !!k.shield,
        members: ci.members.map((w) => `${w.label} ${wireColorLabel(w)}${w.cableRole === 'shield' ? ' (S)' : ''}`).join(', '),
        layLength: k.kind === 'twist' ? k.layLength : null,
        twistFactor: ci.twistFactor,
        outerDiameter: ci.outerDiameter ? Math.round(ci.outerDiameter * 10) / 10 : null,
        length: ci.length === null ? null : Math.round(ci.length),
      };
    })
    .sort((a, b) => natural(a.label, b.label));
}

export function bomRows(derived, exploded = false) {
  return (exploded ? derived.bomExploded : derived.bom).map((b) => ({
    pos: b.pos,
    group: bomGroupLabel(b.group),
    partNumber: b.partNumber,
    manufacturer: b.manufacturer,
    description: b.description,
    qty: b.qty,
    unit: unitLabel(b.unit),
    isMetre: b.unit === 'm',
    refs: [...new Set(b.refs)].sort(natural).join(', '),
    notes: b.notes,
    unassigned: !!b.unassigned,
  }));
}
