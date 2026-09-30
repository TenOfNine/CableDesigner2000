import { renderToStaticMarkup } from 'react-dom/server';
import SchematicScene, { schematicBounds } from './SchematicScene.jsx';
import LayoutScene, { layoutBounds } from './LayoutScene.jsx';
import { DARK, LIGHT } from './theme.js';
import { downloadBlob, fetchAsDataUrl, partImageUrl, safeFilename } from '../api.js';
import { wireListRows, pinoutRows, segmentRows, bomRows } from './tables.js';

// Teilebilder für Export/Druck als Data-URLs laden
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
  const b = view === 'schematic' ? schematicBounds(doc) : layoutBounds(doc, derived);
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
      i.onerror = () => reject(new Error('Bild konnte nicht erzeugt werden.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * s);
    canvas.height = Math.round(height * s);
    const ctx = canvas.getContext('2d');
    ctx.scale(s, s);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG konnte nicht erzeugt werden (Zeichnung zu groß?).');
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
  wb.creator = 'Harness Designer';
  wb.created = new Date();

  const addSheet = (name, columns, rows, decorate) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
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

  const wires = wireListRows(doc, derived);
  addSheet(
    'Leitungsliste',
    [
      { header: 'Nr.', key: 'label', width: 8 },
      { header: 'Signal', key: 'signal', width: 16 },
      { header: 'Von', key: 'fromComp', width: 16 },
      { header: 'Pin', key: 'fromPin', width: 8 },
      { header: 'Nach', key: 'toComp', width: 16 },
      { header: 'Pin', key: 'toPin', width: 8 },
      { header: 'Farbe', key: 'color', width: 9 },
      { header: 'Farbe (Name)', key: 'colorName', width: 14 },
      { header: 'Querschnitt mm²', key: 'cs', width: 15, style: { numFmt: '0.00' } },
      { header: 'AWG ≈', key: 'awg', width: 8 },
      { header: 'Typ', key: 'type', width: 10 },
      { header: 'Teilenummer', key: 'partNumber', width: 14 },
      { header: 'Länge mm', key: 'length', width: 11, style: { numFmt: '0' } },
      { header: 'Verlauf', key: 'route', width: 40 },
      { header: 'Bemerkung', key: 'notes', width: 24 },
    ],
    wires,
    (row, r) => {
      const cell = row.getCell('color');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(r.colorHex) } };
      cell.font = { color: { argb: contrast(r.colorHex) }, bold: true };
    }
  );

  addSheet(
    'Stückliste',
    [
      { header: 'Pos.', key: 'pos', width: 6 },
      { header: 'Gruppe', key: 'group', width: 16 },
      { header: 'Teilenummer', key: 'partNumber', width: 18 },
      { header: 'Hersteller', key: 'manufacturer', width: 22 },
      { header: 'Beschreibung', key: 'description', width: 50 },
      { header: 'Menge', key: 'qty', width: 10, style: { numFmt: '0.###' } },
      { header: 'Einheit', key: 'unit', width: 8 },
      { header: 'Verwendung', key: 'refs', width: 40 },
      { header: 'Hinweis', key: 'notes', width: 16 },
    ],
    bomRows(derived)
  );

  addSheet(
    'Pinbelegung',
    [
      { header: 'Bauteil', key: 'comp', width: 16 },
      { header: 'Art', key: 'type', width: 14 },
      { header: 'Teilenummer', key: 'part', width: 16 },
      { header: 'Gegenstück', key: 'mate', width: 14 },
      { header: 'Pin', key: 'pin', width: 7 },
      { header: 'Funktion', key: 'fn', width: 16 },
      { header: 'Leitung', key: 'wire', width: 9 },
      { header: 'Farbe', key: 'color', width: 9 },
      { header: 'Querschnitt mm²', key: 'cs', width: 15, style: { numFmt: '0.00' } },
      { header: 'Ziel', key: 'dest', width: 18 },
      { header: 'Ziel-Funktion', key: 'destFn', width: 16 },
      { header: 'Länge mm', key: 'length', width: 11, style: { numFmt: '0' } },
    ],
    pinoutRows(doc, derived),
    (row, r) => {
      if (r.colorHex) {
        const cell = row.getCell('color');
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(r.colorHex) } };
        cell.font = { color: { argb: contrast(r.colorHex) }, bold: true };
      }
    }
  );

  addSheet(
    'Segmente',
    [
      { header: 'Von', key: 'from', width: 16 },
      { header: 'Nach', key: 'to', width: 16 },
      { header: 'Bezeichnung', key: 'label', width: 14 },
      { header: 'Länge mm', key: 'length', width: 11, style: { numFmt: '0.#' } },
      { header: 'Anzahl Leitungen', key: 'wires', width: 16 },
      { header: 'Bündel-Ø ≈ mm', key: 'bundle', width: 15, style: { numFmt: '0.0' } },
      { header: 'Ummantelung', key: 'coverings', width: 30 },
      { header: 'Leitungen', key: 'wireLabels', width: 40 },
    ],
    segmentRows(doc, derived)
  );

  const info = wb.addWorksheet('Info');
  info.columns = [{ width: 26 }, { width: 60 }];
  const s = doc.settings;
  const lines = [
    ['Kabelbaum', meta.name],
    ['Projekt', (meta.breadcrumb || []).map((b) => b.name).join(' › ')],
    ['Zeichnungsnummer', s.drawingNumber || ''],
    ['Revision', s.revision || ''],
    ['Bearbeiter', s.author || author || ''],
    ['Exportiert am', new Date().toLocaleString('de-DE')],
    ['Längenzugabe je Leitungsende (mm)', Number(s.extraPerEnd) || 0],
    ['Längenzuschlag (%)', Number(s.extraPercent) || 0],
    ['Hinweis', 'Längen = Weg im Layout × (1 + Zuschlag) + 2 × Zugabe je Ende + Zusatzlänge der Leitung'],
  ];
  lines.forEach((l) => {
    const r = info.addRow(l);
    r.getCell(1).font = { bold: true };
  });

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${safeFilename(meta.name)}.xlsx`
  );
}
