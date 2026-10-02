import { renderToStaticMarkup } from 'react-dom/server';
import SchematicScene, { schematicBounds } from './SchematicScene.jsx';
import LayoutScene, { layoutBounds } from './LayoutScene.jsx';
import { DARK, LIGHT } from './theme.js';
import { downloadBlob, fetchAsDataUrl, partImageUrl, safeFilename } from '../api.js';
import { wireListRows, pinoutRows, segmentRows, bomRows, cableRows } from './tables.js';
import { t, locale } from '../i18n/index.js';

// Loads part images as data URLs for exports and printing
export async function loadImages(doc) {
  const out = {};
  const parts = new Map();
  for (const c of doc.components) if (c.show?.image && c.part?.hasImage) parts.set(c.part.id, c.part);
  await Promise.all(
    [...parts.values()].map(async (p) => {
      const url = partImageUrl(p);
      if (url) out[p.id] = await fetchAsDataUrl(url).catch(() => null);
    })
  );
  return out;
}

export function sceneBounds(view, doc, derived, pad = 30) {
  const b = view === 'schematic' ? schematicBounds(doc, derived) : layoutBounds(doc, derived);
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

export function Scene({ view, doc, derived, theme, images }) {
  return view === 'schematic' ? (
    <SchematicScene doc={doc} derived={derived} theme={theme} />
  ) : (
    <LayoutScene doc={doc} derived={derived} theme={theme} images={images} />
  );
}

export async function buildSvg({ view, doc, derived, themeName = 'light', title = '' }) {
  const theme = themeName === 'dark' ? DARK : LIGHT;
  const images = view === 'layout' ? await loadImages(doc) : {};
  const vb = sceneBounds(view, doc, derived);
  const titleH = title ? 34 : 0;
  const markup = renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      xmlnsXlink="http://www.w3.org/1999/xlink"
      viewBox={`${vb.x} ${vb.y - titleH} ${vb.w} ${vb.h + titleH}`}
      width={Math.round(vb.w)}
      height={Math.round(vb.h + titleH)}
    >
      <rect x={vb.x} y={vb.y - titleH} width={vb.w} height={vb.h + titleH} fill={theme.bg} />
      {title && (
        <text x={vb.x + 16} y={vb.y - titleH + 22} fontSize={15} fontWeight={700} fill={theme.text} fontFamily="Inter, system-ui, sans-serif">
          {title}
        </text>
      )}
      <Scene view={view} doc={doc} derived={derived} theme={theme} images={images} />
    </svg>
  );
  return { markup: `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`, width: vb.w, height: vb.h + titleH };
}

export async function exportSvg(opts, filename) {
  const { markup } = await buildSvg(opts);
  downloadBlob(new Blob([markup], { type: 'image/svg+xml' }), `${safeFilename(filename)}.svg`);
}

export async function exportPng(opts, filename, scale = 2) {
  const { markup, width, height } = await buildSvg(opts);
  const maxSide = 12000;
  const s = Math.max(0.25, Math.min(scale, maxSide / width, maxSide / height));
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(t('The image could not be created.')));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * s);
    canvas.height = Math.round(height * s);
    const ctx = canvas.getContext('2d');
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(t('The PNG could not be created (drawing too large?).'));
    downloadBlob(blob, `${safeFilename(filename)}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Excel ----------
function argb(hex) {
  return `FF${String(hex || '#ffffff').replace('#', '').toUpperCase()}`;
}
function contrast(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? 'FF000000' : 'FFFFFFFF';
}

export async function exportExcel({ doc, derived, meta, author }) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CableDesigner2000';
  wb.created = new Date();

  const addSheet = (name, columns, rows, decorate) => {
    const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 14, style: c.style }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2B2E34' } };
    head.alignment = { vertical: 'middle' };
    head.height = 20;
    for (const r of rows) {
      const row = ws.addRow(r);
      decorate?.(row, r);
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    return ws;
  };
  const colorCell = (row, key, hex) => {
    if (!hex) return;
    const cell = row.getCell(key);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } };
    cell.font = { color: { argb: contrast(hex) }, bold: true };
  };

  addSheet(
    t('Wire list'),
    [
      { header: t('No.'), key: 'label', width: 8 },
      { header: t('Signal'), key: 'signal', width: 16 },
      { header: t('From'), key: 'fromComp', width: 16 },
      { header: t('Pin'), key: 'fromPin', width: 8 },
      { header: t('To'), key: 'toComp', width: 16 },
      { header: t('Pin'), key: 'toPin', width: 8 },
      { header: t('Colour'), key: 'color', width: 9 },
      { header: t('Colour (name)'), key: 'colorName', width: 14 },
      { header: t('Cross-section mm²'), key: 'cs', width: 15, style: { numFmt: '0.00' } },
      { header: 'AWG ≈', key: 'awg', width: 8 },
      { header: t('Type'), key: 'type', width: 10 },
      { header: t('Cable'), key: 'cable', width: 9 },
      { header: t('Part number'), key: 'partNumber', width: 14 },
      { header: t('Length mm'), key: 'length', width: 11, style: { numFmt: '0' } },
      { header: t('Route'), key: 'route', width: 40 },
      { header: t('Remark'), key: 'notes', width: 24 },
    ],
    wireListRows(doc, derived),
    (row, r) => colorCell(row, 'color', r.colorHex)
  );

  const bomColumns = [
    { header: t('Pos.'), key: 'pos', width: 6 },
    { header: t('Group'), key: 'group', width: 18 },
    { header: t('Part number'), key: 'partNumber', width: 18 },
    { header: t('Manufacturer'), key: 'manufacturer', width: 22 },
    { header: t('Description'), key: 'description', width: 50 },
    { header: t('Qty'), key: 'qty', width: 10, style: { numFmt: '0.###' } },
    { header: t('Unit'), key: 'unit', width: 8 },
    { header: t('Used by'), key: 'refs', width: 40 },
    { header: t('Note'), key: 'notes', width: 16 },
  ];
  addSheet(t('Bill of materials'), bomColumns, bomRows(derived, false));
  if (derived.subs.size) addSheet(t('BOM (exploded)'), bomColumns, bomRows(derived, true));

  addSheet(
    t('Pin assignment'),
    [
      { header: t('Component'), key: 'comp', width: 16 },
      { header: t('Kind'), key: 'type', width: 14 },
      { header: t('Part number'), key: 'part', width: 16 },
      { header: t('Mating part'), key: 'mate', width: 14 },
      { header: t('Pin'), key: 'pin', width: 7 },
      { header: t('Function'), key: 'fn', width: 16 },
      { header: t('Wire'), key: 'wire', width: 9 },
      { header: t('Colour'), key: 'color', width: 9 },
      { header: t('Cross-section mm²'), key: 'cs', width: 15, style: { numFmt: '0.00' } },
      { header: t('Destination'), key: 'dest', width: 18 },
      { header: t('Destination function'), key: 'destFn', width: 16 },
      { header: t('Length mm'), key: 'length', width: 11, style: { numFmt: '0' } },
    ],
    pinoutRows(doc, derived),
    (row, r) => colorCell(row, 'color', r.colorHex)
  );

  const cables = cableRows(doc, derived);
  if (cables.length) {
    addSheet(
      t('Cables'),
      [
        { header: t('Designation'), key: 'label', width: 10 },
        { header: t('Kind'), key: 'kind', width: 18 },
        { header: t('Type'), key: 'type', width: 12 },
        { header: t('Part number'), key: 'part', width: 16 },
        { header: t('Cores'), key: 'cores', width: 8 },
        { header: t('Shield'), key: 'shieldText', width: 8 },
        { header: t('Wires'), key: 'members', width: 40 },
        { header: t('Lay length mm'), key: 'layLength', width: 12 },
        { header: t('Outer diameter mm'), key: 'outerDiameter', width: 14, style: { numFmt: '0.0' } },
        { header: t('Length mm'), key: 'length', width: 11, style: { numFmt: '0' } },
      ],
      cables.map((r) => ({ ...r, shieldText: r.shield ? t('yes') : '' }))
    );
  }

  addSheet(
    t('Segments'),
    [
      { header: t('From'), key: 'from', width: 16 },
      { header: t('To'), key: 'to', width: 16 },
      { header: t('Designation'), key: 'label', width: 14 },
      { header: t('Length mm'), key: 'length', width: 11, style: { numFmt: '0.#' } },
      { header: t('Number of wires'), key: 'wires', width: 16 },
      { header: t('Bundle Ø ≈ mm'), key: 'bundle', width: 15, style: { numFmt: '0.0' } },
      { header: t('Covering'), key: 'coverings', width: 30 },
      { header: t('Wires'), key: 'wireLabels', width: 40 },
    ],
    segmentRows(doc, derived)
  );

  const info = wb.addWorksheet('Info');
  info.columns = [{ width: 32 }, { width: 70 }];
  const s = doc.settings;
  const lines = [
    [t('Harness'), meta.name],
    [t('Project'), (meta.breadcrumb || []).map((b) => b.name).join(' › ')],
    [t('Drawing number'), s.drawingNumber || ''],
    [t('Revision'), s.revision || ''],
    [t('Author'), s.author || author || ''],
    [t('Exported on'), new Date().toLocaleString(locale())],
    [t('Length allowance per wire end (mm)'), Number(s.extraPerEnd) || 0],
    [t('Length surcharge (%)'), Number(s.extraPercent) || 0],
    [t('Note'), t('Length = path in layout × (1 + surcharge) × twist factor + 2 × allowance per end + extra length of the wire')],
  ];
  lines.forEach((l) => {
    const r = info.addRow(l);
    r.getCell(1).font = { bold: true };
  });

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${safeFilename(meta.name)}.xlsx`);
}
