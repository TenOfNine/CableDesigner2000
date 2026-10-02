// Pure rendering of the schematic (used by the editor, printing and image export)
import { schBox, schAnchor, schCenter, orthoPoints, roundedPath, SCH } from './geometry.js';
import { colorByCode, terminalSubtype, partTitle, fmtCs, cableKindLabel } from './model.js';
import { truncate, FONT } from './svgUtil.js';
import { t } from '../i18n/index.js';

export function computeWireGeometry(doc, derived) {
  const out = new Map();
  const groups = new Map();
  for (const w of derived.validWires) {
    const fa = derived.pins.get(w.from.p);
    const tb = derived.pins.get(w.to.p);
    const ca = fa.comp;
    const cb = tb.comp;
    const centerA = schCenter(ca, derived);
    const centerB = schCenter(cb, derived);
    const same = ca.id === cb.id;
    const a = schAnchor(ca, fa.index, same ? Infinity : centerB.x);
    const b = schAnchor(cb, tb.index, same ? Infinity : centerA.x);
    const manual = typeof w.schMid === 'number';
    const pts = orthoPoints(a, b, manual ? w.schMid : undefined);
    const entry = { wire: w, a, b, pts, manual };
    out.set(w.id, entry);
    if (!manual && pts.length === 4) {
      const key = Math.round(pts[1].x / 6);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
  }
  // Spread parallel wires onto separate lanes
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((p, q) => Math.min(p.a.y, p.b.y) - Math.min(q.a.y, q.b.y) || p.a.y - q.a.y);
    const n = list.length;
    list.forEach((e, i) => {
      const off = (i - (n - 1) / 2) * 7;
      const mx = e.pts[1].x + off;
      e.pts = [e.pts[0], { x: mx, y: e.pts[0].y }, { x: mx, y: e.pts[3].y }, e.pts[3]];
    });
  }
  return out;
}

export function schematicBounds(doc, derived) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y, w, h) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const c of doc.components) {
    const b = schBox(c, derived);
    add(b.x - 40, b.y - 20, b.w + 80, b.h + 30);
  }
  for (const n of doc.notes) if (n.view === 'sch') add(n.x, n.y, noteSize(n).w, noteSize(n).h);
  if (minX === Infinity) return { x: 0, y: 0, w: 800, h: 600 };
  for (const w of doc.wires) {
    if (typeof w.schMid !== 'number') continue;
    minX = Math.min(minX, w.schMid - 20);
    maxX = Math.max(maxX, w.schMid + 20);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function noteSize(n) {
  const lines = String(n.text || '').split('\n');
  const w = Math.max(80, Math.min(420, Math.max(...lines.map((l) => l.length)) * 6.8 + 20));
  return { w, h: lines.length * 16 + 14 };
}

export function NoteShape({ n, theme, selected }) {
  const { w, h } = noteSize(n);
  const lines = String(n.text || '').split('\n');
  return (
    <g data-kind="note" data-id={n.id} style={{ cursor: 'move' }}>
      <rect x={n.x} y={n.y} width={w} height={h} rx={6} fill={theme.noteFill} stroke={selected ? theme.select : theme.noteStroke} strokeWidth={selected ? 2 : 1} />
      {lines.map((l, i) => (
        <text key={i} x={n.x + 10} y={n.y + 20 + i * 16} fontSize={12} fill={theme.noteText} fontFamily={FONT}>
          {l}
        </text>
      ))}
    </g>
  );
}

function WireShape({ geom, theme, selected, dimmed, highlighted, interactive }) {
  const w = geom.wire;
  const d = roundedPath(geom.pts, 7);
  const hex = colorByCode(w.color).hex;
  const opacity = dimmed ? theme.dim : 1;
  const labelA = labelPos(geom.a);
  const labelB = labelPos(geom.b);
  const shield = w.cableRole === 'shield';
  return (
    <g data-kind="wire" data-id={w.id} opacity={opacity} style={interactive ? { cursor: 'pointer' } : undefined}>
      {interactive && <path d={d} fill="none" stroke="transparent" strokeWidth={12} />}
      {(selected || highlighted) && (
        <path d={d} fill="none" stroke={selected ? theme.select : theme.highlight} strokeWidth={8} strokeOpacity={0.45} strokeLinejoin="round" strokeLinecap="round" />
      )}
      <path d={d} fill="none" stroke={theme.wireOutline} strokeOpacity={theme.wireOutlineOpacity} strokeWidth={4.4} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={shield ? '6 4' : undefined} />
      <path d={d} fill="none" stroke={hex} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={shield ? '6 4' : undefined} />
      {w.stripe && <path d={d} fill="none" stroke={colorByCode(w.stripe).hex} strokeWidth={2.6} strokeDasharray="5 5" strokeLinejoin="round" />}
      <text x={labelA.x} y={labelA.y} fontSize={8.5} fill={theme.textMuted} textAnchor={labelA.anchor} fontFamily={FONT}>
        {w.label}
      </text>
      <text x={labelB.x} y={labelB.y} fontSize={8.5} fill={theme.textMuted} textAnchor={labelB.anchor} fontFamily={FONT}>
        {w.label}
      </text>
    </g>
  );
}

function labelPos(a) {
  if (a.center) return { x: a.x + (a.side === 'right' ? 12 : -12), y: a.y - 5, anchor: a.side === 'right' ? 'start' : 'end' };
  return a.side === 'right' ? { x: a.x + 7, y: a.y - 4, anchor: 'start' } : { x: a.x - 7, y: a.y - 4, anchor: 'end' };
}

function midOf(pts) {
  if (pts.length === 4) return { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
  let best = 1;
  let bl = -1;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > bl) {
      bl = l;
      best = i;
    }
  }
  return { x: (pts[best].x + pts[best - 1].x) / 2, y: (pts[best].y + pts[best - 1].y) / 2 };
}

/** Ellipse around the member wires of a cable / twisted group */
function CableMarker({ ci, geoms, theme, selected, interactive }) {
  const pts = ci.members.map((w) => geoms.get(w.id)).filter(Boolean).map((g) => midOf(g.pts));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rx = Math.max(12, (Math.max(...xs) - Math.min(...xs)) / 2 + 10);
  const ry = Math.max(12, (Math.max(...ys) - Math.min(...ys)) / 2 + 10);
  const k = ci.cable;
  const twist = k.kind === 'twist';
  const nCores = k.cores || ci.cores.length;
  const sub = twist ? t('twisted') : [k.type || k.part?.partNumber, nCores && ci.cores.length ? `${nCores}×${fmtCs(ci.cores[0].cs).replace(' mm²', '')}` : ''].filter(Boolean).join(' ');
  const stroke = selected ? theme.select : theme.text;
  return (
    <g data-kind="cable" data-id={k.id} style={interactive ? { cursor: 'pointer' } : undefined}>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={interactive ? 'transparent' : 'none'} stroke={stroke} strokeWidth={selected ? 2.2 : 1.4} strokeDasharray={twist ? '3 3' : undefined} pointerEvents={interactive ? 'stroke' : 'none'} />
      {interactive && <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke="transparent" strokeWidth={10} />}
      {twist && (
        <path
          d={`M${cx - 10},${cy - ry - 7} q2.5,-5 5,0 t5,0 t5,0 t5,0`}
          fill="none"
          stroke={stroke}
          strokeWidth={1.3}
        />
      )}
      <text x={cx + (twist ? 14 : 0)} y={cy - ry - 5} fontSize={10} fontWeight={700} fill={theme.text} textAnchor={twist ? 'start' : 'middle'} fontFamily={FONT}>
        {k.label}
        <tspan fontWeight={400} fill={theme.textMuted}>{sub ? `  ${sub}` : ''}</tspan>
      </text>
    </g>
  );
}

function PinDot({ x, y, comp, pin, theme, used, interactive }) {
  return (
    <g>
      {interactive && <circle cx={x} cy={y} r={8} fill="transparent" data-role="pin" data-pin={pin.id} data-comp={comp.id} style={{ cursor: 'crosshair' }} />}
      <circle cx={x} cy={y} r={3.3} fill={used ? theme.text : theme.pinDot} pointerEvents="none" />
    </g>
  );
}

function ConnectorShape({ c, derived, theme, selected, highlightPins, interactive, dimmed, groupId }) {
  const b = schBox(c);
  const stroke = selected ? theme.select : theme.compStroke;
  const mate = c.mateId ? derived.comps.get(c.mateId) : derived.matePairs.find(([, v]) => v.id === c.id)?.[0];
  const title = c.virtual ? c.shortLabel : c.label;
  const sub = [c.part ? partTitle(c.part) : t('no part'), mate ? `⇄ ${mate.label}` : ''].filter(Boolean).join('  ·  ');
  const moveCursor = interactive ? { cursor: 'move' } : undefined;
  return (
    <g data-kind="component" data-id={groupId || c.id} opacity={dimmed ? 0.55 : 1}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={7} fill={theme.compFill} stroke={stroke} strokeWidth={selected ? 2 : 1} style={moveCursor} />
      <path
        d={`M${b.x + 7},${b.y} H${b.x + b.w - 7} Q${b.x + b.w},${b.y} ${b.x + b.w},${b.y + 7} V${b.y + SCH.headH} H${b.x} V${b.y + 7} Q${b.x},${b.y} ${b.x + 7},${b.y} Z`}
        fill={theme.compHeader}
        style={moveCursor}
      />
      <line x1={b.x} x2={b.x + b.w} y1={b.y + SCH.headH} y2={b.y + SCH.headH} stroke={theme.compStroke} strokeWidth={1} />
      <text x={b.x + 10} y={b.y + 13} fontSize={12} fontWeight={700} fill={theme.text} fontFamily={FONT} pointerEvents="none">
        {truncate(title, b.w - 20, 12, true)}
      </text>
      <text x={b.x + 10} y={b.y + 25} fontSize={9.5} fill={theme.textMuted} fontFamily={FONT} pointerEvents="none">
        {truncate(sub, b.w - 20, 9.5)}
      </text>
      {c.pins.map((p, i) => {
        const y0 = b.y + SCH.headH + i * SCH.rowH;
        const cy = y0 + SCH.rowH / 2;
        const used = (derived.pinWires.get(p.id) || []).length > 0;
        const hl = highlightPins?.has(p.id);
        return (
          <g key={p.id}>
            {i > 0 && <line x1={b.x + 1} x2={b.x + b.w - 1} y1={y0} y2={y0} stroke={theme.rowStroke} strokeWidth={1} pointerEvents="none" />}
            {hl && <rect x={b.x + 1} y={y0 + 1} width={b.w - 2} height={SCH.rowH - 2} fill={theme.highlight} fillOpacity={0.2} pointerEvents="none" />}
            <text x={b.x + 12} y={cy + 4} fontSize={11} fill={theme.textMuted} fontFamily={FONT} pointerEvents="none">
              {truncate(p.name, 26, 11)}
            </text>
            <text x={b.x + 42} y={cy + 4} fontSize={11.5} fill={theme.text} fontFamily={FONT} pointerEvents="none">
              {truncate(p.fn, b.w - 56, 11.5)}
            </text>
            <PinDot x={b.x} y={cy} comp={c} pin={p} theme={theme} used={used} interactive={interactive} />
            <PinDot x={b.x + b.w} y={cy} comp={c} pin={p} theme={theme} used={used} interactive={interactive} />
          </g>
        );
      })}
    </g>
  );
}

function TerminalShape({ c, derived, theme, selected, highlightPins, interactive, dimmed }) {
  const b = schBox(c);
  const p = c.pins[0];
  const st = terminalSubtype(c.subtype);
  const used = p && (derived.pinWires.get(p.id) || []).length > 0;
  const hl = p && highlightPins?.has(p.id);
  const text = p?.fn && p.fn !== c.label ? `${c.label} · ${p.fn}` : c.label;
  return (
    <g data-kind="component" data-id={c.id} opacity={dimmed ? 0.55 : 1}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={b.h / 2} fill={hl ? theme.compHeader : theme.compFill} stroke={selected ? theme.select : hl ? theme.highlight : theme.compStroke} strokeWidth={selected || hl ? 2 : 1} style={interactive ? { cursor: 'move' } : undefined} />
      <text x={b.x + 14} y={b.y + b.h / 2 + 4.5} fontSize={13} fill={theme.textMuted} fontFamily={FONT} pointerEvents="none">
        {st.symbol}
      </text>
      <text x={b.x + 32} y={b.y + b.h / 2 + 4} fontSize={12} fontWeight={600} fill={theme.text} fontFamily={FONT} pointerEvents="none">
        {truncate(text, b.w - 44, 12, true)}
      </text>
      {p && <PinDot x={b.x} y={b.y + b.h / 2} comp={c} pin={p} theme={theme} used={used} interactive={interactive} />}
      {p && <PinDot x={b.x + b.w} y={b.y + b.h / 2} comp={c} pin={p} theme={theme} used={used} interactive={interactive} />}
    </g>
  );
}

function SpliceShape({ c, theme, selected, highlightPins, interactive, dimmed }) {
  const { x, y } = c.sch;
  const p = c.pins[0];
  const hl = p && highlightPins?.has(p.id);
  return (
    <g data-kind="component" data-id={c.id} opacity={dimmed ? 0.55 : 1}>
      {interactive && p && <circle cx={x} cy={y} r={14} fill="transparent" data-role="pin" data-pin={p.id} data-comp={c.id} style={{ cursor: 'crosshair' }} />}
      <circle cx={x} cy={y} r={SCH.spliceR} fill={hl ? theme.highlight : theme.compHeader} stroke={selected ? theme.select : theme.text} strokeWidth={selected ? 2.5 : 1.5} style={interactive ? { cursor: 'move' } : undefined} />
      <text x={x} y={y - 14} fontSize={11} fontWeight={600} fill={theme.text} textAnchor="middle" fontFamily={FONT} pointerEvents="none">
        {c.label}
      </text>
    </g>
  );
}

function DeviceShape({ c, derived, theme, selected, highlightPins, interactive, dimmed }) {
  const b = schBox(c);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const stroke = theme.text;
  return (
    <g data-kind="component" data-id={c.id} opacity={dimmed ? 0.55 : 1}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6} fill={theme.compFill} stroke={selected ? theme.select : theme.compStroke} strokeWidth={selected ? 2 : 1} style={interactive ? { cursor: 'move' } : undefined} />
      <line x1={b.x} x2={cx - 12} y1={cy} y2={cy} stroke={stroke} strokeWidth={1.4} pointerEvents="none" />
      <line x1={cx + 12} x2={b.x + b.w} y1={cy} y2={cy} stroke={stroke} strokeWidth={1.4} pointerEvents="none" />
      {c.subtype === 'diode' ? (
        <g pointerEvents="none">
          <path d={`M${cx - 10},${cy - 9} L${cx + 7},${cy} L${cx - 10},${cy + 9} Z`} fill="none" stroke={stroke} strokeWidth={1.4} />
          <line x1={cx + 8} x2={cx + 8} y1={cy - 9} y2={cy + 9} stroke={stroke} strokeWidth={1.8} />
          <line x1={cx - 12} x2={cx - 10} y1={cy} y2={cy} stroke={stroke} strokeWidth={1.4} />
          <line x1={cx + 8} x2={cx + 12} y1={cy} y2={cy} stroke={stroke} strokeWidth={1.4} />
        </g>
      ) : (
        <rect x={cx - 12} y={cy - 6} width={24} height={12} fill="none" stroke={stroke} strokeWidth={1.4} pointerEvents="none" />
      )}
      <text x={b.x} y={b.y - 6} fontSize={11.5} fontWeight={700} fill={theme.text} fontFamily={FONT} pointerEvents="none">
        {c.label}
        {c.value ? <tspan fontWeight={400} fill={theme.textMuted}>{`  ${c.value}`}</tspan> : null}
      </text>
      {c.pins.map((p, i) => {
        const x = i === 0 ? b.x : b.x + b.w;
        const used = (derived.pinWires.get(p.id) || []).length > 0;
        return (
          <g key={p.id}>
            {highlightPins?.has(p.id) && <circle cx={x} cy={cy} r={7} fill={theme.highlight} fillOpacity={0.4} />}
            <text x={i === 0 ? b.x + 4 : b.x + b.w - 4} y={b.y + b.h - 4} fontSize={8.5} fill={theme.textMuted} textAnchor={i === 0 ? 'start' : 'end'} fontFamily={FONT} pointerEvents="none">
              {p.name}
            </text>
            <PinDot x={x} y={cy} comp={c} pin={p} theme={theme} used={used} interactive={interactive} />
          </g>
        );
      })}
    </g>
  );
}

/** Embedded sub-harness: frame with the interface connectors of the linked harness */
function SubharnessShape({ c, derived, theme, selected, highlightPins, interactive, dimmed }) {
  const sub = derived.subs.get(c.id);
  const b = sub?.box || schBox(c, derived);
  return (
    <g opacity={dimmed ? 0.55 : 1}>
      <g data-kind="component" data-id={c.id} style={interactive ? { cursor: 'move' } : undefined}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={9} fill={theme.compFill} fillOpacity={0.5} stroke={selected ? theme.select : theme.compStroke} strokeWidth={selected ? 2 : 1.2} strokeDasharray="6 4" />
        <text x={b.x + 10} y={b.y + 15} fontSize={12} fontWeight={700} fill={theme.text} fontFamily={FONT}>
          ⧉ {truncate(c.label, b.w - 34, 12, true)}
        </text>
        <text x={b.x + 10} y={b.y + 29} fontSize={9.5} fill={theme.textMuted} fontFamily={FONT}>
          {truncate(`${t('Sub-harness')}: ${sub?.name || c.ref?.name || '?'}`, b.w - 20, 9.5)}
        </text>
        {sub?.missing && (
          <text x={b.x + 10} y={b.y + 52} fontSize={10.5} fill="#e5a33b" fontFamily={FONT}>
            {t('not available')}
          </text>
        )}
        {sub && !sub.missing && sub.virtuals.length === 0 && (
          <text x={b.x + 10} y={b.y + 52} fontSize={10.5} fill={theme.textMuted} fontFamily={FONT}>
            {t('no interface connectors')}
          </text>
        )}
      </g>
      {(sub?.virtuals || []).map((v) => (
        <ConnectorShape key={v.id} c={v} derived={derived} theme={theme} highlightPins={highlightPins} interactive={interactive} groupId={c.id} />
      ))}
    </g>
  );
}

export function ComponentShape(props) {
  switch (props.c.type) {
    case 'connector':
      return <ConnectorShape {...props} />;
    case 'terminal':
      return <TerminalShape {...props} />;
    case 'splice':
      return <SpliceShape {...props} />;
    case 'device':
      return <DeviceShape {...props} />;
    case 'subharness':
      return <SubharnessShape {...props} />;
    default:
      return null;
  }
}

export default function SchematicScene({ doc, derived, theme, selection = [], hover = null, interactive = false, preview = null }) {
  const geoms = computeWireGeometry(doc, derived);
  const selIds = new Set(selection.map((s) => s.id));
  const hoverSet = hover?.wireIds ? new Set(hover.wireIds) : null;
  const highlightPins = new Set();
  const activeComps = new Set();
  if (hoverSet) {
    for (const id of hoverSet) {
      const info = derived.wireInfo.get(id);
      if (!info) continue;
      highlightPins.add(info.wire.from.p);
      highlightPins.add(info.wire.to.p);
      activeComps.add(derived.gnode(info.wire.from.c));
      activeComps.add(derived.gnode(info.wire.to.c));
    }
  }
  const wiresNormal = [];
  const wiresTop = [];
  for (const g of geoms.values()) {
    const top = selIds.has(g.wire.id) || hoverSet?.has(g.wire.id);
    (top ? wiresTop : wiresNormal).push(g);
  }
  return (
    <g fontFamily={FONT}>
      {doc.notes
        .filter((n) => n.view === 'sch')
        .map((n) => (
          <NoteShape key={n.id} n={n} theme={theme} selected={selIds.has(n.id)} />
        ))}
      {/* mated pairs */}
      {derived.matePairs.map(([a, b]) => {
        const ba = schBox(a, derived);
        const bb = schBox(b, derived);
        const p1 = { x: ba.x + ba.w / 2, y: ba.y };
        const p2 = { x: bb.x + bb.w / 2, y: bb.y };
        const midX = (p1.x + p2.x) / 2;
        const topY = Math.min(p1.y, p2.y) - 16;
        return (
          <g key={`${a.id}-${b.id}`} pointerEvents="none">
            <path d={`M${p1.x},${p1.y} V${topY} H${p2.x} V${p2.y}`} fill="none" stroke={theme.mate} strokeWidth={1} strokeDasharray="4 4" />
            <text x={midX} y={topY - 4} fontSize={10} fill={theme.mate} textAnchor="middle" fontFamily={FONT}>
              ⇄ {t('mated')}
            </text>
          </g>
        );
      })}
      {wiresNormal.map((g) => (
        <WireShape key={g.wire.id} geom={g} theme={theme} interactive={interactive} dimmed={!!hoverSet} />
      ))}
      {doc.components.map((c) => (
        <ComponentShape
          key={c.id}
          c={c}
          derived={derived}
          theme={theme}
          selected={selIds.has(c.id)}
          highlightPins={highlightPins}
          interactive={interactive}
          dimmed={hoverSet && !activeComps.has(c.id)}
        />
      ))}
      {wiresTop.map((g) => (
        <WireShape
          key={g.wire.id}
          geom={g}
          theme={theme}
          interactive={interactive}
          selected={selIds.has(g.wire.id)}
          highlighted={hoverSet?.has(g.wire.id)}
          dimmed={hoverSet && !hoverSet.has(g.wire.id)}
        />
      ))}
      {[...derived.cableInfo.values()].map((ci) => (
        <CableMarker key={ci.cable.id} ci={ci} geoms={geoms} theme={theme} selected={selIds.has(ci.cable.id)} interactive={interactive} />
      ))}
      {preview && (
        <path d={`M${preview.a.x},${preview.a.y} L${preview.b.x},${preview.b.y}`} stroke={theme.select} strokeWidth={2} strokeDasharray="6 5" fill="none" pointerEvents="none" />
      )}
    </g>
  );
}

export { cableKindLabel };
