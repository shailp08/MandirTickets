import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../integrations/google-sheets.gs', import.meta.url), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: 'google-sheets.gs' });

const baseTicket = () => ({
  action: 'createTicket',
  requestKey: '0123456789abcdef0123456789abcdef',
  startedAt: Date.now() - 2000,
  website: '',
  machine: 'foam',
  customerName: 'Test Person',
  department: 'Events',
  purpose: 'Stage letters',
  phone: '',
  notes: '',
  quantity: '2',
  width: '20',
  length: '36',
  thickness: '2',
  neededBy: 'This week',
  files: [],
});

test('Apps Script backend validates a complete foam ticket', () => {
  const ticket = context.validatePublicTicket_(baseTicket());
  assert.equal(ticket.machine, 'foam');
  assert.equal(ticket.quantity, 2);
  assert.equal(ticket.thickness, 2);
});

test('Apps Script backend requires a safe print file and rejects bot submissions', () => {
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), machine: 'printer', paperType: 'Standard' }), /print-ready file/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), website: 'spam' }), /Unable to accept/i);
  const ticket = context.validatePublicTicket_({
    ...baseTicket(),
    machine: 'printer',
    paperType: 'Canvas',
    files: [{ name: 'art.pdf', type: 'application/pdf', size: 4, data: 'JVBERg==' }],
  });
  assert.equal(ticket.files[0].name, 'art.pdf');
});

test('Apps Script backend accepts private Drive receipts up to 200 MB total', () => {
  const ticket = context.validatePublicTicket_({
    ...baseTicket(),
    machine: 'printer',
    paperType: 'Standard',
    files: [{ id: 'drive_file_12345', index: 0, name: 'large-poster.pdf', type: 'application/pdf', size: 200 * 1024 * 1024 }],
  });
  assert.equal(ticket.files[0].id, 'drive_file_12345');
  assert.throws(() => context.validatePublicTicket_({
    ...baseTicket(),
    machine: 'printer',
    paperType: 'Standard',
    files: [
      { id: 'drive_file_12345', index: 0, name: 'one.pdf', type: 'application/pdf', size: 150 * 1024 * 1024 },
      { id: 'drive_file_67890', index: 1, name: 'two.pdf', type: 'application/pdf', size: 51 * 1024 * 1024 },
    ],
  }), /200 MB/i);
});

test('Apps Script backend rejects invalid dimensions, deadlines, keys, and attachments', () => {
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), width: '0' }), /valid width/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), neededBy: 'Eventually' }), /needed/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), requestKey: 'short' }), /Refresh/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), files: [{ name: 'bad.exe', size: 4, data: 'AAAAAA==' }] }), /PDF, SVG/i);
});
