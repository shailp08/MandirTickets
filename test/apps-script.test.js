import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../integrations/google-sheets.gs', import.meta.url), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: 'google-sheets.gs' });

const loadContext = (globals = {}) => {
  const isolated = vm.createContext({ console, ...globals });
  vm.runInContext(source, isolated, { filename: 'google-sheets.gs' });
  return isolated;
};

const propertiesStore = initial => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getProperty: key => values.get(key) ?? null,
    getProperties: () => Object.fromEntries(values),
    setProperty: (key, value) => values.set(key, String(value)),
    deleteProperty: key => values.delete(key),
  };
};

const outboxBook = () => {
  const rows = [];
  let hidden = false;
  const sheet = {
    getLastRow: () => rows.length,
    getMaxColumns: () => 10,
    insertColumnsAfter() {},
    isSheetHidden: () => hidden,
    hideSheet() { hidden = true; },
    deleteRow(rowNumber) { rows.splice(rowNumber - 1, 1); },
    getRange(row, column, rowCount = 1, columnCount = 1) {
      return {
        setValues(values) {
          for (let r = 0; r < rowCount; r++) {
            rows[row - 1 + r] ||= [];
            for (let c = 0; c < columnCount; c++) rows[row - 1 + r][column - 1 + c] = values[r][c];
          }
        },
        setValue(value) {
          rows[row - 1] ||= [];
          rows[row - 1][column - 1] = value;
        },
        getValues: () => Array.from({ length: rowCount }, (_unused, r) =>
          Array.from({ length: columnCount }, (_unusedColumn, c) => rows[row - 1 + r]?.[column - 1 + c] ?? '')),
        getDisplayValues: () => Array.from({ length: rowCount }, (_unused, r) =>
          Array.from({ length: columnCount }, (_unusedColumn, c) => String(rows[row - 1 + r]?.[column - 1 + c] ?? ''))),
        createTextFinder(value) {
          return {
            matchEntireCell() { return this; },
            findNext() {
              const index = rows.findIndex((entry, rowIndex) => rowIndex >= row - 1 && String(entry?.[column - 1] ?? '') === value);
              return index === -1 ? null : { getRow: () => index + 1 };
            },
          };
        },
      };
    },
  };
  const book = {
    getSheetByName: name => name === 'Notification Outbox' && rows.length ? sheet : null,
    insertSheet: () => sheet,
  };
  return { book, rows, sheet };
};

const baseTicket = () => ({
  action: 'createTicket',
  requestKey: '0123456789abcdef0123456789abcdef',
  startedAt: Date.now() - 2000,
  website: '',
  machine: 'foam',
  customerName: 'Test Person',
  department: 'Events',
  purpose: 'Stage letters',
  email: 'requester@example.com',
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
    files: [{ id: 'drive_file_12345', index: 0, name: 'large-poster.pdf', type: 'application/pdf', size: 200 * 1024 * 1024, md5Checksum: '0123456789abcdef0123456789abcdef' }],
  });
  assert.equal(ticket.files[0].id, 'drive_file_12345');
  assert.equal(ticket.files[0].md5Checksum, '0123456789abcdef0123456789abcdef');
  assert.throws(() => context.validatePublicTicket_({
    ...baseTicket(),
    machine: 'printer',
    paperType: 'Standard',
    files: [
      { id: 'drive_file_12345', index: 0, name: 'one.pdf', type: 'application/pdf', size: 150 * 1024 * 1024, md5Checksum: '0123456789abcdef0123456789abcdef' },
      { id: 'drive_file_67890', index: 1, name: 'two.pdf', type: 'application/pdf', size: 51 * 1024 * 1024, md5Checksum: 'abcdef0123456789abcdef0123456789' },
    ],
  }), /200 MB/i);
});

test('Apps Script backend requires a valid Drive checksum on every direct-upload receipt', () => {
  const request = {
    ...baseTicket(),
    machine: 'printer',
    paperType: 'Standard',
    files: [{ id: 'drive_file_12345', index: 0, name: 'poster.pdf', type: 'application/pdf', size: 4096 }],
  };
  assert.throws(() => context.validatePublicTicket_(request), /integrity check/i);
  assert.throws(() => context.validatePublicTicket_({
    ...request,
    files: [{ ...request.files[0], md5Checksum: 'not-an-md5' }],
  }), /integrity check/i);
});

test('setup migrates the legacy admin recipient to the managed group only once', () => {
  const properties = propertiesStore({
    SPREADSHEET_ID: 'sheet-id',
    UPLOAD_FOLDER_ID: 'folder-id',
    ADMIN_NOTIFICATION_EMAILS: 'legacy-owner@example.com',
    NOTIFICATION_OUTBOX_STARTED_AT: new Date().toISOString(),
  });
  const alerts = [];
  const book = { getId: () => 'sheet-id' };
  const isolated = loadContext({
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book,
      getUi: () => ({ alert: message => alerts.push(message) }),
    },
  });
  isolated.ensureTicketSheet_ = () => {};
  isolated.initializeNotificationStatusMarkers_ = () => {};
  isolated.ensureNotificationSheet_ = () => {};
  isolated.installStatusNotificationTrigger_ = () => {};
  isolated.installNotificationRetryTrigger_ = () => {};
  isolated.authorizeLargeFileUploads = () => {};
  isolated.formatTicketSheet = () => {};

  isolated.setupMandirTicketSystem();
  assert.equal(properties.getProperty('ADMIN_NOTIFICATION_EMAILS'), 'demandirtickets@googlegroups.com');
  assert.equal(properties.getProperty('ADMIN_NOTIFICATION_DEFAULT_VERSION'), 'google-group-v1');
  assert.match(alerts[0], /demandirtickets@googlegroups\.com/);

  properties.setProperty('ADMIN_NOTIFICATION_EMAILS', 'replacement-group@example.com');
  isolated.setupMandirTicketSystem();
  assert.equal(properties.getProperty('ADMIN_NOTIFICATION_EMAILS'), 'replacement-group@example.com');
});

test('Apps Script backend rejects invalid dimensions, deadlines, keys, and attachments', () => {
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), email: 'not-an-email' }), /valid email/i);
  for (const email of ['a,b@example.com', 'a<victim@example.com>', 'a\0@example.com']) {
    assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), email }), /valid email/i);
  }
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), width: '0' }), /valid width/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), neededBy: 'Eventually' }), /needed/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), requestKey: 'short' }), /Refresh/i);
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), files: [{ name: 'bad.exe', size: 4, data: 'AAAAAA==' }] }), /PDF, SVG/i);
});

test('upload reservation retries charge daily bytes exactly once per request file', () => {
  const properties = propertiesStore({});
  const isolated = loadContext({
    Utilities: { formatDate: () => '2026-10-18' },
    Session: { getScriptTimeZone: () => 'America/New_York' },
  });
  const requestKey = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const size = 38 * 1024 * 1024;

  const first = isolated.checkUploadReservation_(properties, requestKey, 0, size);
  isolated.commitUploadReservation_(properties, first, 0, size);
  assert.equal(properties.getProperty('DAILY_UPLOAD_BYTES'), `2026-10-18:${size}`);

  const retry = isolated.checkUploadReservation_(properties, requestKey, 0, size);
  isolated.commitUploadReservation_(properties, retry, 0, size);
  assert.equal(properties.getProperty('DAILY_UPLOAD_BYTES'), `2026-10-18:${size}`, 'retrying the same file must not consume the quota twice');

  const secondFile = isolated.checkUploadReservation_(properties, requestKey, 1, 1024);
  isolated.commitUploadReservation_(properties, secondFile, 1, 1024);
  assert.equal(properties.getProperty('DAILY_UPLOAD_BYTES'), `2026-10-18:${size + 1024}`);
});

test('beginUpload binds Drive ownership metadata and requests an MD5 receipt', () => {
  const properties = propertiesStore({ UPLOAD_FOLDER_ID: 'private-folder' });
  let driveRequest;
  const lock = {
    waitLock() {},
    hasLock: () => true,
    releaseLock() {},
  };
  const isolated = loadContext({
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => lock },
    Utilities: { formatDate: () => '2026-10-18' },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    ScriptApp: { getOAuthToken: () => 'oauth-token' },
    UrlFetchApp: {
      fetch(url, options) {
        driveRequest = { url, options };
        return {
          getResponseCode: () => 200,
          getAllHeaders: () => ({ Location: 'https://www.googleapis.com/upload/session-id' }),
        };
      },
    },
  });
  const requestKey = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const result = isolated.beginUpload_({
    requestKey,
    startedAt: Date.now() - 2000,
    index: '0',
    name: 'poster.pdf',
    type: 'application/pdf',
    size: '4096',
    origin: 'https://shailp08.github.io',
  });

  assert.equal(result.sessionUrl, 'https://www.googleapis.com/upload/session-id');
  assert.match(driveRequest.url, /fields=.*md5Checksum/i);
  assert.deepEqual(JSON.parse(driveRequest.options.payload).appProperties, {
    mandirRequestKey: requestKey,
    mandirIndex: '0',
  });
});

test('Drive file verification checks ownership, byte count, and checksum and remains retryable after rename', () => {
  const requestKey = 'cccccccccccccccccccccccccccccccc';
  const checksum = 'abcdef0123456789abcdef0123456789';
  const metadata = {
    id: 'drive_file_12345',
    name: 'already-renamed.pdf',
    size: '4096',
    parents: ['private-folder'],
    trashed: false,
    md5Checksum: checksum,
    appProperties: { mandirRequestKey: requestKey, mandirIndex: '0' },
  };
  const names = [];
  const uploaded = {
    name: metadata.name,
    setName(name) { this.name = name; names.push(name); },
    getName() { return this.name; },
    getUrl: () => 'https://drive.example/file',
  };
  const isolated = loadContext({
    ScriptApp: { getOAuthToken: () => 'oauth-token' },
    UrlFetchApp: {
      fetch: () => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify(metadata),
      }),
    },
    DriveApp: {
      getFolderById: () => ({ createFile() { throw new Error('legacy upload was not expected'); } }),
      getFileById: () => uploaded,
    },
  });
  const properties = propertiesStore({ UPLOAD_FOLDER_ID: 'private-folder' });
  const receipt = [{
    id: metadata.id,
    index: 0,
    name: 'poster.pdf',
    type: 'application/pdf',
    size: 4096,
    md5Checksum: checksum,
  }];

  const first = isolated.saveFiles_(receipt, 'P-0001', requestKey, properties);
  const retry = isolated.saveFiles_(receipt, 'P-0001', requestKey, properties);
  assert.deepEqual([...first], ['P-0001-1-poster.pdf — https://drive.example/file']);
  assert.deepEqual([...retry], first);
  assert.deepEqual(names, ['P-0001-1-poster.pdf', 'P-0001-1-poster.pdf']);

  assert.throws(() => isolated.saveFiles_([{ ...receipt[0], md5Checksum: '00000000000000000000000000000000' }], 'P-0001', requestKey, properties), /integrity check/i);
});

test('duplicate createTicket requests write one Sheet row and reuse the first ticket', () => {
  const properties = propertiesStore({ ADMIN_NOTIFICATION_EMAILS: 'owner@example.com, helper@example.com' });
  let rowWritten = false;
  let fileSaves = 0;
  let dailyIncrements = 0;
  const emails = [];
  const writtenRows = [];
  const outbox = outboxBook();
  const lock = {
    locked: false,
    waitLock() { this.locked = true; },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; },
  };
  const sheet = {
    getLastRow: () => rowWritten ? 2 : 1,
    getRange: () => ({
      setValues(rows) {
        rowWritten = true;
        writtenRows.push(...rows);
      },
    }),
  };
  const isolated = loadContext({
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { flush() {} },
    Utilities: { getUuid: () => 'ticket-uuid' },
    MailApp: { sendEmail: message => emails.push(message) },
  });
  isolated.validatePublicTicket_ = () => ({ ...baseTicket(), machine: 'foam', files: [] });
  isolated.ensureTicketSheet_ = () => sheet;
  isolated.openBook_ = () => outbox.book;
  const findRow = isolated.findRow_;
  isolated.findRow_ = (target, column, value) => target === sheet ? (rowWritten ? 2 : 0) : findRow(target, column, value);
  isolated.enforceDailyLimit_ = () => {};
  isolated.nextTicketNumber_ = () => 'F-0001';
  isolated.randomCode_ = () => 'ABCD2345';
  isolated.saveFiles_ = () => { fileSaves++; return []; };
  isolated.incrementDailyCount_ = () => { dailyIncrements++; };
  isolated.escapeCell_ = value => value;
  isolated.jsonResponse_ = value => value;

  const event = { postData: { contents: JSON.stringify(baseTicket()) } };
  const first = isolated.doPost(event);
  const duplicate = isolated.doPost(event);

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(writtenRows.length, 1);
  assert.equal(fileSaves, 1);
  assert.equal(dailyIncrements, 1);
  assert.equal(emails.length, 1);
  assert.equal(emails[0].to, 'owner@example.com');
  assert.equal(emails[0].bcc, 'helper@example.com');
  assert.ok(emails.every(message => message.replyTo === 'requester@example.com'));
});

test('installed status edit handler emails the requester and advances revision metadata', () => {
  const sent = [];
  const writes = [];
  const outbox = outboxBook();
  const lock = {
    locked: false,
    waitLock() { this.locked = true; },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; },
  };
  const row = Array(24).fill('');
  row[1] = 'F-0007';
  row[2] = 'Foam cutting';
  row[13] = 'ready';
  row[18] = 3;
  row[22] = 'requester@example.com';
  row[23] = 'in-progress';
  const sheet = {
    getName: () => 'Tickets',
    getRange(_row, column, _rows, columns) {
      if (column === 1 && columns === 24) return { getValues: () => [row] };
      return { setValue: value => writes.push({ column, value }) };
    },
  };
  const range = {
    getSheet: () => sheet,
    getColumn: () => 14,
    getNumRows: () => 1,
    getNumColumns: () => 1,
    getDisplayValues: () => [['ready']],
    getRow: () => 2,
  };
  const isolated = loadContext({
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => propertiesStore({}) },
    SpreadsheetApp: { flush() {} },
    MailApp: { sendEmail: message => sent.push(message) },
  });
  isolated.openBook_ = () => outbox.book;

  isolated.onTicketStatusEdit({ range, oldValue: 'in-progress' });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'requester@example.com');
  assert.equal(sent[0].replyTo, 'demandirtickets@googlegroups.com');
  assert.match(sent[0].subject, /F-0007.*ready for pickup/i);
  assert.equal(writes.find(write => write.column === 19).value, 4);
  assert.ok(!Number.isNaN(Date.parse(writes.find(write => write.column === 18).value)));
});

test('installed status edit handler notifies every requester in a bulk status edit', () => {
  const sent = [];
  const writes = [];
  const outbox = outboxBook();
  const lock = {
    locked: false,
    waitLock() { this.locked = true; },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; },
  };
  const rows = [2, 3].map((rowNumber, index) => {
    const row = Array(24).fill('');
    row[0] = `ticket-${rowNumber}`;
    row[1] = `F-000${rowNumber}`;
    row[2] = 'Foam cutting';
    row[13] = 'ready';
    row[18] = index + 1;
    row[22] = `requester${rowNumber}@example.com`;
    row[23] = 'in-progress';
    return row;
  });
  const sheet = {
    getName: () => 'Tickets',
    getRange(rowNumber, column, _rowCount, columns) {
      if (column === 1 && columns === 24) return { getValues: () => [rows[rowNumber - 2]] };
      return { setValue: value => writes.push({ rowNumber, column, value }) };
    },
  };
  const range = {
    getSheet: () => sheet,
    getColumn: () => 14,
    getNumRows: () => 2,
    getNumColumns: () => 1,
    getDisplayValues: () => [['ready'], ['ready']],
    getRow: () => 2,
  };
  const isolated = loadContext({
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => propertiesStore({}) },
    SpreadsheetApp: { flush() {} },
    MailApp: { sendEmail: message => sent.push(message) },
  });
  isolated.openBook_ = () => outbox.book;

  isolated.onTicketStatusEdit({ range });

  assert.deepEqual(sent.map(message => message.to), ['requester2@example.com', 'requester3@example.com']);
  assert.deepEqual(writes.filter(write => write.column === 19).map(write => write.value), [2, 3]);
});

test('bulk status edits do not notify or revise rows already at that status', () => {
  const sent = [];
  const writes = [];
  const outbox = outboxBook();
  const properties = propertiesStore({});
  const lock = {
    locked: false,
    waitLock() { this.locked = true; },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; },
  };
  const rows = [2, 3].map(rowNumber => {
    const row = Array(24).fill('');
    row[0] = `ticket-${rowNumber}`;
    row[1] = `F-000${rowNumber}`;
    row[2] = 'Foam cutting';
    row[13] = 'ready';
    row[18] = 2;
    row[22] = `requester${rowNumber}@example.com`;
    row[23] = 'ready';
    return row;
  });
  const sheet = {
    getName: () => 'Tickets',
    getRange(rowNumber, column, _rowCount, columns) {
      if (column === 1 && columns === 24) return { getValues: () => [rows[rowNumber - 2]] };
      return { setValue: value => writes.push({ rowNumber, column, value }) };
    },
  };
  const range = {
    getSheet: () => sheet,
    getColumn: () => 14,
    getNumRows: () => 2,
    getNumColumns: () => 1,
    getDisplayValues: () => [['ready'], ['ready']],
    getRow: () => 2,
  };
  const isolated = loadContext({
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { flush() {} },
    MailApp: { sendEmail: message => sent.push(message) },
  });
  isolated.openBook_ = () => outbox.book;

  isolated.onTicketStatusEdit({ range });

  assert.equal(sent.length, 0);
  assert.equal(writes.length, 0);
});

test('Apps Script persists failed admin and customer notifications and retries them', () => {
  const outbox = outboxBook();
  const properties = propertiesStore({ ADMIN_NOTIFICATION_EMAILS: 'owner@example.com, helper@example.com' });
  const sent = [];
  let failing = true;
  const lock = {
    locked: false,
    waitLock() { this.locked = true; },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; },
  };
  const isolated = loadContext({
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { flush() {} },
    MailApp: {
      sendEmail(message) {
        if (failing) throw new Error('Mail service unavailable');
        sent.push(message);
      },
    },
  });
  isolated.openBook_ = () => outbox.book;

  assert.equal(isolated.notifyAdminsOfNewTicket_(baseTicket(), 'F-0008', properties, outbox.book), true);
  const customerRow = Array(24).fill('');
  customerRow[0] = 'ticket-id';
  customerRow[1] = 'F-0008';
  customerRow[2] = 'Foam cutting';
  customerRow[22] = 'requester@example.com';
  assert.equal(isolated.notifyCustomerOfStatus_(customerRow, 'ready', 2, outbox.book), true);

  assert.equal(outbox.rows.length, 3);
  assert.deepEqual(outbox.rows.slice(1).map(row => row[7]), [1, 1]);
  assert.ok(outbox.rows.slice(1).every(row => /Mail service unavailable/.test(row[8])));

  outbox.rows.slice(1).forEach(row => { row[9] = new Date(0); });
  failing = false;
  assert.deepEqual({ ...isolated.retryTicketNotifications() }, { sent: 2, pending: 0 });
  assert.equal(outbox.rows.length, 3);
  assert.ok(outbox.rows.slice(1).every(row => !Number.isNaN(Date.parse(row[10]))));
  assert.deepEqual(sent.map(message => message.to), ['owner@example.com', 'requester@example.com']);
  assert.equal(sent[0].bcc, 'helper@example.com');
});

test('periodic reconciliation recovers notifications missed by a status-edit lock timeout', () => {
  const outbox = outboxBook();
  const properties = propertiesStore({
    ADMIN_NOTIFICATION_EMAILS: 'owner@example.com',
    NOTIFICATION_OUTBOX_STARTED_AT: '2024-01-01T00:00:00.000Z',
  });
  const ticket = Array(24).fill('');
  ticket[0] = 'ticket-id';
  ticket[1] = 'F-0099';
  ticket[2] = 'Foam cutting';
  ticket[3] = 'Requester';
  ticket[4] = 'Events';
  ticket[5] = 'Stage sign';
  ticket[12] = 'This week';
  ticket[13] = 'ready';
  ticket[16] = new Date('2024-02-01T00:00:00.000Z');
  ticket[18] = 1;
  ticket[20] = '0123456789abcdef0123456789abcdef';
  ticket[21] = 'GitHub Pages';
  ticket[22] = 'requester@example.com';
  ticket[23] = 'in-progress';
  const metadataWrites = [];
  const ticketSheet = {
    getLastRow: () => 2,
    getRange(_row, column, _rowCount, columns) {
      if (column === 1 && columns === 24) return { getValues: () => [ticket] };
      return { setValue: value => { ticket[column - 1] = value; metadataWrites.push({ column, value }); } };
    },
  };
  let lockFails = true;
  const lock = {
    locked: false,
    waitLock() {
      if (lockFails) throw new Error('Timed out waiting for lock');
      this.locked = true;
    },
    hasLock() { return this.locked; },
    releaseLock() { this.locked = false; },
  };
  const sent = [];
  const isolated = loadContext({
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { flush() {} },
    MailApp: { sendEmail: message => sent.push(message) },
  });
  isolated.openBook_ = () => outbox.book;
  isolated.ensureTicketSheet_ = () => ticketSheet;
  const editSheet = {
    getName: () => 'Tickets',
    getRange: () => ({ getDisplayValue: () => 'ticket-id' }),
  };
  const range = {
    getSheet: () => editSheet,
    getColumn: () => 14,
    getNumRows: () => 1,
    getNumColumns: () => 1,
    getDisplayValues: () => [['ready']],
    getRow: () => 2,
  };

  assert.equal(isolated.onTicketStatusEdit({ range, oldValue: 'in-progress' }), false);
  lockFails = false;
  const findRow = isolated.findRow_;
  isolated.findRow_ = (target, column, value) => target === ticketSheet ? 2 : findRow(target, column, value);
  assert.deepEqual({ ...isolated.retryTicketNotifications() }, { sent: 2, pending: 0 });
  assert.deepEqual(sent.map(message => message.to), ['requester@example.com', 'owner@example.com']);
  assert.equal(metadataWrites.find(write => write.column === 19).value, 2);
  assert.equal(metadataWrites.find(write => write.column === 24).value, 'ready');
  assert.deepEqual({ ...isolated.retryTicketNotifications() }, { sent: 0, pending: 0 });
  assert.equal(sent.length, 2);
});
