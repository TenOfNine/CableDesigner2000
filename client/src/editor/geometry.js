// Geometry for schematic and layout views

// ---------- Schematic ----------
export const SCH = {
  connW: 184,
  headH: 30,
  rowH: 22,
  termW: 164,
  termH: 28,
  spliceR: 8,
  devW: 84,
  devH: 38,
  grid: 10,
};

// `derived` is needed for sub-harness blocks (their height depends on the embedded harness)
export function schBox(c, derived) {
  const { x, y } = c.sch;
  switch (c.type) {
    case 'subharness':
      return derived?.subs?.get(c.id)?.box || { x, y, w: SCH.connW + 16, h: 62 };
    case 'connector':
      return { x, y, w: SCH.connW, h: SCH.headH + Math.max(1, c.pins.length) * SCH.rowH + 4 };
    case 'terminal':
      return { x, y, w: SCH.termW, h: SCH.termH };
    case 'splice':
      return { x: x - SCH.spliceR, y: y - SCH.spliceR, w: SCH.spliceR * 2, h: SCH.spliceR * 2 };
    case 'device':
      return { x, y, w: SCH.devW, h: SCH.devH };
    default:
      return { x, y, w: 100, h: 40 };
  }
}

export function schCenter(c, derived) {
  const b = schBox(c, derived);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

// Anchor point of a pin; side: 'left' | 'right'
export function schAnchor(c, pinIndex, towardX) {
  const b = schBox(c);
  const cx = b.x + b.w / 2;
  if (c.type === 'splice') return { x: cx, y: b.y + b.h / 2, side: towardX >= cx ? 'right' : 'left', center: true };
  if (c.type === 'device') {
    return pinIndex === 0 ? { x: b.x, y: b.y + b.h / 2, side: 'left' } : { x: b.x + b.w, y: b.y + b.h / 2, side: 'right' };
  }
  const y = c.type === 'connector' ? b.y + SCH.headH + pinIndex * SCH.rowH + SCH.rowH / 2 : b.y + b.h / 2;
  const side = towardX >= cx ? 'right' : 'left';
  return { x: side === 'right' ? b.x + b.w : b.x, y, side };
}

export function schPinRowY(c, pinIndex) {
  const b = schBox(c);
  if (c.type === 'connector') return b.y + SCH.headH + pinIndex * SCH.rowH + SCH.rowH / 2;
  return b.y + b.h / 2;
}

// Orthogonal wire path between two anchor points
export function orthoPoints(a, b, midX) {
  const STUB = 22;
  if (midX !== undefined && midX !== null) {
    return [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b];
  }
  const aOut = a.side === 'right' ? 1 : -1;
  const bOut = b.side === 'right' ? 1 : -1;
  if (aOut === 1 && bOut === -1 && b.x - a.x > 2 * 10) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (aOut === -1 && bOut === 1 && a.x - b.x > 2 * 10) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (aOut === bOut) {
    const mx = aOut === 1 ? Math.max(a.x, b.x) + STUB * 1.5 : Math.min(a.x, b.x) - STUB * 1.5;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  // Backwards: S-curve
  const ax = a.x + aOut * STUB;
  const bx = b.x + bOut * STUB;
  const my = (a.y + b.y) / 2;
  return [a, { x: ax, y: a.y }, { x: ax, y: my }, { x: bx, y: my }, { x: bx, y: b.y }, b];
}

// Polyline with rounded corners as SVG path
export function roundedPath(pts, radius = 8) {
  const p = dedupe(pts);
  if (p.length < 2) return '';
  let d = `M${r2(p[0].x)},${r2(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const prev = p[i - 1];
    const cur = p[i];
    const next = p[i + 1];
    const d1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const d2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    if (r < 0.5) {
      d += ` L${r2(cur.x)},${r2(cur.y)}`;
      continue;
    }
    const a = { x: cur.x - ((cur.x - prev.x) / d1) * r, y: cur.y - ((cur.y - prev.y) / d1) * r };
    const b = { x: cur.x + ((next.x - cur.x) / d2) * r, y: cur.y + ((next.y - cur.y) / d2) * r };
    d += ` L${r2(a.x)},${r2(a.y)} Q${r2(cur.x)},${r2(cur.y)} ${r2(b.x)},${r2(b.y)}`;
  }
  const last = p[p.length - 1];
  d += ` L${r2(last.x)},${r2(last.y)}`;
  return d;
}

function dedupe(pts) {
  const out = [];
  for (const q of pts) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l.x - q.x) > 0.01 || Math.abs(l.y - q.y) > 0.01) out.push(q);
  }
  return out;
}
const r2 = (n) => Math.round(n * 100) / 100;

export const snap = (v, g = SCH.grid) => Math.round(v / g) * g;

// ---------- Layout ----------
export const LAY = {
  grid: 10,
  imageSize: 96,
  faceCell: 26,
  tableRowH: 20,
  tableHeadH: 22,
  tableCols: [36, 150, 92, 70],
};

export function segmentPoints(seg, derived) {
  const a = derived.layoutPos(seg.a);
  const b = derived.layoutPos(seg.b);
  if (!a || !b) return null;
  return [{ x: a.x, y: a.y }, ...(seg.points || []), { x: b.x, y: b.y }];
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

// Point on a polyline closest to p: { index (sub-segment), t, point, dist }
export function nearestOnPolyline(pts, p) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + dx * t, y: a.y + dy * t };
    const dist = Math.hypot(p.x - q.x, p.y - q.y);
    if (!best || dist < best.dist) best = { index: i - 1, t, point: q, dist };
  }
  return best;
}

// Fraction of the drawn length up to a point (for proportional length split)
export function fractionAlong(pts, hit) {
  const total = polylineLength(pts) || 1;
  let l = 0;
  for (let i = 1; i <= hit.index; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const a = pts[hit.index];
  l += Math.hypot(hit.point.x - a.x, hit.point.y - a.y);
  return l / total;
}

// Label position: middle of the longest sub-segment
export function labelPlacement(pts) {
  let bi = 1;
  let bl = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  const a = pts[bi - 1];
  const b = pts[bi];
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const rad = (angle * Math.PI) / 180;
  const off = 13;
  return {
    x: (a.x + b.x) / 2 + Math.sin(rad) * off,
    y: (a.y + b.y) / 2 - Math.cos(rad) * off,
    angle,
    segLen: bl,
  };
}

export function tableSize(rows) {
  const w = LAY.tableCols.reduce((a, b) => a + b, 0);
  return { w, h: LAY.tableHeadH + Math.max(1, rows) * LAY.tableRowH };
}

export function faceSize(count, rows) {
  const r = Math.max(1, Math.min(rows || 1, count || 1));
  const cols = Math.ceil((count || 1) / r);
  return { w: cols * LAY.faceCell + 16, h: r * LAY.faceCell + 16 };
}

export function closestPointOnRect(r, p) {
  return {
    x: Math.max(r.x, Math.min(r.x + r.w, p.x)),
    y: Math.max(r.y, Math.min(r.y + r.h, p.y)),
  };
}
