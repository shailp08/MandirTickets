# Google Sheets ticket backend

This backend makes the GitHub Pages site operational without publishing the spreadsheet. Ticket details stay in a private Google Sheet, attachments stay in a private Google Drive folder, and the tracker returns only ticket number, machine, status, queue position, and creation time.

## Create and deploy the backend

1. Create a new private Google Sheet named **Mandir Workshop Tickets**.
2. In that sheet, choose **Extensions → Apps Script**.
3. Replace the editor contents with [`google-sheets.gs`](google-sheets.gs) and save it.
4. Select `setupMandirTicketSystem` in the function menu and click **Run**. Approve access to the current spreadsheet, Google Drive, and email sending. Setup creates the `Tickets` tab, a private Drive folder for attachments, and the installable trigger used for customer status emails.
5. Reload the spreadsheet, then choose **Ticket system → Configure notification emails**. Enter your address and any other admin addresses that should receive new-ticket alerts, separated by commas.
6. Choose **Deploy → New deployment → Web app**.
7. Set **Execute as** to yourself and **Who has access** to **Anyone**. Deploy and copy the URL ending in `/exec`.
8. In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables** and create `VITE_GOOGLE_SCRIPT_URL` with the `/exec` URL.
9. Re-run the **Verify and deploy GitHub Pages** workflow.

Never publish the spreadsheet, share the upload folder, commit the deployment URL as source code, or add a client-side secret. The web app is intentionally public so visitors can create and track tickets; private tracking codes prevent casual enumeration of ticket status.

## Daily workflow

- Open the private **Mandir Workshop Tickets** spreadsheet in Google Drive and use the `Tickets` tab as the staff queue. Do not link the private sheet from the public website.
- New submissions appear as one row with status `queued`. The most useful staff columns are Queue number (B), Name (D), Purpose (F), Needed by (M), Status (N), and Files (P).
- Update Status (column N) with its dropdown: `queued`, `in-progress`, `ready`, `collected`, or `cancelled`. The public tracker reflects the change and the customer receives an email at the address stored with the ticket.
- Use **Ticket system → Configure notification emails** whenever you need to add or remove admins from new-ticket alerts. This setting is private and never sent to the public frontend.
- To print the submitted artwork, open its private Drive link in Files (column P), then print or download it from the Drive preview.
- To print the ticket details, select the cells in that ticket's row, choose **File → Print**, and set **Print** to **Selected cells**. Landscape orientation is usually easiest to read.
- The hidden Ticket ID, Tracking code, and Request key columns support integrity and idempotency. Do not delete or reuse them.
- Use **Ticket system → Audit ticket files** to verify that every Sheet file link still points to a non-empty, checksummed file in the private Drive folder.

## Reliability target

This deployment assumes one workshop, internal PII, fewer than one request per second at peak, and more tracker reads than ticket writes. The operational target is 99.5% monthly availability, with backend handshake latency excluding file-transfer time of p50 ≤ 2,500 ms, p95 ≤ 15,000 ms, and p99 ≤ 60,000 ms. The recovery point objective is zero loss for tickets that displayed a receipt; the recovery time objective is four hours. The workshop site owner is the named error-budget owner and should run the file audit after backend changes or any reported upload failure.

The public backend accepts up to five files and 200 MB total. PDF, static SVG, ASCII DXF, PNG, JPG, and TIFF are accepted. Large files use private, resumable Google Drive sessions instead of passing through the Apps Script request body. Google Apps Script is suitable for a small workshop; its quotas, a default 250-ticket daily circuit breaker, and a default 5 GiB daily upload reservation limit reduce abuse. Set different positive `MAX_DAILY_TICKETS` or `MAX_DAILY_UPLOAD_BYTES` script properties only if needed. Set `UPLOAD_ORIGINS` to a comma-separated origin allowlist if the frontend is hosted somewhere other than the included GitHub Pages site or local development addresses.

When upgrading an existing deployment, run `setupMandirTicketSystem` again before deploying the new version. This adds the Customer email column, installs the status-change notification trigger, and requests the email permission. Existing tickets without an email address continue to work but cannot receive status alerts.

## Updating the backend

After changing `google-sheets.gs`, update the Apps Script source, save, then choose **Deploy → Manage deployments → Edit → New version → Deploy**. Existing `/exec` URLs continue working.

The script accepts both the original Node server’s authenticated 19-column sync payload and the current 20-column payload with customer email when `SHARED_SECRET` is set as a script property. Most GitHub Pages installations do not need that compatibility path.

Official deployment guide: https://developers.google.com/apps-script/guides/web
