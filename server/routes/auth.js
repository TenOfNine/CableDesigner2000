import express from 'express';
import { db } from '../db.js';
import { t, LANGUAGES } from '../i18n.js';
import {
  hashPassword, verifyPassword, validatePassword, validateUsername,
  createSession, clearSession, requireUser, loginBlocked, loginFailed, loginSucceeded,
} from '../auth.js';

const router = express.Router();

const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

router.get('/setup', (req, res) => {
  res.json({ needsSetup: userCount() === 0 });
});

// Initial setup: the first user becomes administrator
router.post('/setup', (req, res) => {
  if (userCount() > 0) return res.status(409).json({ error: t(req, 'Setup has already been completed.') });
  const { username, displayName, password, language } = req.body || {};
  const err = validateUsername(username) || validatePassword(password);
  if (err) return res.status(400).json({ error: t(req, err) });
  const lang = LANGUAGES.includes(language) ? language : 'de';
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, is_admin, language) VALUES (?, ?, ?, 1, ?)')
    .run(username, (displayName || username).trim().slice(0, 80), hashPassword(password), lang);
  createSession(res, info.lastInsertRowid);
  res.json({ ok: true });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `${req.ip}|${String(username || '').toLowerCase()}`;
  if (loginBlocked(key)) {
    return res.status(429).json({ error: t(req, 'Too many failed attempts. Please try again in 15 minutes.') });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    loginFailed(key);
    return res.status(401).json({ error: t(req, 'Wrong username or password.') });
  }
  if (user.disabled) return res.status(403).json({ error: t(req, 'This account is disabled.') });
  loginSucceeded(key);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  createSession(res, user.id);
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: t(req, 'Not signed in.') });
  res.json({ user: req.user });
});

router.post('/password', requireUser, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(currentPassword || ''), user.password_hash)) {
    return res.status(400).json({ error: t(req, 'The current password is wrong.') });
  }
  const err = validatePassword(newPassword);
  if (err) return res.status(400).json({ error: t(req, err) });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

router.patch('/profile', requireUser, (req, res) => {
  const b = req.body || {};
  if (b.displayName !== undefined) {
    const displayName = String(b.displayName || '').trim().slice(0, 80);
    if (!displayName) return res.status(400).json({ error: t(req, 'Display name must not be empty.') });
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.user.id);
  }
  if (b.language !== undefined) {
    if (!LANGUAGES.includes(b.language)) return res.status(400).json({ error: t(req, 'Unsupported language.') });
    db.prepare('UPDATE users SET language = ? WHERE id = ?').run(b.language, req.user.id);
  }
  res.json({ ok: true });
});

// Directory for sharing (minimal fields only)
router.get('/directory', requireUser, (req, res) => {
  const users = db
    .prepare('SELECT id, username, display_name AS displayName FROM users WHERE disabled = 0 AND id != ? ORDER BY display_name')
    .all(req.user.id);
  res.json({ users });
});

export default router;
