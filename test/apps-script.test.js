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

const blob = bytes => ({
  getBytes: () => Array.from(bytes),
  getDataAsString: charset => Buffer.from(bytes).toString(String(charset).toUpperCase() === 'UTF-8' ? 'utf8' : 'latin1'),
});

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

test('Apps Script backend accepts calendar deadlines and removes the legacy notes marker', () => {
  const ticket = context.validatePublicTicket_({ ...baseTicket(), neededByDate: '2099-12-31', notes: 'Needed by date: 2099-12-31\nBlue logo' });
  assert.equal(ticket.neededBy, '2099-12-31');
  assert.equal(ticket.notes, 'Blue logo');
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), neededByDate: '2099-02-29' }), /valid needed-by date/i);
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

test('Apps Script backend enforces machine-specific file formats', () => {
  assert.throws(() => context.validatePublicTicket_({
    ...baseTicket(),
    machine: 'printer',
    files: [{ name: 'cut.svg', type: 'image/svg+xml', size: 4, data: 'PHN2Zz4=' }],
  }), /PDF or JPG/i);
  assert.throws(() => context.validatePublicTicket_({
    ...baseTicket(),
    files: [{ name: 'photo.jpg', type: 'image/jpeg', size: 4, data: '/9j/2Q==' }],
  }), /SVG or DXF/i);
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
  assert.throws(() => context.validatePublicTicket_({ ...baseTicket(), files: [{ name: 'bad.exe', size: 4, data: 'AAAAAA==' }] }), /SVG or DXF/i);
  assert.throws(() => context.validatePublicTicket_({
    ...baseTicket(),
    files: [{ id: 'drive_file_12345', index: 0, name: 'huge.svg', type: 'image/svg+xml', size: 10 * 1024 * 1024 + 1, md5Checksum: '0123456789abcdef0123456789abcdef' }],
  }), /10 MB/i);
});

test('public queue reads only public columns, caches snapshots, and survives cache failures', () => {
  let reads = 0;
  let cached = null;
  let failCacheWrites = false;
  const cache = {
    get: () => cached,
    put: (_key, value) => {
      if (failCacheWrites) throw new Error('cache full');
      cached = value;
    },
    remove: () => { cached = null; },
  };
  const isolated = loadContext({ CacheService: { getScriptCache: () => cache } });
  const row = ['id-1', 'P-0001', 'Poster printing', 'Queue Name', '', '', '', 1, '', 24, 36, '', 'Today', 'queued', '', '', '2026-10-26T12:00:00Z'];
  isolated.publicQueueRows_ = () => { reads++; return [row]; };

  assert.equal(isolated.publicWorkshopQueue_().machines[0].tickets[0].ticketNumber, 'P-0001');
  assert.equal(isolated.publicWorkshopQueue_().machines[0].tickets[0].ticketNumber, 'P-0001');
  assert.equal(reads, 1);

  isolated.invalidatePublicQueueCache_();
  failCacheWrites = true;
  assert.doesNotThrow(() => isolated.publicWorkshopQueue_());
  assert.equal(reads, 2);
  assert.doesNotThrow(() => isolated.invalidatePublicQueueCache_());
});

test('Apps Script re-reads Drive bytes and validates direct PDF, JPG, SVG and DXF uploads', () => {
  const makeContext = content => loadContext({
    ScriptApp: { getOAuthToken: () => 'oauth-token' },
    Utilities: { newBlob: bytes => blob(bytes) },
    UrlFetchApp: {
      fetch(_url, options) {
        const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
        assert.ok(match);
        const start = Number(match[1]);
        const end = Number(match[2]);
        return {
          getResponseCode: () => 206,
          getAllHeaders: () => ({ 'Content-Range': `bytes ${start}-${end}/${content.length}` }),
          getBlob: () => blob(content.subarray(start, end + 1)),
        };
      },
    },
  });
  const validPdf = Buffer.from('%PDF-1.7\nbody\n%%EOF\n');
  const valid = makeContext(validPdf);
  assert.doesNotThrow(() => valid.inspectDriveFile_(
    { id: 'drive_file_valid', name: 'poster.pdf' },
    { size: String(validPdf.length) },
    {},
  ));

  const disguised = Buffer.from('not really a pdf');
  const invalid = makeContext(disguised);
  assert.throws(() => invalid.inspectDriveFile_(
    { id: 'drive_file_fake', name: 'poster.pdf' },
    { size: String(disguised.length) },
    {},
  ), /not a valid PDF/i);

  const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
  const image = makeContext(validJpg);
  assert.doesNotThrow(() => image.inspectDriveFile_(
    { id: 'drive_file_image', name: 'photo.jpg' },
    { size: String(validJpg.length) },
    {},
  ));

  const benignSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="24" height="24" fill="url(#g)"/></svg>');
  const svg = makeContext(benignSvg);
  assert.doesNotThrow(() => svg.inspectDriveFile_(
    { id: 'drive_file_svg', name: 'design.svg' },
    { size: String(benignSvg.length) },
    { getBlob: () => blob(benignSvg) },
  ));

  const benignDxf = Buffer.from('0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n24\n21\n12\n0\nENDSEC\n0\nEOF\n');
  const dxf = makeContext(benignDxf);
  assert.doesNotThrow(() => dxf.inspectDriveFile_(
    { id: 'drive_file_dxf', name: 'design.dxf' },
    { size: String(benignDxf.length) },
    { getBlob: () => blob(benignDxf) },
  ));

  const activeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const vector = makeContext(activeSvg);
  assert.throws(() => vector.inspectDriveFile_(
    { id: 'drive_file_svg', name: 'design.svg' },
    { size: String(activeSvg.length) },
    { getBlob: () => blob(activeSvg) },
  ), /unsupported|active/i);

  const remoteSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="url(https://example.invalid/a)"/></svg>');
  const remote = makeContext(remoteSvg);
  assert.throws(() => remote.inspectDriveFile_(
    { id: 'drive_file_remote_svg', name: 'design.svg' },
    { size: String(remoteSvg.length) },
    { getBlob: () => blob(remoteSvg) },
  ), /external resources/i);
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

test('abandoned upload cleanup trashes only expired pending files and removes stale reservations', () => {
  const now = Date.now();
  const oldKey = `UPLOAD_${'a'.repeat(32)}`;
  const freshKey = `UPLOAD_${'b'.repeat(32)}`;
  const properties = propertiesStore({
    UPLOAD_FOLDER_ID: 'private-folder',
    [oldKey]: JSON.stringify({ created: now - 25 * 60 * 60 * 1000, files: { 0: 10 } }),
    [freshKey]: JSON.stringify({ created: now - 60 * 60 * 1000, files: { 0: 10 } }),
  });
  const files = [
    { name: `.mandir-pending-${'a'.repeat(32)}-0-old.pdf`, created: now - 25 * 60 * 60 * 1000, trashed: false },
    { name: `.mandir-pending-${'b'.repeat(32)}-0-new.pdf`, created: now - 60 * 60 * 1000, trashed: false },
    { name: 'P-0001-1-poster.pdf', created: now - 25 * 60 * 60 * 1000, trashed: false },
  ].map(record => ({
    record,
    getName: () => record.name,
    getDateCreated: () => new Date(record.created),
    setTrashed: value => { record.trashed = value; },
  }));
  let index = 0;
  const isolated = loadContext({
    console: { ...console, log() {} },
    PropertiesService: { getScriptProperties: () => properties },
    DriveApp: { getFolderById: () => ({ getFiles: () => ({ hasNext: () => index < files.length, next: () => files[index++] }) }) },
  });

  assert.equal(isolated.cleanupAbandonedUploads(), 1);
  assert.equal(files[0].record.trashed, true);
  assert.equal(files[1].record.trashed, false);
  assert.equal(files[2].record.trashed, false);
  assert.equal(properties.getProperty(oldKey), null);
  assert.notEqual(properties.getProperty(freshKey), null);
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
    machine: 'printer',
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
  let inspections = 0;
  isolated.inspectDriveFile_ = () => { inspections++; };
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
  assert.equal(inspections, 2);

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
    getRange: (_row, column) => ({
      setValues(rows) {
        rowWritten = true;
        writtenRows.push(...rows);
      },
      getDisplayValue: () => column === 32 ? writtenRows[0]?.[31] || '' : '',
      setValue(value) { if (column === 32 && writtenRows[0]) writtenRows[0][31] = value; },
    }),
  };
  const isolated = loadContext({
    console: { ...console, error() {} },
    LockService: { getScriptLock: () => lock },
    PropertiesService: { getScriptProperties: () => properties },
    SpreadsheetApp: { flush() {} },
    Utilities: { getUuid: () => 'ticket-uuid' },
  });
  isolated.validatePublicTicket_ = input => ({ ...baseTicket(), ...input, machine: 'foam', files: [] });
  isolated.requestFingerprint_ = request => JSON.stringify({ customerName: request.customerName, files: request.files });
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
  const mismatch = isolated.doPost({ postData: { contents: JSON.stringify({ ...baseTicket(), customerName: 'Changed Person' }) } });

  assert.equal(first.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /different details or files/i);
  assert.equal(writtenRows.length, 1);
  assert.equal(writtenRows[0][13], 'pending-review');
  assert.equal(writtenRows[0].length, 32);
  assert.equal(writtenRows[0].slice(22, 27).join(','), ',,,,');
  assert.equal(writtenRows[0][27], '[]');
  assert.equal(writtenRows[0][28], '[]');
  assert.equal(fileSaves, 1);
  assert.equal(dailyIncrements, 1);
});
