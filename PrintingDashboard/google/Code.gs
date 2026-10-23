/* ===========================================================================
   PrintTrack — Google Apps Script web app
   Bridges the Google Form responses sheet to the dashboard.

   Endpoints (all GET, to avoid CORS preflight that Apps Script can't answer):
     GET  <exec-url>
       → returns the job list as JSON.
     GET  <exec-url>?action=updateStatus&rowId=<n>&status=<pending|in_progress|completed>
       → writes the Status cell for that row.

   Setup: see google/SETUP.md. Bind this script to the responses spreadsheet,
   then Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Access: Anyone.
   =========================================================================== */

// Sheet/tab that holds the form responses. Update if you renamed it.
var SHEET_NAME = 'Form Responses 1';

// Maps the dashboard field names to the form's column headers.
// Edit the right-hand strings to match YOUR form's exact question text.
var COLUMN_MAP = {
  submittedAt: 'Timestamp',
  requester:   'Name',
  content:     'Content name',
  material:    'Material',
  widthIn:     'Width (in)',
  heightIn:    'Height (in)',
  quantity:    'Quantity',
  department:  'Department',
  notes:       'Notes',
  status:      'Status',     // managed by the dashboard; add this column manually
  fileUrl:     'Print File', // the Form file-upload question (Drive link column)
  email:       'Email Address', // added when the Form's "Collect emails" is on
};

// Set to false to disable the "your print is ready" email on completion.
var NOTIFY_ON_DONE = true;

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'updateStatus') {
    return updateStatus_(e.parameter.rowId, e.parameter.status);
  }
  if (action === 'getFile') {
    return getFile_(e.parameter.rowId);
  }
  if (action === 'getThumbnail') {
    return getThumbnail_(e.parameter.rowId);
  }
  if (action === 'peekFile') {
    return peekFile_(e.parameter.rowId);
  }
  if (action === 'debugHeaders') {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return json_({ error: 'sheet not found' });
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    return json_({ headers: headers });
  }
  return json_(getJobs_());
}

/** Return a small Drive-generated thumbnail (base64) for artwork preview. */
function getThumbnail_(rowId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return json_({ ok: false, error: 'sheet not found' });
  var row = Number(rowId);
  if (!row || row < 2) return json_({ ok: false, error: 'bad rowId' });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf(COLUMN_MAP.fileUrl);
  if (col < 0) return json_({ ok: false, error: 'no Artwork column' });

  var id = extractFileId_(String(sheet.getRange(row, col + 1).getValue() || ''));
  if (!id) return json_({ ok: false, error: 'no file' });

  try {
    var thumb = DriveApp.getFileById(id).getThumbnail();
    if (!thumb) return json_({ ok: false, error: 'no thumbnail' });
    return json_({ ok: true, base64: Utilities.base64Encode(thumb.getBytes()), mime: thumb.getContentType() });
  } catch (err) {
    return json_({ ok: false, error: 'thumbnail failed: ' + err });
  }
}

/** Check if a file exists for a row without downloading it (fast metadata only). */
function peekFile_(rowId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return json_({ ok: false, error: 'sheet not found' });
  var row = Number(rowId);
  if (!row || row < 2) return json_({ ok: false, error: 'bad rowId' });
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf(COLUMN_MAP.fileUrl);
  if (col < 0) return json_({ ok: false, error: 'no file column' });
  var cell = String(sheet.getRange(row, col + 1).getValue() || '');
  var id = extractFileId_(cell);
  if (!id) return json_({ ok: false, error: 'no file' });
  try {
    var file = DriveApp.getFileById(id);
    return json_({ ok: true, filename: file.getName(), mime: file.getMimeType() });
  } catch (err) {
    return json_({ ok: false, error: 'cannot access: ' + err });
  }
}

/** Return the uploaded artwork for a row as base64 (for the backend to print). */
function getFile_(rowId) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return json_({ ok: false, error: 'sheet not found' });

  var row = Number(rowId);
  if (!row || row < 2) return json_({ ok: false, error: 'bad rowId' });

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf(COLUMN_MAP.fileUrl);
  if (col < 0) return json_({ ok: false, error: 'no Artwork column' });

  var cell = String(sheet.getRange(row, col + 1).getValue() || '');
  var id = extractFileId_(cell);
  if (!id) return json_({ ok: false, error: 'no file for this row' });

  try {
    var file = DriveApp.getFileById(id);
    var blob = file.getBlob();
    return json_({
      ok: true,
      filename: file.getName(),
      mime: blob.getContentType(),
      base64: Utilities.base64Encode(blob.getBytes()),
    });
  } catch (err) {
    return json_({ ok: false, error: 'cannot read file: ' + err });
  }
}

/** Pull a Drive file id out of a Forms upload URL (or a raw id). */
function extractFileId_(value) {
  var m = value.match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/** Read every response row and shape it into the dashboard's job objects. */
function getJobs_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var headers = values[0];
  var idx = {};
  for (var key in COLUMN_MAP) {
    idx[key] = headers.indexOf(COLUMN_MAP[key]);
  }

  var jobs = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var content = idx.content >= 0 ? row[idx.content] : '';
    if (!content) continue; // skip blank rows

    var fileCell = idx.fileUrl >= 0 ? String(row[idx.fileUrl] || '') : '';
    jobs.push({
      id: r + 1, // 1-based sheet row number, used for status writes
      submittedAt: idx.submittedAt >= 0 ? toIso_(row[idx.submittedAt]) : '',
      requester:   idx.requester >= 0 ? String(row[idx.requester]) : '',
      content:     String(content),
      material:    idx.material >= 0 ? String(row[idx.material]) : '',
      widthIn:     idx.widthIn >= 0 ? Number(row[idx.widthIn]) : 0,
      heightIn:    idx.heightIn >= 0 ? Number(row[idx.heightIn]) : 0,
      quantity:    idx.quantity >= 0 ? Number(row[idx.quantity]) : 1,
      department:  idx.department >= 0 ? String(row[idx.department]) : '',
      notes:       idx.notes >= 0 ? String(row[idx.notes]) : '',
      status:      normalizeStatus_(idx.status >= 0 ? row[idx.status] : ''),
      fileId:      extractFileId_(fileCell),
    });
  }
  return jobs;
}

/** Write a status value back to a given sheet row. */
function updateStatus_(rowId, status) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) return json_({ ok: false, error: 'sheet not found' });

  var row = Number(rowId);
  var statusCol = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getValues()[0].indexOf(COLUMN_MAP.status) + 1;
  if (statusCol < 1) return json_({ ok: false, error: 'no Status column' });
  if (!row || row < 2) return json_({ ok: false, error: 'bad rowId' });

  var human = { pending: 'Pending', in_progress: 'In Progress', ready: 'Ready for Pickup', completed: 'Picked Up' }[status] || 'Pending';
  sheet.getRange(row, statusCol).setValue(human);

  // Notify when the print is ready for pickup (not when it's been collected)
  if (NOTIFY_ON_DONE && status === 'ready') {
    notifyDone_(sheet, row);
  }
  return json_({ ok: true, rowId: row, status: status });
}

/** Email the requester that their print is ready (best-effort, non-fatal). */
function notifyDone_(sheet, row) {
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var emailCol = headers.indexOf(COLUMN_MAP.email);
    var contentCol = headers.indexOf(COLUMN_MAP.content);
    if (emailCol < 0) return; // no email collected — skip silently

    var email = String(sheet.getRange(row, emailCol + 1).getValue() || '').trim();
    if (!email) return;

    var content = contentCol >= 0 ? String(sheet.getRange(row, contentCol + 1).getValue() || 'your print') : 'your print';
    MailApp.sendEmail(
      email,
      'Your print is ready: ' + content,
      'Hari Om,\n\n"' + content + '" has finished printing and is ready for pickup at the print station.\n\n— PrintTrack, BAPS Mandir'
    );
  } catch (err) {
    // Don't fail the status update if mail quota/permission is unavailable.
  }
}

/** Map free-text sheet status to the dashboard's enum. Blank → pending. */
function normalizeStatus_(value) {
  var v = String(value || '').trim().toLowerCase();
  if (v === 'in progress' || v === 'in_progress' || v === 'printing') return 'in_progress';
  if (v === 'ready for pickup' || v === 'ready') return 'ready';
  if (v === 'done' || v === 'completed' || v === 'complete' || v === 'picked up') return 'completed';
  return 'pending';
}

function toIso_(value) {
  if (value instanceof Date) return value.toISOString();
  return String(value || '');
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
