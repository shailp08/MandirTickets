# Mandir Workshop Tickets

A focused request system for poster printing and foam cutting. The public site opens with one question—what the requester needs—and then shows only the fields required for that job.

## What works

- One focused public interface with no marketing, public queue, or staff pages
- Private Google Sheets backend with private Google Drive attachments
- Receipt-protected ticket tracking with live status and queue position
- Separate print and foam-cutting request requirements
- Streaming uploads with type, structure, signature, count, and size validation
- Persistent `P-0001` and `F-0001` queue sequences
- Idempotent submissions that cannot silently create duplicate tickets
- Password-protected staff API with stale-write protection
- Queued → In progress → Ready for pickup → Collected workflow
- Cancellation, reopening, and complete status history
- Email alerts to one or more admins for new tickets and to requesters for status changes
- CSV export and optional authenticated Google Sheets replication
- Atomic local persistence and a single-writer process lock
- Responsive and keyboard-accessible React request form with reduced-motion support

## Run locally

Node.js 22 or newer is required.

```bash
npm ci
cp .env.example .env
# Set ADMIN_PASSWORD in .env
npm start
```

Open [http://localhost:3000](http://localhost:3000).

`npm start` builds the React client before starting Express. The local server stores records in `data/tickets.json` and files in `data/uploads/` unless `DATA_DIR` points elsewhere.

## Verify the system

```bash
npm run check
npm audit --omit=dev
```

`npm run check` performs a production client build, runs the API/security/persistence test suite, and audits the configured ticket database without printing customer information. The data audit checks duplicate IDs and queue numbers, status and revision consistency, history timestamps, missing upload files, unsafe stored filenames, and orphaned files.

## GitHub Pages and Google Sheets

The recommended Pages deployment uses the included Google Apps Script backend. Tickets are written to a private Sheet, attachments are stored in a private Drive folder, and status changes made in the Sheet appear in the public tracker. Tracking requires both the queue number and the private code printed on the receipt; names, departments, contact details, purposes, notes, and files are never returned by the tracker.

Setup instructions are in [integrations/README.md](integrations/README.md). Once the Apps Script web app is deployed, add its `/exec` URL to the GitHub repository variable `VITE_GOOGLE_SCRIPT_URL` and re-run the Pages workflow.

The original Node backend remains available for controlled local or separately hosted installations. Set `VITE_API_BASE_URL` instead when using it. If neither backend variable is configured, the Pages build clearly identifies itself as a non-saving preview.

## Production environment

Production refuses to start unless these safeguards are configured:

- `NODE_ENV=production`
- `ADMIN_PASSWORD` with at least 16 characters
- `APP_ORIGIN` set to the HTTPS frontend origin
- `COOKIE_SECURE=true`
- `CLAMSCAN_PATH` set to an absolute ClamAV `clamscan` executable with current signatures
- Persistent `DATA_DIR` storage with backups and disk monitoring

Optional upload controls default to ten files and 200 MiB per file:

- `MAX_UPLOAD_FILES`
- `MAX_UPLOAD_BYTES`

The Node backend sends notification emails through any SMTP provider. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `NOTIFICATION_FROM`, and (when required) `SMTP_USER` and `SMTP_PASSWORD`. Set `ADMIN_NOTIFICATION_EMAILS` to a comma-separated list of every admin who should receive new-ticket alerts. Failed messages are stored in `DATA_DIR/notifications.json` and retried automatically; notification status is also included in the authenticated `GET /api/tickets` response.

Use only one server process against a data directory. `server.lock` prevents simultaneous writers. After a crash, verify that no server on any host uses that directory before removing the lock.

The application should be placed behind HTTPS and trusted-network or identity controls before broad public exposure. Google Sheets is a reporting copy, not the source of truth.

## Data and privacy

The public endpoints return only queue numbers, machine names, statuses, and positions. Names, departments, email addresses, phone numbers, purposes, notes, and files require a staff session. Recent ticket numbers stored in the browser contain no customer details and can be cleared by the requester.

Uploaded PDF and image checks verify safe envelopes, not complete document semantics. SVG and DXF receive restrictive structural validation. Production additionally requires malware scanning. Staff must still verify material, margins, dimensions, geometry, and machine readiness.

## Managing tickets in Google Sheets

Staff use the private `Tickets` sheet as the work queue. Change the Status dropdown in column N to `queued`, `in-progress`, `ready`, `collected`, or `cancelled`; the customer tracker reads that state live and the requester receives an email. Open artwork from the private Drive links in column P. To print a ticket, select its row and use **File → Print → Selected cells**. The Sheet is the system of record and should not be published or shared with requesters. See [`integrations/README.md`](integrations/README.md#daily-workflow) for the complete staff workflow.
