// Mandir Workshop Tickets — Google Sheets + Drive backend for GitHub Pages.
// Bind this script to a private Google Sheet, run setupMandirTicketSystem once,
// then deploy it as a web app that executes as you and is reachable by Anyone.

var TICKET_SHEET = 'Tickets';
var HEADERS = [
  'Ticket ID', 'Queue number', 'Machine', 'Name', 'Department', 'Purpose', 'Phone',
  'Quantity', 'Paper', 'Width (in)', 'Length (in)', 'Thickness (in)', 'Needed by',
  'Status', 'Notes', 'Files', 'Created', 'Updated', 'Revision',
  'Tracking code', 'Request key', 'Source'
];
var STATUSES = ['queued', 'in-progress', 'ready', 'collected', 'cancelled'];
var MACHINES = { printer: 'Poster printing', foam: 'Foam cutting' };
var PAPER_TYPES = ['Polypropylene', 'Adhesive', 'Canvas', 'Glossy', 'Standard'];
var DEADLINES = ['Today', 'Tomorrow', 'This week', 'No rush'];
var MAX_FILES = 5;
var MAX_FILE_BYTES = 200 * 1024 * 1024;
var MAX_TOTAL_BYTES = 200 * 1024 * 1024;
var LEGACY_MAX_FILE_BYTES = 5 * 1024 * 1024;
var LEGACY_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
var DEFAULT_DAILY_LIMIT = 250;
var DEFAULT_DAILY_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
var DEFAULT_UPLOAD_ORIGINS = [
  'https://shailp08.github.io',
  'http://127.0.0.1:4177',
  'http://localhost:4177',
  'http://localhost:5173'
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Ticket system')
    .addItem('Set up backend', 'setupMandirTicketSystem')
    .addItem('Refresh sheet formatting', 'formatTicketSheet')
    .addItem('Audit ticket files', 'showTicketPipelineAudit')
    .addToUi();
}

function setupMandirTicketSystem() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Open this script from the Google Sheet before running setup.');
  var properties = PropertiesService.getScriptProperties();
  properties.setProperty('SPREADSHEET_ID', book.getId());
  if (!properties.getProperty('UPLOAD_FOLDER_ID')) {
    properties.setProperty('UPLOAD_FOLDER_ID', DriveApp.createFolder('Mandir Workshop Ticket Files').getId());
  }
  ensureTicketSheet_(book);
  authorizeLargeFileUploads();
  formatTicketSheet();
  SpreadsheetApp.getUi().alert('The private ticket sheet and Drive upload folder are ready. Deploy this script as a web app next.');
}

function authorizeLargeFileUploads() {
  var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files%28id%29', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Google Drive upload authorization failed with status ' + response.getResponseCode() + '.');
  return true;
}

function auditTicketPipeline() {
  var sheet = ensureTicketSheet_(openBook_());
  var folderId = PropertiesService.getScriptProperties().getProperty('UPLOAD_FOLDER_ID');
  if (!folderId) throw new Error('The upload folder is not configured. Run setup again.');
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getDisplayValues() : [];
  var report = { ok: true, tickets: rows.length, files: 0, verifiedBytes: 0, verifiedChecksums: 0, errors: [] };
  rows.forEach(function(row, rowIndex) {
    var ticketNumber = String(row[1] || 'row ' + (rowIndex + 2));
    String(row[15] || '').split('\n').filter(String).forEach(function(entry) {
      report.files++;
      var match = /\/d\/([A-Za-z0-9_-]{10,200})/.exec(entry);
      if (!match) {
        report.errors.push(ticketNumber + ': invalid Drive link');
        return;
      }
      try {
        var metadata = getDriveFileMetadata_(match[1]);
        if (metadata.trashed || metadata.parents.indexOf(folderId) === -1) report.errors.push(ticketNumber + ': file is outside the private upload folder');
        if (!Number(metadata.size) || !/^[a-f0-9]{32}$/i.test(String(metadata.md5Checksum || ''))) report.errors.push(ticketNumber + ': file is empty or missing its Drive checksum');
        else {
          report.verifiedBytes += Number(metadata.size);
          report.verifiedChecksums++;
        }
        if (String(metadata.name || '').indexOf(ticketNumber + '-') !== 0) report.errors.push(ticketNumber + ': file name does not match the ticket');
      } catch (_error) {
        report.errors.push(ticketNumber + ': Drive file could not be read');
      }
    });
  });
  report.ok = report.errors.length === 0;
  console.log(JSON.stringify(report));
  return report;
}

function showTicketPipelineAudit() {
  var report = auditTicketPipeline();
  var message = report.ok
    ? 'Audit passed: ' + report.tickets + ' tickets and ' + report.files + ' files are linked correctly.'
    : 'Audit found ' + report.errors.length + ' problem(s):\n\n' + report.errors.slice(0, 20).join('\n');
  SpreadsheetApp.getUi().alert(message);
}

function formatTicketSheet() {
  var book = openBook_();
  var sheet = ensureTicketSheet_(book);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#1d3a29')
    .setFontColor('#ffffff');
  sheet.setColumnWidths(1, HEADERS.length, 120);
  sheet.setColumnWidth(2, 105);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(6, 260);
  sheet.setColumnWidth(15, 260);
  sheet.setColumnWidth(16, 260);
  sheet.hideColumns(1);
  sheet.hideColumns(20, 2);
  var validation = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, 14, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(validation);
  return true;
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    var raw = event && event.postData ? event.postData.contents : '';
    var input = JSON.parse(raw || (event && event.parameter && event.parameter.payload) || '{}');

    // Preserve compatibility with the optional Node server's authenticated Sheets mirror.
    if (Array.isArray(input.row)) return syncServerRow_(input, lock);
    if (input.action !== 'createTicket') return jsonResponse_({ ok: false, error: 'Unsupported action.' });

    var request = validatePublicTicket_(input);
    lock.waitLock(20000);
    var properties = PropertiesService.getScriptProperties();
    var sheet = ensureTicketSheet_(openBook_());
    var existing = findRow_(sheet, 21, request.requestKey);
    if (existing) {
      properties.deleteProperty(uploadReservationKey_(request.requestKey));
      return jsonResponse_({ ok: true, duplicate: true });
    }
    enforceDailyLimit_(properties);

    var ticketNumber = nextTicketNumber_(sheet, request.machine);
    var trackingCode = randomCode_(8);
    var createdAt = new Date();
    var uploadedFiles = saveFiles_(request.files, ticketNumber, request.requestKey, properties);
    var row = [
      Utilities.getUuid(), ticketNumber, MACHINES[request.machine], request.customerName,
      request.department, request.purpose, request.phone, request.quantity,
      request.paperType, request.width, request.length, request.thickness,
      request.neededBy, 'queued', request.notes, uploadedFiles.join('\n'),
      createdAt, createdAt, 1, trackingCode, request.requestKey, 'GitHub Pages'
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row.map(escapeCell_)]);
    SpreadsheetApp.flush();
    incrementDailyCount_(properties);
    properties.deleteProperty(uploadReservationKey_(request.requestKey));
    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({ ok: false, error: safeError_(error) });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function doGet(event) {
  var callback = String(event && event.parameter && event.parameter.callback || '');
  if (!/^[A-Za-z_$][\w$]{0,80}$/.test(callback)) return jsonResponse_({ ok: false, error: 'A valid callback is required.' });
  try {
    var params = event.parameter || {};
    if (params.action === 'health') return javascriptResponse_(callback, { ok: true, service: 'Mandir Workshop Tickets' });
    if (params.action === 'beginUpload') return javascriptResponse_(callback, beginUpload_(params));
    if (params.action !== 'track') return javascriptResponse_(callback, { ok: false, error: 'Unsupported action.' });
    return javascriptResponse_(callback, trackTicket_(params));
  } catch (error) {
    return javascriptResponse_(callback, { ok: false, error: safeError_(error) });
  }
}

function trackTicket_(params) {
  var sheet = ensureTicketSheet_(openBook_());
  var rowNumber = 0;
  var byRequestKey = String(params.requestKey || '').toLowerCase();
  if (/^[a-f0-9]{32}$/.test(byRequestKey)) rowNumber = findRow_(sheet, 21, byRequestKey);
  if (!rowNumber) {
    var number = String(params.ticket || '').trim().toUpperCase();
    var code = String(params.code || '').trim().toUpperCase();
    if (!/^[PF]-\d{4,8}$/.test(number) || !/^[A-Z2-9]{8}$/.test(code)) throw new Error('Enter the ticket number and tracking code from the receipt.');
    rowNumber = findRow_(sheet, 2, number);
    if (!rowNumber) throw new Error('Ticket not found. Check the number on the receipt.');
    if (String(sheet.getRange(rowNumber, 20).getDisplayValue()).toUpperCase() !== code) throw new Error('Ticket not found. Check the number and tracking code.');
  }
  if (!rowNumber) throw new Error('The ticket is still being saved.');
  var row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  var status = String(row[13] || '').toLowerCase();
  var position = activePosition_(sheet, rowNumber, String(row[2]), status);
  return {
    ok: true,
    ticket: {
      ticketNumber: String(row[1]),
      trackingCode: String(row[19]),
      machineName: String(row[2]),
      status: status,
      position: position,
      createdAt: row[16] instanceof Date ? row[16].toISOString() : String(row[16])
    }
  };
}

function validatePublicTicket_(input) {
  if (input.website) throw new Error('Unable to accept this request.');
  validateRequestWindow_(input.startedAt);
  var machine = requiredChoice_(input.machine, MACHINES, 'Choose a machine.');
  var requestKey = String(input.requestKey || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(requestKey)) throw new Error('Refresh the form and submit again.');
  var request = {
    requestKey: requestKey,
    machine: machine,
    customerName: cleanText_(input.customerName, 'Name', 100, true),
    department: cleanText_(input.department, 'Department', 100, true),
    purpose: cleanText_(input.purpose, 'Purpose', 2000, true),
    phone: cleanText_(input.phone, 'Phone', 40, false),
    notes: cleanText_(input.notes, 'Notes', 4000, false),
    quantity: positiveNumber_(input.quantity, 'Quantity', 10000, true),
    width: positiveNumber_(input.width, 'Width', machine === 'printer' ? 24 : 10000, false),
    length: positiveNumber_(input.length, 'Length', 100000, false),
    neededBy: requiredArrayChoice_(input.neededBy, DEADLINES, 'Choose when the job is needed.'),
    paperType: '',
    thickness: '',
    files: validateFiles_(input.files || [])
  };
  if (machine === 'printer') {
    request.paperType = requiredArrayChoice_(input.paperType, PAPER_TYPES, 'Choose a paper type.');
    if (!request.files.length) throw new Error('Add at least one print-ready file.');
  } else {
    request.thickness = positiveNumber_(input.thickness, 'Foam thickness', 1000, false);
  }
  return request;
}

function validateFiles_(files) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Attach no more than ' + MAX_FILES + ' files.');
  var total = 0;
  var legacyTotal = 0;
  return files.map(function(file, index) {
    var name = String(file && file.name || '');
    var type = String(file && file.type || 'application/octet-stream').slice(0, 100);
    var size = Number(file && file.size);
    if (!name || name.length > 180 || /[\\/\u0000-\u001f]/.test(name) || !/\.(pdf|svg|dxf|png|jpe?g|tiff?)$/i.test(name)) throw new Error('Use PDF, SVG, DXF, PNG, JPG, or TIFF files with safe filenames.');
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Error('Each file must be 200 MB or smaller.');
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new Error('Attachments must total 200 MB or less.');
    var id = String(file && file.id || '');
    if (id) {
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(id) || Number(file.index) !== index) throw new Error('An uploaded file could not be verified.');
      var md5Checksum = String(file && file.md5Checksum || '').toLowerCase();
      if (!/^[a-f0-9]{32}$/.test(md5Checksum)) throw new Error('An uploaded file is missing its integrity check.');
      return { id: id, index: index, name: name, type: type, size: size, md5Checksum: md5Checksum };
    }
    var data = String(file && file.data || '');
    legacyTotal += size;
    if (size > LEGACY_MAX_FILE_BYTES || legacyTotal > LEGACY_MAX_TOTAL_BYTES) throw new Error('Refresh the page before attaching large files.');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || Math.abs(Math.floor(data.replace(/=/g, '').length * 3 / 4) - size) > 2) throw new Error('An attachment could not be verified.');
    return { name: name, type: type, size: size, data: data };
  });
}

function saveFiles_(files, ticketNumber, requestKey, properties) {
  if (!files.length) return [];
  var folderId = properties.getProperty('UPLOAD_FOLDER_ID');
  if (!folderId) throw new Error('The upload folder is not configured. Run setup again.');
  var folder = DriveApp.getFolderById(folderId);
  return files.map(function(file, index) {
    var safeName = file.name.replace(/[^A-Za-z0-9._ -]/g, '_');
    if (file.id) {
      var metadata = getDriveFileMetadata_(file.id);
      var appProperties = metadata.appProperties || {};
      var ownedByRequest = appProperties.mandirRequestKey === requestKey && String(appProperties.mandirIndex) === String(index);
      var legacyPendingName = String(metadata.name || '').indexOf(pendingFilePrefix_(requestKey, index)) === 0;
      if (metadata.trashed || metadata.parents.indexOf(folderId) === -1 || Number(metadata.size) !== file.size || (!ownedByRequest && !legacyPendingName)) throw new Error('An uploaded file could not be verified.');
      if (String(metadata.md5Checksum || '').toLowerCase() !== file.md5Checksum) throw new Error('An uploaded file failed its integrity check.');
      var uploaded = DriveApp.getFileById(file.id);
      uploaded.setName(ticketNumber + '-' + (index + 1) + '-' + safeName);
      return uploaded.getName() + ' — ' + uploaded.getUrl();
    }
    var bytes = Utilities.base64Decode(file.data);
    inspectFile_(file.name, bytes);
    var blob = Utilities.newBlob(bytes, file.type, ticketNumber + '-' + (index + 1) + '-' + safeName);
    var saved = folder.createFile(blob);
    return saved.getName() + ' — ' + saved.getUrl();
  });
}

function getDriveFileMetadata_(fileId) {
  var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=id%2Cname%2Csize%2Cparents%2Ctrashed%2Cmd5Checksum%2CappProperties', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Google Drive could not verify an uploaded file.');
  var metadata = JSON.parse(response.getContentText() || '{}');
  metadata.parents = Array.isArray(metadata.parents) ? metadata.parents : [];
  return metadata;
}

function beginUpload_(params) {
  validateRequestWindow_(params.startedAt);
  var requestKey = String(params.requestKey || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(requestKey)) throw new Error('Refresh the form and submit again.');
  var index = Number(params.index);
  if (!Number.isSafeInteger(index) || index < 0 || index >= MAX_FILES) throw new Error('Attach no more than ' + MAX_FILES + ' files.');
  var metadata = validateFiles_([{
    name: params.name,
    type: params.type,
    size: Number(params.size),
    id: 'pendingfile',
    index: 0,
    md5Checksum: '00000000000000000000000000000000'
  }])[0];
  var properties = PropertiesService.getScriptProperties();
  var origin = String(params.origin || '');
  var configuredOrigins = String(properties.getProperty('UPLOAD_ORIGINS') || '').split(',').map(function(value) { return value.trim(); }).filter(String);
  var allowedOrigins = configuredOrigins.length ? configuredOrigins : DEFAULT_UPLOAD_ORIGINS;
  if (allowedOrigins.indexOf(origin) === -1) throw new Error('Open the ticket form from the workshop website.');
  var folderId = properties.getProperty('UPLOAD_FOLDER_ID');
  if (!folderId) throw new Error('The upload folder is not configured. Run setup again.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    enforceDailyLimit_(properties);
    var reservation = checkUploadReservation_(properties, requestKey, index, metadata.size);
    var pendingName = pendingFilePrefix_(requestKey, index) + metadata.name.replace(/[^A-Za-z0-9._ -]/g, '_');
    var response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id%2Cname%2CmimeType%2Csize%2Cmd5Checksum', {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({
        name: pendingName,
        parents: [folderId],
        description: 'Pending Mandir workshop ticket upload',
        appProperties: { mandirRequestKey: requestKey, mandirIndex: String(index) }
      }),
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        Origin: origin,
        'X-Upload-Content-Type': metadata.type,
        'X-Upload-Content-Length': String(metadata.size)
      },
      followRedirects: false,
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) throw new Error('Google Drive could not start the file upload.');
    var headers = response.getAllHeaders();
    var sessionUrl = '';
    Object.keys(headers).some(function(key) {
      if (key.toLowerCase() === 'location') {
        sessionUrl = String(headers[key]);
        return true;
      }
      return false;
    });
    if (!/^https:\/\/www\.googleapis\.com\/upload\//.test(sessionUrl)) throw new Error('Google Drive did not return an upload session.');
    commitUploadReservation_(properties, reservation, index, metadata.size);
    return { ok: true, sessionUrl: sessionUrl };
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function validateRequestWindow_(value) {
  var startedAt = Number(value);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt < 800 || Date.now() - startedAt > 24 * 60 * 60 * 1000) throw new Error('Refresh the page and submit the request again.');
}

function pendingFilePrefix_(requestKey, index) {
  return '.mandir-pending-' + requestKey + '-' + index + '-';
}

function uploadReservationKey_(requestKey) {
  return 'UPLOAD_' + requestKey;
}

function checkUploadReservation_(properties, requestKey, index, size) {
  var propertyKey = uploadReservationKey_(requestKey);
  var state;
  try { state = JSON.parse(properties.getProperty(propertyKey) || '{}'); } catch (_error) { state = {}; }
  if (!state.created || Date.now() - Number(state.created) > 24 * 60 * 60 * 1000) state = { created: Date.now(), files: {} };
  if (!state.files || typeof state.files !== 'object') state.files = {};
  var projectedFiles = Object.assign({}, state.files);
  var previouslyReserved = Number(projectedFiles[index] || 0);
  projectedFiles[index] = size;
  var indexes = Object.keys(projectedFiles);
  var total = indexes.reduce(function(sum, key) { return sum + Number(projectedFiles[key] || 0); }, 0);
  if (indexes.length > MAX_FILES || total > MAX_TOTAL_BYTES) throw new Error('Attachments must total 200 MB or less.');

  var dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var daily = String(properties.getProperty('DAILY_UPLOAD_BYTES') || '').split(':');
  var used = daily[0] === dateKey ? Number(daily[1] || 0) : 0;
  var limit = Number(properties.getProperty('MAX_DAILY_UPLOAD_BYTES') || DEFAULT_DAILY_UPLOAD_BYTES);
  if (!Number.isSafeInteger(limit) || limit < MAX_FILE_BYTES) limit = DEFAULT_DAILY_UPLOAD_BYTES;
  var additionalBytes = Math.max(0, size - previouslyReserved);
  if (used + additionalBytes > limit) throw new Error('The workshop has reached today’s file upload limit. Please contact the desk.');
  return { propertyKey: propertyKey, state: state, files: projectedFiles, dateKey: dateKey, used: used, additionalBytes: additionalBytes };
}

function commitUploadReservation_(properties, reservation, index, size) {
  reservation.state.files = reservation.files;
  properties.setProperty(reservation.propertyKey, JSON.stringify(reservation.state));
  properties.setProperty('DAILY_UPLOAD_BYTES', reservation.dateKey + ':' + (reservation.used + reservation.additionalBytes));
}

function inspectFile_(name, bytes) {
  var lower = name.toLowerCase();
  if (lower.endsWith('.pdf') && !(bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70)) throw new Error('A PDF attachment is not a valid PDF.');
  if (lower.endsWith('.png') && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) throw new Error('A PNG attachment is not a valid PNG.');
  if (/\.jpe?g$/.test(lower) && !(bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217)) throw new Error('A JPG attachment is not a valid JPG.');
  if (/\.tiff?$/.test(lower) && !((bytes[0] === 73 && bytes[1] === 73) || (bytes[0] === 77 && bytes[1] === 77))) throw new Error('A TIFF attachment is not a valid TIFF.');
  if (lower.endsWith('.svg') || lower.endsWith('.dxf')) {
    var text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    if (lower.endsWith('.svg') && (!/<svg[\s>]/i.test(text) || /<script|<foreignObject|<!ENTITY|\bon\w+\s*=|javascript:|data:text\/html|url\s*\(/i.test(text))) throw new Error('SVG files must contain static vector artwork only.');
    if (lower.endsWith('.dxf') && (!/SECTION/i.test(text) || !/EOF\s*$/i.test(text))) throw new Error('The DXF attachment is incomplete.');
  }
}

function syncServerRow_(input, lock) {
  var properties = PropertiesService.getScriptProperties();
  var secret = properties.getProperty('SHARED_SECRET');
  if (!secret || input.secret !== secret || input.row.length !== 19 || typeof input.row[0] !== 'string' || !Number.isInteger(input.row[18])) return jsonResponse_({ ok: false });
  lock.waitLock(20000);
  var sheet = ensureTicketSheet_(openBook_());
  var match = findRow_(sheet, 1, input.row[0]);
  if (match && Number(sheet.getRange(match, 19).getValue()) >= input.row[18]) return jsonResponse_({ ok: true });
  var target = match || sheet.getLastRow() + 1;
  sheet.getRange(target, 1, 1, 19).setValues([input.row.map(escapeCell_)]);
  sheet.getRange(target, 22).setValue('Node API');
  SpreadsheetApp.flush();
  return jsonResponse_({ ok: true });
}

function openBook_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('The ticket backend has not been set up.');
  return SpreadsheetApp.openById(id);
}

function ensureTicketSheet_(book) {
  var sheet = book.getSheetByName(TICKET_SHEET) || book.insertSheet(TICKET_SHEET);
  if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), HEADERS.length - sheet.getMaxColumns());
  var current = sheet.getRange(1, 1, 1, HEADERS.length).getDisplayValues()[0];
  for (var i = 0; i < HEADERS.length; i++) if (!current[i]) sheet.getRange(1, i + 1).setValue(HEADERS[i]);
  return sheet;
}

function findRow_(sheet, column, value) {
  if (sheet.getLastRow() < 2) return 0;
  var match = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function nextTicketNumber_(sheet, machine) {
  var prefix = machine === 'printer' ? 'P' : 'F';
  var values = sheet.getLastRow() > 1 ? sheet.getRange(2, 2, sheet.getLastRow() - 1, 1).getDisplayValues() : [];
  var highest = values.reduce(function(max, row) {
    var match = new RegExp('^' + prefix + '-(\\d+)$').exec(String(row[0]));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return prefix + '-' + String(highest + 1).padStart(4, '0');
}

function activePosition_(sheet, rowNumber, machineName, status) {
  if (status !== 'queued' && status !== 'in-progress') return null;
  if (sheet.getLastRow() < 2) return null;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  var targetIndex = rowNumber - 2;
  var position = 0;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][2]) !== machineName) continue;
    var rowStatus = String(rows[i][13]).toLowerCase();
    if (rowStatus === 'queued' || rowStatus === 'in-progress') position++;
    if (i === targetIndex) return position || null;
  }
  return null;
}

function enforceDailyLimit_(properties) {
  var key = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var record = String(properties.getProperty('DAILY_TICKET_COUNT') || '').split(':');
  var count = record[0] === key ? Number(record[1] || 0) : 0;
  var limit = Number(properties.getProperty('MAX_DAILY_TICKETS') || DEFAULT_DAILY_LIMIT);
  if (!Number.isSafeInteger(limit) || limit < 1) limit = DEFAULT_DAILY_LIMIT;
  if (count >= limit) throw new Error('The workshop has reached today’s online request limit. Please contact the desk.');
}

function incrementDailyCount_(properties) {
  var key = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var record = String(properties.getProperty('DAILY_TICKET_COUNT') || '').split(':');
  var count = record[0] === key ? Number(record[1] || 0) : 0;
  properties.setProperty('DAILY_TICKET_COUNT', key + ':' + (count + 1));
}

function cleanText_(value, label, maxLength, required) {
  if (typeof value !== 'string') throw new Error(label + ' is invalid.');
  var text = value.replace(/\r\n?/g, '\n').trim();
  if (required && !text) throw new Error(label + ' is required.');
  if (text.length > maxLength) throw new Error(label + ' is too long.');
  return text;
}

function positiveNumber_(value, label, max, integer) {
  var number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max || (integer && !Number.isInteger(number))) throw new Error('Enter a valid ' + label.toLowerCase() + '.');
  return number;
}

function requiredChoice_(value, choices, message) {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(choices, value)) throw new Error(message);
  return value;
}

function requiredArrayChoice_(value, choices, message) {
  if (typeof value !== 'string' || choices.indexOf(value) === -1) throw new Error(message);
  return value;
}

function escapeCell_(value) {
  return typeof value === 'string' && /^\s*[=+@-]/.test(value) ? "'" + value : value;
}

function randomCode_(length) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + new Date().getTime());
  var output = '';
  for (var i = 0; i < length; i++) output += alphabet.charAt((bytes[i] + 256) % alphabet.length);
  return output;
}

function safeError_(error) {
  var message = String(error && error.message || 'The ticket could not be saved.');
  return message.length > 180 ? 'The ticket could not be saved. Please try again.' : message;
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function javascriptResponse_(callback, value) {
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(value) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}
