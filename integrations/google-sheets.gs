// Delaware Mandir Workshop Tickets — Google Sheets + Drive backend for GitHub Pages.
// Bind this script to a private Google Sheet, run setupMandirTicketSystem once,
// then deploy it as a web app that executes as you and is reachable by Anyone.

var TICKET_SHEET = 'Tickets';
var NOTIFICATION_SHEET = 'Notification Outbox';
var DEFAULT_ADMIN_NOTIFICATION_EMAIL = 'demandirtickets@googlegroups.com';
var ADMIN_NOTIFICATION_DEFAULT_VERSION = 'google-group-v1';
var HEADERS = [
  'Ticket ID', 'Queue number', 'Machine', 'Name', 'Department', 'Purpose', 'Phone',
  'Quantity', 'Paper', 'Width (in)', 'Length (in)', 'Thickness (in)', 'Needed by',
  'Status', 'Notes', 'Files', 'Created', 'Updated', 'Revision',
  'Tracking code', 'Request key', 'Source', 'Customer email', 'Last notified status',
  'Approx. cost (USD)', 'Cost basis', 'Cost estimate version',
  'Material usage', 'Staff history', 'SMS consent', 'Review reason'
];
var NOTIFICATION_HEADERS = [
  'Notification ID', 'To', 'Bcc', 'Reply to', 'Subject', 'Body', 'Created',
  'Attempts', 'Last error', 'Next attempt', 'Delivered'
];
var STATUSES = ['pending-review', 'declined', 'queued', 'in-progress', 'ready', 'collected', 'cancelled'];
var MACHINES = { printer: 'Poster printing', foam: 'Foam cutting' };
var PAPER_TYPES = ['Polypropylene', 'Adhesive', 'Canvas', 'Glossy', 'Standard'];
var DEADLINES = ['Today', 'Tomorrow', 'This week', 'No rush'];
var DELAWARE_TIME_ZONE = 'America/New_York';
var DEFAULT_PRICING = {
  version: 'materials-v1',
  foamSheetWidthIn: 48,
  foamSheetLengthIn: 96,
  foamCentsPerInch: 1500,
  foamMinimumSheetCents: 1500,
  printInkCentsPerSquareFoot: 60,
  printMaterialCentsPerSquareFoot: {
    Standard: 40,
    Glossy: 80,
    Polypropylene: 100,
    Adhesive: 125,
    Canvas: 175
  }
};
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
    .addItem('Configure notification emails', 'configureNotificationEmails')
    .addItem('Hold unreviewed queued tickets', 'holdUnreviewedQueueForAdminReview')
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
  if (properties.getProperty('ADMIN_NOTIFICATION_DEFAULT_VERSION') !== ADMIN_NOTIFICATION_DEFAULT_VERSION) {
    properties.setProperty('ADMIN_NOTIFICATION_EMAILS', DEFAULT_ADMIN_NOTIFICATION_EMAIL);
    properties.setProperty('ADMIN_NOTIFICATION_DEFAULT_VERSION', ADMIN_NOTIFICATION_DEFAULT_VERSION);
  }
  if (!properties.getProperty('NOTIFICATION_OUTBOX_STARTED_AT')) {
    properties.setProperty('NOTIFICATION_OUTBOX_STARTED_AT', new Date().toISOString());
  }
  initializePricingProperties_(properties);
  ensureTicketSheet_(book);
  initializeNotificationStatusMarkers_(book);
  initializeCostEstimates_(book);
  ensureNotificationSheet_(book);
  installStatusNotificationTrigger_(book);
  installNotificationRetryTrigger_();
  authorizeLargeFileUploads();
  formatTicketSheet();
  SpreadsheetApp.getUi().alert('The private ticket sheet, Drive upload folder, and email notifications are ready. New-ticket alerts and customer replies use ' + DEFAULT_ADMIN_NOTIFICATION_EMAIL + '. Manage recipients through the Google Group, then deploy this script as a web app.');
}

function initializePricingProperties_(properties) {
  var defaults = {
    COST_ESTIMATE_VERSION: DEFAULT_PRICING.version,
    COST_FOAM_SHEET_WIDTH_IN: DEFAULT_PRICING.foamSheetWidthIn,
    COST_FOAM_SHEET_LENGTH_IN: DEFAULT_PRICING.foamSheetLengthIn,
    COST_FOAM_CENTS_PER_INCH: DEFAULT_PRICING.foamCentsPerInch,
    COST_FOAM_MIN_SHEET_CENTS: DEFAULT_PRICING.foamMinimumSheetCents,
    COST_PRINT_INK_CENTS_PER_SQFT: DEFAULT_PRICING.printInkCentsPerSquareFoot,
    COST_PRINT_STANDARD_CENTS_PER_SQFT: DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Standard,
    COST_PRINT_GLOSSY_CENTS_PER_SQFT: DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Glossy,
    COST_PRINT_POLYPROPYLENE_CENTS_PER_SQFT: DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Polypropylene,
    COST_PRINT_ADHESIVE_CENTS_PER_SQFT: DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Adhesive,
    COST_PRINT_CANVAS_CENTS_PER_SQFT: DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Canvas
  };
  Object.keys(defaults).forEach(function(key) {
    if (properties.getProperty(key) === null) properties.setProperty(key, String(defaults[key]));
  });
}

function pricingNumber_(properties, key, fallback, positive) {
  var configured = properties.getProperty(key);
  var value = Number(configured === null || configured === '' ? fallback : configured);
  if (!isFinite(value) || value < 0 || (positive && (value <= 0 || value > 1000000))
    || (!positive && (!Number.isSafeInteger(value) || value > 1000000000))) {
    throw new Error(key + ' must be a safe ' + (positive ? 'positive dimension' : 'non-negative whole number of cents') + '.');
  }
  return value;
}

function pricingConfig_() {
  var properties = PropertiesService.getScriptProperties();
  return {
    version: String(properties.getProperty('COST_ESTIMATE_VERSION') || DEFAULT_PRICING.version),
    foamSheetWidthIn: pricingNumber_(properties, 'COST_FOAM_SHEET_WIDTH_IN', DEFAULT_PRICING.foamSheetWidthIn, true),
    foamSheetLengthIn: pricingNumber_(properties, 'COST_FOAM_SHEET_LENGTH_IN', DEFAULT_PRICING.foamSheetLengthIn, true),
    foamCentsPerInch: pricingNumber_(properties, 'COST_FOAM_CENTS_PER_INCH', DEFAULT_PRICING.foamCentsPerInch, false),
    foamMinimumSheetCents: pricingNumber_(properties, 'COST_FOAM_MIN_SHEET_CENTS', DEFAULT_PRICING.foamMinimumSheetCents, false),
    printInkCentsPerSquareFoot: pricingNumber_(properties, 'COST_PRINT_INK_CENTS_PER_SQFT', DEFAULT_PRICING.printInkCentsPerSquareFoot, false),
    printMaterialCentsPerSquareFoot: {
      Standard: pricingNumber_(properties, 'COST_PRINT_STANDARD_CENTS_PER_SQFT', DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Standard, false),
      Glossy: pricingNumber_(properties, 'COST_PRINT_GLOSSY_CENTS_PER_SQFT', DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Glossy, false),
      Polypropylene: pricingNumber_(properties, 'COST_PRINT_POLYPROPYLENE_CENTS_PER_SQFT', DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Polypropylene, false),
      Adhesive: pricingNumber_(properties, 'COST_PRINT_ADHESIVE_CENTS_PER_SQFT', DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Adhesive, false),
      Canvas: pricingNumber_(properties, 'COST_PRINT_CANVAS_CENTS_PER_SQFT', DEFAULT_PRICING.printMaterialCentsPerSquareFoot.Canvas, false)
    }
  };
}

function estimateTicketCost_(ticket, pricing) {
  pricing = pricing || pricingConfig_();
  var disclaimer = 'Approximate material cost only; labor, finishing, tax, and design time are not included. Final cost may change.';
  if (ticket.machine === 'printer') {
    var squareFeet = Number(ticket.quantity) * Number(ticket.width) * Number(ticket.length) / 144;
    var materialRate = pricing.printMaterialCentsPerSquareFoot[ticket.paperType];
    if (!isFinite(squareFeet) || squareFeet <= 0 || !Number.isSafeInteger(materialRate)
      || !Number.isSafeInteger(pricing.printInkCentsPerSquareFoot)) throw new Error('The print cost estimate could not be calculated.');
    var paperCents = Math.round(squareFeet * materialRate);
    var inkCents = Math.round(squareFeet * pricing.printInkCentsPerSquareFoot);
    var printTotal = paperCents + inkCents;
    if (!Number.isSafeInteger(paperCents) || paperCents < 0 || !Number.isSafeInteger(inkCents) || inkCents < 0
      || !Number.isSafeInteger(printTotal) || printTotal < 0) throw new Error('The print cost estimate is too large.');
    return {
      version: pricing.version,
      currency: 'USD',
      amountCents: printTotal,
      amountDisplay: '$' + (printTotal / 100).toFixed(2),
      basis: squareFeet.toFixed(2) + ' sq ft of ' + String(ticket.paperType).toLowerCase() + ' material plus ink',
      disclaimer: disclaimer
    };
  }
  var width = Number(ticket.width);
  var length = Number(ticket.length);
  var quantity = Number(ticket.quantity);
  var normal = Math.floor(pricing.foamSheetWidthIn / width) * Math.floor(pricing.foamSheetLengthIn / length);
  var rotated = Math.floor(pricing.foamSheetWidthIn / length) * Math.floor(pricing.foamSheetLengthIn / width);
  var piecesPerSheet = Math.max(normal, rotated);
  var sheets;
  if (piecesPerSheet > 0) sheets = Math.ceil(quantity / piecesPerSheet);
  else {
    var tiledNormal = Math.ceil(width / pricing.foamSheetWidthIn) * Math.ceil(length / pricing.foamSheetLengthIn);
    var tiledRotated = Math.ceil(width / pricing.foamSheetLengthIn) * Math.ceil(length / pricing.foamSheetWidthIn);
    sheets = Math.min(tiledNormal, tiledRotated) * quantity;
  }
  var perSheetCents = Math.max(pricing.foamMinimumSheetCents, Math.round(Number(ticket.thickness) * pricing.foamCentsPerInch));
  var foamTotal = sheets * perSheetCents;
  if (!Number.isSafeInteger(sheets) || sheets < 1 || !Number.isSafeInteger(perSheetCents) || perSheetCents < 0
    || !Number.isSafeInteger(foamTotal) || foamTotal < 0) throw new Error('The foam cost estimate is too large.');
  return {
    version: pricing.version,
    currency: 'USD',
    amountCents: foamTotal,
    amountDisplay: '$' + (foamTotal / 100).toFixed(2),
    basis: sheets + ' estimated ' + pricing.foamSheetWidthIn + ' × ' + pricing.foamSheetLengthIn + ' in foam sheet' + (sheets === 1 ? '' : 's') + ' at ' + Number(ticket.thickness) + ' in thick',
    disclaimer: disclaimer
  };
}

function estimateFromRow_(row) {
  var storedAmount = Number(row[24]);
  if (row[24] !== '' && isFinite(storedAmount) && storedAmount >= 0) {
    var cents = Math.round(storedAmount * 100);
    if (!Number.isSafeInteger(cents)) throw new Error('The stored cost estimate is too large.');
    return {
      version: String(row[26] || DEFAULT_PRICING.version),
      currency: 'USD',
      amountCents: cents,
      amountDisplay: '$' + (cents / 100).toFixed(2),
      basis: String(row[25] || 'Stored material estimate'),
      disclaimer: 'Approximate material cost only; labor, finishing, tax, and design time are not included. Final cost may change.'
    };
  }
  var machineName = String(row[2]);
  return estimateTicketCost_({
    machine: machineName === MACHINES.printer || machineName === '24-inch roll printer' ? 'printer' : 'foam',
    quantity: row[7],
    paperType: String(row[8]),
    width: row[9],
    length: row[10],
    thickness: row[11]
  });
}

function initializeCostEstimates_(book) {
  var sheet = ensureTicketSheet_(book);
  if (sheet.getLastRow() < 2) return;
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
  rows.forEach(function(row, index) {
    if (row[24] !== '') return;
    var machineName = String(row[2]);
    var isPrinter = machineName === MACHINES.printer || machineName === '24-inch roll printer';
    if (isPrinter && !String(row[8] || '').trim()) return;
    try {
      var estimate = estimateFromRow_(row);
      sheet.getRange(index + 2, 25, 1, 3).setValues([[estimate.amountCents / 100, estimate.basis, estimate.version]]);
    } catch (error) {
      console.error('Could not initialize cost estimate for row ' + (index + 2) + ': ' + error.message);
    }
  });
}

function formatCostEstimate_(estimate) {
  return 'Approximate material cost: ' + estimate.amountDisplay + '\nBased on: ' + estimate.basis + '\n' + estimate.disclaimer;
}

function publicTrackingNumber_(stored) {
  var value = String(stored || '').trim().toUpperCase();
  return value.indexOf('DM-') === 0 ? value : 'DM-' + value;
}

function uniqueTrackingCode_(sheet) {
  for (var attempt = 0; attempt < 100; attempt++) {
    var candidate = randomCode_(12);
    if (!findRow_(sheet, 20, candidate) && !findRow_(sheet, 20, publicTrackingNumber_(candidate))) return candidate;
  }
  throw new Error('Could not reserve a unique ticket code.');
}

function configureNotificationEmails() {
  var ui = SpreadsheetApp.getUi();
  var properties = PropertiesService.getScriptProperties();
  var response = ui.prompt(
    'Admin ticket notifications',
    'Enter every admin email that should receive new-ticket notifications, separated by commas.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return false;
  var emails = parseEmailList_(response.getResponseText());
  if (!emails.length) throw new Error('Enter at least one admin notification email.');
  properties.setProperty('ADMIN_NOTIFICATION_EMAILS', emails.join(','));
  ui.alert('New-ticket notifications will be sent to ' + emails.length + ' admin' + (emails.length === 1 ? '.' : 's.'));
  return true;
}

function installStatusNotificationTrigger_(book) {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'onTicketStatusEdit';
  });
  if (!exists) ScriptApp.newTrigger('onTicketStatusEdit').forSpreadsheet(book).onEdit().create();
}

function installNotificationRetryTrigger_() {
  var exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'retryTicketNotifications';
  });
  if (!exists) ScriptApp.newTrigger('retryTicketNotifications').timeBased().everyMinutes(5).create();
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
  sheet.setColumnWidth(25, 125);
  sheet.setColumnWidth(26, 320);
  sheet.getRange(2, 25, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat('$0.00');
  sheet.hideColumns(1);
  sheet.hideColumns(20, 2);
  sheet.hideColumns(24);
  var validation = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, 14, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(validation);
  return true;
}

function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    var raw = event && event.postData ? event.postData.contents : '';
    var input = JSON.parse(raw || (event && event.parameter && event.parameter.payload) || '{}');

    if (['staffList', 'staffUpdate', 'staffUsage', 'adminReview'].indexOf(input.action) !== -1) return staffAction_(input, lock);
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
      if (lock.hasLock()) lock.releaseLock();
      try { retryTicketNotifications(); }
      catch (notificationError) { console.error('Could not retry notifications: ' + notificationError.message); }
      return jsonResponse_({ ok: true, duplicate: true });
    }
    enforceDailyLimit_(properties);

    var ticketNumber = nextTicketNumber_(sheet, request.machine);
    var trackingCode = uniqueTrackingCode_(sheet);
    var costEstimate = request.machine === 'foam' ? estimateTicketCost_(request) : null;
    request.trackingNumber = publicTrackingNumber_(trackingCode);
    request.costEstimate = costEstimate;
    var createdAt = new Date();
    var uploadedFiles = saveFiles_(request.files, ticketNumber, request.requestKey, properties);
    var row = [
      Utilities.getUuid(), ticketNumber, MACHINES[request.machine], request.customerName,
      request.department, request.purpose, request.phone, request.quantity,
      request.paperType, request.width, request.length, request.thickness,
      request.neededBy, 'pending-review', request.notes, uploadedFiles.join('\n'),
      createdAt, createdAt, 1, trackingCode, request.requestKey, 'GitHub Pages', request.email, 'pending-review',
      costEstimate ? costEstimate.amountCents / 100 : '', costEstimate ? costEstimate.basis : '', costEstimate ? costEstimate.version : '',
      '[]', '[]', request.smsConsent ? 'yes' : '', ''
    ];
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, HEADERS.length).setValues([row.map(escapeCell_)]);
    SpreadsheetApp.flush();
    incrementDailyCount_(properties);
    properties.deleteProperty(uploadReservationKey_(request.requestKey));
    try { notifyAdminsOfNewTicket_(request, ticketNumber, properties, openBook_(), true); }
    catch (notificationError) { console.error('Could not queue admin notification: ' + notificationError.message); }
    if (lock.hasLock()) lock.releaseLock();
    try { retryTicketNotifications(); }
    catch (notificationError) { console.error('Could not deliver queued notifications: ' + notificationError.message); }
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
    if (params.action === 'health') return javascriptResponse_(callback, { ok: true, service: 'Delaware Mandir Workshop Tickets' });
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
    var tracking = String(params.tracking || '').trim().toUpperCase();
    var code = tracking.indexOf('DM-') === 0 ? tracking.slice(3) : '';
    if (/^[A-HJ-NP-Z2-9]{12}$/.test(code)) {
      rowNumber = findRow_(sheet, 20, tracking) || findRow_(sheet, 20, code);
    }
    if (!rowNumber) throw new Error('Request not found. Check the ticket code on your receipt.');
  }
  if (!rowNumber) throw new Error('The ticket is still being saved.');
  var row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
  var status = String(row[13] || '').toLowerCase();
  var position = activePosition_(sheet, rowNumber, String(row[2]), status);
  var costEstimate = null;
  try { costEstimate = estimateFromRow_(row); }
  catch (_estimateError) { costEstimate = null; }
  return {
    ok: true,
    ticket: {
      trackingNumber: publicTrackingNumber_(row[19]),
      machineName: String(row[2]),
      status: status,
      position: position,
      reason: String(row[30] || ''),
      createdAt: row[16] instanceof Date ? row[16].toISOString() : String(row[16]),
      costEstimate: costEstimate
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
    email: validateEmail_(input.email, 'Email'),
    phone: cleanText_(input.phone, 'Phone', 40, false),
    smsConsent: input.smsConsent === true || input.smsConsent === 'true' || input.smsConsent === 'on',
    notes: cleanText_(input.notes, 'Notes', 4000, false),
    quantity: positiveNumber_(input.quantity, 'Quantity', 10000, true),
    width: positiveNumber_(input.width, 'Width', machine === 'printer' ? 24 : 10000, false),
    length: positiveNumber_(input.length, 'Length', 100000, false),
    neededBy: validateNeededBy_(input.neededBy),
    paperType: '',
    thickness: '',
    files: validateFiles_(input.files || [])
  };
  if (machine === 'printer') {
    if (!request.files.length) throw new Error('Add at least one print-ready file.');
  } else {
    request.thickness = positiveNumber_(input.thickness, 'Foam thickness', 1000, false);
  }
  request.phone = normalizePhone_(request.phone, request.smsConsent);
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
        description: 'Pending Delaware Mandir workshop ticket upload',
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
  if (!secret || input.secret !== secret || [19, 20, 24].indexOf(input.row.length) === -1 || typeof input.row[0] !== 'string' || !Number.isInteger(input.row[18])) return jsonResponse_({ ok: false });
  lock.waitLock(20000);
  var sheet = ensureTicketSheet_(openBook_());
  var match = findRow_(sheet, 1, input.row[0]);
  if (match && Number(sheet.getRange(match, 19).getValue()) >= input.row[18]) return jsonResponse_({ ok: true });
  var target = match || sheet.getLastRow() + 1;
  sheet.getRange(target, 1, 1, 19).setValues([input.row.slice(0, 19).map(escapeCell_)]);
  sheet.getRange(target, 22).setValue('Node API');
  if (input.row.length >= 20) sheet.getRange(target, 23).setValue(escapeCell_(input.row[19]));
  if (input.row.length === 24) {
    sheet.getRange(target, 20).setValue(escapeCell_(input.row[20]));
    sheet.getRange(target, 25, 1, 3).setValues([input.row.slice(21, 24).map(escapeCell_)]);
  }
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

function initializeNotificationStatusMarkers_(book) {
  var sheet = ensureTicketSheet_(book);
  if (sheet.getLastRow() < 2) return;
  var count = sheet.getLastRow() - 1;
  var statuses = sheet.getRange(2, 14, count, 1).getDisplayValues();
  var markers = sheet.getRange(2, 24, count, 1).getDisplayValues();
  var changed = false;
  for (var i = 0; i < count; i++) {
    if (!markers[i][0] && STATUSES.indexOf(String(statuses[i][0]).trim().toLowerCase()) !== -1) {
      markers[i][0] = String(statuses[i][0]).trim().toLowerCase();
      changed = true;
    }
  }
  if (changed) sheet.getRange(2, 24, count, 1).setValues(markers);
}

function ensureNotificationSheet_(book) {
  var sheet = book.getSheetByName(NOTIFICATION_SHEET) || book.insertSheet(NOTIFICATION_SHEET);
  if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, NOTIFICATION_HEADERS.length).setValues([NOTIFICATION_HEADERS]);
  if (sheet.getMaxColumns() < NOTIFICATION_HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), NOTIFICATION_HEADERS.length - sheet.getMaxColumns());
  }
  var current = sheet.getRange(1, 1, 1, NOTIFICATION_HEADERS.length).getDisplayValues()[0];
  for (var i = 0; i < NOTIFICATION_HEADERS.length; i++) {
    if (!current[i]) sheet.getRange(1, i + 1).setValue(NOTIFICATION_HEADERS[i]);
  }
  if (!sheet.isSheetHidden()) sheet.hideSheet();
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
  var ordered = rows.map(staffTicket_).filter(function(ticket) {
    return MACHINES[ticket.machine] === machineName && (ticket.status === 'queued' || ticket.status === 'in-progress');
  }).sort(fifoCompare_);
  var index = ordered.findIndex(function(ticket) { return ticket.id === target; });
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

function onTicketStatusEdit(event) {
  if (!event || !event.range || event.range.getSheet().getName() !== TICKET_SHEET) return;
  if (event.range.getColumn() !== 14 || event.range.getNumColumns() !== 1) return;
  var sheet = event.range.getSheet();
  var firstRow = event.range.getRow();
  var rowCount = event.range.getNumRows();
  if (firstRow + rowCount - 1 < 2) return;
  var statuses = event.range.getDisplayValues();
  var oldStatus = rowCount === 1 ? String(event.oldValue || '').trim().toLowerCase() : '';
  var lock = LockService.getScriptLock();
  var queued = false;
  try { lock.waitLock(300000); }
  catch (lockError) {
    try { recordPendingStatusEdits_(sheet, firstRow, statuses); }
    catch (recoveryError) { console.error('Could not record status notification recovery: ' + recoveryError.message); }
    console.error('Status notification will be reconciled after lock timeout: ' + lockError.message);
    return false;
  }
  try {
    var book = openBook_();
    for (var i = 0; i < rowCount; i++) {
      var rowNumber = firstRow + i;
      var status = String(statuses[i] && statuses[i][0] || '').trim().toLowerCase();
      if (rowNumber < 2 || STATUSES.indexOf(status) === -1 || (rowCount === 1 && status === oldStatus)) continue;
      var row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
      if (String(row[23] || '').trim().toLowerCase() === status) continue;
      var updatedAt = new Date();
      var revision = Math.max(1, Number(row[18]) || 1) + 1;
      try {
        if (notifyCustomerOfStatus_(row, status, revision, book, true)) queued = true;
        sheet.getRange(rowNumber, 18).setValue(updatedAt);
        sheet.getRange(rowNumber, 19).setValue(revision);
        sheet.getRange(rowNumber, 24).setValue(status);
      }
      catch (notificationError) {
        try { recordPendingStatusEdits_(sheet, rowNumber, [[status]]); }
        catch (recoveryError) { console.error('Could not record status notification recovery: ' + recoveryError.message); }
        console.error('Could not queue customer notification: ' + notificationError.message);
      }
    }
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
  if (queued) {
    try { retryTicketNotifications(); }
    catch (notificationError) { console.error('Could not deliver queued notifications: ' + notificationError.message); }
  }
}

function recordPendingStatusEdits_(sheet, firstRow, statuses) {
  var properties = PropertiesService.getScriptProperties();
  for (var i = 0; i < statuses.length; i++) {
    var rowNumber = firstRow + i;
    var status = String(statuses[i] && statuses[i][0] || '').trim().toLowerCase();
    if (rowNumber < 2 || STATUSES.indexOf(status) === -1) continue;
    var ticketId = String(sheet.getRange(rowNumber, 1).getDisplayValue() || '');
    if (ticketId) properties.setProperty('PENDING_STATUS_NOTIFICATION_' + ticketId, JSON.stringify({ status: status }));
  }
}

function notifyAdminsOfNewTicket_(request, ticketNumber, properties, book, deferFlush) {
  var recipients = parseEmailList_(properties.getProperty('ADMIN_NOTIFICATION_EMAILS') || DEFAULT_ADMIN_NOTIFICATION_EMAIL);
  if (!recipients.length) return false;
  var reference = String(request.trackingNumber || ticketNumber);
  var estimate = request.costEstimate;
  if (!estimate) {
    try { estimate = estimateTicketCost_(request); }
    catch (_estimateError) { estimate = null; }
  }
  var subject = '[Delaware Mandir tickets] New ' + reference;
  var body = [
    'A new ' + (request.machine === 'printer' ? 'poster printing' : 'foam cutting') + ' ticket was submitted.',
    '',
    'Ticket code: ' + reference,
    'Requester: ' + request.customerName,
    'Department: ' + request.department,
    'Needed by: ' + request.neededBy,
    'Purpose: ' + request.purpose,
    estimate ? '\n' + formatCostEstimate_(estimate) : ''
  ].join('\n');
  enqueueNotification_(book, {
    id: 'new-ticket:' + request.requestKey,
    to: recipients[0],
    bcc: recipients.slice(1).join(','),
    replyTo: request.email,
    subject: subject,
    body: body
  });
  if (!deferFlush) flushNotifications_(book);
  return true;
}

function notifyCustomerOfStatus_(row, status, revision, book, deferFlush) {
  var email = String(row[22] || '').trim().toLowerCase();
  if (!email) return false;
  email = validateEmail_(email, 'Customer email');
  var labels = {
    'pending-review': 'Awaiting review',
    declined: 'Declined',
    queued: 'Waiting',
    'in-progress': 'Being made',
    ready: 'Ready for pickup',
    collected: 'Picked up',
    cancelled: 'Cancelled'
  };
  var reference = row[19] ? publicTrackingNumber_(row[19]) : String(row[1]);
  var label = labels[status] || status;
  var estimate;
  try { estimate = estimateFromRow_(row); }
  catch (_estimateError) { estimate = null; }
  var adminRecipients = parseEmailList_(PropertiesService.getScriptProperties().getProperty('ADMIN_NOTIFICATION_EMAILS') || DEFAULT_ADMIN_NOTIFICATION_EMAIL);
  enqueueNotification_(book, {
    id: 'status:' + String(row[0]) + ':' + String(revision) + ':' + status,
    to: email,
    replyTo: adminRecipients[0] || DEFAULT_ADMIN_NOTIFICATION_EMAIL,
    subject: '[Delaware Mandir tickets] ' + reference + ' is ' + label.toLowerCase(),
    body: [
      'Your Delaware Mandir workshop request ' + reference + ' was updated.',
      '',
      'Current status: ' + label,
      'Request: ' + String(row[2]),
      estimate ? '\n' + formatCostEstimate_(estimate) : ''
    ].join('\n')
  });
  if (!deferFlush) flushNotifications_(book);
  return true;
}

function enqueueNotification_(book, notification) {
  var sheet = ensureNotificationSheet_(book);
  if (findRow_(sheet, 1, notification.id)) return false;
  var createdAt = new Date();
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, NOTIFICATION_HEADERS.length).setValues([[
    notification.id, notification.to, notification.bcc || '', notification.replyTo || '',
    notification.subject, notification.body, createdAt, 0, '', createdAt, ''
  ]]);
  SpreadsheetApp.flush();
  return true;
}

function flushNotifications_(book) {
  var sheet = ensureNotificationSheet_(book);
  if (sheet.getLastRow() < 2) return { sent: 0, pending: 0 };
  var rowCount = sheet.getLastRow() - 1;
  var rows = sheet.getRange(2, 1, rowCount, NOTIFICATION_HEADERS.length).getValues();
  var now = new Date();
  var sentRows = [];
  var attempted = 0;
  for (var i = 0; i < rows.length && attempted < 25; i++) {
    var row = rows[i];
    var nextAttempt = new Date(row[9]);
    if (!row[0] || row[10] || (!isNaN(nextAttempt.getTime()) && nextAttempt > now)) continue;
    attempted++;
    var message = {
      to: String(row[1]),
      subject: String(row[4]),
      body: String(row[5]),
      name: 'Delaware Mandir Workshop Tickets'
    };
    if (row[2]) message.bcc = String(row[2]);
    if (row[3]) message.replyTo = String(row[3]);
    try {
      MailApp.sendEmail(message);
      sentRows.push(i + 2);
    } catch (error) {
      var attempts = Math.max(0, Number(row[7]) || 0) + 1;
      var delay = Math.min(60 * 60 * 1000, 30 * 1000 * Math.pow(2, Math.min(attempts - 1, 7)));
      sheet.getRange(i + 2, 8, 1, 3).setValues([[
        attempts, String(error && error.message || 'Email delivery failed.').slice(0, 500), new Date(now.getTime() + delay)
      ]]);
      console.error('Notification delivery failed and will retry: ' + String(error && error.message || error));
    }
  }
  sentRows.forEach(function(rowNumber) { sheet.getRange(rowNumber, 11).setValue(new Date()); });
  SpreadsheetApp.flush();
  var pending = rows.filter(function(row, index) {
    return row[0] && !row[10] && sentRows.indexOf(index + 2) === -1;
  }).length;
  return { sent: sentRows.length, pending: pending };
}

function reconcileNotifications_(book) {
  var properties = PropertiesService.getScriptProperties();
  reconcilePendingStatusEdits_(book, properties);
  var startedAt = new Date(properties.getProperty('NOTIFICATION_OUTBOX_STARTED_AT') || '');
  if (isNaN(startedAt.getTime())) return 0;
  var ticketSheet = ensureTicketSheet_(book);
  if (ticketSheet.getLastRow() < 2) return 0;
  var firstRow = Math.max(2, ticketSheet.getLastRow() - 499);
  var tickets = ticketSheet.getRange(firstRow, 1, ticketSheet.getLastRow() - firstRow + 1, HEADERS.length).getValues();
  var outbox = ensureNotificationSheet_(book);
  var ids = {};
  if (outbox.getLastRow() > 1) {
    outbox.getRange(2, 1, outbox.getLastRow() - 1, 1).getDisplayValues().forEach(function(row) { ids[String(row[0])] = true; });
  }
  var queued = 0;
  tickets.forEach(function(row, rowIndex) {
    try {
      if (String(row[21]) !== 'GitHub Pages' || new Date(row[16]) < startedAt) return;
      var requestKey = String(row[20]);
      var adminId = 'new-ticket:' + requestKey;
      if (requestKey && !ids[adminId]) {
        var request = {
          requestKey: requestKey,
          machine: String(row[2]) === MACHINES.printer ? 'printer' : 'foam',
          customerName: String(row[3]),
          department: String(row[4]),
          purpose: String(row[5]),
          neededBy: String(row[12]),
          email: String(row[22]),
          quantity: row[7],
          paperType: String(row[8]),
          width: row[9],
          length: row[10],
          thickness: row[11],
          trackingNumber: row[19] ? publicTrackingNumber_(row[19]) : String(row[1])
        };
        try { request.costEstimate = estimateFromRow_(row); }
        catch (_estimateError) { request.costEstimate = null; }
        if (notifyAdminsOfNewTicket_(request, String(row[1]), properties, book, true)) {
          ids[adminId] = true;
          queued++;
        }
      }
      var status = String(row[13]).trim().toLowerCase();
      var revision = Math.max(1, Number(row[18]) || 1);
      var statusId = 'status:' + String(row[0]) + ':' + String(revision) + ':' + status;
      var lastNotifiedStatus = String(row[23] || '').trim().toLowerCase();
      if (status !== lastNotifiedStatus && STATUSES.indexOf(status) !== -1) {
        if (!ids[statusId]) {
          var nextRevision = revision + 1;
          if (notifyCustomerOfStatus_(row, status, nextRevision, book, true)) {
            ids['status:' + String(row[0]) + ':' + String(nextRevision) + ':' + status] = true;
            queued++;
          }
          ticketSheet.getRange(firstRow + rowIndex, 18).setValue(new Date());
          ticketSheet.getRange(firstRow + rowIndex, 19).setValue(nextRevision);
        }
        ticketSheet.getRange(firstRow + rowIndex, 24).setValue(status);
      }
    } catch (error) {
      console.error('Could not reconcile notifications for ticket ' + String(row[0] || row[1] || firstRow + rowIndex) + ': ' + String(error && error.message || error));
    }
  });
  return queued;
}

function reconcilePendingStatusEdits_(book, properties) {
  var pending = properties.getProperties();
  var prefix = 'PENDING_STATUS_NOTIFICATION_';
  var sheet = ensureTicketSheet_(book);
  Object.keys(pending).filter(function(key) { return key.indexOf(prefix) === 0; }).forEach(function(key) {
    var ticketId = key.slice(prefix.length);
    try {
      var rowNumber = findRow_(sheet, 1, ticketId);
      if (!rowNumber) {
        properties.deleteProperty(key);
        return;
      }
      var row = sheet.getRange(rowNumber, 1, 1, HEADERS.length).getValues()[0];
      var status = String(row[13] || '').trim().toLowerCase();
      if (STATUSES.indexOf(status) === -1) return;
      if (String(row[23] || '').trim().toLowerCase() === status) {
        properties.deleteProperty(key);
        return;
      }
      var currentRevision = Math.max(1, Number(row[18]) || 1);
      var existingId = 'status:' + String(row[0]) + ':' + String(currentRevision) + ':' + status;
      if (findRow_(ensureNotificationSheet_(book), 1, existingId)) {
        sheet.getRange(rowNumber, 24).setValue(status);
        properties.deleteProperty(key);
        return;
      }
      var revision = currentRevision + 1;
      notifyCustomerOfStatus_(row, status, revision, book, true);
      var updatedAt = new Date();
      sheet.getRange(rowNumber, 18).setValue(updatedAt);
      sheet.getRange(rowNumber, 19).setValue(revision);
      sheet.getRange(rowNumber, 24).setValue(status);
      properties.deleteProperty(key);
    } catch (error) {
      console.error('Could not reconcile pending status notification for ticket ' + ticketId + ': ' + String(error && error.message || error));
    }
  });
}

function retryTicketNotifications() {
  var lock = LockService.getScriptLock();
  lock.waitLock(300000);
  try {
    var book = openBook_();
    try { reconcileNotifications_(book); }
    catch (reconcileError) { console.error('Could not reconcile notifications: ' + reconcileError.message); }
    return flushNotifications_(book);
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}

function validateEmail_(value, label) {
  if (typeof value !== 'string') throw new Error(label + ' is invalid.');
  var email = value.trim().toLowerCase();
  var local = email.split('@')[0];
  var pattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
  if (!email || email.length > 254 || local.length > 64 || local.indexOf('.') === 0
    || local.lastIndexOf('.') === local.length - 1 || local.indexOf('..') !== -1 || !pattern.test(email)) {
    throw new Error('Enter a valid ' + label.toLowerCase() + '.');
  }
  return email;
}

function parseEmailList_(value) {
  var seen = {};
  return String(value || '').split(',').map(function(email) {
    return email.trim() ? validateEmail_(email, 'Admin notification email') : '';
  }).filter(function(email) {
    if (!email || seen[email]) return false;
    seen[email] = true;
    return true;
  });
}

function validateNeededBy_(value) {
  if (DEADLINES.indexOf(value) !== -1) return value;
  var text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Choose or enter a valid needed-by date.');
  var parts = text.split('-').map(Number);
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (parts[0] < 2000 || parts[0] > 2100 || date.getUTCFullYear() !== parts[0]
    || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
    throw new Error('Choose or enter a valid needed-by date.');
  }
  var today = Utilities.formatDate(new Date(), DELAWARE_TIME_ZONE, 'yyyy-MM-dd');
  if (text < today) throw new Error('Needed-by date cannot be in the past.');
  return text;
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
function workshopFail_(message, status) {
  var error = new Error(message);
  error.status = status || 400;
  throw error;
}

function fifoCompare_(a, b) {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt)
    || (a.sequence || Number(String(a.ticketNumber || '').slice(2))) - (b.sequence || Number(String(b.ticketNumber || '').slice(2)))
    || a.id.localeCompare(b.id);
}

function assertTransition_(ticket, status) {
  if (ticket.status === status) return;
  var allowed = { queued: ['in-progress', 'cancelled'], 'in-progress': ['ready', 'cancelled'], ready: ['collected', 'cancelled'], collected: [], cancelled: [] };
  if (!allowed[ticket.status] || allowed[ticket.status].indexOf(status) === -1) workshopFail_('Use the next workflow step for this ticket.', 409);
  if (status === 'ready' && !(ticket.usage || []).length) workshopFail_('Record material used before marking this job ready.', 409);
}

function validateUsage_(ticket, input) {
  if (!input || typeof input !== 'object' || !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestKey || '')) workshopFail_('Refresh the material form and try again.');
  var used = Number(input.used);
  var waste = Number(input.waste);
  if (input.used === '' || input.used == null || input.waste === '' || input.waste == null || !Number.isFinite(used) || !Number.isFinite(waste)
    || used < 0 || waste < 0 || used + waste <= 0 || used + waste > 100000) {
    workshopFail_('Enter valid material quantities, including zero waste when there is none.');
  }
  var operator = typeof input.operator === 'string' ? input.operator.trim() : '';
  var note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!operator || operator.length > 100 || !note || note.length > 500) workshopFail_('Add your name and a short usage note (up to 500 characters).');
  return { requestKey: input.requestKey, used: used, waste: waste, operator: operator, note: note,
    material: ticket.machine === 'printer' ? ticket.paperType : 'Foam ' + ticket.thickness + ' in',
    unit: ticket.machine === 'printer' ? 'linear ft' : 'sq ft' };
}

function normalizePhone_(phone, consent) {
  if (!consent) return phone;
  var number = String(phone || '').replace(/[\s().-]/g, '');
  if (/^\d{10}$/.test(number)) number = '+1' + number;
  if (/^1\d{10}$/.test(number)) number = '+' + number;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) workshopFail_('Enter a valid mobile number with country code for text updates.');
  return number;
}

function notificationEvent_(ticket, status, reason) {
  if (['ready', 'cancelled', 'declined'].indexOf(status) === -1 || !ticket.smsConsent) return {};
  return { notification: { phone: ticket.phone, ticketNumber: ticket.ticketNumber, status: status, reason: reason || '' } };
}

function validateReview_(ticket, input) {
  if (!input || ['save', 'approve', 'decline'].indexOf(input.decision) === -1) workshopFail_('Choose a review action.');
  if (ticket.status !== 'pending-review') workshopFail_('Only requests awaiting review can be edited.', 409);
  var fields = input.fields || {};
  function stringField(key, max, required) {
    var value = fields[key] === undefined ? ticket[key] || '' : fields[key];
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) workshopFail_('Check ' + key + '.');
    return value.trim();
  }
  function numberField(key, max) {
    var raw = fields[key] === undefined ? ticket[key] : fields[key];
    if (['number', 'string'].indexOf(typeof raw) === -1 || !/^(?:\d+\.?\d*|\.\d+)$/.test(String(raw).trim())) workshopFail_('Check ' + key + '.');
    var value = Number(raw);
    if (!Number.isFinite(value) || value < 0.01 || value > max) workshopFail_('Check ' + key + '.');
    return value;
  }
  var machine = stringField('machine', 10, true);
  if (['printer', 'foam'].indexOf(machine) === -1) workshopFail_('Choose a machine.');
  var neededBy = stringField('neededBy', 30, true);
  if (DEADLINES.indexOf(neededBy) === -1 && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) workshopFail_('Choose a requested deadline.');
  var quantity = numberField('quantity', 10000);
  if (!Number.isInteger(quantity)) workshopFail_('Quantity must be a whole number.');
  var paperType = machine === 'printer' ? stringField('paperType', 50, false) : '';
  if (paperType && PAPER_TYPES.indexOf(paperType) === -1) workshopFail_('Choose a paper material.');
  if (input.decision === 'approve' && machine === 'printer' && !paperType) workshopFail_('Choose a paper material before approval.');
  var files = fields.files === undefined ? ticket.files : fields.files;
  if (!Array.isArray(files) || files.length > 10) workshopFail_('Attach up to ten artwork files.');
  files = files.map(function(file) {
    if (!file || typeof file.originalName !== 'string' || !file.originalName.trim() || file.originalName.length > 180 || /[\r\n]/.test(file.originalName)) workshopFail_('Check the artwork filename.');
    if (file.url && /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view$/.test(file.url)) return { originalName: file.originalName.trim(), url: file.url };
    workshopFail_('Use a Google Drive file link ending in /view.');
  });
  if (input.decision === 'approve' && machine === 'printer' && !files.length) workshopFail_('Attach artwork before approving a print.');
  var reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length > 1000 || (input.decision === 'decline' && !reason)) workshopFail_('Give a decline reason (up to 1000 characters).');
  var operator = typeof input.operator === 'string' ? input.operator.trim() : '';
  if (!operator || operator.length > 100) workshopFail_('Enter the reviewing admin name.');
  var phone = normalizePhone_(stringField('phone', 40, false), ticket.smsConsent === true);
  var edits = { machine: machine, neededBy: neededBy, quantity: quantity, paperType: paperType, files: files, phone: phone,
    customerName: stringField('customerName', 100, true), department: stringField('department', 100, true),
    purpose: stringField('purpose', 2000, true), notes: stringField('notes', 4000, false),
    width: numberField('width', machine === 'printer' ? 24 : 10000), length: numberField('length', 100000),
    thickness: machine === 'foam' ? numberField('thickness', 1000) : 0 };
  var changes = Object.keys(edits).filter(function(key) { return JSON.stringify(ticket[key]) !== JSON.stringify(edits[key]); })
    .map(function(key) { return { field: key, before: ticket[key] == null ? null : ticket[key], after: edits[key] }; });
  return { edits: edits, changes: changes, reason: reason, operator: operator,
    status: input.decision === 'approve' ? 'queued' : input.decision === 'decline' ? 'declined' : 'pending-review' };
}

function staffTicket_(row) {
  var machine = Object.keys(MACHINES).find(function(id) { return MACHINES[id] === String(row[2]) || id === String(row[2]); });
  function date(value) { return value instanceof Date ? value.toISOString() : String(value || ''); }
  function parsed(value) { if (!value) return []; var result = JSON.parse(String(value)); if (!Array.isArray(result)) throw new Error('Invalid staff record.'); return result; }
  return { id: String(row[0]), ticketNumber: String(row[1]), sequence: Number(String(row[1]).slice(2)), machine: machine,
    customerName: String(row[3]), department: String(row[4]), purpose: String(row[5]), phone: String(row[6] || '').replace(/^'(?=\+)/, ''),
    quantity: Number(row[7]), paperType: String(row[8] || ''), width: Number(row[9]), length: Number(row[10]), thickness: Number(row[11]), neededBy: String(row[12]),
    status: String(row[13]).toLowerCase(), notes: String(row[14] || ''),
    files: String(row[15] || '').split('\n').filter(Boolean).map(function(entry) {
      var match = /https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(entry);
      return match ? { originalName: entry.slice(0, entry.indexOf(match[0])).replace(/[\s—:|-]+$/, '') || 'Artwork', url: 'https://drive.google.com/file/d/' + match[1] + '/view' } : null;
    }).filter(Boolean),
    createdAt: date(row[16]), updatedAt: date(row[17]), revision: Number(row[18]) || 1,
    usage: parsed(row[27]), history: parsed(row[28]), smsConsent: row[29] === 'yes', reason: String(row[30] || '') };
}

function workshopRows_(sheet) {
  return sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getValues();
}

function publicWorkshopQueue_() {
  var tickets = workshopRows_(ensureTicketSheet_(openBook_())).map(staffTicket_).sort(fifoCompare_);
  return { ok: true, updatedAt: new Date().toISOString(), machines: Object.keys(MACHINES).map(function(id) {
    var activeTickets = tickets.filter(function(ticket) { return ticket.machine === id && (ticket.status === 'queued' || ticket.status === 'in-progress'); });
    var visible = tickets.filter(function(ticket) { return ticket.machine === id && ['pending-review', 'queued', 'in-progress'].indexOf(ticket.status) !== -1; });
    return { id: id, name: MACHINES[id], waiting: activeTickets.length,
      inReview: visible.filter(function(ticket) { return ticket.status === 'pending-review'; }).length,
      tickets: visible.map(function(ticket) { return { ticketNumber: ticket.ticketNumber, status: ticket.status,
        position: ticket.status === 'pending-review' ? null : activeTickets.findIndex(function(active) { return active.id === ticket.id; }) + 1 }; }) };
  }) };
}

function staffAction_(input, lock) {
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('WORKSHOP_SHARED_SECRET');
    if (!secret || secret.length < 32 || input.secret !== secret) workshopFail_('Staff connection is not authorized.', 401);
    lock.waitLock(20000);
    var book = openBook_();
    var sheet = ensureTicketSheet_(book);
    var rows = workshopRows_(sheet);
    var tickets = rows.map(staffTicket_);
    if (input.action === 'staffList') return jsonResponse_({ ok: true, tickets: tickets });
    var index = tickets.findIndex(function(ticket) { return ticket.id === input.id; });
    if (index < 0) workshopFail_('Ticket not found.', 404);
    var ticket = tickets[index];
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) workshopFail_('Refresh the ticket first.');
    var previousStatus = ticket.status;
    var now = new Date().toISOString();
    if (input.action === 'adminReview') {
      if (ticket.revision !== input.expectedRevision) workshopFail_('This request changed. Refresh before reviewing.', 409);
      var review = validateReview_(ticket, input.input);
      Object.assign(ticket, review.edits, { status: review.status, reason: review.reason });
      ticket.history.push(Object.assign({ status: ticket.status, at: now, operator: review.operator, reason: review.reason, changes: review.changes }, notificationEvent_(ticket, ticket.status, review.reason)));
    } else if (input.action === 'staffUsage') {
      var entry = validateUsage_(ticket, input.input);
      var prior = ticket.usage.find(function(item) { return item.requestKey === entry.requestKey; });
      if (prior) {
        if (Object.keys(entry).some(function(key) { return entry[key] !== prior[key]; })) workshopFail_('Usage was already recorded with different values.', 409);
        return jsonResponse_({ ok: true, ticket: ticket });
      }
      if (ticket.revision !== input.expectedRevision) workshopFail_('This ticket changed. Refresh and try again.', 409);
      if (['in-progress', 'ready'].indexOf(ticket.status) === -1) workshopFail_('Start the job before recording material usage.', 409);
      entry.at = now;
      ticket.usage.push(entry);
    } else {
      if (ticket.revision !== input.expectedRevision) workshopFail_('This ticket changed. Refresh and try again.', 409);
      assertTransition_(ticket, input.status);
      if (ticket.status === input.status) return jsonResponse_({ ok: true, ticket: ticket });
      if (typeof input.reason !== 'undefined' && typeof input.reason !== 'string') workshopFail_('Check the reason.');
      var reason = (input.reason || '').trim();
      if (reason.length > 1000 || (input.status === 'cancelled' && !reason)) workshopFail_('Give a cancellation reason (up to 1000 characters).');
      ticket.status = input.status;
      ticket.reason = reason;
      ticket.history.push(Object.assign({ status: ticket.status, at: now, reason: ticket.reason }, notificationEvent_(ticket, ticket.status, ticket.reason)));
    }
    ticket.revision++;
    ticket.updatedAt = now;
    var row = rows[index];
    if (input.action === 'adminReview') {
      row[2] = MACHINES[ticket.machine]; row[3] = ticket.customerName; row[4] = ticket.department; row[5] = ticket.purpose; row[6] = ticket.phone;
      row[7] = ticket.quantity; row[8] = ticket.paperType; row[9] = ticket.width; row[10] = ticket.length; row[11] = ticket.thickness;
      row[12] = ticket.neededBy; row[14] = ticket.notes; row[15] = ticket.files.map(function(file) { return file.originalName + ' — ' + file.url; }).join('\n');
      try {
        var estimate = estimateTicketCost_(ticket);
        row[24] = estimate.amountCents / 100; row[25] = estimate.basis; row[26] = estimate.version;
      } catch (_estimateError) { row[24] = ''; row[25] = ''; row[26] = ''; }
    }
    row[13] = ticket.status; row[17] = now; row[18] = ticket.revision;
    row[27] = JSON.stringify(ticket.usage); row[28] = JSON.stringify(ticket.history);
    row[29] = ticket.smsConsent ? 'yes' : ''; row[30] = ticket.reason || '';
    if (row[27].length > 45000 || row[28].length > 45000) workshopFail_('This ticket has reached its history limit. Contact the coordinator.');
    if (previousStatus !== ticket.status) {
      try { notifyCustomerOfStatus_(row, ticket.status, ticket.revision, book, true); row[23] = ticket.status; }
      catch (notificationError) { console.error('Could not queue customer notification: ' + notificationError.message); }
    }
    sheet.getRange(index + 2, 1, 1, HEADERS.length).setValues([row.map(escapeCell_)]);
    SpreadsheetApp.flush();
    return jsonResponse_({ ok: true, ticket: ticket });
  } catch (error) {
    return jsonResponse_({ ok: false, status: error.status || 503,
      error: error.status ? error.message : 'Google Sheets could not complete this operation. Refresh and retry.' });
  }
}

// Run once during rollout if pre-existing queued requests have not been reviewed.
function holdUnreviewedQueueForAdminReview() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = ensureTicketSheet_(openBook_());
    workshopRows_(sheet).forEach(function(row, index) {
      var ticket = staffTicket_(row);
      var approved = ticket.history.some(function(history) { return history.status === 'queued' && history.operator && Array.isArray(history.changes); });
      if (ticket.status !== 'queued' || approved) return;
      var now = new Date().toISOString();
      ticket.history.push({ status: 'pending-review', at: now, reason: 'Existing unstarted request moved to admin review during rollout.' });
      row[13] = 'pending-review'; row[17] = now; row[18] = ticket.revision + 1; row[28] = JSON.stringify(ticket.history);
      sheet.getRange(index + 2, 1, 1, HEADERS.length).setValues([row.map(escapeCell_)]);
    });
    SpreadsheetApp.flush();
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
