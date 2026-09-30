import express from 'express';
import { db } from '../db.js';
import { requireUser } from '../auth.js';

const router = express.Router();
router.use(requireUser);

export const CATEGORIES = ['connector', 'terminal', 'wire', 'splice', 'covering', 'device'];

const partFields = `id, owner_id, category, part_number, manufacturer, description, data,
  image IS NOT NULL AS has_image, created_at, updated_at`;

function toDto(row, userId) {
  return {
    id: row.id,
    scope: row.owner_id === null ? 'global' : 'own',
    editable: row.owner_id === userId,
    category: row.category,
    partNumber: row.part_number,
    manufacturer: row.manufacturer,
    description: row.description,
    data: JSON.parse(row.data || '{}'),
    hasImage: !!row.has_image,
    imageVersion: row.updated_at,
    updatedAt: row.updated_at,
  };
}

function canEdit(req, row) {
  if (row.owner_id === null) return req.user.isAdmin;
  return row.owner_id === req.user.id;
}

router.get('/parts', (req, res) => {
  const rows = db
    .prepare(`SELECT ${partFields} FROM parts WHERE owner_id IS NULL OR owner_id = ? ORDER BY category, part_number, description`)
    .all(req.user.id);
  res.json({
    parts: rows.map((r) => {
      const dto = toDto(r, req.user.id);
      if (r.owner_id === null) dto.editable = req.user.isAdmin;
      return dto;
    }),
  });
});

function sanitize(body) {
  const category = String(body.category || '');
  if (!CATEGORIES.includes(category)) return { error: 'Ungültige Kategorie.' };
  const data = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
  const json = JSON.stringify(data);
  if (json.length > 50_000) return { error: 'Zu viele Zusatzdaten.' };
  const partNumber = String(body.partNumber || '').trim().slice(0, 120);
  const description = String(body.description || '').trim().slice(0, 500);
  if (!partNumber && !description) return { error: 'Bitte Teilenummer oder Beschreibung angeben.' };
  return {
    category,
    partNumber,
    manufacturer: String(body.manufacturer || '').trim().slice(0, 120),
    description,
    data: json,
  };
}

router.post('/parts', (req, res) => {
  const p = sanitize(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  const scope = req.body?.scope === 'global' ? 'global' : 'own';
  if (scope === 'global' && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Nur Administratoren können globale Teile anlegen.' });
  }
  const info = db
    .prepare('INSERT INTO parts (owner_id, category, part_number, manufacturer, description, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(scope === 'global' ? null : req.user.id, p.category, p.partNumber, p.manufacturer, p.description, p.data);
  const row = db.prepare(`SELECT ${partFields} FROM parts WHERE id = ?`).get(info.lastInsertRowid);
  res.json({ part: { ...toDto(row, req.user.id), editable: true } });
});

router.put('/parts/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.params.id));
  if (!row || (row.owner_id !== null && row.owner_id !== req.user.id)) return res.status(404).json({ error: 'Teil nicht gefunden.' });
  if (!canEdit(req, row)) return res.status(403).json({ error: 'Keine Berechtigung zum Bearbeiten.' });
  const p = sanitize(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  db.prepare(
    `UPDATE parts SET category = ?, part_number = ?, manufacturer = ?, description = ?, data = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(p.category, p.partNumber, p.manufacturer, p.description, p.data, row.id);
  const updated = db.prepare(`SELECT ${partFields} FROM parts WHERE id = ?`).get(row.id);
  res.json({ part: { ...toDto(updated, req.user.id), editable: true } });
});

router.delete('/parts/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.params.id));
  if (!row || (row.owner_id !== null && row.owner_id !== req.user.id)) return res.status(404).json({ error: 'Teil nicht gefunden.' });
  if (!canEdit(req, row)) return res.status(403).json({ error: 'Keine Berechtigung zum Löschen.' });
  db.prepare('DELETE FROM parts WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ---------- Bilder ----------
const ALLOWED = {
  'image/png': (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  'image/gif': (b) => b.length > 6 && b.toString('ascii', 0, 3) === 'GIF',
};

router.put('/parts/:id/image', express.raw({ type: () => true, limit: '3mb' }), (req, res) => {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.params.id));
  if (!row || (row.owner_id !== null && row.owner_id !== req.user.id)) return res.status(404).json({ error: 'Teil nicht gefunden.' });
  if (!canEdit(req, row)) return res.status(403).json({ error: 'Keine Berechtigung.' });
  const type = String(req.headers['content-type'] || '').split(';')[0].trim();
  const check = ALLOWED[type];
  if (!check || !Buffer.isBuffer(req.body) || !check(req.body)) {
    return res.status(400).json({ error: 'Nur PNG, JPEG, WebP oder GIF bis 3 MB.' });
  }
  db.prepare("UPDATE parts SET image = ?, image_type = ?, updated_at = datetime('now') WHERE id = ?").run(req.body, type, row.id);
  const updated = db.prepare(`SELECT ${partFields} FROM parts WHERE id = ?`).get(row.id);
  res.json({ part: { ...toDto(updated, req.user.id), editable: true } });
});

router.delete('/parts/:id/image', (req, res) => {
  const row = db.prepare('SELECT * FROM parts WHERE id = ?').get(Number(req.params.id));
  if (!row || (row.owner_id !== null && row.owner_id !== req.user.id)) return res.status(404).json({ error: 'Teil nicht gefunden.' });
  if (!canEdit(req, row)) return res.status(403).json({ error: 'Keine Berechtigung.' });
  db.prepare("UPDATE parts SET image = NULL, image_type = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ ok: true });
});

router.get('/parts/:id/image', (req, res) => {
  const row = db.prepare('SELECT id, owner_id, image, image_type FROM parts WHERE id = ?').get(Number(req.params.id));
  if (!row || !row.image) return res.status(404).end();
  let allowed = row.owner_id === null || row.owner_id === req.user.id;
  if (!allowed) {
    // Bilder eigener Teile sind für Benutzer sichtbar, denen der Eigentümer ein Projekt freigegeben hat
    allowed = !!db
      .prepare(
        `SELECT 1 FROM project_shares s JOIN projects p ON p.id = s.project_id
         WHERE s.user_id = ? AND p.owner_id = ? LIMIT 1`
      )
      .get(req.user.id, row.owner_id);
  }
  if (!allowed) return res.status(404).end();
  res.setHeader('Content-Type', row.image_type);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(row.image);
});

export default router;
