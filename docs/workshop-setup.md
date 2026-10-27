# Delaware Mandir workshop — setup and rollout

All project files are inside MandirTickets, including the staff-dashboard subfolder. The live GitHub Pages site and its Google Apps Script deployment have **not** been changed.

## Workflow

1. A requester submits printing or foam details and artwork. The receipt says **Awaiting admin review**. The public queue and private tracker show **In Review** until approval, without a production position. No paper-material selector appears on the public form.
2. An admin signs in and opens **Admin review**. They can open artwork, correct requester/contact information, department, purpose, requested timing, quantity, dimensions, foam thickness, notes, request type, and artwork attachments. Corrected files can be linked from the private workshop Google Drive folder. Local attachments can be renamed or removed. The admin chooses paper for printing.
3. The admin saves corrections, approves for production, or declines with a reason. Approval requires a paper choice for printing. The interface also requires confirmation that artwork, sizes, quantity, and material were checked. Edits and decisions are recorded in history; concurrent edits cannot overwrite a newer revision.
4. Approved requests enter the staff printing or foam queue. Submission time provides the default order, but staff can start any approved job, including several jobs being worked on. Positions are advisory, not promised completion times.
5. Staff record actual material used and waste, then mark ready for pickup, collected, or cancelled. Cancellation requires a reason. Material history is retained.
6. Requesters who opt in receive a Textbee notification when ready, declined, or cancelled. Private tracking shows the current status and review/cancellation reason. The public queue shows the requester’s name below each ticket number. Phone numbers, artwork, and review reasons remain private.

The workflow does not send commands to the printer or foam cutter. Trained volunteers operate the machines. Material totals measure recorded consumption, not remaining inventory, ink levels, or automatic machine telemetry.

## GitHub Pages staff access

The GitHub Pages deployment connects the staff dashboard directly to Apps Script. Its sign-in screen is a browser-local gate and does not require `WORKSHOP_SHARED_SECRET`, `APP_ORIGIN`, `STAFF_API_URL`, or a Node server. The Pages workflow passes the existing `VITE_GOOGLE_SCRIPT_URL` into both frontend builds.

After entering the staff screen, the dashboard opens the review workspace and production tools. The typed volunteer name is saved as a history label. Ticket reads retry transient Apps Script failures and have a JSONP fallback; writes use a single POST so an uncertain response cannot automatically replay a status or review mutation.

The optional Node deployment remains in the repository but is not required for this mode.

## Textbee free tier

As checked on October 23, 2026, Textbee’s free plan allows **50 messages per day and 300 per month**, including received messages, on one Android device. It uses that device’s SIM number. It does not provide a free sender number or mobile plan.

Use a **dedicated mandir Android phone and SIM**, so no volunteer’s personal number is used. The phone needs power, an internet connection, permission to run Textbee in the background, and an active SMS-capable SIM plan. Confirm the current allowance in the Textbee account before the Diwali rush.

1. Create/verify the mandir’s Textbee account and install the official app on its Android phone.
2. Pair the phone and enable sending. Record the device ID and create an API key.
3. Put `TEXTBEE_API_KEY` and `TEXTBEE_DEVICE_ID` in the **private server environment**, never in the public React app or Google Sheet. No secret needs to be pasted into this chat.
4. Keep a persistent disk mounted at `DATA_DIR`; run one server instance. `notifications.json` is the durable send journal and must survive restarts and deployments. Back it up along with other server data. Losing this journal can resend previously processed notification events.
5. Send a live test only to a consenting coordinator’s number and confirm both the phone and Textbee dashboard show the expected outcome. This live delivery test has not been performed.

The app uses Textbee’s authenticated `POST /api/v1/gateway/send-sms` endpoint and always specifies the dedicated device ID. It normalizes US numbers and accepts international numbers with country codes. Opt-in is optional; legacy requests are not opted in automatically.

A Textbee acceptance is labeled **delivery unconfirmed**, not delivered. The Textbee dashboard is the place to check carrier delivery and incoming replies; this version does not synchronize delivery webhooks or replies. Rejected sends, including free-tier limits, remain visible on the ticket and can be retried after the cause is fixed. Timeouts and interrupted sends are marked **unknown** and are not automatically retried, to avoid duplicates. Check Textbee before following up manually. Notifications awaiting configuration are retained; obsolete pickup messages are skipped if the ticket has already moved on.

Sources: [Free plan](https://textbee.dev/free-sms-api), [Setup requirements](https://textbee.dev/docs/getting-started), [Sending API and response semantics](https://textbee.dev/docs/sending-sms/sending-sms).

## Existing live system

Public site: [MandirTickets](https://shailp08.github.io/MandirTickets/).

Existing Apps Script deployment:

```
https://script.google.com/macros/s/AKfycbwpy_peP9T_gYF6blc1EnCvVn-TqvFhXHgiW_d9s5c4sDLx61U56ANTLTawZUQ0ic8p/exec
```

The existing read-only health check succeeded earlier. The new admin/staff endpoints still require deployment. No live tickets were created or changed during development.

To find the editor, open the ticket Google Sheet and choose **Extensions → Apps Script**. If the Sheet is owned by someone else, its owner must provide access or apply the update. The public deployment URL does not grant editor access.

## Rollout order

1. Back up the ticket Sheet and existing Apps Script source; retain the previous deployment version for rollback.
2. Replace the existing ticket script with `MandirTickets/integrations/google-sheets.gs`. Preserve existing Script Properties, Sheet ID, upload-folder ID, and allowed upload origins. **Do not run new-system setup or create a replacement Sheet.**
3. Publish a new version of the **existing deployment**, keeping its `/exec` URL. The script preserves the legacy email and cost columns, then stores Material usage, Staff history, SMS consent, and Review reason after them. Existing receipt codes, IDs, timestamps, costs, and Drive links are preserved.
4. Before opening the staff desk, run `holdUnreviewedQueueForAdminReview` from the script editor if the existing queued backlog has not already been approved. It moves only unstarted queued requests without an approval history into review. Active, ready, collected, and cancelled work is preserved. It is safe to rerun without duplicating these holds. Direct Sheet changes bypass application review and revision controls; use the app afterward.
5. In GitHub repository variables, retain `VITE_GOOGLE_SCRIPT_URL` with the existing `/exec` URL. `STAFF_API_URL` may remain empty. Run the **Verify and deploy GitHub Pages** workflow; it passes the Apps Script URL to both the public form and staff dashboard.
6. Verify a clearly labeled real request for each machine with the coordinator: submit a small DXF/SVG and a print file, confirm the Drive link appears on the staff ticket, edit/approve, start, log material, mark ready, and collect. Also test decline with a private reason.

Google Drive artwork remains private. Give authorized admins/staff access to the existing workshop folder; the app does not make files public.

## Optional private-server configuration

The following is only for a future Node-hosted deployment. It is not needed for the GitHub Pages-only pipeline:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
APP_ORIGIN=https://YOUR-STAFF-HOST
COOKIE_SECURE=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=SET-PRIVATELY
STAFF_USERNAME=workshop
STAFF_PASSWORD=SET-PRIVATELY
WORKSHOP_GOOGLE_SCRIPT_URL=THE-EXISTING-EXEC-URL
WORKSHOP_SHARED_SECRET=THE-SAME-VALUE-AS-SCRIPT-PROPERTIES
PUBLIC_REQUEST_URL=https://shailp08.github.io/MandirTickets/
TEXTBEE_API_KEY=SET-PRIVATELY
TEXTBEE_DEVICE_ID=YOUR-DEDICATED-PHONE-ID
DATA_DIR=/app/data
UPLOAD_REQUEST_TIMEOUT_MS=900000
SHEETS_WEBHOOK_URL=
SHEETS_SHARED_SECRET=
```

Mount durable storage at `/app/data` with write access for the application user. Keep one server instance. Sessions last eight hours and are cleared on restart. The Google Sheet remains the source of truth for tickets, review history, and material usage; local durable storage keeps the SMS send journal. Google failures never create a replacement local production queue.

The archive contains one `MandirTickets` folder. From inside that folder:

```bash
docker build -f deploy/Dockerfile -t mandir-workshop .
```

The Dockerfile is prepared but has not been built here. The application builds were verified directly. No hosting account has been created or charged, and no live deployment has been performed.

## Local checks

Use Node 22 or newer. Run these commands from MandirTickets:

```bash
npm run setup
npm run check
npm start
```

For a separate local test database, leave `WORKSHOP_GOOGLE_SCRIPT_URL`, `SHEETS_WEBHOOK_URL`, and Textbee credentials blank; set `HOST=127.0.0.1` and point `DATA_DIR` to a test directory. Open `http://localhost:3000/` and `/staff/`. Local mode is for development, not a replacement for the live Google system. Local-upload production mode additionally requires the existing ClamAV configuration.

Dashboard-only tests, from MandirTickets:

```bash
npm run test:staff
```

## Verification

Both production builds passed. The backend suite passed 115 tests and the dashboard/library suite passed 194 tests. Checks cover the deployed Apps Script health check, optional phone and size fields, inline and resumable uploads, queue transport fallback, approval gating, editable fields, stale revisions, file-path restrictions, flexible production ordering, privacy, upload validation, material-entry retries, and duplicate-send prevention. The existing local-data audit passed with two tickets, two files, and no orphaned files.

Browser checks used a separate sample database and confirmed both configured accounts, removal of the requester paper selector, awaiting-review receipts, admin corrections/approval, staff starting a later job, actual paper usage, pickup status, a visible unconfigured Textbee notification, and decline reasons in private tracking. Sample data and credentials are excluded from the archive. Existing Create React App maintenance warnings remain; builds and tests pass.

Still needed for launch: publish a new version of the existing Apps Script deployment and rerun the GitHub Pages workflow. A private Node host is not required. A dedicated Textbee phone/SIM/account is needed only if SMS notifications are enabled later.
