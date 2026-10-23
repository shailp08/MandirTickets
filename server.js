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
import { createNotificationService, createNotifications } from './lib/notifications.js';
import { pricingFromEnvironment } from './lib/cost-estimate.js';
import { createGoogleWorkshop } from './lib/google-workshop.js';
import { usageCsv } from './lib/workflow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(here, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const legacyUploads = path.join(here, 'uploads');
const production = process.env.NODE_ENV === 'production';
const workshopGoogleUrl = String(process.env.WORKSHOP_GOOGLE_SCRIPT_URL || '').trim();
// Existing installations already have a private Sheets secret. Reuse it during
// the workshop migration unless a dedicated secret has been configured.
const workshopGoogleSecret = String(process.env.WORKSHOP_SHARED_SECRET || process.env.SHEETS_SHARED_SECRET || '').trim();
const googleMode = Boolean(workshopGoogleUrl);
const scanner = createMalwareScanner(process.env.CLAMSCAN_PATH);
const requestSite = process.env.PUBLIC_REQUEST_URL || '';
if (requestSite && !/^https:\/\//.test(requestSite)) throw new Error('PUBLIC_REQUEST_URL must use HTTPS.');
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
if (production && ((!googleMode && !scanner) || !appOrigin?.startsWith('https://') || process.env.COOKIE_SECURE !== 'true' || (process.env.ADMIN_PASSWORD || '').length < 16)) {
  throw new Error('Production requires CLAMSCAN_PATH for local uploads, an HTTPS APP_ORIGIN, COOKIE_SECURE=true, and an ADMIN_PASSWORD of at least 16 characters.');
}
if (process.env.STAFF_PASSWORD && process.env.STAFF_PASSWORD === process.env.ADMIN_PASSWORD) throw new Error('Staff and admin passwords must differ.');
await fs.mkdir(uploadDir, { recursive: true });
const releaseLock = acquireProcessLock(dataDir);
process.once('exit', releaseLock);
const pricing = pricingFromEnvironment(process.env);
const store = await createStore(dataDir, { pricing });
const sheets = createSheetsSync(store, { url: process.env.SHEETS_WEBHOOK_URL, secret: process.env.SHEETS_SHARED_SECRET });
const googleWorkshop = workshopGoogleUrl
  ? createGoogleWorkshop({ url: workshopGoogleUrl, secret: workshopGoogleSecret }) : null;
if (googleWorkshop && process.env.SHEETS_WEBHOOK_URL) throw new Error('Use Google as the source of truth OR a local mirror, never both.');
const defaultAdminNotificationEmail = 'demandirtickets@googlegroups.com';
const notifications = await createNotificationService(dataDir, {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  from: process.env.NOTIFICATION_FROM,
  adminEmails: process.env.ADMIN_NOTIFICATION_EMAILS || defaultAdminNotificationEmail,
  replyTo: process.env.NOTIFICATION_REPLY_TO || defaultAdminNotificationEmail,
  appUrl: process.env.APP_ORIGIN,
});
await notifications.reconcile(store.list());
const smsNotifications = await createNotifications({ directory: dataDir, apiKey: process.env.TEXTBEE_API_KEY, deviceId: process.env.TEXTBEE_DEVICE_ID });
const workshop = googleWorkshop || {
  review: (...args) => store.review(...args),
  list: async () => store.list(),
  update: (id, status, revision, reason) => store.update(id, status, revision, true, reason),
  recordUsage: (...args) => store.recordUsage(...args),
};
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
  for (const [token, session] of sessions) if (session.expires <= now) sessions.delete(token);
  for (const [ip, times] of attempts) if (times.every(at => now - at >= 600000)) attempts.delete(ip);
}, 60000);
authCleanup.unref();
function sessionToken(req) { return /(?:^|;\s*)desk_session=([a-f0-9]{64})(?:;|$)/.exec(req.get('cookie') || '')?.[1]; }
function sessionCookie(req) {
  const ownOrigin = `${req.protocol}://${req.get('host')}`;
  const crossSite = Boolean(appOrigin && appOrigin !== ownOrigin);
  return { httpOnly: true, sameSite: crossSite ? 'none' : 'strict', secure: crossSite || process.env.COOKIE_SECURE === 'true' };
}
function requireStaff(req, res, next) {
  const session = sessions.get(sessionToken(req));
  if (session && session.expires > Date.now()) { req.role = session.role; return next(); }
  res.status(401).json({ error: 'Sign in to the staff desk.' });
}
function requireAdmin(req, res, next) {
  requireStaff(req, res, () => req.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access is required to review requests.' }));
}
const sameSecret = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
app.post('/api/session', (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'Set ADMIN_PASSWORD in the local configuration before staff sign-in.' });
  const key = req.ip;
  const recent = (attempts.get(key) || []).filter(t => Date.now() - t < 600000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in ten minutes.' });
  if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') return res.status(400).json({ error: 'Send a JSON sign-in request.' });
  if (!attempts.has(key) && attempts.size >= 10000) return res.status(429).json({ error: 'Sign-in is busy. Try again later.' });
  const validInput = typeof req.body.password === 'string' && typeof req.body.username === 'string';
  const role = !validInput ? null
    : sameSecret(req.body.username, process.env.ADMIN_USERNAME || 'admin') && sameSecret(req.body.password, process.env.ADMIN_PASSWORD) ? 'admin'
      : process.env.STAFF_PASSWORD && sameSecret(req.body.username, process.env.STAFF_USERNAME || 'workshop') && sameSecret(req.body.password, process.env.STAFF_PASSWORD) ? 'staff' : null;
  if (!role) {
    attempts.set(key, [...recent, Date.now()]); return res.status(401).json({ error: 'Incorrect staff password.' });
  }
  attempts.delete(key);
  for (const [token, session] of sessions) if (session.expires <= Date.now()) sessions.delete(token);
  sessions.delete(sessionToken(req));
  if (sessions.size >= 1000) return res.status(503).json({ error: 'Too many active staff sessions. Try again later.' });
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { expires: Date.now() + 8 * 3600000, role });
  res.cookie('desk_session', token, { ...sessionCookie(req), maxAge: 8 * 3600000 });
  res.json({ ok: true, role });
});
app.delete('/api/session', (req, res) => { sessions.delete(sessionToken(req)); res.clearCookie('desk_session', sessionCookie(req)); res.json({ ok: true }); });
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get('/api/config', (_req, res) => res.json({ machines, paperTypes: papers, turnaroundOptions: deadlines, statuses,
  uploads: { maxFiles: maxUploadFiles, maxFileBytes: maxUploadBytes } }));
app.get('/api/queue', async (_req, res) => res.json({ machines: publicQueue(await workshop.list()), updatedAt: new Date().toISOString() }));
const positionFor = (ticket, tickets) => publicQueue(tickets).find(machine => machine.id === ticket.machine)
  ?.tickets.find(candidate => candidate.ticketNumber === ticket.ticketNumber)?.position || null;
const publicTicket = (ticket, tickets) => ({
  trackingNumber: ticket.trackingNumber,
  machine: ticket.machine,
  status: ticket.status,
  position: positionFor(ticket, tickets),
  costEstimate: ticket.costEstimate,
  reason: ticket.reason || '',
  createdAt: ticket.createdAt,
});
app.get('/api/track/:number', async (req, res) => {
  const number = String(req.params.number || '').trim().toUpperCase();
  const tickets = await workshop.list();
  const ticket = /^DM-[A-HJ-NP-Z2-9]{12}$/.test(number)
    ? tickets.find(candidate => candidate.trackingNumber === number) : null;
  if (!ticket) return res.status(404).json({ error: 'Request not found. Check the ticket code on your receipt.' });
  res.json(publicTicket(ticket, tickets));
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
  if (googleWorkshop) return res.status(409).json({ error: 'Use the live Google-connected request form to submit this ticket.' });
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
    res.status(duplicate ? 200 : 201).json({ ticket: { ...publicTicket(ticket, store.list()), department: ticket.department } });
  } catch (error) { if (!committed) await cleanup(req.files); next(error); }
  finally { req.releaseUploadSlot(); }
});
const visibleToStaff = ticket => !['pending-review', 'declined'].includes(ticket.status);
app.get('/api/tickets', requireStaff, async (req, res) => res.json({
  tickets: (await workshop.list()).filter(visibleToStaff).map(smsNotifications.decorate), role: req.role,
  source: googleWorkshop ? 'google' : 'local', sheets: sheets.state(), emailNotifications: notifications.state(), updatedAt: new Date().toISOString(),
}));
app.get('/api/admin/requests', requireAdmin, async (_req, res) => res.json({ tickets: (await workshop.list()).map(smsNotifications.decorate) }));
app.post('/api/admin/requests/:id/review', requireAdmin, async (req, res) => {
  if (!Number.isSafeInteger(req.body?.expectedRevision)) fail('Refresh before reviewing.');
  const ticket = await workshop.review(req.params.id, req.body, req.body.expectedRevision);
  if (!googleWorkshop) await enqueueNotification(notifications.ticketUpdated(ticket));
  void smsNotifications.reconcile(await workshop.list()).catch(error => console.error('SMS notification processing failed:', error.message));
  void sheets.sync();
  res.json({ ticket: smsNotifications.decorate(ticket) });
});
app.post('/api/tickets/:id/notifications/:notificationId/retry', requireStaff, async (req, res) => {
  const ticket = (await workshop.list()).find(candidate => candidate.id === req.params.id);
  if (!ticket || (req.role !== 'admin' && !visibleToStaff(ticket))) fail('Ticket not found.', 404);
  res.json({ ticket: await smsNotifications.retry(req.params.notificationId, ticket) });
});
app.patch('/api/tickets/:id', requireStaff, async (req, res) => {
  if (!req.body || !Number.isSafeInteger(req.body.expectedRevision) || req.body.expectedRevision < 1) fail('Refresh the ticket before changing its status.');
  if (!['in-progress', 'ready', 'collected', 'cancelled'].includes(req.body.status)) fail('Use an approved production workflow step.', 409);
  const ticket = await workshop.update(req.params.id, req.body.status, req.body.expectedRevision, req.body.reason);
  if (!googleWorkshop && ticket.revision > req.body.expectedRevision) await enqueueNotification(notifications.ticketUpdated(ticket));
  void smsNotifications.reconcile(await workshop.list()).catch(error => console.error('SMS notification processing failed:', error.message));
  void sheets.sync();
  res.json({ ticket: smsNotifications.decorate(ticket) });
});
app.get('/api/tickets/:id/files/:name', requireStaff, async (req, res) => {
  const ticket = store.list().find(t => t.id === req.params.id);
  if (ticket && req.role !== 'admin' && !visibleToStaff(ticket)) return res.sendStatus(404);
  const file = ticket?.files?.find(f => f.storedName === req.params.name);
  if (!file || path.basename(file.storedName) !== file.storedName) return res.sendStatus(404);
  if (production && (file.validation !== 'screened-v1' || file.scan !== 'clean')) return res.status(409).json({ error: 'This legacy file needs staff safety review before downloading in production.' });
  let location = path.join(uploadDir, file.storedName);
  try { await fs.access(location); } catch (error) { if (error.code !== 'ENOENT') throw error; location = path.join(legacyUploads, file.storedName); }
  res.set({ 'Content-Type': 'application/octet-stream', 'Content-Security-Policy': "sandbox; default-src 'none'" });
  res.download(location, file.originalName);
});
app.get('/api/export', requireAdmin, async (_req, res) => {
  res.set('Content-Type', 'text/csv; charset=utf-8').attachment('mandir-tickets.csv').send(csv(await workshop.list()));
});
app.post('/api/sheets/sync', requireAdmin, async (_req, res) => res.json({ sheets: await sheets.sync() }));
app.post('/api/tickets/:id/usage', requireStaff, async (req, res) => {
  if (!Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 1) fail('Refresh the ticket before recording usage.');
  const ticket = await workshop.recordUsage(req.params.id, req.body, req.body.expectedRevision);
  res.json({ ticket: smsNotifications.decorate(ticket) });
});
app.get('/api/usage/export', requireStaff, async (_req, res) => {
  res.type('text/csv').attachment('mandir-material-usage.csv').send(usageCsv(await workshop.list()));
});
const staffBuild = process.env.STAFF_BUILD_DIR || path.resolve(here, 'PrintingDashboard/build');
app.use('/staff', express.static(staffBuild));
if (googleMode) app.get('/', (_req, res) => res.redirect(requestSite || '/staff/'));
app.use(express.static(path.join(here, 'dist')));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error instanceof multer.MulterError ? 400 : error.status || 500;
  if (status === 500) console.error('Ticket operation failed:', error.message);
  const uploadMessage = error instanceof multer.MulterError && ({ LIMIT_FILE_SIZE: `Each file must be no larger than ${Math.ceil(maxUploadBytes / 1024 / 1024)} MB.`,
    LIMIT_FILE_COUNT: `Attach no more than ${maxUploadFiles} files.`, LIMIT_UNEXPECTED_FILE: `Attach no more than ${maxUploadFiles} files.` })[error.code];
  res.status(status).json({ error: uploadMessage || (error.type === 'entity.parse.failed' ? 'Invalid JSON request.' : status === 500 ? 'Could not save this request. Please try again.' : error.message) });
});
async function background() {
  await sheets.sync();
  if (!googleWorkshop) void notifications.reconcile(store.list()).catch(error => console.error('Could not reconcile email notifications:', error.message));
  try { await smsNotifications.reconcile(await workshop.list()); }
  catch (error) { console.error('SMS notification processing failed:', error.message); }
}
const interval = setInterval(() => void background(), 30000);
interval.unref();
void background();
const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log('Delaware Mandir Ticket Desk ready on port ' + server.address().port));
server.requestTimeout = uploadRequestTimeoutMs;
server.headersTimeout = Math.min(60000, uploadRequestTimeoutMs);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  clearInterval(interval); clearInterval(authCleanup); notifications.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30000).unref();
});
