import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import { loadUser, cleanupSessions } from './auth.js';
import { t } from './i18n.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import projectRoutes from './routes/projects.js';
import partRoutes from './routes/parts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) {
  const v = process.env.TRUST_PROXY;
  app.set('trust proxy', /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v);
}

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; ')
  );
  next();
});

app.use('/api', express.json({ limit: '8mb' }));
app.use('/api', loadUser);

// CSRF protection: state-changing requests must carry the custom header
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'CableDesigner2000') {
    return res.status(403).json({ error: t(req, 'Invalid request.') });
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', projectRoutes);
app.use('/api', partRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: t(req, 'Unknown endpoint.') }));

// Serve the frontend
const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
}

// Error handling
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: t(req, 'The data is too large.') });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: t(req, 'Invalid JSON.') });
  console.error(err);
  res.status(500).json({ error: t(req, 'Internal server error.') });
});

cleanupSessions();
setInterval(cleanupSessions, 3600_000).unref();

app.listen(PORT, HOST, () => {
  console.log(`CableDesigner2000 listening on http://${HOST}:${PORT}`);
});
