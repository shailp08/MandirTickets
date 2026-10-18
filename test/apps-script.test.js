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
    setProperty: (key, value) => values.set(key, String(value)),
    deleteProperty: key => values.delete(key),
  };
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

test('Apps Script backend rejects invalid dimensions, deadlines, keys, and attachments', () => {
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
  const properties = propertiesStore({});
  let rowWritten = false;
  let fileSaves = 0;
  let dailyIncrements = 0;
  const writtenRows = [];
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
  });
  isolated.validatePublicTicket_ = () => ({ ...baseTicket(), machine: 'foam', files: [] });
  isolated.ensureTicketSheet_ = () => sheet;
  isolated.openBook_ = () => ({});
  isolated.findRow_ = () => rowWritten ? 2 : 0;
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
});
