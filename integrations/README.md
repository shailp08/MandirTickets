# Google Sheets recording

Create a private Google Sheet for the workshop register. Do not publish the sheet or commit its ID.

## Automatic connection
1. Open the private register and choose Extensions → Apps Script.
2. Paste google-sheets.gs into the editor.
3. In Project settings → Script properties, set SPREADSHEET_ID to the ID from the sheet URL and SHARED_SECRET to the SHEETS_SHARED_SECRET value in the server environment. Never put the secret in a spreadsheet cell or client-side configuration.
4. Deploy → New deployment → Web app. Execute as yourself; permit Anyone to reach the endpoint. The script checks the private shared secret before accessing the sheet, and does not expose any read endpoint. The spreadsheet itself stays private.
5. Authorize the script with Google. Copy the resulting /exec deployment URL to SHEETS_WEBHOOK_URL in .env, then restart the server.
6. Staff desk → Sync now sends pending tickets. Confirm a row appears and that changing a ticket to Ready updates that row.

Records go into the Tickets tab. Every ticket has an immutable ID; retries update rather than duplicate rows. Revision checks ignore stale updates. Spreadsheet formula characters in user-supplied values are escaped. Files stay on the local server; only filenames are recorded in Sheets.

## Manual export
Staff desk → Export spreadsheet downloads a CSV. In Google Sheets use File → Import → Upload, choose the CSV and insert a new sheet. Disable conversion of text to numbers/dates/formulas when importing to retain phone and dimension formatting. This remains available without a live connection.

Official deployment guide: https://developers.google.com/apps-script/guides/web
