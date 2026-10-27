// Mandir Workshop Tickets — Google Sheets + Drive backend for GitHub Pages.
// Bind this script to a private Google Sheet, run setupMandirTicketSystem once,
// then deploy it as a web app that executes as you and is reachable by Anyone.

var TICKET_SHEET = 'Tickets';
var HEADERS = [
  'Ticket ID', 'Queue number', 'Machine', 'Name', 'Department', 'Purpose', 'Phone',
  'Quantity', 'Paper', 'Width (in)', 'Length (in)', 'Thickness (in)', 'Needed by',
  'Status', 'Notes', 'Files', 'Created', 'Updated', 'Revision',
  'Tracking code', 'Request key', 'Source', 'Customer email', 'Last notified status',
  'Approx. cost (USD)', 'Cost basis', 'Cost estimate version',
  'Material usage', 'Staff history', 'SMS consent', 'Review reason', 'Request fingerprint'
];
var STATUSES = ['pending-review', 'declined', 'queued', 'in-progress', 'ready', 'collected', 'cancelled'];
var MACHINES = { printer: 'Poster printing', foam: 'Foam cutting' };
var PAPER_TYPES = ['Polypropylene', 'Adhesive', 'Canvas', 'Glossy', 'Standard'];
var DEADLINES = ['Today', 'Tomorrow', 'This week', 'No rush'];
var MAX_FILES = 5;
var MAX_FILE_BYTES = 200 * 1024 * 1024;
var MAX_TOTAL_BYTES = 200 * 1024 * 1024;
var MAX_VECTOR_FILE_BYTES = 10 * 1024 * 1024;
var LEGACY_MAX_FILE_BYTES = 5 * 1024 * 1024;
var LEGACY_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
var DEFAULT_DAILY_LIMIT = 250;
var DEFAULT_DAILY_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
var PUBLIC_QUEUE_CACHE_KEY = 'PUBLIC_QUEUE_V2';
var PUBLIC_QUEUE_CACHE_SECONDS = 10;
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
    .addItem('Clean abandoned uploads', 'cleanupAbandonedUploads')
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
  sheet.hideColumns(32);
  var validation = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, 14, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(validation);
  return true;
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    var raw = event && event.postData ? event.postData.contents : '';
    var input = JSON.parse(raw || (event && event.parameter && event.parameter.payload) || '{}');

    if (input.action === 'publicQueue') return jsonResponse_(publicWorkshopQueue_());
    if (['staffList', 'staffUpdate', 'staffUsage', 'adminReview'].indexOf(input.action) !== -1) return staffAction_(input, lock, input.publicStaff === true);
    // Preserve compatibility with the optional Node server's authenticated Sheets mirror.
    if (Array.isArray(input.row)) return syncServerRow_(input, lock);
    if (input.action !== 'createTicket') return jsonResponse_({ ok: false, error: 'Unsupported action.' });

    var request = validatePublicTicket_(input);
    var requestFingerprint = requestFingerprint_(request);
    lock.waitLock(20000);
    var properties = PropertiesService.getScriptProperties();
    var sheet = ensureTicketSheet_(openBook_());
    var existing = findRow_(sheet, 21, request.requestKey);
    if (existing) {
      var existingFingerprint = String(sheet.getRange(existing, 32).getDisplayValue() || '');
      if (existingFingerprint && existingFingerprint !== requestFingerprint) throw new Error('This request was already saved with different details or files. Reload the form to start a new request.');
      if (!existingFingerprint) sheet.getRange(existing, 32).setValue(requestFingerprint);
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
      request.neededBy, 'pending-review', request.notes, uploadedFiles.join('\n'),
      createdAt, createdAt, 1, trackingCode, request.requestKey, 'GitHub Pages',
      '', '', '', '', '', '[]', '[]', request.smsConsent ? 'yes' : '', '', requestFingerprint
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row.map(escapeCell_)]);
    SpreadsheetApp.flush();
    invalidatePublicQueueCache_();
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
    if (params.action === 'queue') return javascriptResponse_(callback, publicWorkshopQueue_());
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
      reason: String(row[30] || ''),
      createdAt: row[16] instanceof Date ? row[16].toISOString() : String(row[16])
    }
  };
}

function validatePublicTicket_(input) {
  if (input.website) throw new Error('Unable to accept this request.');
  validateRequestWindow_(input.startedAt);
  var machine = requiredChoice_(input.machine, MACHINES, 'Choose a machine.');
  var notesInput = String(input.notes || '');
  if (input.neededByDate) {
    var compatibilityPrefix = 'Needed by date: ' + String(input.neededByDate);
    if (notesInput.indexOf(compatibilityPrefix) === 0) notesInput = notesInput.slice(compatibilityPrefix.length).replace(/^\n/, '');
  }
  var requestKey = String(input.requestKey || '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(requestKey)) throw new Error('Refresh the form and submit again.');
  var request = {
    requestKey: requestKey,
    machine: machine,
    customerName: cleanText_(input.customerName, 'Name', 100, true),
    department: cleanText_(input.department, 'Department', 100, true),
    purpose: cleanText_(input.purpose, 'Purpose', 2000, true),
    phone: cleanText_(input.phone, 'Phone', 40, false),
    smsConsent: input.smsConsent === true || input.smsConsent === 'true' || input.smsConsent === 'on',
    notes: cleanText_(notesInput, 'Notes', 4000, false),
    quantity: positiveNumber_(input.quantity, 'Quantity', 10000, true),
    width: positiveNumber_(input.width, 'Width', machine === 'printer' ? 24 : 10000, false),
    length: positiveNumber_(input.length, 'Length', 100000, false),
    neededBy: neededByDate_(input.neededByDate || input.neededBy),
    paperType: '',
    thickness: '',
    files: validateFiles_(input.files || [], machine)
  };
  if (machine === 'printer') {
    if (!request.files.length) throw new Error('Add at least one print-ready file.');
  } else {
    request.thickness = positiveNumber_(input.thickness, 'Foam thickness', 1000, false);
  }
  request.phone = normalizePhone(request.phone, request.smsConsent);
  return request;
}

function requestFingerprint_(request) {
  var canonical = JSON.stringify({
    machine: request.machine,
    customerName: request.customerName,
    department: request.department,
    purpose: request.purpose,
    phone: request.phone,
    smsConsent: request.smsConsent,
    notes: request.notes,
    quantity: request.quantity,
    width: request.width,
    length: request.length,
    thickness: request.thickness,
    neededBy: request.neededBy,
    paperType: request.paperType,
    files: request.files.map(function(file) {
      return file.id
        ? { id: file.id, index: file.index, name: file.name, type: file.type, size: file.size, md5Checksum: file.md5Checksum }
        : { name: file.name, type: file.type, size: file.size, data: file.data };
    })
  });
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical, Utilities.Charset.UTF_8);
  return digest.map(function(value) { return (value + 256).toString(16).slice(-2); }).join('');
}

function neededByDate_(value) {
  var text = String(value || '').trim();
  if (DEADLINES.indexOf(text) !== -1) return text;
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new Error('Choose a valid needed-by date.');
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== text) throw new Error('Choose a valid needed-by date.');
  return text;
}

function validateFiles_(files, machine) {
  if (!Array.isArray(files) || files.length > MAX_FILES) throw new Error('Attach no more than ' + MAX_FILES + ' files.');
  var format = machine === 'printer'
    ? { pattern: /\.(pdf|jpe?g)$/i, message: 'Poster printing accepts PDF or JPG files only.' }
    : machine === 'foam'
      ? { pattern: /\.(svg|dxf)$/i, message: 'Foam cutting accepts SVG or DXF files only.' }
      : null;
  if (!format) throw new Error('Choose a machine.');
  var total = 0;
  var legacyTotal = 0;
  return files.map(function(file, index) {
    var name = String(file && file.name || '');
    var type = String(file && file.type || 'application/octet-stream').slice(0, 100);
    var size = Number(file && file.size);
    if (!name || name.length > 180 || /[\\/\u0000-\u001f]/.test(name)) throw new Error('Use a safe filename under 180 characters.');
    if (!format.pattern.test(name)) throw new Error(format.message);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Error('Each file must be 200 MB or smaller.');
    if (/\.(svg|dxf)$/i.test(name) && size > MAX_VECTOR_FILE_BYTES) throw new Error('SVG and DXF files must be 10 MB or smaller so their full contents can be checked.');
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
      inspectDriveFile_(file, metadata, uploaded);
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

function responseHeader_(response, wanted) {
  var headers = response.getAllHeaders ? response.getAllHeaders() : {};
  var value = '';
  Object.keys(headers).some(function(key) {
    if (key.toLowerCase() === wanted.toLowerCase()) {
      value = String(headers[key]);
      return true;
    }
    return false;
  });
  return value;
}

function readDriveRange_(fileId, start, end, size) {
  var response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media', {
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      Range: 'bytes=' + start + '-' + end
    },
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  if (code !== 206 && !(code === 200 && start === 0 && end === size - 1)) throw new Error('Google Drive could not verify the uploaded file contents.');
  if (code === 206 && responseHeader_(response, 'Content-Range') !== 'bytes ' + start + '-' + end + '/' + size) throw new Error('Google Drive returned an incomplete file range.');
  var bytes = response.getBlob().getBytes();
  if (bytes.length !== end - start + 1) throw new Error('Google Drive returned an incomplete file range.');
  return bytes;
}

function byte_(value) {
  return value < 0 ? value + 256 : value;
}

function inspectDriveFile_(file, metadata, uploaded) {
  var lower = file.name.toLowerCase();
  var size = Number(metadata.size);
  if (/\.(svg|dxf)$/.test(lower)) {
    var vectorBytes = uploaded.getBlob().getBytes();
    if (vectorBytes.length !== size) throw new Error('Google Drive returned incomplete vector artwork.');
    inspectFile_(file.name, vectorBytes);
    return;
  }
  var prefix = readDriveRange_(file.id, 0, Math.min(size - 1, 15), size);
  var suffix = readDriveRange_(file.id, Math.max(0, size - 2048), size - 1, size);
  if (lower.endsWith('.pdf')) {
    var header = Utilities.newBlob(prefix).getDataAsString('ISO-8859-1');
    var footer = Utilities.newBlob(suffix).getDataAsString('ISO-8859-1');
    if (!/^%PDF-(1\.[0-7]|2\.0)[\r\n ]/.test(header) || !/%%EOF\s*$/.test(footer)) throw new Error('A PDF attachment is incomplete or is not a valid PDF.');
    return;
  }
  if (/\.jpe?g$/.test(lower) && !(byte_(prefix[0]) === 255 && byte_(prefix[1]) === 216 && byte_(prefix[2]) === 255 && byte_(suffix[suffix.length - 2]) === 255 && byte_(suffix[suffix.length - 1]) === 217)) {
    throw new Error('A JPG attachment is not a valid JPG.');
  }
}

function beginUpload_(params) {
  validateRequestWindow_(params.startedAt);
  var machine = requiredChoice_(params.machine, MACHINES, 'Choose a machine.');
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
  }], machine)[0];
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

function cleanupAbandonedUploads() {
  var properties = PropertiesService.getScriptProperties();
  var folderId = properties.getProperty('UPLOAD_FOLDER_ID');
  if (!folderId) throw new Error('The upload folder is not configured. Run setup again.');
  var cutoff = Date.now() - 24 * 60 * 60 * 1000;
  var removedReservations = 0;
  var allProperties = properties.getProperties();
  Object.keys(allProperties).forEach(function(key) {
    if (!/^UPLOAD_[a-f0-9]{32}$/.test(key)) return;
    var state;
    try { state = JSON.parse(allProperties[key]); } catch (_error) { state = null; }
    if (!state || !Number.isFinite(Number(state.created)) || Number(state.created) < cutoff) {
      properties.deleteProperty(key);
      removedReservations++;
    }
  });
  var files = DriveApp.getFolderById(folderId).getFiles();
  var removed = 0;
  while (files.hasNext()) {
    var file = files.next();
    if (/^\.mandir-pending-[a-f0-9]{32}-\d+-/.test(file.getName()) && file.getDateCreated().getTime() < cutoff) {
      file.setTrashed(true);
      removed++;
    }
  }
  console.log('Removed ' + removed + ' abandoned upload(s) and ' + removedReservations + ' stale reservation(s).');
  return removed;
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
  if (lower.endsWith('.pdf') && !(byte_(bytes[0]) === 37 && byte_(bytes[1]) === 80 && byte_(bytes[2]) === 68 && byte_(bytes[3]) === 70 && /%%EOF\s*$/.test(Utilities.newBlob(bytes.slice(-2048)).getDataAsString('ISO-8859-1')))) throw new Error('A PDF attachment is incomplete or is not a valid PDF.');
  if (lower.endsWith('.png') && !(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71)) throw new Error('A PNG attachment is not a valid PNG.');
  if (/\.jpe?g$/.test(lower) && !(byte_(bytes[0]) === 255 && byte_(bytes[1]) === 216 && byte_(bytes[bytes.length - 2]) === 255 && byte_(bytes[bytes.length - 1]) === 217)) throw new Error('A JPG attachment is not a valid JPG.');
  if (/\.tiff?$/.test(lower) && !((bytes[0] === 73 && bytes[1] === 73) || (bytes[0] === 77 && bytes[1] === 77))) throw new Error('A TIFF attachment is not a valid TIFF.');
  if (lower.endsWith('.svg') || lower.endsWith('.dxf')) {
    var text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
    if (text.indexOf('\uFFFD') !== -1) throw new Error('SVG and ASCII DXF files must use valid UTF-8 text.');
    if (lower.endsWith('.svg')) inspectSvgText_(text);
    if (lower.endsWith('.dxf')) inspectDxfText_(text);
  }
}

function decodeSvgAttribute_(value) {
  var output = '';
  var position = 0;
  var entity = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/ig;
  var match;
  while ((match = entity.exec(value))) {
    if (value.slice(position, match.index).indexOf('&') !== -1) throw new Error('SVG contains an invalid entity.');
    output += value.slice(position, match.index);
    var name = match[1].toLowerCase();
    var code = name === 'amp' ? 38 : name === 'lt' ? 60 : name === 'gt' ? 62 : name === 'quot' ? 34 : name === 'apos' ? 39
      : name.indexOf('#x') === 0 ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    if (!Number.isSafeInteger(code) || code < 1 || code > 0x10ffff) throw new Error('SVG contains an invalid entity.');
    output += String.fromCodePoint(code);
    position = entity.lastIndex;
  }
  if (value.slice(position).indexOf('&') !== -1) throw new Error('SVG contains an invalid entity.');
  return output + value.slice(position);
}

function inspectSvgText_(text) {
  var tags = {};
  'svg g defs title desc path rect circle ellipse line polyline polygon text tspan linearGradient radialGradient stop clipPath'.split(' ').forEach(function(name) { tags[name] = true; });
  var attributes = {};
  'id version x y x1 y1 x2 y2 cx cy r rx ry width height viewBox preserveAspectRatio d points transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity clip-path clip-rule font-family font-size font-weight font-style text-anchor dominant-baseline dx dy rotate offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy fr'.split(' ').forEach(function(name) { attributes[name] = true; });
  var stack = [];
  var rootSeen = false;
  var rootClosed = false;
  var inTag = false;
  var quote = '';
  var token = '';

  function processTag(value) {
    if (/^<[!?]/.test(value)) throw new Error('SVG declarations, comments, CDATA and processing instructions are not supported.');
    var closing = /^<\/([A-Za-z][\w.-]*)\s*>$/.exec(value);
    if (closing) {
      if (!stack.length || stack.pop() !== closing[1]) throw new Error('SVG elements are not correctly nested.');
      if (!stack.length) rootClosed = true;
      return;
    }
    var body = value.slice(1, -1);
    var selfClosing = /\/\s*$/.test(body);
    if (selfClosing) body = body.replace(/\/\s*$/, '');
    var nameMatch = /^([A-Za-z][\w.-]*)/.exec(body);
    if (!nameMatch || !tags[nameMatch[1]]) throw new Error('SVG contains unsupported or active elements.');
    var name = nameMatch[1];
    var isRoot = !rootSeen;
    if (isRoot) {
      if (name !== 'svg') throw new Error('The SVG must have an svg root element.');
      rootSeen = true;
    } else if (rootClosed || !stack.length) {
      throw new Error('SVG must contain one root element.');
    }
    var rest = body.slice(name.length);
    var sawNamespace = false;
    while (rest.length) {
      var attribute = /^\s+([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest);
      if (!attribute) throw new Error('SVG contains malformed or unsupported attributes.');
      var attributeName = attribute[1];
      var attributeValue = decodeSvgAttribute_(attribute[2] === undefined ? attribute[3] : attribute[2]);
      var specialAttribute = false;
      if (attributeName === 'xmlns' && attributeValue === 'http://www.w3.org/2000/svg' && name === 'svg') { sawNamespace = true; specialAttribute = true; }
      else if (attributeName === 'xml:space' && (attributeValue === 'default' || attributeValue === 'preserve')) specialAttribute = true;
      else if (attributeName.indexOf(':') !== -1 || !attributes[attributeName]) throw new Error('SVG contains unsupported attributes. Remove scripts, styles and external resources.');
      if (!specialAttribute && /\\|\/\*|(?:https?|data|javascript):/i.test(attributeValue)) throw new Error('SVG escaped styles and external resources are not allowed.');
      if (!specialAttribute && /url\s*\(/i.test(attributeValue) && !/^url\(#[A-Za-z_][\w.-]*\)$/.test(attributeValue)) throw new Error('SVG external resources are not allowed.');
      rest = rest.slice(attribute[0].length);
    }
    if (isRoot && !sawNamespace) throw new Error('SVG must declare the standard SVG namespace.');
    if (!selfClosing) stack.push(name);
    else if (!stack.length) rootClosed = true;
    if (stack.length > 100) throw new Error('SVG nesting is too complex. Export a flattened PDF instead.');
  }

  for (var index = 0; index < text.length; index++) {
    var character = text[index];
    if (!inTag) {
      if (character === '<') {
        inTag = true;
        token = '<';
      } else if ((!rootSeen || rootClosed) && !/\s/.test(character)) {
        throw new Error('SVG contains data outside its root element.');
      }
      continue;
    }
    token += character;
    if (token.length > 262144) throw new Error('An SVG element is too complex. Export a flattened PDF instead.');
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') {
      processTag(token);
      inTag = false;
      token = '';
    }
  }
  if (inTag || !rootSeen || stack.length || !rootClosed) throw new Error('The SVG is empty, truncated or not well formed.');
}

function inspectDxfText_(text) {
  if (text.indexOf('\u0000') !== -1) throw new Error('Binary DXF is not supported. Export an ASCII DXF.');
  var lines = text.replace(/\r/g, '').split('\n');
  var code = null;
  var section = false;
  var sectionName = false;
  var sawSection = false;
  var eof = false;
  lines.forEach(function(raw) {
    var value = raw.trim();
    if (!value && code === null) return;
    if (eof) {
      if (value) throw new Error('DXF has data after its EOF marker.');
      return;
    }
    if (raw.length > 262144) throw new Error('A DXF record is too long.');
    if (code === null) {
      if (!/^\d{1,4}$/.test(value) || Number(value) > 1071) throw new Error('DXF contains an invalid group code.');
      code = Number(value);
      return;
    }
    var group = code;
    code = null;
    if (sectionName) {
      if (group !== 2 || !/^[A-Z0-9_]+$/.test(value)) throw new Error('DXF section name is missing.');
      sectionName = false;
      return;
    }
    if (group === 0 && value === 'SECTION') {
      if (section) throw new Error('DXF sections cannot be nested.');
      section = true; sectionName = true; sawSection = true;
    } else if (group === 0 && value === 'ENDSEC') {
      if (!section) throw new Error('DXF has an unmatched ENDSEC.');
      section = false;
    } else if (group === 0 && value === 'EOF') {
      if (section || !sawSection) throw new Error('DXF is incomplete.');
      eof = true;
    } else if (!section && group !== 999) throw new Error('DXF data must be inside a section.');
    var numeric = (group >= 10 && group <= 79) || (group >= 110 && group <= 149) || (group >= 160 && group <= 179) || (group >= 210 && group <= 239) || (group >= 270 && group <= 299) || (group >= 370 && group <= 389) || (group >= 400 && group <= 409) || (group >= 420 && group <= 429) || (group >= 440 && group <= 459) || (group >= 460 && group <= 469) || (group >= 1010 && group <= 1071);
    if (numeric && (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value)))) throw new Error('DXF contains a non-finite or invalid numeric value.');
  });
  if (!eof || code !== null || sectionName) throw new Error('DXF is truncated or missing EOF.');
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
  invalidatePublicQueueCache_();
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
  var target = String(rows[rowNumber - 2][0]);
  var ordered = rows.map(staffTicket_).filter(function(t) { return MACHINES[t.machine] === machineName && (t.status === 'queued' || t.status === 'in-progress'); }).sort(fifoCompare);
  var index = ordered.findIndex(function(t) { return t.id === target; });
  return index < 0 ? null : index + 1;
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

// Staff operations are server-to-server only. Keep WORKSHOP_SHARED_SECRET in
// Script Properties and the private Node environment, never in the React build.
function workshopFail_(message, status) { var error = new Error(message); error.status = status || 400; throw error; }
const fifoCompare = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.sequence || Number(a.ticketNumber?.slice(2))) - (b.sequence || Number(b.ticketNumber?.slice(2))) || a.id.localeCompare(b.id);
function assertTransition(tickets, ticket, status) {
  if (ticket.status === status) return;
  const allowed = { queued: ['in-progress', 'cancelled'], 'in-progress': ['ready', 'cancelled'], ready: ['collected', 'cancelled'], collected: [], cancelled: [] };
  if (!allowed[ticket.status]?.includes(status)) workshopFail_('Use the next workflow step for this ticket.', 409);
  if (status === 'ready' && !(ticket.usage || []).length) workshopFail_('Record material used before marking this job ready.', 409);
}
function validateUsage(ticket, input) {
  if (!input || typeof input !== 'object' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey || '')) workshopFail_('Refresh the material form and try again.');
  const used = Number(input.used), waste = Number(input.waste);
  if (input.used === '' || input.used == null || input.waste === '' || input.waste == null || !Number.isFinite(used) || !Number.isFinite(waste) || used < 0 || waste < 0 || used + waste <= 0 || used + waste > 100000) workshopFail_('Enter valid material quantities, including zero waste when there is none.');
  const operator = typeof input.operator === 'string' ? input.operator.trim() : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!operator || operator.length > 100 || !note || note.length > 500) workshopFail_('Add your name and a short usage note (up to 500 characters).');
  return { requestKey: input.requestKey, used, waste, operator, note, material: ticket.machine === 'printer' ? ticket.paperType : `Foam ${ticket.thickness} in`, unit: ticket.machine === 'printer' ? 'linear ft' : 'sq ft' };
}
function normalizePhone(phone, consent) {
  if (!consent) return phone;
  let number = phone.replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(number)) number = '+1' + number;
  if (/^1\d{10}$/.test(number)) number = '+' + number;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) workshopFail_('Enter a valid mobile number with country code for text updates.');
  return number;
}
function notificationEvent(ticket, status, reason = '') {
  if (!['ready', 'cancelled', 'declined'].includes(status) || !ticket.smsConsent) return {};
  return { notification: { phone: ticket.phone, ticketNumber: ticket.ticketNumber, status, reason } };
}
function machineId_(value) {
  var name = String(value || '').trim().toLowerCase();
  if (['printer', MACHINES.printer.toLowerCase(), '24-inch roll printer', 'hp designjet t210 · 24-inch', 'hp designjet t210 · 24-inch printer'].indexOf(name) !== -1) return 'printer';
  if (['foam', MACHINES.foam.toLowerCase(), 'foam cutting machine', '2525 hot-wire machine', '2525 hot-wire foam cutter'].indexOf(name) !== -1) return 'foam';
  return '';
}
// Review edits are explicit: no client-controlled identifiers, timestamps, or stored paths.
function validateReview(ticket, input) {
  if (!input || !['save', 'approve', 'decline'].includes(input.decision)) workshopFail_('Choose a review action.');
  if (ticket.status !== 'pending-review') workshopFail_('Only requests awaiting review can be edited.', 409);
  const fields = input.fields || {};
  const str = (key, max, required = false) => {
    const v = fields[key] === undefined ? ticket[key] || '' : fields[key];
    if (typeof v !== 'string' || v.length > max || (required && !v.trim())) workshopFail_('Check ' + key + '.');
    return v.trim();
  };
  const num = (key, max) => {
    const raw = fields[key] === undefined ? ticket[key] : fields[key];
    if (!['number','string'].includes(typeof raw) || !/^(?:\d+\.?\d*|\.\d+)$/.test(String(raw).trim())) workshopFail_('Check ' + key + '.');
    const v = Number(raw); if (!Number.isFinite(v) || v < .01 || v > max) workshopFail_('Check ' + key + '.'); return v;
  };
  const machine = str('machine', 10, true);
  if (!['printer','foam'].includes(machine)) workshopFail_('Choose a machine.');
  const neededBy = str('neededBy', 30, true);
  neededByDate_(neededBy);
  const quantity = num('quantity',10000); if (!Number.isInteger(quantity)) workshopFail_('Quantity must be a whole number.');
  const paperType = machine === 'printer' ? str('paperType',50) : '';
  if (paperType && !['Polypropylene','Adhesive','Canvas','Glossy','Standard'].includes(paperType)) workshopFail_('Choose a paper material.');
  if (input.decision === 'approve' && machine === 'printer' && !paperType) workshopFail_('Choose a paper material before approval.');
  let files = fields.files === undefined ? ticket.files : fields.files;
  if (!Array.isArray(files) || files.length > 10) workshopFail_('Attach up to ten artwork files.');
  files = files.map(f => {
    if (!f || typeof f.originalName !== 'string' || !f.originalName.trim() || f.originalName.length > 180 || /[\r\n]/.test(f.originalName)) workshopFail_('Check the artwork filename.');
    if (f.storedName) {
      const original = ticket.files.find(old => old.storedName === f.storedName);
      if (!original) workshopFail_('This stored file does not belong to the ticket.');
      return { ...original, originalName: f.originalName.trim() };
    }
    if (typeof f.url !== 'string' || !/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(f.url)) workshopFail_('Use a Google Drive file link ending in /view.');
    return { originalName: f.originalName.trim(), url: f.url };
  });
  if (input.decision === 'approve' && machine === 'printer' && !files.length) workshopFail_('Attach artwork before approving a print.');
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length > 1000 || (input.decision === 'decline' && !reason)) workshopFail_('Give a decline reason (up to 1000 characters).');
  const operator = typeof input.operator === 'string' ? input.operator.trim() : '';
  if (!operator || operator.length > 100) workshopFail_('Enter the reviewing admin name.');
  const phone = normalizePhone(str('phone',40), ticket.smsConsent === true);
  const edits = { machine, neededBy, quantity, paperType, files, phone, customerName: str('customerName',100,true), department: str('department',100,true), purpose: str('purpose',2000,true), notes: str('notes',4000), width: num('width',machine === 'printer' ? 24 : 10000), length:num('length',100000), thickness:machine === 'foam' ? num('thickness',1000) : 0 };
  const changes = Object.keys(edits).filter(k => JSON.stringify(ticket[k]) !== JSON.stringify(edits[k])).map(k => ({ field:k, before:ticket[k] ?? null, after:edits[k] }));
  return { edits, changes, reason, operator, status: input.decision === 'approve' ? 'queued' : input.decision === 'decline' ? 'declined' : 'pending-review' };
}

function staffTicket_(row) {
  var machine = machineId_(row[2]);
  var date = function(v) { return v instanceof Date ? v.toISOString() : String(v || ''); };
  var parsed = function(v) { if (!v) return []; var result = JSON.parse(String(v)); if (!Array.isArray(result)) throw new Error('Invalid staff record.'); return result; };
  return { id: String(row[0]), ticketNumber: String(row[1]), sequence: Number(String(row[1]).slice(2)), machine: machine,
    customerName: String(row[3]), department: String(row[4]), purpose: String(row[5]), phone: String(row[6] || '').replace(/^'(?=\+)/, ''),
    quantity: Number(row[7]), paperType: String(row[8] || ''), width: Number(row[9]), length: Number(row[10]), thickness: Number(row[11]), neededBy: String(row[12]),
    status: String(row[13]).toLowerCase(), notes: String(row[14] || ''),
    files: String(row[15] || '').split('\n').filter(Boolean).map(function(entry) {
      var match = /https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(entry);
      return match ? { originalName: entry.slice(0, entry.indexOf(match[0])).replace(/[\s—:|-]+$/, '') || 'Artwork', url: 'https://drive.google.com/file/d/' + match[1] + '/view' } : null;
    }).filter(Boolean), createdAt: date(row[16]), updatedAt: date(row[17]), revision: Number(row[18]) || 1,
    usage: parsed(row[27]), history: parsed(row[28]), smsConsent: row[29] === 'yes', reason: String(row[30] || '') };
}
function workshopRows_(sheet) { return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues(); }

function publicQueueCache_() {
  try { return typeof CacheService === 'undefined' ? null : CacheService.getScriptCache(); }
  catch (_error) { return null; }
}

function invalidatePublicQueueCache_() {
  var cache = publicQueueCache_();
  if (cache) {
    try { cache.remove(PUBLIC_QUEUE_CACHE_KEY); }
    catch (_error) { /* Cache failures must never block a ticket update. */ }
  }
}

function publicQueueRows_() {
  var sheet = openBook_().getSheetByName(TICKET_SHEET);
  if (!sheet) throw new Error('The ticket backend has not been set up.');
  var lastRow = sheet.getLastRow();
  return lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 17).getValues();
}

function publicQueueTicket_(row) {
  var ticketNumber = String(row[1] || '');
  return {
    id: String(row[0] || ticketNumber),
    ticketNumber: ticketNumber,
    sequence: Number(ticketNumber.slice(2)) || 0,
    machine: machineId_(row[2]),
    customerName: String(row[3] || ''),
    status: String(row[13] || '').trim().toLowerCase(),
    createdAt: row[16] instanceof Date ? row[16].toISOString() : String(row[16] || '')
  };
}

function publicWorkshopQueue_() {
  var cache = publicQueueCache_();
  if (cache) {
    try {
      var cached = JSON.parse(cache.get(PUBLIC_QUEUE_CACHE_KEY) || 'null');
      if (cached && Array.isArray(cached.machines)) return cached;
    } catch (_error) {
      try { cache.remove(PUBLIC_QUEUE_CACHE_KEY); }
      catch (_removeError) { /* Continue with a fresh Sheet read. */ }
    }
  }
  var visibleStatuses = { 'pending-review': true, queued: true, 'in-progress': true };
  var tickets = publicQueueRows_().map(publicQueueTicket_).filter(function(ticket) {
    return ticket.machine && ticket.ticketNumber && visibleStatuses[ticket.status];
  }).sort(fifoCompare);
  var snapshot = { ok: true, updatedAt: new Date().toISOString(), machines: Object.keys(MACHINES).map(function(id) {
    var visible = tickets.filter(function(ticket) { return ticket.machine === id; });
    var active = visible.filter(function(ticket) { return ticket.status === 'queued' || ticket.status === 'in-progress'; });
    var positions = {};
    active.forEach(function(ticket, index) { positions[ticket.id] = index + 1; });
    return { id: id, name: MACHINES[id], waiting: active.length, inReview: visible.filter(function(ticket) { return ticket.status === 'pending-review'; }).length, tickets: visible.map(function(ticket) {
      return { ticketNumber: ticket.ticketNumber, customerName: ticket.customerName, status: ticket.status, position: ticket.status === 'pending-review' ? null : positions[ticket.id] || null };
    }) };
  }) };
  if (cache) {
    try { cache.put(PUBLIC_QUEUE_CACHE_KEY, JSON.stringify(snapshot), PUBLIC_QUEUE_CACHE_SECONDS); }
    catch (_error) { /* A large or unavailable cache must not break the queue. */ }
  }
  return snapshot;
}
function staffAction_(input, lock, publicAccess) {
  try {
    if (!publicAccess) {
      var secret = PropertiesService.getScriptProperties().getProperty('WORKSHOP_SHARED_SECRET');
      if (!secret || secret.length < 32 || input.secret !== secret) workshopFail_('Staff connection is not authorized.', 401);
    }
    lock.waitLock(20000);
    var sheet = ensureTicketSheet_(openBook_());
    var rows = workshopRows_(sheet);
    var tickets = rows.map(staffTicket_);
    if (input.action === 'staffList') return jsonResponse_({ ok: true, tickets: tickets });
    var index = tickets.findIndex(function(t) { return t.id === input.id; });
    if (index < 0) workshopFail_('Ticket not found.', 404);
    var ticket = tickets[index];
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) workshopFail_('Refresh the ticket first.');
    var now = new Date().toISOString();
    if (input.action === 'adminReview') {
      if (ticket.revision !== input.expectedRevision) workshopFail_('This request changed. Refresh before reviewing.',409);
      var result = validateReview(ticket,input.input);
      Object.assign(ticket,result.edits,{status:result.status,reason:result.reason});
      ticket.history.push({status:ticket.status,at:now,operator:result.operator,reason:result.reason,changes:result.changes,...notificationEvent(ticket,ticket.status,result.reason)});
    } else if (input.action === 'staffUsage') {
      var entry = validateUsage(ticket, input.input);
      var prior = ticket.usage.find(function(u) { return u.requestKey === entry.requestKey; });
      if (prior) {
        if (Object.keys(entry).some(function(k) { return entry[k] !== prior[k]; })) workshopFail_('Usage was already recorded with different values.', 409);
        return jsonResponse_({ ok: true, ticket: ticket });
      }
      if (ticket.revision !== input.expectedRevision) workshopFail_('This ticket changed. Refresh and try again.', 409);
      if (['in-progress', 'ready'].indexOf(ticket.status) < 0) workshopFail_('Start the job before recording material usage.', 409);
      entry.at = now; ticket.usage.push(entry);
    } else {
      if (ticket.revision !== input.expectedRevision) workshopFail_('This ticket changed. Refresh and try again.', 409);
      assertTransition(tickets, ticket, input.status);
      if (ticket.status === input.status) return jsonResponse_({ ok: true, ticket: ticket });
      if (typeof input.reason !== 'undefined' && typeof input.reason !== 'string') workshopFail_('Check the reason.');
      var reason = (input.reason || '').trim();
      if (reason.length > 1000 || (input.status === 'cancelled' && !reason)) workshopFail_('Give a cancellation reason (up to 1000 characters).');
      ticket.status = input.status; ticket.reason = reason;
      ticket.history.push({ status: ticket.status, at: now, reason: ticket.reason, ...notificationEvent(ticket,ticket.status,ticket.reason) });
    }
    ticket.revision++; ticket.updatedAt = now;
    // One row write commits status, revision, usage and history together.
    var row = rows[index];
    if (input.action === 'adminReview') {
      row[2] = MACHINES[ticket.machine]; row[3] = ticket.customerName; row[4] = ticket.department; row[5] = ticket.purpose; row[6] = ticket.phone;
      row[7] = ticket.quantity; row[8] = ticket.paperType; row[9] = ticket.width; row[10] = ticket.length; row[11] = ticket.thickness;
      row[12] = ticket.neededBy; row[14] = ticket.notes; row[15] = ticket.files.map(f => f.originalName + ' — ' + f.url).join('\n');
    }
    row[29] = ticket.smsConsent ? 'yes' : ''; row[30] = ticket.reason || '';
    row[13] = ticket.status; row[17] = now; row[18] = ticket.revision;
    row[27] = JSON.stringify(ticket.usage); row[28] = JSON.stringify(ticket.history);
    if (row[27].length > 45000 || row[28].length > 45000) workshopFail_('This ticket has reached its history limit. Contact the coordinator.');
    sheet.getRange(index + 2, 1, 1, HEADERS.length).setValues([row.map(escapeCell_)]);
    SpreadsheetApp.flush();
    invalidatePublicQueueCache_();
    return jsonResponse_({ ok: true, ticket: ticket });
  } catch (error) {
    return jsonResponse_({ ok: false, status: error.status || 503, error: error.status ? error.message : 'Google Sheets could not complete this operation. Refresh and retry.' });
  }
}

// Run once during rollout if pre-existing queued requests have not been reviewed.
// Active/ready/closed work and recorded material usage are retained.
function holdUnreviewedQueueForAdminReview() {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sheet = ensureTicketSheet_(openBook_());
    workshopRows_(sheet).forEach(function(row,index) {
      var ticket = staffTicket_(row);
      var approved = ticket.history.some(function(h) { return h.status === 'queued' && h.operator && Array.isArray(h.changes); });
      if (ticket.status !== 'queued' || approved) return;
      var now = new Date().toISOString();
      ticket.history.push({status:'pending-review',at:now,reason:'Existing unstarted request moved to admin review during rollout.'});
      row[13] = 'pending-review'; row[17] = now; row[18] = ticket.revision + 1; row[28] = JSON.stringify(ticket.history);
      sheet.getRange(index + 2,1,1,HEADERS.length).setValues([row.map(escapeCell_)]);
    });
    SpreadsheetApp.flush();
    invalidatePublicQueueCache_();
  } finally { lock.releaseLock(); }
}
