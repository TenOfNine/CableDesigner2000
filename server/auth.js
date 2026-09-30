import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
export const COOKIE_NAME = 'hd_session';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true';

// ---------- Passwörter (scrypt) ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  if (pw.length > 200) return 'Das Passwort ist zu lang.';
  return null;
}

export function validateUsername(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9._-]{2,40}$/.test(name)) {
    return 'Benutzername: 2–40 Zeichen, erlaubt sind Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich.';
  }
  return null;
}

// ---------- Sessions ----------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token), userId, expires.toISOString()
  );
  setCookie(res, token, expires);
}

function setCookie(res, token, expires) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSession(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

function readCookie(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

export function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
}

// Middleware: hängt req.user an, wenn gültige Session vorhanden
export function loadUser(req, res, next) {
  const token = readCookie(req);
  if (!token) return next();
  const row = db
    .prepare(
      `SELECT s.token_hash, s.expires_at, u.id, u.username, u.display_name, u.is_admin, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .get(sha256(token));
  if (!row) return next();
  const expires = new Date(row.expires_at);
  if (expires < new Date() || row.disabled) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return next();
  }
  // Gleitende Verlängerung, wenn weniger als die Hälfte der Laufzeit übrig ist
  if (expires.getTime() - Date.now() < (SESSION_DAYS * 86400_000) / 2) {
    const newExpires = new Date(Date.now() + SESSION_DAYS * 86400_000);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(newExpires.toISOString(), row.token_hash);
    setCookie(res, token, newExpires);
  }
  req.user = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isAdmin: !!row.is_admin,
  };
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet.' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Nur für Administratoren.' });
  next();
}

// ---------- Einfache Login-Drosselung ----------
const attempts = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;

export function loginBlocked(key) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX_FAILS;
}
export function loginFailed(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else a.count++;
}
export function loginSucceeded(key) {
  attempts.delete(key);
}
