# Google Sheets ticket backend

This backend makes the GitHub Pages site operational without publishing the spreadsheet. Ticket details stay in a private Google Sheet, attachments stay in a private Google Drive folder, and the tracker returns only the private ticket code, machine, status, queue position, creation time, and stored material estimate.

## Create and deploy the backend

1. Create a new private Google Sheet named **Delaware Mandir Workshop Tickets**.
2. In that sheet, choose **Extensions → Apps Script**.
3. Replace the editor contents with [`google-sheets.gs`](google-sheets.gs) and save it.
4. Select `setupMandirTicketSystem` in the function menu and click **Run**. Approve access to the current spreadsheet, Google Drive, and email sending. Setup creates the `Tickets` tab, a private Drive folder for attachments, a hidden notification outbox, and installable triggers for status emails and delivery retries.
5. Reload the spreadsheet. Setup makes the managed Google Group `demandirtickets@googlegroups.com` the notification recipient, including when upgrading an installation that previously defaulted to its owner. Keep it as the single address so group membership controls which admins receive alerts.
6. Choose **Deploy → New deployment → Web app**.
7. Set **Execute as** to yourself and **Who has access** to **Anyone**. Deploy and copy the URL ending in `/exec`.
8. In the GitHub repository, open **Settings → Secrets and variables → Actions → Variables** and create `VITE_GOOGLE_SCRIPT_URL` with the `/exec` URL.
9. Re-run the **Verify and deploy GitHub Pages** workflow.

Never publish the spreadsheet, share the upload folder, commit the deployment URL as source code, or add a client-side secret. The web app is intentionally public so visitors can create and track tickets; each receipt has one opaque `DM-…` ticket code so internal sequential queue numbers are not exposed.

## Daily workflow

- Open the private **Delaware Mandir Workshop Tickets** spreadsheet in Google Drive and use the `Tickets` tab as the staff queue. Do not link the private sheet from the public website.
- New submissions appear as one row with status `queued`. The most useful staff columns are Queue number (B), Name (D), Purpose (F), Needed by (M), Status (N), and Files (P).
- Update Status (column N) with its dropdown: `queued`, `in-progress`, `ready`, `collected`, or `cancelled`. The public tracker reflects the change and the customer receives an email at the address stored with the ticket.
- Manage admins by adding or removing members in `demandirtickets@googlegroups.com`. Use **Ticket system → Configure notification emails** only if the notification group address itself changes. Customer status emails use the group as their Reply-To address; Apps Script still sends them from the Google account that owns the deployment.
- Failed emails remain in the hidden notification outbox and retry automatically. Do not rename, edit, or delete that hidden tab.
- To print the submitted artwork, open its private Drive link in Files (column P), then print or download it from the Drive preview.
- To print the ticket details, select the cells in that ticket's row, choose **File → Print**, and set **Print** to **Selected cells**. Landscape orientation is usually easiest to read.
- The hidden Ticket ID, Tracking code, and Request key columns support integrity and idempotency. Do not delete or reuse them.
- Approximate cost, cost basis, and estimate version are stored at submission so later rate changes do not rewrite an existing estimate. The estimate covers materials only.
- Use **Ticket system → Audit ticket files** to verify that every Sheet file link still points to a non-empty, checksummed file in the private Drive folder.

## Reliability target

This deployment assumes one workshop, internal PII, fewer than one request per second at peak, and more tracker reads than ticket writes. The operational target is 99.5% monthly availability, with backend handshake latency excluding file-transfer time of p50 ≤ 2,500 ms, p95 ≤ 15,000 ms, and p99 ≤ 60,000 ms. The recovery point objective is zero loss for tickets that displayed a receipt; the recovery time objective is four hours. The workshop site owner is the named error-budget owner and should run the file audit after backend changes or any reported upload failure.

The public backend accepts up to five files and 200 MB total. PDF, static SVG, ASCII DXF, PNG, JPG, and TIFF are accepted. Large files use private, resumable Google Drive sessions instead of passing through the Apps Script request body. Google Apps Script is suitable for a small workshop; its quotas, a default 250-ticket daily circuit breaker, and a default 5 GiB daily upload reservation limit reduce abuse. Set different positive `MAX_DAILY_TICKETS` or `MAX_DAILY_UPLOAD_BYTES` script properties only if needed. Set `UPLOAD_ORIGINS` to a comma-separated origin allowlist if the frontend is hosted somewhere other than the included GitHub Pages site or local development addresses.

When upgrading an existing deployment, run `setupMandirTicketSystem` again before deploying the new version. This adds the estimate columns, snapshots estimates for compatible existing rows, installs notification triggers, and requests the required permissions. Existing tickets without an email address continue to work but cannot receive status alerts.

The setup function creates starter `COST_*` Script Properties matching the Node defaults. In **Project Settings → Script Properties**, replace the foam sheet dimensions/rates, each print-material rate, and the ink rate with the workshop's actual costs. Increment `COST_ESTIMATE_VERSION` whenever rates change; existing rows keep their saved estimate.

## Updating the backend

After changing `google-sheets.gs`, update the Apps Script source, save, then choose **Deploy → Manage deployments → Edit → New version → Deploy**. Existing `/exec` URLs continue working.

The script accepts the original Node server’s authenticated 19/20-column sync payloads and the current 24-column payload with customer email, ticket code, and cost estimate when `SHARED_SECRET` is set as a script property. Most GitHub Pages installations do not need that compatibility path.

Official deployment guide: https://developers.google.com/apps-script/guides/web
