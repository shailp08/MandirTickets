import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';

const statusLabels = {
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
  if (!config.from || /[\r\n]/.test(config.from)) throw new Error('NOTIFICATION_FROM is required when SMTP is configured.');
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

export async function createNotificationService(directory, config = {}, dependencies = {}) {
  const options = smtpOptions(config);
  const adminEmails = parseEmailList(config.adminEmails);
  if (options && !adminEmails.length) throw new Error('ADMIN_NOTIFICATION_EMAILS must include at least one address when SMTP is configured.');
  const trackerUrl = publicTrackerUrl(config.appUrl);
  const transporter = options ? (dependencies.createTransport || nodemailer.createTransport)(options) : null;
  const filename = path.join(directory, 'notifications.json');
  const reportError = dependencies.reportError || (error => console.error('Notification delivery failed:', error.message));
  await fs.mkdir(directory, { recursive: true });
  let jobs = [];
  try {
    const stored = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (!Array.isArray(stored) || stored.some(job => !validJob(job))) throw new Error('Notification queue data is invalid.');
    jobs = stored;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
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
    jobs = next;
  }

  function mutate(operation) {
    const mutation = tail.then(async () => {
      const next = structuredClone(jobs);
      const result = operation(next);
      await save(next);
      return result;
    });
    tail = mutation.catch(() => {});
    return mutation;
  }

  const makeJob = ({ to, replyTo, subject, text }) => ({
    id: crypto.randomUUID(),
    to,
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    attempts: 0,
    createdAt: new Date().toISOString(),
    nextAttemptAt: new Date().toISOString(),
  });

  function drain() {
    if (!transporter) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      while (true) {
        await tail;
        const job = jobs.find(candidate => new Date(candidate.nextAttemptAt) <= new Date());
        if (!job) break;
        try {
          await transporter.sendMail({ from: config.from, to: job.to, replyTo: job.replyTo, subject: job.subject, text: job.text });
          await mutate(next => {
            const index = next.findIndex(candidate => candidate.id === job.id);
            if (index !== -1) next.splice(index, 1);
          });
          lastError = null;
          lastSuccess = new Date().toISOString();
        } catch (error) {
          lastError = 'Email delivery failed and will retry automatically.';
          reportError(error);
          await mutate(next => {
            const pending = next.find(candidate => candidate.id === job.id);
            if (!pending) return;
            pending.attempts++;
            const delay = Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(pending.attempts - 1, 7)));
            pending.nextAttemptAt = new Date(Date.now() + delay).toISOString();
          });
          break;
        }
      }
    })().finally(() => { running = null; });
    return running;
  }

  async function enqueue(nextJobs) {
    if (!transporter || !nextJobs.length) return false;
    await mutate(next => next.push(...nextJobs));
    void drain();
    return true;
  }

  async function ticketCreated(ticket) {
    const details = [
      `A new ${ticket.machine === 'printer' ? 'poster printing' : 'foam cutting'} ticket was submitted.`,
      '',
      `Ticket: ${ticket.ticketNumber}`,
      `Requester: ${ticket.customerName}`,
      `Department: ${ticket.department}`,
      `Needed by: ${ticket.neededBy}`,
      `Purpose: ${ticket.purpose}`,
    ].join('\n');
    return enqueue(adminEmails.map(to => makeJob({
      to,
      replyTo: ticket.email,
      subject: `[Mandir tickets] New ${ticket.ticketNumber}`,
      text: details,
    })));
  }

  async function ticketUpdated(ticket) {
    if (!ticket.email) return false;
    const label = statusLabels[ticket.status] || ticket.status;
    const text = [
      `Your Mandir workshop ticket ${ticket.ticketNumber} was updated.`,
      '',
      `Current status: ${label}`,
      `Request: ${ticket.machine === 'printer' ? 'Poster printing' : 'Foam cutting'}`,
      ...(trackerUrl ? ['', `Track your ticket: ${trackerUrl}`] : []),
    ].join('\n');
    return enqueue([makeJob({
      to: ticket.email,
      subject: `[Mandir tickets] ${ticket.ticketNumber} is ${label.toLowerCase()}`,
      text,
    })]);
  }

  const interval = setInterval(() => void drain(), 30000);
  interval.unref();
  void drain();

  return {
    ticketCreated,
    ticketUpdated,
    flush: drain,
    state: () => ({
      configured: Boolean(transporter),
      adminRecipientCount: adminEmails.length,
      pending: jobs.length,
      lastError,
      lastSuccess,
    }),
    close: () => {
      clearInterval(interval);
      transporter?.close?.();
    },
  };
}
