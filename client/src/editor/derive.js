// Derived data: routing through the layout, wire lengths, circuits, cables, sub-harnesses,
// bill of materials and design checks
import {
  colorByCode, wireColorLabel, wireColorName, outerDiameter, terminalSubtype, deviceSubtypes, coveringSubtypes, fmtCs, fmtNum,
  interfaceComponents, normalizeDoc, partDescription, cableKindLabel,
} from './model.js';
import { SCH, schBox } from './geometry.js';
import { t } from '../i18n/index.js';

export const SUB_HEAD = 38;
const SUB_W = SCH.connW + 16;

/** Union-find over pin ids */
function makeUnionFind() {
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
  return { find, union };
}

/** Internal connectivity of a child document: child pin id -> net root */
function childNets(doc) {
  const uf = makeUnionFind();
  const pinSet = new Set(doc.components.flatMap((c) => c.pins.map((p) => p.id)));
  for (const w of doc.wires) if (pinSet.has(w.from?.p) && pinSet.has(w.to?.p)) uf.union(w.from.p, w.to.p);
  const byId = new Map(doc.components.map((c) => [c.id, c]));
  for (const c of doc.components) {
    const m = c.mateId && byId.get(c.mateId);
    if (!m) continue;
    for (const p of c.pins) {
      const q = m.pins.find((mp) => mp.name === p.name);
      if (q) uf.union(p.id, q.id);
    }
  }
  return uf;
}

/**
 * @param doc    normalized harness document
 * @param embeds Map(harnessId -> { name, data, missing }) of embedded sub-harnesses (may be empty)
 */
export function derive(doc, embeds = new Map(), depth = 0) {
  const comps = new Map();
  const pins = new Map(); // pinId -> { comp, pin, index }
  for (const c of doc.components) {
    comps.set(c.id, c);
    c.pins.forEach((p, i) => pins.set(p.id, { comp: c, pin: p, index: i }));
  }

  // ---------- Embedded sub-harnesses: virtual interface components ----------
  const subs = new Map();
  for (const S of doc.components) {
    if (S.type !== 'subharness') continue;
    const e = embeds.get(Number(S.ref?.harnessId));
    if (!e || e.missing || !e.data) {
      subs.set(S.id, { S, missing: true, virtuals: [], box: { x: S.sch.x, y: S.sch.y, w: SUB_W, h: SUB_HEAD + 24 } });
      continue;
    }
    const child = e.doc || (e.doc = normalizeDoc(structuredClone(e.data)));
    let y = S.sch.y + SUB_HEAD;
    const virtuals = interfaceComponents(child).map((X) => {
      const v = {
        id: `${S.id}::${X.id}`,
        type: 'connector',
        origType: X.type,
        virtual: true,
        subId: S.id,
        childId: X.id,
        label: `${S.label}/${X.label}`,
        shortLabel: X.label,
        part: X.part,
        subtype: X.subtype,
        pins: X.pins.map((p) => ({ ...p, id: `${S.id}::${p.id}`, childPinId: p.id })),
        sch: { x: S.sch.x + 8, y },
        lay: S.lay,
        mateId: null,
        show: {},
        callouts: {},
      };
      y += schBox(v).h + 8;
      return v;
    });
    for (const v of virtuals) {
      comps.set(v.id, v);
      v.pins.forEach((p, i) => pins.set(p.id, { comp: v, pin: p, index: i }));
    }
    subs.set(S.id, { S, child, name: e.name, virtuals, box: { x: S.sch.x, y: S.sch.y, w: SUB_W, h: Math.max(y - S.sch.y + 2, SUB_HEAD + 24) } });
  }

  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const segs = new Map(doc.segments.map((s) => [s.id, s]));
  const cablesById = new Map((doc.cables || []).map((k) => [k.id, k]));

  // layout graph node of a component (virtual components live in their sub-harness node)
  const gnode = (id) => comps.get(id)?.subId || id;
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
    return n.label || `${t('Branch')} ${doc.nodes.indexOf(n) + 1}`;
  };

  // Wires per pin
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

  // ---------- Graph from segments ----------
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
  function route(fromComp, toComp) {
    const a = gnode(fromComp);
    const b = gnode(toComp);
    if (a === b) return { segIds: [], nodeIds: [a], length: 0 };
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (routeCache.has(key)) {
      const r = routeCache.get(key);
      if (!r) return null;
      return a < b ? r : { ...r, nodeIds: [...r.nodeIds].reverse(), segIds: [...r.segIds].reverse() };
    }
    // Dijkstra (small graphs)
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
        // Wires pass branch points and splices/devices lying in the bundle,
        // but never run through connectors, terminals or sub-harnesses (those are wire ends)
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

  // ---------- Twist factor ----------
  // Extra length of twisted wires: sqrt(1 + (π·d / lay length)²), d ≈ wire outer diameter
  const twistFactor = new Map();
  for (const k of doc.cables || []) {
    if (k.kind !== 'twist' || !(Number(k.layLength) > 0)) continue;
    const members = validWires.filter((w) => w.cableId === k.id);
    if (!members.length) continue;
    const d = members.reduce((a, w) => a + outerDiameter(w), 0) / members.length;
    twistFactor.set(k.id, Math.sqrt(1 + ((Math.PI * d) / Number(k.layLength)) ** 2));
  }

  // ---------- Wire lengths ----------
  const s = doc.settings || {};
  const extraPerEnd = Number(s.extraPerEnd) || 0;
  const extraPercent = Number(s.extraPercent) || 0;
  const wireInfo = new Map();
  const segWires = new Map(doc.segments.map((sg) => [sg.id, []]));
  for (const w of validWires) {
    const fa = pins.get(w.from.p);
    const tb = pins.get(w.to.p);
    const r = route(w.from.c, w.to.c);
    const overridden = w.lengthOverride !== null && w.lengthOverride !== undefined && w.lengthOverride !== '';
    const tf = (w.cableId && twistFactor.get(w.cableId)) || 1;
    let total = null;
    if (overridden) total = Number(w.lengthOverride);
    else if (r) total = r.length * (1 + extraPercent / 100) * tf + 2 * extraPerEnd + (Number(w.lengthExtra) || 0);
    if (r) for (const sid of r.segIds) segWires.get(sid)?.push(w.id);
    wireInfo.set(w.id, {
      wire: w,
      from: fa,
      to: tb,
      route: r,
      routed: !!r,
      baseLength: r ? r.length : null,
      length: total,
      overridden,
      twistFactor: tf,
      cable: w.cableId ? cablesById.get(w.cableId) || null : null,
      signal: w.signal || fa.pin.fn || tb.pin.fn || '',
    });
  }

  // ---------- Cables ----------
  const cableInfo = new Map();
  for (const k of doc.cables || []) {
    const members = validWires.filter((w) => w.cableId === k.id);
    const lengths = members.map((w) => wireInfo.get(w.id).length).filter((l) => l !== null);
    const coreOds = members.filter((w) => w.cableRole !== 'shield').map((w) => outerDiameter(w));
    const od =
      Number(k.outerDiameter) ||
      Number(k.part?.data?.outerDiameter) ||
      (coreOds.length ? Math.sqrt(coreOds.reduce((a, d) => a + d * d, 0)) * 1.2 + 1.2 : 0);
    const ends = new Set(members.map((w) => [w.from.c, w.to.c].sort().join('|')));
    cableInfo.set(k.id, {
      cable: k,
      members,
      cores: members.filter((w) => w.cableRole !== 'shield'),
      length: lengths.length ? Math.max(...lengths) : null,
      unrouted: members.some((w) => wireInfo.get(w.id).length === null),
      outerDiameter: od,
      odEstimated: !(Number(k.outerDiameter) || Number(k.part?.data?.outerDiameter)),
      twistFactor: twistFactor.get(k.id) || 1,
      mixedEnds: ends.size > 1,
    });
  }

  // ---------- Circuits (nets) ----------
  const uf = makeUnionFind();
  for (const w of validWires) uf.union(w.from.p, w.to.p);
  const matePairs = [];
  const allConnectors = [...comps.values()].filter((c) => c.type === 'connector');
  for (const c of doc.components) {
    if (c.type !== 'connector' || !c.mateId) continue;
    const m = comps.get(c.mateId);
    if (!m) continue;
    if (!m.virtual && m.id < c.id && m.mateId === c.id) continue; // each real pair once
    matePairs.push([c, m]);
    for (const p of c.pins) {
      const q = m.pins.find((mp) => mp.name === p.name);
      if (q) uf.union(p.id, q.id);
    }
  }
  // continuity through sub-harnesses
  for (const sub of subs.values()) {
    if (sub.missing) continue;
    const cn = childNets(sub.child);
    const groups = new Map();
    for (const v of sub.virtuals) {
      for (const p of v.pins) {
        const root = cn.find(p.childPinId);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(p.id);
      }
    }
    for (const g of groups.values()) for (let i = 1; i < g.length; i++) uf.union(g[0], g[i]);
  }
  const netOf = (pinId) => uf.find(pinId);

  // ---------- Segment info ----------
  const segInfo = new Map();
  for (const sg of doc.segments) {
    const ids = segWires.get(sg.id) || [];
    const ods = [];
    const cablesHere = new Set();
    for (const id of ids) {
      const w = wireInfo.get(id).wire;
      const k = w.cableId && cablesById.get(w.cableId);
      if (k && k.kind === 'cable') cablesHere.add(k.id);
      else ods.push(outerDiameter(w));
    }
    for (const kid of cablesHere) ods.push(cableInfo.get(kid).outerDiameter);
    const bundle = ods.length ? Math.sqrt(ods.reduce((a, d) => a + d * d, 0)) * 1.15 : 0;
    segInfo.set(sg.id, { wires: ids, cables: [...cablesHere], bundleDiameter: bundle, fromLabel: nodeLabel(sg.a), toLabel: nodeLabel(sg.b) });
  }

  // ---------- Bill of materials ----------
  const bomMap = new Map();
  const addBom = (key, item, qty, ref) => {
    if (!bomMap.has(key)) bomMap.set(key, { ...item, key, qty: 0, refs: [], notes: new Set() });
    const b = bomMap.get(key);
    b.qty += qty;
    if (ref) b.refs.push(ref);
    return b;
  };
  for (const c of doc.components) {
    if (c.excludeFromBom) continue;
    const p = c.part;
    const desc = p ? partDescription(p) : '';
    if (c.type === 'connector') {
      if (p) {
        addBom(`c:${p.partNumber}|${p.manufacturer}|${p.description}`, {
          group: 'connector', partNumber: p.partNumber, manufacturer: p.manufacturer, description: desc, unit: 'pcs',
        }, 1, c.label);
        const d = p.data || {};
        const used = c.pins.filter((pin) => (pinWires.get(pin.id) || []).length > 0).length;
        if (d.contactPart && used > 0) {
          const kind = d.gender === 'male' ? t('Pin contact') : d.gender === 'female' ? t('Socket contact') : t('Contact');
          addBom(`k:${d.contactPart}`, {
            group: 'contact', partNumber: d.contactPart, manufacturer: p.manufacturer,
            description: `${kind}${d.series ? ` ${d.series}` : ''}${d.contactRange ? `, ${d.contactRange}` : ''}`, unit: 'pcs',
          }, used, c.label);
        }
        if (d.sealPart && used > 0) {
          addBom(`s:${d.sealPart}`, {
            group: 'lock', partNumber: d.sealPart, manufacturer: p.manufacturer,
            description: `${t('Single wire seal')}${d.series ? ` ${d.series}` : ''}`, unit: 'pcs',
          }, used, c.label);
        }
        if (d.lockPart) {
          addBom(`l:${d.lockPart}`, {
            group: 'lock', partNumber: d.lockPart, manufacturer: p.manufacturer,
            description: `${t('Secondary lock / accessory')}${d.series ? ` ${d.series}` : ''}`, unit: 'pcs',
          }, 1, c.label);
        }
      } else {
        addBom(`cg:${c.pins.length}`, {
          group: 'connector', partNumber: '', manufacturer: '',
          description: t('Connector {n}-way (no part assigned)', { n: c.pins.length }), unit: 'pcs', unassigned: true,
        }, 1, c.label);
      }
    } else if (c.type === 'terminal') {
      if (c.subtype === 'loose_end' && !p) continue;
      addBom(p ? `t:${p.partNumber}|${p.description}` : `tg:${c.subtype}`, {
        group: 'terminal', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p ? desc : t('{name} (no part assigned)', { name: terminalSubtype(c.subtype).label }), unit: 'pcs', unassigned: !p,
      }, 1, c.label);
    } else if (c.type === 'splice') {
      addBom(p ? `s:${p.partNumber}|${p.description}` : 'sg', {
        group: 'splice', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p ? desc : t('{name} (no part assigned)', { name: t('Splice') }), unit: 'pcs', unassigned: !p,
      }, 1, c.label);
    } else if (c.type === 'device') {
      const st = deviceSubtypes().find((d) => d.value === c.subtype);
      addBom(p ? `d:${p.partNumber}|${p.description}` : `dg:${c.subtype}|${c.value || ''}`, {
        group: 'device', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: p ? desc : `${st?.label || t('Device')}${c.value ? ` ${c.value}` : ''}`, unit: 'pcs', unassigned: !p,
      }, 1, c.label);
    } else if (c.type === 'subharness') {
      const sub = subs.get(c.id);
      addBom(`a:${c.ref?.harnessId}`, {
        group: 'assembly', partNumber: '', manufacturer: '',
        description: t('Sub-harness "{name}"', { name: sub?.name || c.ref?.name || '?' }), unit: 'pcs', harnessId: c.ref?.harnessId,
      }, 1, c.label);
    }
  }
  for (const w of validWires) {
    const info = wireInfo.get(w.id);
    const k = info.cable;
    if (k && k.kind === 'cable') continue; // material is the cable itself
    const b = addBom(`w:${w.type}|${w.cs}|${wireColorLabel(w)}`, {
      group: 'wire', partNumber: w.part?.partNumber || '', manufacturer: w.part?.manufacturer || '',
      description: `${w.type || t('Wire')} ${fmtCs(w.cs)} ${wireColorName(w)}`, unit: 'm',
    }, info.length ? info.length / 1000 : 0, w.label);
    if (info.length === null) b.notes.add(t('without length'));
    if (k && k.kind === 'twist') b.notes.add(t('twisted'));
  }
  for (const k of doc.cables || []) {
    if (k.kind !== 'cable' || k.excludeFromBom) continue;
    const ci = cableInfo.get(k.id);
    if (!ci.members.length) continue;
    const p = k.part;
    const typeText = k.type || p?.data?.type || t('Cable');
    const cores = k.cores || ci.cores.length;
    const cs = ci.cores[0]?.cs;
    const b = addBom(p ? `kb:${p.partNumber}|${p.description}` : `kbg:${typeText}|${cores}|${cs}|${k.shield ? 1 : 0}`, {
      group: 'cable', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
      description: p ? partDescription(p) : `${typeText} ${cores} × ${fmtCs(cs)}${k.shield ? `, ${t('shielded')}` : ''}`, unit: 'm',
    }, ci.length ? ci.length / 1000 : 0, k.label);
    if (ci.length === null) b.notes.add(t('without length'));
  }
  for (const sg of doc.segments) {
    for (const cov of sg.coverings || []) {
      const p = cov.part;
      const st = coveringSubtypes().find((x) => x.value === p?.data?.subtype);
      addBom(`v:${p?.partNumber || ''}|${p?.description || cov.label || ''}`, {
        group: 'covering', partNumber: p?.partNumber || '', manufacturer: p?.manufacturer || '',
        description: (p && partDescription(p)) || cov.label || st?.label || t('Covering'), unit: 'm',
      }, (Number(sg.length) || 0) / 1000, `${nodeLabel(sg.a)}–${nodeLabel(sg.b)}`);
    }
  }

  const finishBom = (map) =>
    [...map.values()]
      .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || (a.partNumber || a.description).localeCompare(b.partNumber || b.description, undefined, { numeric: true }))
      .map((b, i) => ({ ...b, pos: i + 1, notes: [...b.notes].join(', '), qty: b.unit === 'm' ? Math.round(b.qty * 1000) / 1000 : b.qty }));
  const bom = finishBom(bomMap);

  // Exploded BOM: sub-harness assemblies replaced by their (recursive) content
  const explodedMap = new Map();
  for (const [key, b] of bomMap) if (b.group !== 'assembly') explodedMap.set(key, { ...b, refs: [...b.refs], notes: new Set(b.notes) });
  const childDerived = new Map();
  if (depth < 8) {
    for (const sub of subs.values()) {
      if (sub.missing || sub.S.excludeFromBom) continue;
      const hid = Number(sub.S.ref.harnessId);
      if (!childDerived.has(hid)) childDerived.set(hid, derive(sub.child, embeds, depth + 1));
      for (const item of childDerived.get(hid).bomExploded) {
        const key = item.key;
        if (!explodedMap.has(key)) explodedMap.set(key, { ...item, qty: 0, refs: [], notes: new Set() });
        const tgt = explodedMap.get(key);
        tgt.qty += item.qty;
        tgt.refs.push(...item.refs.map((r) => `${sub.S.label}/${r}`));
        if (item.notes) String(item.notes).split(', ').filter(Boolean).forEach((n) => tgt.notes.add(n));
      }
    }
  }
  const bomExploded = finishBom(explodedMap);

  // ---------- Design checks ----------
  const warnings = [];
  const labelCount = new Map();
  for (const c of doc.components) labelCount.set(c.label, (labelCount.get(c.label) || 0) + 1);
  for (const [label, n] of labelCount) if (n > 1) warnings.push({ level: 'warn', text: t('Designation "{label}" is used {n} times.', { label, n }) });
  const inLayout = new Set();
  for (const sg of doc.segments) {
    inLayout.add(sg.a);
    inLayout.add(sg.b);
  }
  for (const w of validWires) {
    const info = wireInfo.get(w.id);
    if (!info.routed && !info.overridden) {
      const miss = [info.from.comp, info.to.comp].filter((c) => !inLayout.has(gnode(c.id))).map((c) => c.label);
      warnings.push({
        level: 'warn',
        wireId: w.id,
        text: miss.length
          ? t('{wire}: {names} not connected in the layout – no length.', { wire: w.label, names: miss.join(' + ') })
          : t('{wire}: no path in the layout between {a} and {b} – no length.', { wire: w.label, a: info.from.comp.label, b: info.to.comp.label }),
      });
    }
  }
  for (const sg of doc.segments) {
    if (!(Number(sg.length) > 0)) warnings.push({ level: 'warn', segmentId: sg.id, text: t('Segment {a} – {b} has no length.', { a: nodeLabel(sg.a), b: nodeLabel(sg.b) }) });
  }
  for (const [a, b] of matePairs) {
    if (a.pins.length !== b.pins.length) {
      warnings.push({ level: 'warn', text: t('Mated pair {a} ⇄ {b}: different number of pins ({n} / {m}).', { a: a.label, b: b.label, n: a.pins.length, m: b.pins.length }) });
    }
    const namesB = new Set(b.pins.map((p) => p.name));
    const missing = a.pins.filter((p) => !namesB.has(p.name)).map((p) => p.name);
    if (missing.length) warnings.push({ level: 'warn', text: t('Mated pair {a} ⇄ {b}: pins {pins} without counterpart.', { a: a.label, b: b.label, pins: missing.join(', ') }) });
  }
  for (const c of doc.components) {
    if (c.type === 'connector' && c.mateId && !comps.has(c.mateId)) {
      warnings.push({ level: 'warn', text: t('{name}: the mated connector no longer exists (e.g. removed from the sub-harness).', { name: c.label }) });
    }
    if (c.type === 'subharness') {
      const sub = subs.get(c.id);
      if (sub?.missing) warnings.push({ level: 'warn', text: t('{name}: the embedded harness is not available (deleted or no access).', { name: c.label }) });
      continue;
    }
    const n = c.pins.reduce((a, p) => a + (pinWires.get(p.id) || []).length, 0);
    if (n === 0 && !c.mateId) warnings.push({ level: 'info', text: t('{name}: no wire connected.', { name: c.label }) });
    if (c.type === 'connector') {
      for (const p of c.pins) {
        const k = (pinWires.get(p.id) || []).length;
        if (k > 1) warnings.push({ level: 'info', text: t('{name}.{pin}: {n} wires on one contact (double crimp).', { name: c.label, pin: p.name, n: k }) });
      }
    }
    if ((c.type === 'connector' || c.type === 'terminal') && !c.part && !c.excludeFromBom && !(c.type === 'terminal' && c.subtype === 'loose_end')) {
      warnings.push({ level: 'info', text: t('{name}: no library part assigned.', { name: c.label }) });
    }
  }
  for (const ci of cableInfo.values()) {
    const k = ci.cable;
    if (!ci.members.length) warnings.push({ level: 'warn', text: t('{name}: {kind} without wires.', { name: k.label, kind: cableKindLabel(k.kind) }) });
    if (k.kind === 'cable' && k.cores && ci.cores.length > k.cores) {
      warnings.push({ level: 'warn', text: t('{name}: {n} cores assigned, but the cable only has {m}.', { name: k.label, n: ci.cores.length, m: k.cores }) });
    }
    if (k.kind === 'twist' && ci.members.length !== 2) warnings.push({ level: 'info', text: t('{name}: twisted group with {n} wires.', { name: k.label, n: ci.members.length }) });
    if (k.kind === 'cable' && ci.mixedEnds) warnings.push({ level: 'info', text: t('{name}: cores end at different components (break-out).', { name: k.label }) });
  }

  return {
    comps, pins, nodes, segs, subs, pinWires, wireInfo, segInfo, cableInfo, layoutPos, nodeLabel, route, gnode,
    netOf, matePairs, bom, bomExploded, warnings, inLayout, validWires, allConnectors,
  };
}

const GROUP_ORDER = { assembly: 0, connector: 1, contact: 2, lock: 3, terminal: 4, splice: 5, device: 6, wire: 7, cable: 8, covering: 9 };
export const bomGroupLabel = (g) =>
  ({
    assembly: t('Assemblies'),
    connector: t('Connectors'),
    contact: t('Contacts'),
    lock: t('Accessories'),
    terminal: t('Terminals'),
    splice: t('Splices'),
    device: t('Devices'),
    wire: t('Wires'),
    cable: t('Multi-core cables'),
    covering: t('Coverings'),
  })[g] || g;
export const unitLabel = (u) => (u === 'pcs' ? t('pcs') : u);

// Destination of a wire seen from a pin (for wire tables)
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
  if (comp.type === 'terminal' || comp.type === 'splice' || comp.origType === 'terminal' || comp.origType === 'splice') return comp.label;
  return `${comp.label}.${pin.name}`;
}

export function wireHex(w) {
  return colorByCode(w.color).hex;
}

export { fmtNum, SUB_W };
