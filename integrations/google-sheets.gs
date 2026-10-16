// Google Apps Script: deploy as a web app executing as the owner.
// Script properties: SPREADSHEET_ID, SHARED_SECRET (same secret as the server).
// Keep this sheet private. The endpoint only accepts authenticated writes.
function doPost(event) {
  var lock = LockService.getScriptLock();
  try {
    var input = JSON.parse(event.postData.contents);
    var properties = PropertiesService.getScriptProperties();
    var secret = properties.getProperty('SHARED_SECRET');
    if (!secret || input.secret !== secret) return jsonResponse({ ok: false });
    var row = input.row;
    if (!Array.isArray(row) || row.length !== 19 || typeof row[0] !== 'string' || !Number.isInteger(row[18])) return jsonResponse({ ok: false });
    lock.waitLock(20000);
    var book = SpreadsheetApp.openById(properties.getProperty('SPREADSHEET_ID'));
    var sheet = book.getSheetByName('Tickets') || book.insertSheet('Tickets');
    var headers = ['Ticket ID', 'Queue number', 'Machine', 'Name', 'Department', 'Purpose', 'Phone', 'Quantity', 'Paper', 'Width (in)', 'Length (in)', 'Thickness (in)', 'Needed by', 'Status', 'Notes', 'Files', 'Created', 'Updated', 'Revision'];
    if (!sheet.getLastRow()) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#234c3d').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, headers.length);
    }
    var match = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(row[0]).matchEntireCell(true).findNext() : null;
    if (match && Number(sheet.getRange(match.getRow(), 19).getValue()) >= row[18]) return jsonResponse({ ok: true });
    var safe = row.map(function(value) { return typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : value; });
    sheet.getRange(match ? match.getRow() : sheet.getLastRow() + 1, 1, 1, headers.length).setValues([safe]);
    SpreadsheetApp.flush();
    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false });
  } finally {
    if (lock.hasLock()) lock.releaseLock();
  }
}
function jsonResponse(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
