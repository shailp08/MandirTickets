import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { formatCostEstimate } from './cost-estimate.js';

const statusLabels = {
  'pending-review': 'Awaiting review',
  declined: 'Declined',
  queued: 'Waiting',
  'in-progress': 'Being made',
  ready: 'Ready for pickup',
  collected: 'Picked up',
  cancelled: 'Cancelled',
};

const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeEmail(value, label = 'Email') {
  if (typeof value !== 'string') throw new Error(`${label} must be an email address.`);
  const email = value.trim().toLowerCase();
  const local = email.split('@')[0];
  if (!email || email.length > 254 || local.length > 64 || local.startsWith('.') || local.endsWith('.')
    || local.includes('..') || !EMAIL_PATTERN.test(email)) {
    throw new Error(`Enter a valid ${label.toLowerCase()}.`);
  }
  return email;
}

export function parseEmailList(value = '') {
  const addresses = String(value).split(',').map(address => address.trim()).filter(Boolean);
  return [...new Set(addresses.map(address => normalizeEmail(address, 'Admin notification email')))];
}

function smtpOptions(config) {
  const supplied = [config.host, config.user, config.password, config.from]
    .some(value => value !== undefined && value !== '');
  if (!supplied) return null;
  if (typeof config.host !== 'string' || !config.host.trim() || /\s/.test(config.host)) throw new Error('SMTP_HOST must be a hostname.');
  const port = config.port === undefined || config.port === '' ? 587 : Number(config.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be a valid port number.');
  if (!['', undefined, 'true', 'false'].includes(config.secure)) throw new Error('SMTP_SECURE must be true or false.');
  if (typeof config.from !== 'string' || !config.from.trim() || /[\r\n]/.test(config.from)) {
    throw new Error('NOTIFICATION_FROM is required when SMTP is configured.');
  }
  if (Boolean(config.user) !== Boolean(config.password)) throw new Error('Set both SMTP_USER and SMTP_PASSWORD, or leave both empty for an unauthenticated relay.');
  return {
    host: config.host.trim(),
    port,
    secure: config.secure === 'true',
    ...(config.user && config.secure !== 'true' ? { requireTLS: true } : {}),
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
    ...(config.user ? { auth: { user: config.user, pass: config.password } } : {}),
  };
}

function publicTrackerUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return `${url.origin}/#tracker`;
  } catch {
    return '';
  }
}

function validJob(job) {
  return job && typeof job === 'object' && typeof job.id === 'string' && typeof job.to === 'string'
    && typeof job.subject === 'string' && typeof job.text === 'string' && Number.isSafeInteger(job.attempts)
    && !Number.isNaN(Date.parse(job.createdAt)) && !Number.isNaN(Date.parse(job.nextAttemptAt));
}

function validTimestampMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(timestamp => !Number.isNaN(Date.parse(timestamp)));
}

function validLedger(value) {
  return value && value.version === 1 && Array.isArray(value.jobs) && value.jobs.every(validJob)
    && validTimestampMap(value.events) && validTimestampMap(value.delivered)
    && (value.reconciliationStartedAt === null || !Number.isNaN(Date.parse(value.reconciliationStartedAt)));
}

export async function createNotificationService(directory, config = {}, dependencies = {}) {
  const options = smtpOptions(config);
  const notificationFrom = options ? config.from.trim() : '';
  const adminEmails = parseEmailList(config.adminEmails);
  if (options && !adminEmails.length) throw new Error('ADMIN_NOTIFICATION_EMAILS must include at least one address when SMTP is configured.');
  const notificationReplyTo = config.replyTo ? normalizeEmail(config.replyTo, 'Notification reply-to email') : adminEmails[0] || '';
  const trackerUrl = publicTrackerUrl(config.appUrl);
  const transporter = options ? (dependencies.createTransport || nodemailer.createTransport)(options) : null;
  const filename = path.join(directory, 'notifications.json');
  const reportError = dependencies.reportError || (error => console.error('Notification delivery failed:', error.message));
  const now = dependencies.now || (() => new Date());
  const nowIso = () => new Date(now()).toISOString();
  await fs.mkdir(directory, { recursive: true });
  let ledger;
  let needsInitialSave = false;
  try {
    const stored = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (Array.isArray(stored)) {
      if (stored.some(job => !validJob(job))) throw new Error('Notification queue data is invalid.');
      ledger = { version: 1, reconciliationStartedAt: transporter ? nowIso() : null, jobs: stored, events: {}, delivered: {} };
      needsInitialSave = true;
    } else {
      if (!validLedger(stored)) throw new Error('Notification queue data is invalid.');
      ledger = stored;
      if (transporter && !ledger.reconciliationStartedAt) {
        ledger.reconciliationStartedAt = nowIso();
        needsInitialSave = true;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ledger = { version: 1, reconciliationStartedAt: transporter ? nowIso() : null, jobs: [], events: {}, delivered: {} };
    needsInitialSave = true;
  }

  let lastError = null;
  let lastSuccess = null;
  let tail = Promise.resolve();
  let running = null;

  async function save(next) {
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flush: true });
      await fs.rename(temporary, filename);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    ledger = next;
  }

  if (needsInitialSave) await save(ledger);

  function mutate(operation) {
    const mutation = tail.then(async () => {
      const next = structuredClone(ledger);
      const result = operation(next);
      await save(next);
      return result;
    });
    tail = mutation.catch(() => {});
    return mutation;
  }

  const makeJob = ({ id, to, replyTo, subject, text }) => ({
    id,
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    attempts: 0,
    createdAt: nowIso(),
    nextAttemptAt: nowIso(),
  });

  const ticketIdentity = ticket => String(ticket.id || ticket.requestKey || ticket.trackingNumber || ticket.ticketNumber);

  function createdEvent(ticket) {
    return `ticket-created:${ticketIdentity(ticket)}`;
  }

  function updatedEvent(ticket) {
    return `ticket-updated:${ticketIdentity(ticket)}:${ticket.revision}:${ticket.status}`;
  }

  function createdJobs(ticket) {
    const reference = ticket.trackingNumber || ticket.ticketNumber;
    const estimate = formatCostEstimate(ticket.costEstimate);
    const details = [
      `A new ${ticket.machine === 'printer' ? 'poster printing' : 'foam cutting'} ticket was submitted.`,
      '',
      `Ticket code: ${reference}`,
      `Requester: ${ticket.customerName}`,
      `Department: ${ticket.department}`,
      `Needed by: ${ticket.neededBy}`,
      `Purpose: ${ticket.purpose}`,
      ...(estimate ? ['', estimate] : []),
    ].join('\n');
    const event = createdEvent(ticket);
    return adminEmails.map(to => makeJob({
      id: `${event}:admin:${to}`,
      to,
      replyTo: ticket.email,
      subject: `[Delaware Mandir tickets] New ${reference}`,
      text: details,
    }));
  }

  function updatedJobs(ticket) {
    if (!ticket.email) return [];
    const reference = ticket.trackingNumber || ticket.ticketNumber;
    const estimate = formatCostEstimate(ticket.costEstimate);
    const label = statusLabels[ticket.status] || ticket.status;
    const text = [
      `Your Delaware Mandir workshop request ${reference} was updated.`,
      '',
      `Current status: ${label}`,
      `Request: ${ticket.machine === 'printer' ? 'Poster printing' : 'Foam cutting'}`,
      ...(estimate ? ['', estimate] : []),
      ...(trackerUrl ? ['', `Track your ticket: ${trackerUrl}`] : []),
    ].join('\n');
    const event = updatedEvent(ticket);
    return [makeJob({
      id: `${event}:customer:${ticket.email}`,
      to: ticket.email,
      replyTo: notificationReplyTo,
      subject: `[Delaware Mandir tickets] ${reference} is ${label.toLowerCase()}`,
      text,
    })];
  }

  function drain() {
    if (!transporter) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      while (true) {
        await tail;
        const job = ledger.jobs.find(candidate => new Date(candidate.nextAttemptAt) <= new Date(now()));
        if (!job) break;
        try {
          await transporter.sendMail({ from: notificationFrom, to: job.to, replyTo: job.replyTo, subject: job.subject, text: job.text });
          await mutate(next => {
            const index = next.jobs.findIndex(candidate => candidate.id === job.id);
            if (index !== -1) next.jobs.splice(index, 1);
            next.delivered[job.id] = nowIso();
          });
          if (!ledger.jobs.length) lastError = null;
          lastSuccess = new Date().toISOString();
        } catch (error) {
          lastError = 'Email delivery failed and will retry automatically.';
          reportError(error);
          await mutate(next => {
            const pending = next.jobs.find(candidate => candidate.id === job.id);
            if (!pending) return;
            pending.attempts++;
            const delay = Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(pending.attempts - 1, 7)));
            pending.nextAttemptAt = new Date(new Date(now()).getTime() + delay).toISOString();
          });
          break;
        }
      }
    })().finally(() => { running = null; });
    return running;
  }

  async function enqueue(nextJobs, event) {
    if (!transporter || !nextJobs.length) return false;
    const added = await mutate(next => {
      if (next.events[event]) return false;
      for (const job of nextJobs) {
        if (!next.delivered[job.id] && !next.jobs.some(candidate => candidate.id === job.id)) next.jobs.push(job);
      }
      next.events[event] = nowIso();
      return true;
    });
    if (!added) return false;
    void drain();
    return true;
  }

  async function ticketCreated(ticket) {
    return enqueue(createdJobs(ticket), createdEvent(ticket));
  }

  async function ticketUpdated(ticket) {
    return enqueue(updatedJobs(ticket), updatedEvent(ticket));
  }

  async function reconcile(tickets) {
    if (!transporter || !ledger.reconciliationStartedAt || !Array.isArray(tickets)) return false;
    const threshold = Date.parse(ledger.reconciliationStartedAt);
    let queued = false;
    for (const ticket of tickets) {
      const createdAt = Date.parse(ticket.createdAt);
      if (!ledger.events[createdEvent(ticket)] && Number.isFinite(createdAt) && createdAt >= threshold) {
        queued = await enqueue(createdJobs(ticket), createdEvent(ticket)) || queued;
      }
      const updatedAt = Date.parse(ticket.updatedAt);
      if (Number(ticket.revision) > 1 && !ledger.events[updatedEvent(ticket)]
        && Number.isFinite(updatedAt) && updatedAt >= threshold) {
        queued = await enqueue(updatedJobs(ticket), updatedEvent(ticket)) || queued;
      }
    }
    return queued;
  }

  const interval = setInterval(() => void drain(), 30000);
  interval.unref();
  void drain();

  return {
    ticketCreated,
    ticketUpdated,
    reconcile,
    flush: drain,
    state: () => ({
      configured: Boolean(transporter),
      adminRecipientCount: adminEmails.length,
      pending: ledger.jobs.length,
      lastError,
      lastSuccess,
    }),
    close: () => {
      clearInterval(interval);
      transporter?.close?.();
    },
  };
}

// SMS uses a separate journal from email so either channel can be enabled or
// restarted without interpreting the other channel's persistence format.
export async function createNotifications({ directory, apiKey, deviceId, fetcher = fetch }) {
  const filename = path.join(directory, 'sms-notifications.json');
  let records = {};
  try { records = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const save = async () => {
    const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(records, null, 2) + '\n', { mode: 0o600, flush: true });
      await fs.rename(temporary, filename);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  };
  for (const notification of Object.values(records)) {
    if (notification.state === 'sending') {
      notification.state = 'unknown';
      notification.detail = 'Server restarted during send. Check Textbee before contacting the requester again.';
    }
  }
  await save();
  let tail = Promise.resolve();
  const serial = operation => {
    const pending = tail.then(operation);
    tail = pending.catch(() => {});
    return pending;
  };
  const configured = Boolean(apiKey && deviceId);
  const decorate = ticket => ({ ...ticket, notifications: Object.values(records)
    .filter(notification => notification.ticketId === ticket.id)
    .map(({ phone, ...notification }) => notification) });

  async function send(notification) {
    notification.state = 'sending';
    notification.detail = '';
    await save();
    try {
      const message = `DE Mandir: ${notification.ticketNumber} ${notification.status === 'ready' ? 'is ready for pickup.'
        : notification.status === 'declined' ? 'was declined. Please check your ticket for the reason.'
          : 'was cancelled. Please check your ticket for details.'}`;
      const response = await fetcher('https://api.textbee.dev/api/v1/gateway/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ deviceId, recipients: [notification.phone], message }),
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.data?.success === true && typeof body.data.smsBatchId === 'string') {
        notification.state = 'accepted';
        notification.batchId = body.data.smsBatchId;
        notification.detail = 'Textbee accepted the text. Delivery is not yet confirmed; check the Textbee dashboard.';
      } else if ([400, 401, 403, 404, 429].includes(response.status)) {
        notification.state = 'failed';
        notification.detail = response.status === 429
          ? 'Textbee free-tier limit reached. Retry after the allowance resets, or contact the requester manually.'
          : `Textbee rejected this send (${response.status}). Check the account, API key, device and SIM before retrying.`;
      } else {
        notification.state = 'unknown';
        notification.detail = 'Textbee did not confirm the outcome. Check its dashboard before contacting the requester again.';
      }
    } catch {
      notification.state = 'unknown';
      notification.detail = 'Connection interrupted during send. Check Textbee before contacting the requester again.';
    }
    notification.updatedAt = new Date().toISOString();
    await save();
  }

  return {
    configured,
    decorate,
    reconcile: tickets => serial(async () => {
      for (const ticket of tickets) {
        for (let index = 0; index < (ticket.history || []).length; index++) {
          const history = ticket.history[index];
          const event = history.notification;
          if (!event || !['ready', 'cancelled', 'declined'].includes(event.status) || !/^\+[1-9]\d{7,14}$/.test(event.phone || '')) continue;
          const key = crypto.createHash('sha256').update(`${ticket.id}:${index}:${history.at}:${event.status}`).digest('hex');
          records[key] ||= { id: key, ticketId: ticket.id, ticketNumber: event.ticketNumber, phone: event.phone,
            status: event.status, state: 'pending', updatedAt: history.at,
            detail: configured ? 'Waiting to send.' : 'Textbee is not connected yet.' };
          const notification = records[key];
          if (notification.state === 'pending' && ticket.status !== notification.status) {
            notification.state = 'superseded';
            notification.detail = 'Ticket moved on before this notification was sent.';
          }
          await save();
          if (notification.state === 'pending' && configured) await send(notification);
        }
      }
    }),
    retry: (id, ticket) => serial(async () => {
      const notification = records[id];
      if (!notification || notification.ticketId !== ticket.id) throw Object.assign(new Error('Notification not found.'), { status: 404 });
      if (!configured || notification.state !== 'failed' || ticket.status !== notification.status) {
        throw Object.assign(new Error('Only a rejected notification for the current status can be retried. Check Textbee configuration and refresh.'), { status: 409 });
      }
      await send(notification);
      return decorate(ticket);
    }),
  };
}
