import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { db } from '../db.js';
import { hashPassword, validatePassword, validateUsername, requireAdmin } from '../auth.js';

const router = express.Router();
router.use(requireAdmin);

const listUsers = () =>
  db
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.is_admin AS isAdmin, u.disabled,
              u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
              (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id AND p.parent_id IS NULL) AS projectCount
       FROM users u ORDER BY u.username`
    )
    .all()
    .map((u) => ({ ...u, isAdmin: !!u.isAdmin, disabled: !!u.disabled }));

router.get('/users', (req, res) => res.json({ users: listUsers() }));

router.post('/users', (req, res) => {
  const { username, displayName, password, isAdmin } = req.body || {};
  const err = validateUsername(username) || validatePassword(password);
  if (err) return res.status(400).json({ error: err });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ error: 'Dieser Benutzername ist bereits vergeben.' });
  }
  db.prepare('INSERT INTO users (username, display_name, password_hash, is_admin) VALUES (?, ?, ?, ?)').run(
    username, String(displayName || username).trim().slice(0, 80), hashPassword(password), isAdmin ? 1 : 0
  );
  res.json({ users: listUsers() });
});

const adminCount = () => db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0').get().n;

router.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  const b = req.body || {};
  if (b.displayName !== undefined) {
    const dn = String(b.displayName).trim().slice(0, 80);
    if (!dn) return res.status(400).json({ error: 'Anzeigename darf nicht leer sein.' });
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(dn, id);
  }
  if (b.isAdmin !== undefined) {
    if (!b.isAdmin && user.is_admin && adminCount() <= 1) {
      return res.status(400).json({ error: 'Es muss mindestens ein aktiver Administrator bestehen bleiben.' });
    }
    db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(b.isAdmin ? 1 : 0, id);
  }
  if (b.disabled !== undefined) {
    if (id === req.user.id && b.disabled) return res.status(400).json({ error: 'Du kannst dich nicht selbst deaktivieren.' });
    if (b.disabled && user.is_admin && adminCount() <= 1) {
      return res.status(400).json({ error: 'Es muss mindestens ein aktiver Administrator bestehen bleiben.' });
    }
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(b.disabled ? 1 : 0, id);
    if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  if (b.password !== undefined) {
    const err = validatePassword(b.password);
    if (err) return res.status(400).json({ error: err });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), id);
    if (id !== req.user.id) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  res.json({ users: listUsers() });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Du kannst dein eigenes Konto nicht löschen.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  if (user.is_admin && adminCount() <= 1) {
    return res.status(400).json({ error: 'Es muss mindestens ein aktiver Administrator bestehen bleiben.' });
  }
  // Löscht per Fremdschlüssel auch Projekte, Kabelbäume, eigene Teile, Freigaben und Sessions
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ users: listUsers() });
});

// Vollständige Datenbanksicherung herunterladen
router.get('/backup', async (req, res, next) => {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const tmp = path.join(os.tmpdir(), `harness-backup-${stamp}-${process.pid}.db`);
  try {
    await db.backup(tmp);
    res.download(tmp, `harness-designer-backup-${stamp}.db`, () => fs.rm(tmp, { force: true }, () => {}));
  } catch (e) {
    fs.rm(tmp, { force: true }, () => {});
    next(e);
  }
});

export default router;
