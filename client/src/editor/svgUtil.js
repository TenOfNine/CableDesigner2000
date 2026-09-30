// Kleine Hilfen für SVG-Texte

export function textWidth(text, fontSize = 12, bold = false) {
  return String(text || '').length * fontSize * (bold ? 0.6 : 0.56);
}

export function truncate(text, maxPx, fontSize = 12, bold = false) {
  const s = String(text ?? '');
  if (textWidth(s, fontSize, bold) <= maxPx) return s;
  const maxChars = Math.max(1, Math.floor(maxPx / (fontSize * (bold ? 0.6 : 0.56))) - 1);
  return s.slice(0, maxChars) + '…';
}

export const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
