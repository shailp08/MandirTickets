import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeEmail } from './notifications.js';
import { defaultPricing, estimateTicketCost } from './cost-estimate.js';

export const machines = { printer: 'Poster printing', foam: 'Foam cutting' };
export const papers = ['Polypropylene', 'Adhesive', 'Canvas', 'Glossy', 'Standard'];
export const statuses = ['queued', 'in-progress', 'ready', 'collected', 'cancelled'];
export const deadlines = ['Today', 'Tomorrow', 'This week', 'No rush'];
const DELAWARE_TIME_ZONE = 'America/New_York';
export const active = ticket => ['queued', 'in-progress'].includes(ticket.status);
const trackingAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, label, max, required = false) {
  if (value !== undefined && typeof value !== 'string') fail(`${label} must be text.`);
  const result = (value || '').trim();
  if ((required && !result) || result.length > max) fail(`${label} is ${!result ? 'required' : `limited to ${max} characters`}.`);
  return result;
}
function number(value, label, max = 100000) {
  if (!['string', 'number'].includes(typeof value) || !/^(?:\d+\.?\d*|\.\d+)$/.test(String(value).trim())) fail(`Enter a decimal number for ${label}.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0.01 || result > max) fail(`Enter a valid ${label} between 0.01 and ${max}.`);
  return result;
}
function dateInDelaware(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DELAWARE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function validateNeededBy(value, now = new Date()) {
  if (deadlines.includes(value)) return value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Choose or enter a valid needed-by date.');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail('Choose or enter a valid needed-by date.');
  }
  if (value < dateInDelaware(now)) fail('Needed-by date cannot be in the past.');
  return value;
}

function trackingNumber(tickets) {
  const used = new Set(tickets.map(ticket => String(ticket.trackingNumber || '').toUpperCase()));
  for (let attempt = 0; attempt < 100; attempt++) {
    const bytes = crypto.randomBytes(12);
    const candidate = `DM-${Array.from(bytes, byte => trackingAlphabet[byte % trackingAlphabet.length]).join('')}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not reserve a unique tracking number.');
}

export function validateTicket(body, files) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(files)) fail('Invalid ticket request.');
  if (typeof body.machine !== 'string' || !Object.hasOwn(machines, body.machine)) fail('Choose a machine.');
  if (body.unit !== undefined && body.unit !== 'in') fail('Enter dimensions in inches.');
  const quantity = number(body.quantity, 'quantity', 10000);
  if (!Number.isInteger(quantity)) fail('Quantity must be a whole number.');
  const neededBy = validateNeededBy(body.neededBy);
  let email;
  try { email = normalizeEmail(body.email); } catch (error) { fail(error.message); }
  const ticket = {
    machine: body.machine, customerName: text(body.customerName, 'Name', 100, true),
    department: text(body.department, 'Department', 100, true), purpose: text(body.purpose, 'Purpose', 2000, true),
    email, phone: text(body.phone, 'Phone', 40), notes: text(body.notes, 'Notes', 4000), quantity,
    neededBy, width: number(body.width, 'width', body.machine === 'printer' ? 24 : 10000),
    length: number(body.length, 'length'), unit: 'in', files,
  };
  if (body.machine === 'printer') {
    if (!papers.includes(body.paperType)) fail('Choose a paper type.');
    if (!files.length) fail('Attach at least one file to print.');
    ticket.paperType = body.paperType;
  } else {
    ticket.thickness = number(body.thickness, 'foam thickness', 1000);
  }
  return ticket;
}

// All read-modify-write operations run through one queue. Atomic rename keeps the
// last complete file intact if a write is interrupted. Run one app process.
export async function createStore(directory, { pricing = defaultPricing } = {}) {
  await fs.mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'tickets.json');
  let records;
  try { records = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; records = []; }
  if (!Array.isArray(records)) throw new Error('Ticket data must be an array.');
  const migrated = [];
  records = records.map(ticket => {
    const existingTrackingNumber = /^DM-[A-HJ-NP-Z2-9]{12}$/i.test(String(ticket.trackingNumber || ''))
      ? String(ticket.trackingNumber).toUpperCase() : '';
    const uniqueExistingTrackingNumber = existingTrackingNumber
      && !migrated.some(candidate => candidate.trackingNumber === existingTrackingNumber) ? existingTrackingNumber : '';
    const needsTrackingMigration = !uniqueExistingTrackingNumber;
    const revision = ticket.revision || 1;
    let needsEstimateMigration = !ticket.costEstimate;
    if (ticket.costEstimate && (!Number.isSafeInteger(ticket.costEstimate.amountCents)
      || ticket.costEstimate.amountCents < 0
      || ticket.costEstimate.amountDisplay !== `$${(ticket.costEstimate.amountCents / 100).toFixed(2)}`
      || typeof ticket.costEstimate.basis !== 'string' || typeof ticket.costEstimate.version !== 'string')) needsEstimateMigration = true;
    const migratedTicket = { ...ticket, machine: ticket.machine || 'printer',
    status: ({ new: 'queued', printing: 'in-progress', done: 'ready' })[ticket.status] || ticket.status,
    department: ticket.department || 'Not recorded', purpose: ticket.purpose || ticket.notes || 'Legacy print request',
    email: typeof ticket.email === 'string' ? ticket.email : '',
    files: Array.isArray(ticket.files) ? ticket.files : [], history: Array.isArray(ticket.history) ? ticket.history : [],
    revision, syncedRevision: ticket.syncedRevision || 0,
      trackingNumber: uniqueExistingTrackingNumber || trackingNumber(migrated),
    };
    delete migratedTicket.legacyTicketNumberLookup;
    if (needsEstimateMigration) {
      try { migratedTicket.costEstimate = estimateTicketCost(migratedTicket, pricing); }
      catch { migratedTicket.costEstimate = null; }
    }
    if (needsTrackingMigration || needsEstimateMigration) {
      migratedTicket.syncedRevision = Math.min(migratedTicket.syncedRevision, Math.max(0, revision - 1));
    }
    migrated.push(migratedTicket);
    return migratedTicket;
  });
  const save = async next => {
    const temp = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flush: true });
      await fs.rename(temp, filename);
    } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
    records = next;
  };
  await save(records);
  let tail = Promise.resolve();
  function mutate(fn) {
    const operation = tail.then(async () => {
      const next = structuredClone(records);
      const result = fn(next);
      await save(next);
      return structuredClone(result);
    });
    tail = operation.catch(() => {});
    return operation;
  }
  return {
    list: () => structuredClone(records),
    create: (details, requestKey) => mutate(tickets => {
      const existing = tickets.find(t => t.requestKey === requestKey);
      // Stored filenames are random; fingerprints use the actual design bytes and request fields.
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...details,
        files: details.files.map(({ originalName, size, sha256 }) => ({ originalName, size, sha256 })) })).digest('hex');
      if (existing) {
        if (existing.fingerprint !== fingerprint) fail(`This request was already saved as ${existing.trackingNumber}. Track that request, or reload the page to start a different request.`, 409);
        return { ticket: existing, duplicate: true };
      }
      const sequence = tickets.reduce((max, t) => t.machine === details.machine
        ? Math.max(max, t.sequence || Number(/^[PF]-(\d+)$/.exec(t.ticketNumber || '')?.[1]) || 0) : max, 0) + 1;
      if (!Number.isSafeInteger(sequence)) fail('Queue numbering is exhausted. Contact staff.', 503);
      const ticket = { ...details, id: crypto.randomUUID(), sequence,
        ticketNumber: `${details.machine === 'printer' ? 'P' : 'F'}-${String(sequence).padStart(4, '0')}`,
        trackingNumber: trackingNumber(tickets),
        costEstimate: estimateTicketCost(details, pricing),
        requestKey, fingerprint, status: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        revision: 1, syncedRevision: 0, history: [{ status: 'queued', at: new Date().toISOString() }] };
      tickets.push(ticket);
      return { ticket, duplicate: false };
    }),
    update: (id, status, expectedRevision) => mutate(tickets => {
      if (!statuses.includes(status)) fail('Choose a valid status.');
      const ticket = tickets.find(t => t.id === id);
      if (!ticket) fail('Ticket not found.', 404);
      if (expectedRevision !== undefined && expectedRevision !== ticket.revision) fail('This ticket changed in another staff session. Refresh and try again.', 409);
      if (ticket.status !== status) {
        ticket.status = status; ticket.updatedAt = new Date().toISOString(); ticket.revision++;
        ticket.completedAt = status === 'ready' ? ticket.updatedAt : status === 'collected' ? ticket.completedAt || null : null;
        (ticket.history ||= []).push({ status, at: ticket.updatedAt });
      }
      return ticket;
    }),
    markSynced: (id, revision) => mutate(tickets => {
      const ticket = tickets.find(t => t.id === id);
      if (ticket) { ticket.syncedRevision = Math.max(ticket.syncedRevision, revision); ticket.syncedAt = new Date().toISOString(); }
      return ticket;
    }),
  };
}

export function publicQueue(tickets) {
  return Object.entries(machines).map(([id, name]) => {
    const jobs = tickets.filter(t => t.machine === id).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const waiting = jobs.filter(active);
    const positions = new Map(waiting.map((ticket, index) => [ticket.id, index + 1]));
    return { id, name, waiting: waiting.length,
      tickets: jobs.filter(t => active(t) || t.status === 'ready').map(t => ({
        ticketNumber: t.ticketNumber, status: t.status, position: active(t) ? positions.get(t.id) : null,
      })) };
  });
}
