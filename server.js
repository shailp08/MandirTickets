import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { createStore, validateTicket, publicQueue, machines, papers, deadlines, statuses, fail } from './lib/store.js';
import { createSheetsSync, csv } from './lib/sheets.js';
import { validateFilename, validateUpload, createMalwareScanner } from './lib/uploads.js';
import { acquireProcessLock } from './lib/process-lock.js';
import { createNotificationService } from './lib/notifications.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const legacyUploads = path.join(here, 'uploads');
const production = process.env.NODE_ENV === 'production';
const scanner = createMalwareScanner(process.env.CLAMSCAN_PATH);
const appOrigin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}
const maxUploadBytes = positiveInteger(process.env.MAX_UPLOAD_BYTES, 200 * 1024 * 1024, 'MAX_UPLOAD_BYTES');
const maxUploadFiles = positiveInteger(process.env.MAX_UPLOAD_FILES, 10, 'MAX_UPLOAD_FILES');
const uploadIdleTimeoutMs = positiveInteger(process.env.UPLOAD_IDLE_TIMEOUT_MS, 60000, 'UPLOAD_IDLE_TIMEOUT_MS');
const uploadRequestTimeoutMs = positiveInteger(process.env.UPLOAD_REQUEST_TIMEOUT_MS, 30 * 60 * 1000, 'UPLOAD_REQUEST_TIMEOUT_MS');
if (production && (!scanner || !appOrigin?.startsWith('https://') || process.env.COOKIE_SECURE !== 'true' || (process.env.ADMIN_PASSWORD || '').length < 16)) {
  throw new Error('Production requires CLAMSCAN_PATH, an HTTPS APP_ORIGIN, COOKIE_SECURE=true, and an ADMIN_PASSWORD of at least 16 characters.');
}
await fs.mkdir(uploadDir, { recursive: true });
const releaseLock = acquireProcessLock(dataDir);
process.once('exit', releaseLock);
const store = await createStore(dataDir);
const sheets = createSheetsSync(store, { url: process.env.SHEETS_WEBHOOK_URL, secret: process.env.SHEETS_SHARED_SECRET });
const notifications = await createNotificationService(dataDir, {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.NOTIFICATION_FROM,
  adminEmails: process.env.ADMIN_NOTIFICATION_EMAILS,
  appUrl: process.env.APP_ORIGIN,
});
const enqueueNotification = operation => operation.catch(error => console.error('Could not queue notification:', error.message));
const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  const ownOrigin = `${req.protocol}://${req.get('host')}`;
  let requestOrigin = null;
  try { requestOrigin = req.get('origin') ? new URL(req.get('origin')).origin : null; }
  catch { return res.status(403).json({ error: 'Invalid origin.' }); }
  const allowedOrigin = requestOrigin && (requestOrigin === ownOrigin || requestOrigin === appOrigin);
  if (requestOrigin && requestOrigin === appOrigin && requestOrigin !== ownOrigin) {
    res.set({
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Headers': 'Content-Type, Idempotency-Key',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PATCH, DELETE, OPTIONS',
      Vary: 'Origin',
    });
  }
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self' https://script.google.com https://script.googleusercontent.com; img-src 'self' data:; connect-src 'self' https://script.google.com https://script.googleusercontent.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
  if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return allowedOrigin ? res.sendStatus(204) : res.sendStatus(403);
  // Browsers may only mutate data from this server or the configured frontend origin.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (requestOrigin && !allowedOrigin) return res.status(403).json({ error: 'Use this website to submit requests.' });
    if (req.get('sec-fetch-site') === 'cross-site' && requestOrigin !== appOrigin) return res.status(403).json({ error: 'Use this website to submit requests.' });
  }
  next();
});
app.use(express.json({ limit: '32kb' }));
const sessions = new Map();
const attempts = new Map();
const authCleanup = setInterval(() => {
  const now = Date.now();
  for (const [token, expires] of sessions) if (expires <= now) sessions.delete(token);
  for (const [ip, times] of attempts) if (times.every(at => now - at >= 600000)) attempts.delete(ip);
}, 60000);
authCleanup.unref();
function sessionToken(req) { return /(?:^|;\s*)desk_session=([a-f0-9]{64})(?:;|$)/.exec(req.get('cookie') || '')?.[1]; }
function sessionCookie(req) {
  const ownOrigin = `${req.protocol}://${req.get('host')}`;
  const crossSite = Boolean(appOrigin && appOrigin !== ownOrigin);
  return { httpOnly: true, sameSite: crossSite ? 'none' : 'strict', secure: crossSite || process.env.COOKIE_SECURE === 'true' };
}
function requireAdmin(req, res, next) {
  const expires = sessions.get(sessionToken(req));
  if (expires && expires > Date.now()) return next();
  res.status(401).json({ error: 'Sign in to the staff desk.' });
}
const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
app.post('/api/session', (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'Set ADMIN_PASSWORD in the local configuration before staff sign-in.' });
  const key = req.ip;
  const recent = (attempts.get(key) || []).filter(t => Date.now() - t < 600000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in ten minutes.' });
  if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') return res.status(400).json({ error: 'Send a JSON sign-in request.' });
  if (!attempts.has(key) && attempts.size >= 10000) return res.status(429).json({ error: 'Sign-in is busy. Try again later.' });
  if (typeof req.body.password !== 'string' || !sameSecret(req.body.password, process.env.ADMIN_PASSWORD)) {
    attempts.set(key, [...recent, Date.now()]); return res.status(401).json({ error: 'Incorrect staff password.' });
  }
  attempts.delete(key);
  for (const [token, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(token);
  sessions.delete(sessionToken(req));
  if (sessions.size >= 1000) return res.status(503).json({ error: 'Too many active staff sessions. Try again later.' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + 8 * 3600000);
  res.cookie('desk_session', token, { ...sessionCookie(req), maxAge: 8 * 3600000 });
  res.json({ ok: true });
});
app.delete('/api/session', (req, res) => { sessions.delete(sessionToken(req)); res.clearCookie('desk_session', sessionCookie(req)); res.json({ ok: true }); });
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/config', (_req, res) => res.json({ machines, paperTypes: papers, turnaroundOptions: deadlines, statuses,
  uploads: { maxFiles: maxUploadFiles, maxFileBytes: maxUploadBytes } }));
app.get('/api/queue', (_req, res) => res.json({ machines: publicQueue(store.list()), updatedAt: new Date().toISOString() }));
app.get('/api/track/:number', (req, res) => {
  const ticket = store.list().find(t => t.ticketNumber.toUpperCase() === req.params.number.toUpperCase());
  if (!ticket) return res.status(404).json({ error: 'Ticket not found. Check the number on your receipt.' });
  const queue = publicQueue(store.list()).find(m => m.id === ticket.machine);
  res.json({ ticketNumber: ticket.ticketNumber, machine: machines[ticket.machine], status: ticket.status,
    position: queue.tickets.find(t => t.ticketNumber === ticket.ticketNumber)?.position || null });
});
const upload = multer({ limits: { fields: 20, fieldSize: 16384, files: maxUploadFiles, fileSize: maxUploadBytes }, storage: multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).slice(0, 12)),
}), fileFilter: (_req, file, cb) => {
  try { validateFilename(file.originalname); cb(null, true); } catch (error) { cb(error); }
} });
const cleanup = files => Promise.all((files || []).map(file => fs.unlink(file.path).catch(() => {})));
let activeUploads = 0;
app.post('/api/tickets', (req, res, next) => {
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(req.get('idempotency-key') || '')) return next(Object.assign(new Error('Refresh the form and submit again.'), { status: 400 }));
  if (!req.is('multipart/form-data')) return next(Object.assign(new Error('Submit tickets using the upload form.'), { status: 415 }));
  if (activeUploads >= 4) return res.status(429).json({ error: 'The upload service is busy. Try again shortly.' });
  activeUploads++;
  let released = false;
  let idleTimer;
  let requestTimer;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads--;
    clearTimeout(idleTimer);
    clearTimeout(requestTimer);
    req.off('data', armIdleTimeout);
  };
  const abortStalledUpload = () => {
    release();
    req.destroy();
  };
  function armIdleTimeout() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abortStalledUpload, uploadIdleTimeoutMs);
    idleTimer.unref();
  }
  req.on('data', armIdleTimeout);
  req.once('end', () => { clearTimeout(idleTimer); clearTimeout(requestTimer); });
  armIdleTimeout();
  requestTimer = setTimeout(abortStalledUpload, uploadRequestTimeoutMs);
  requestTimer.unref();
  req.releaseUploadSlot = release;
  res.once('close', () => { if (!req.processingUpload) release(); });
  res.once('finish', release);
  next();
}, (req, res, next) => upload.array('files')(req, res, async error => {
  if (!error) return next();
  await cleanup(req.files);
  next(error);
}), async (req, res, next) => {
  req.processingUpload = true;
  let committed = false;
  try {
    const key = req.get('idempotency-key');
    const files = [];
    for (const file of req.files || []) files.push(await validateUpload(file, { scanner, requireScanner: production }));
    const details = validateTicket(req.body, files);
    const { ticket, duplicate } = await store.create(details, key);
    committed = !duplicate;
    if (duplicate) await cleanup(req.files);
    if (!duplicate) await enqueueNotification(notifications.ticketCreated(ticket));
    void sheets.sync();
    res.status(duplicate ? 200 : 201).json({ ticket: { ticketNumber: ticket.ticketNumber, machine: ticket.machine, status: ticket.status,
      createdAt: ticket.createdAt, department: ticket.department,
      position: publicQueue(store.list()).find(m => m.id === ticket.machine).tickets.find(t => t.ticketNumber === ticket.ticketNumber)?.position || null } });
  } catch (error) { if (!committed) await cleanup(req.files); next(error); }
  finally { req.releaseUploadSlot(); }
});
app.get('/api/tickets', requireAdmin, (_req, res) => res.json({ tickets: store.list(), sheets: sheets.state(), notifications: notifications.state() }));
app.patch('/api/tickets/:id', requireAdmin, async (req, res) => {
  if (!req.body || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 1) fail('Refresh the ticket before changing its status.');
  const ticket = await store.update(req.params.id, req.body.status, req.body.expectedRevision);
  if (ticket.revision > req.body.expectedRevision) await enqueueNotification(notifications.ticketUpdated(ticket));
  void sheets.sync();
  res.json({ ticket });
});
app.get('/api/tickets/:id/files/:name', requireAdmin, async (req, res) => {
  const ticket = store.list().find(t => t.id === req.params.id);
  const file = ticket?.files?.find(f => f.storedName === req.params.name);
  if (!file || path.basename(file.storedName) !== file.storedName) return res.sendStatus(404);
  if (production && (file.validation !== 'screened-v1' || file.scan !== 'clean')) return res.status(409).json({ error: 'This legacy file needs staff safety review before downloading in production.' });
  let location = path.join(uploadDir, file.storedName);
  try { await fs.access(location); } catch (error) { if (error.code !== 'ENOENT') throw error; location = path.join(legacyUploads, file.storedName); }
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Security-Policy': "sandbox; default-src 'none'" });
  res.download(location, file.originalName);
});
app.get('/api/export', requireAdmin, (_req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8').attachment('mandir-tickets.csv').send(csv(store.list()));
});
app.post('/api/sheets/sync', requireAdmin, async (_req, res) => res.json({ sheets: await sheets.sync() }));
app.use(express.static(path.join(here, 'dist')));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof multer.MulterError ? 400 : error.status || 500;
  if (status === 500) console.error('Ticket operation failed:', error.message);
  const uploadMessage = error instanceof multer.MulterError && ({ LIMIT_FILE_SIZE: `Each file must be no larger than ${Math.ceil(maxUploadBytes / 1024 / 1024)} MB.`,
    LIMIT_FILE_COUNT: `Attach no more than ${maxUploadFiles} files.`, LIMIT_UNEXPECTED_FILE: `Attach no more than ${maxUploadFiles} files.` })[error.code];
  res.status(status).json({ error: uploadMessage || (error.type === 'entity.parse.failed' ? 'Invalid JSON request.' : status === 500 ? 'Could not save this request. Please try again.' : error.message) });
});
const interval = setInterval(() => void sheets.sync(), 30000);
interval.unref();
void sheets.sync();
const server = app.listen(Number(process.env.PORT || 3000), () => console.log('Mandir Ticket Desk ready on port ' + server.address().port));
server.requestTimeout = uploadRequestTimeoutMs;
server.headersTimeout = Math.min(60000, uploadRequestTimeoutMs);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  clearInterval(interval); clearInterval(authCleanup); notifications.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30000).unref();
});
