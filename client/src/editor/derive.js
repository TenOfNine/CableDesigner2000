// Abgeleitete Daten: Routing durch das Layout, Aderlängen, Stromkreise, Stückliste, Prüfhinweise
import {
  colorByCode, wireColorLabel, wireColorName, outerDiameter, terminalSubtype, DEVICE_SUBTYPES, COVERING_SUBTYPES, fmtCs, fmtNum,
} from './model.js';

export function derive(doc) {
  const comps = new Map();
  const pins = new Map(); // pinId -> { comp, pin, index }
  for (const c of doc.components) {
    comps.set(c.id, c);
    c.pins.forEach((p, i) => pins.set(p.id, { comp: c, pin: p, index: i }));
  }
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const segs = new Map(doc.segments.map((s) => [s.id, s]));

  const layoutPos = (id) => {
    const c = comps.get(id);
    if (c) return c.lay;
    const n = nodes.get(id);
    return n ? { x: n.x, y: n.y } : null;
  };
  const nodeLabel = (id) => {
    const c = comps.get(id);
    if (c) return c.label;
    const n = nodes.get(id);
    if (!n) return '?';
    return n.label || `Abzweig ${doc.nodes.indexOf(n) + 1}`;
  };

  // Leitungen je Pin
  const pinWires = new Map();
  const addPW = (pid, w) => {
    if (!pinWires.has(pid)) pinWires.set(pid, []);
    pinWires.get(pid).push(w);
  };
  const validWires = [];
  for (const w of doc.wires) {
    if (!pins.has(w.from?.p) || !pins.has(w.to?.p)) continue;
    validWires.push(w);
    addPW(w.from.p, w);
    addPW(w.to.p, w);
  }

  // ---------- Graph aus Segmenten ----------
  const adj = new Map();
  const addAdj = (a, b, s) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, seg: s });
  };
  for (const s of doc.segments) {
    if (!layoutPos(s.a) || !layoutPos(s.b)) continue;
    addAdj(s.a, s.b, s);
    addAdj(s.b, s.a, s);
  }

  const routeCache = new Map();
  function route(a, b) {
    if (a === b) return { segIds: [], nodeIds: [a], length: 0 };
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (routeCache.has(key)) {
      const r = routeCache.get(key);
      if (!r) return null;
      return a < b ? r : { ...r, nodeIds: [...r.nodeIds].reverse(), segIds: [...r.segIds].reverse() };
    }
    // Dijkstra (kleine Graphen)
    const dist = new Map([[a, 0]]);
    const prev = new Map();
    const done = new Set();
    const queue = [a];
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (dist.get(queue[i]) < dist.get(queue[bi])) bi = i;
      const u = queue.splice(bi, 1)[0];
      if (done.has(u)) continue;
      done.add(u);
      if (u === b) break;
      for (const e of adj.get(u) || []) {
        if (done.has(e.to)) continue;
        // Leitungen laufen über Abzweigpunkte sowie an im Bündel liegenden Spleißen/Bauelementen vorbei –
        // aber nicht durch Steckverbinder oder Terminals hindurch (das sind Leitungsenden)
        if (e.to !== b && comps.has(e.to) && !['splice', 'device'].includes(comps.get(e.to).type)) continue;
        const nd = dist.get(u) + (Number(e.seg.length) || 0) + 1e-3;
        if (!dist.has(e.to) || nd < dist.get(e.to)) {
          dist.set(e.to, nd);
          prev.set(e.to, { from: u, seg: e.seg });
          queue.push(e.to);
        }
      }
    }
    let result = null;
    if (dist.has(b)) {
      const segIds = [];
      const nodeIds = [b];
      let cur = b;
      let length = 0;
      while (cur !== a) {
        const p = prev.get(cur);
        segIds.unshift(p.seg.id);
        length += Number(p.seg.length) || 0;
        cur = p.from;
        nodeIds.unshift(cur);
      }
      result = { segIds, nodeIds, length };
    }
    const canonical = result && a > b ? { ...result, nodeIds: [...result.nodeIds].reverse(), segIds: [...result.segIds].reverse() } : result;
    routeCache.set(key, canonical);
    return result;
  }

  // ---------- Leitungslängen ----------
  const s = doc.settings || {};
  const extraPerEnd = Number(s.extraPerEnd) || 0;
  const extraPercent = Number(s.extraPercent) || 0;
  const wireInfo = new Map();
  const segWires = new Map(doc.segments.map((sg) => [sg.id, []]));
  for (const w of validWires) {
    const fa = pins.get(w.from.p);
    const tb = pins.get(w.to.p);
    const r = route(w.from.c, w.to.c);
    let total = null;
    if (w.lengthOverride !== null && w.lengthOverride !== undefined && w.lengthOverride !== '') {
      total = Number(w.lengthOverride);
    } else if (r) {
      total = r.length * (1 + extraPercent / 100) + 2 * extraPerEnd + (Number(w.lengthExtra) || 0);
    }
    if (r) for (const sid of r.segIds) segWires.get(sid)?.push(w.id);
    wireInfo.set(w.id, {
      wire: w,
      from: fa,
      to: tb,
      route: r,
      routed: !!r,
      baseLength: r ? r.length : null,
      length: total,
      overridden: w.lengthOverride !== null && w.lengthOverride !== undefined && w.lengthOverride !== '',
      signal: w.signal || fa.pin.fn || tb.pin.fn || '',
    });
  }

  // ---------- Stromkreise (Netze) ----------
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r);
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c);
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const w of validWires) union(w.from.p, w.to.p);
  const matePairs = [];
  for (const c of doc.components) {
    if (c.type !== 'connector' || !c.mateId) continue;
    const m = comps.get(c.mateId);
    if (!m || m.id < c.id) continue; // jedes Paar einmal
    matePairs.push([c, m]);
    for (const p of c.pins) {
      const q = m.pins.find((mp) => mp.name === p.name);
      if (q) union(p.id, q.id);
    }
  }
  const netOf = (pinId) => find(pinId);
  const netWires = new Map();
  for (const w of validWires) {
    const n = find(w.from.p);
    if (!netWires.has(n)) netWires.set(n, []);
    netWires.get(n).push(w.id);
  }

  // ---------- Segment-Infos ----------
  const segInfo = new Map();
  for (const sg of doc.segments) {
    const ids = segWires.get(sg.id) || [];
    const ods = ids.map((id) => outerDiameter(wireInfo.get(id).wire));
    const bundle = ods.length ? Math.sqrt(ods.reduce((a, d) => a + d * d, 0)) * 1.15 : 0;
    segInfo.set(sg.id, {
      wires: ids,
      bundleDiameter: bundle,
      fromLabel: nodeLabel(sg.a),
      toLabel: nodeLabel(sg.b),
    });
  }

  // ---------- Stückliste ----------
  const bomMap = new Map();
  const addBom = (key, item, qty, ref) => {
    if (!bomMap.has(key)) bomMap.set(key, { ...item, qty: 0, refs: [], notes: new Set() });
    const b = bomMap.get(key);
    b.qty += qty;
    if (ref) b.refs.push(ref);
    return b;
  };
  const ORDER = { connector: 1, contact: 2, lock: 3, terminal: 4, splice: 5, device: 6, wire: 7, covering: 8 };
  for (const c of doc.components) {
    if (c.excludeFromBom) continue;
    const p = c.part;
    if (c.type === 'connector') {
      if (p) {
        addBom(`c:${p.partNumber}|${p.manufacturer}|${p.description}`, {
          group: 'connector', groupLabel: 'Steckverbinder', partNumber: p.partNumber, manufacturer: p.manufacturer,
          description: p.description, unit: 'Stk',
        }, 1, c.label);
        const d = p.data || {};
        const used = c.pins.filter((pin) => (pinWires.get(pin.id) || []).length > 0).length;
        if (d.contactPart && used > 0) {
          addBom(`k:${d.contactPart}`, {
            group: 'contact', groupLabel: 'Kontakte', partNumber: d.contactPart, manufacturer: p.manufacturer,
            description: `${d.gender === 'male' ? 'Stiftkontakt' : d.gender === 'female' ? 'Buchsenkontakt' : 'Kontakt'}${d.series ? ` ${d.series}` : ''}${d.contactRange ? `, ${d.contactRange}` : ''}`,
            unit: 'Stk',
          }, used, c.label);
        }
        if (d.lockPart) {
          addBom(`l:${d.lockPart}`, {
            group: 'lock', groupLabel: 'Zubehör', partNumber: d.lockPart, manufacturer: p.manufacturer,
            description: `Sekundärverriegelung/Zubehör${d.series ? ` ${d.series}` : ''}`, unit: 'Stk',
          }, 1, c.label);
        }
      } else {
        addBom(`cg:${c.pins.length}`, {
          group: 'connector', groupLabel: 'Steckverbinder', partNumber: '', manufacturer: '',
          description: `Steckverbinder ${c.pins.length}-polig (kein Teil zugeordnet)`, unit: 'Stk', unassigned: true,
        }, 1, c.label);
      }
    } else if (c.type === 'terminal') {
      if (c.subtype === 'loose_end' && !p) continue;
      addBom(p ? `t:${p.partNumber}|${p.description}` : `tg:${c.subtype}`, {
        group: 'terminal', groupLabel: 'Terminals', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p ? p.description : `${terminalSubtype(c.subtype).label} (kein Teil zugeordnet)`, unit: 'Stk', unassigned: !p,
      }, 1, c.label);
    } else if (c.type === 'splice') {
      addBom(p ? `s:${p.partNumber}|${p.description}` : 'sg', {
        group: 'splice', groupLabel: 'Spleiße', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p ? p.description : 'Spleiß (kein Teil zugeordnet)', unit: 'Stk', unassigned: !p,
      }, 1, c.label);
    } else if (c.type === 'device') {
      const st = DEVICE_SUBTYPES.find((d) => d.value === c.subtype);
      addBom(p ? `d:${p.partNumber}|${p.description}` : `dg:${c.subtype}|${c.value || ''}`, {
        group: 'device', groupLabel: 'Bauelemente', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p ? p.description : `${st?.label || 'Bauelement'}${c.value ? ` ${c.value}` : ''}`, unit: 'Stk', unassigned: !p,
      }, 1, c.label);
    }
  }
  for (const w of validWires) {
    const info = wireInfo.get(w.id);
    const b = addBom(`w:${w.type}|${w.cs}|${wireColorLabel(w)}`, {
      group: 'wire', groupLabel: 'Leitungen', partNumber: w.part?.partNumber || '', manufacturer: w.part?.manufacturer || '',
      description: `${w.type || 'Leitung'} ${fmtCs(w.cs)} ${wireColorName(w)}`, unit: 'm',
    }, info.length ? info.length / 1000 : 0, w.label);
    if (info.length === null) b.notes.add('ohne Länge');
  }
  for (const sg of doc.segments) {
    for (const cov of sg.coverings || []) {
      const p = cov.part;
      const st = COVERING_SUBTYPES.find((x) => x.value === p?.data?.subtype);
      addBom(`v:${p?.partNumber || ''}|${p?.description || cov.label || ''}`, {
        group: 'covering', groupLabel: 'Ummantelungen', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p?.description || cov.label || st?.label || 'Ummantelung', unit: 'm',
      }, (Number(sg.length) || 0) / 1000, `${nodeLabel(sg.a)}–${nodeLabel(sg.b)}`);
    }
  }
  const bom = [...bomMap.values()]
    .sort((a, b) => ORDER[a.group] - ORDER[b.group] || (a.partNumber || a.description).localeCompare(b.partNumber || b.description, 'de'))
    .map((b, i) => ({ ...b, pos: i + 1, notes: [...b.notes].join(', '), qty: b.unit === 'm' ? Math.round(b.qty * 1000) / 1000 : b.qty }));

  // ---------- Prüfhinweise ----------
  const warnings = [];
  const labelCount = new Map();
  for (const c of doc.components) labelCount.set(c.label, (labelCount.get(c.label) || 0) + 1);
  for (const [label, n] of labelCount) if (n > 1) warnings.push({ level: 'warn', text: `Bezeichnung „${label}“ ist ${n}× vergeben.` });
  const inLayout = new Set();
  for (const sg of doc.segments) {
    inLayout.add(sg.a);
    inLayout.add(sg.b);
  }
  for (const w of validWires) {
    const info = wireInfo.get(w.id);
    if (!info.routed && !info.overridden) {
      const miss = [info.from.comp, info.to.comp].filter((c) => !inLayout.has(c.id)).map((c) => c.label);
      warnings.push({
        level: 'warn',
        wireId: w.id,
        text: miss.length
          ? `${w.label}: ${miss.join(' und ')} ${miss.length > 1 ? 'sind' : 'ist'} im Layout nicht angebunden – keine Länge.`
          : `${w.label}: kein Weg im Layout zwischen ${info.from.comp.label} und ${info.to.comp.label} – keine Länge.`,
      });
    }
  }
  for (const sg of doc.segments) {
    if (!(Number(sg.length) > 0)) warnings.push({ level: 'warn', segmentId: sg.id, text: `Segment ${nodeLabel(sg.a)} – ${nodeLabel(sg.b)} hat keine Länge.` });
  }
  for (const [a, b] of matePairs) {
    if (a.pins.length !== b.pins.length) {
      warnings.push({ level: 'warn', text: `Steckverbinderpaar ${a.label} ⇄ ${b.label}: unterschiedliche Polzahl (${a.pins.length} / ${b.pins.length}).` });
    }
    const namesB = new Set(b.pins.map((p) => p.name));
    const missing = a.pins.filter((p) => !namesB.has(p.name)).map((p) => p.name);
    if (missing.length) warnings.push({ level: 'warn', text: `Steckverbinderpaar ${a.label} ⇄ ${b.label}: Pins ${missing.join(', ')} ohne Gegenstück.` });
  }
  for (const c of doc.components) {
    const n = c.pins.reduce((a, p) => a + (pinWires.get(p.id) || []).length, 0);
    if (n === 0) warnings.push({ level: 'info', text: `${c.label}: keine Leitung angeschlossen.` });
    if (c.type === 'connector') {
      for (const p of c.pins) {
        const k = (pinWires.get(p.id) || []).length;
        if (k > 1) warnings.push({ level: 'info', text: `${c.label}.${p.name}: ${k} Leitungen an einem Kontakt (Doppelanschlag).` });
      }
    }
    if ((c.type === 'connector' || c.type === 'terminal') && !c.part && !c.excludeFromBom && !(c.type === 'terminal' && c.subtype === 'loose_end')) {
      warnings.push({ level: 'info', text: `${c.label}: kein Bibliotheksteil zugeordnet.` });
    }
  }

  return {
    comps, pins, nodes, segs, pinWires, wireInfo, segInfo, layoutPos, nodeLabel, route,
    netOf, netWires, matePairs, bom, warnings, inLayout, validWires,
  };
}

// Ziel-Beschreibung einer Leitung aus Sicht eines Pins (für Leitungstabellen)
export function wireEndsFor(derived, compId, pinId) {
  const out = [];
  for (const w of derived.pinWires.get(pinId) || []) {
    const info = derived.wireInfo.get(w.id);
    const other = w.from.p === pinId && w.from.c === compId ? info.to : info.from;
    out.push({ wire: w, info, other });
  }
  return out;
}

export function pinRef(end) {
  if (!end) return '';
  const { comp, pin } = end;
  if (comp.type === 'terminal' || comp.type === 'splice') return comp.label;
  return `${comp.label}.${pin.name}`;
}

export function wireHex(w) {
  return colorByCode(w.color).hex;
}

export { fmtNum };
