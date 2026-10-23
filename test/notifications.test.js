import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNotificationService, normalizeEmail, parseEmailList } from '../lib/notifications.js';

async function temporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mandir-notifications-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

const config = {
  host: 'smtp.example.com',
  port: '587',
  secure: 'false',
  user: 'smtp-user',
  password: 'smtp-password',
  from: 'Mandir Workshop <tickets@example.com>',
  adminEmails: 'owner@example.com, helper@example.com, OWNER@example.com',
  replyTo: 'support@example.com',
  appUrl: 'https://tickets.example.com/request',
};

const ticket = {
  id: 'ticket-id-42',
  ticketNumber: 'P-0042',
  trackingNumber: 'DM-ABCDEFGHJKLM',
  machine: 'printer',
  customerName: 'Ticket Requester',
  department: 'Events',
  purpose: 'Festival banner',
  neededBy: 'This week',
  email: 'requester@example.com',
  status: 'ready',
  revision: 2,
  createdAt: '2026-10-22T12:00:00.000Z',
  updatedAt: '2026-10-22T13:00:00.000Z',
  costEstimate: {
    amountDisplay: '$16.80',
    basis: '12.00 sq ft of glossy material plus ink',
    disclaimer: 'Approximate material cost only; final cost may change.',
  },
};

test('email validation normalizes addresses and rejects unsafe values', () => {
  assert.equal(normalizeEmail(' Person@Example.COM '), 'person@example.com');
  assert.deepEqual(parseEmailList('a@example.com, B@example.com, a@example.com'), ['a@example.com', 'b@example.com']);
  for (const value of ['', 'not-an-email', 'a@example.com\nBcc: victim@example.com', 'a,b@example.com',
    'a<victim@example.com>', 'a\0@example.com', '.leading@example.com', 'two..dots@example.com']) {
    assert.throws(() => normalizeEmail(value));
  }
});

test('notification service emails every admin once and emails the requester on status changes', async t => {
  const sent = [];
  const service = await createNotificationService(await temporaryDirectory(t), config, {
    createTransport: options => ({
      sendMail: async message => sent.push({ options, message }),
      close() {},
    }),
  });
  t.after(() => service.close());

  await service.ticketCreated(ticket);
  await service.flush();
  assert.deepEqual(sent.map(item => item.message.to), ['owner@example.com', 'helper@example.com']);
  assert.ok(sent.every(item => item.options.requireTLS === true));
  assert.ok(sent.every(item => item.message.replyTo === ticket.email));
  assert.match(sent[0].message.text, /DM-ABCDEFGHJKLM/);
  assert.match(sent[0].message.text, /Approximate material cost: \$16\.80/);

  await service.ticketUpdated(ticket);
  await service.flush();
  assert.equal(sent[2].message.to, ticket.email);
  assert.equal(sent[2].message.replyTo, 'support@example.com');
  assert.match(sent[2].message.subject, /ready for pickup/i);
  assert.match(sent[2].message.subject, /DM-ABCDEFGHJKLM/);
  assert.match(sent[2].message.text, /Approximate material cost: \$16\.80/);
  assert.match(sent[2].message.text, /https:\/\/tickets\.example\.com\/#tracker/);
  assert.deepEqual(service.state(), {
    configured: true,
    adminRecipientCount: 2,
    pending: 0,
    lastError: null,
    lastSuccess: service.state().lastSuccess,
  });
  assert.ok(!Number.isNaN(Date.parse(service.state().lastSuccess)));
});

test('failed delivery remains in the persistent retry queue without rejecting the ticket operation', async t => {
  const errors = [];
  const directory = await temporaryDirectory(t);
  const service = await createNotificationService(directory, config, {
    createTransport: () => ({ sendMail: async () => { throw new Error('SMTP unavailable'); }, close() {} }),
    reportError: error => errors.push(error.message),
  });
  t.after(() => service.close());

  assert.equal(await service.ticketUpdated(ticket), true);
  await service.flush();
  assert.equal(service.state().pending, 1);
  assert.match(service.state().lastError, /retry/i);
  assert.deepEqual(errors, ['SMTP unavailable']);
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'notifications.json'), 'utf8'));
  assert.equal(stored.jobs.length, 1);
  assert.equal(stored.jobs[0].attempts, 1);
  service.close();

  stored.jobs[0].nextAttemptAt = new Date(0).toISOString();
  await fs.writeFile(path.join(directory, 'notifications.json'), JSON.stringify(stored));
  const recovered = [];
  const restarted = await createNotificationService(directory, config, {
    createTransport: () => ({ sendMail: async message => recovered.push(message), close() {} }),
  });
  t.after(() => restarted.close());
  await restarted.flush();
  assert.equal(restarted.state().pending, 0);
  assert.equal(recovered[0].to, ticket.email);
});

test('startup reconciliation recovers post-activation crash gaps without back-emailing old tickets', async t => {
  const directory = await temporaryDirectory(t);
  let clock = new Date('2026-10-22T12:00:00.000Z');
  const first = await createNotificationService(directory, config, {
    now: () => clock,
    createTransport: () => ({ sendMail: async () => {}, close() {} }),
  });
  first.close();

  const sent = [];
  clock = new Date('2026-10-22T12:05:00.000Z');
  const restarted = await createNotificationService(directory, config, {
    now: () => clock,
    createTransport: () => ({ sendMail: async message => sent.push(message), close() {} }),
  });
  t.after(() => restarted.close());
  const oldTicket = { ...ticket, id: 'old', revision: 1, createdAt: '2026-10-22T11:59:59.000Z', updatedAt: '2026-10-22T11:59:59.000Z' };
  const missedCreation = { ...ticket, id: 'new', revision: 1, status: 'queued', createdAt: '2026-10-22T12:00:01.000Z', updatedAt: '2026-10-22T12:00:01.000Z' };
  const missedUpdate = { ...ticket, id: 'updated', createdAt: '2026-10-22T11:00:00.000Z', updatedAt: '2026-10-22T12:00:02.000Z' };

  assert.equal(await restarted.reconcile([oldTicket, missedCreation, missedUpdate]), true);
  await restarted.flush();
  assert.deepEqual(sent.map(message => message.to), ['owner@example.com', 'helper@example.com', 'requester@example.com']);
  assert.equal(await restarted.reconcile([oldTicket, missedCreation, missedUpdate]), false);
  await restarted.flush();
  assert.equal(sent.length, 3);
  const stored = JSON.parse(await fs.readFile(path.join(directory, 'notifications.json'), 'utf8'));
  assert.equal(stored.jobs.length, 0);
  assert.equal(Object.keys(stored.delivered).length, 3);
});

test('notification service can remain disabled until SMTP is configured', async t => {
  const directory = await temporaryDirectory(t);
  const service = await createNotificationService(directory, { port: '587', secure: 'false', adminEmails: 'owner@example.com' });
  t.after(() => service.close());
  assert.equal(await service.ticketCreated(ticket), false);
  assert.equal(service.state().configured, false);
  assert.equal(service.state().pending, 0);
  await assert.rejects(createNotificationService(directory, { host: 'smtp.example.com' }), /NOTIFICATION_FROM/);
  await assert.rejects(createNotificationService(directory, { ...config, adminEmails: '' }), /ADMIN_NOTIFICATION_EMAILS/);
});
