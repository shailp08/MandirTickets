# Mandir Workshop Tickets

A focused request system for a 24-inch roll printer and foam cutting machine. The public site opens with one question—what the requester needs—and then shows only the fields required for that job.

## What works

- One request-only public interface with no marketing, queue, tracking, or staff pages
- Separate print and foam-cutting request requirements
- Streaming uploads with type, structure, signature, count, and size validation
- Persistent `P-0001` and `F-0001` queue sequences
- Idempotent submissions that cannot silently create duplicate tickets
- Password-protected staff API with stale-write protection
- Queued → In progress → Ready for pickup → Collected workflow
- Cancellation, reopening, and complete status history
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

## GitHub Pages and the API

GitHub Pages is a static host. It can publish the request interface, but it cannot run Express, scan uploads, maintain a shared queue, or persist ticket files.

The included Pages workflow therefore deploys the frontend and accepts an optional repository variable named `VITE_API_BASE_URL`. For a working shared installation:

1. Deploy the Node server to an HTTPS host with persistent storage and ClamAV.
2. Set the server's `APP_ORIGIN` to the exact GitHub Pages origin, such as `https://account.github.io`.
3. Set `COOKIE_SECURE=true` and configure the remaining production variables.
4. Add a GitHub Actions repository variable named `VITE_API_BASE_URL` containing the API origin, such as `https://tickets-api.example.org`.
5. Re-run the Pages workflow.

The server supports credentialed cross-origin requests only from `APP_ORIGIN`. Without `VITE_API_BASE_URL`, the Pages site identifies itself as a frontend preview instead of implying that requests are being saved.

## Production environment

Production refuses to start unless these safeguards are configured:

- `NODE_ENV=production`
- `ADMIN_PASSWORD` with at least 16 characters
- `APP_ORIGIN` set to the HTTPS frontend origin
- `COOKIE_SECURE=true`
- `CLAMSCAN_PATH` set to an absolute ClamAV `clamscan` executable with current signatures
- Persistent `DATA_DIR` storage with backups and disk monitoring

Optional upload controls default to ten files and 250 MiB per file:

- `MAX_UPLOAD_FILES`
- `MAX_UPLOAD_BYTES`

Use only one server process against a data directory. `server.lock` prevents simultaneous writers. After a crash, verify that no server on any host uses that directory before removing the lock.

The application should be placed behind HTTPS and trusted-network or identity controls before broad public exposure. Google Sheets is a reporting copy, not the source of truth.

## Data and privacy

The public endpoints return only queue numbers, machine names, statuses, and positions. Names, departments, phone numbers, purposes, notes, and files require a staff session. Recent ticket numbers stored in the browser contain no customer details and can be cleared by the requester.

Uploaded PDF and image checks verify safe envelopes, not complete document semantics. SVG and DXF receive restrictive structural validation. Production additionally requires malware scanning. Staff must still verify material, margins, dimensions, geometry, and machine readiness.

## Google Sheets

The authenticated Apps Script integration updates one row per immutable ticket ID and retries failed writes. Setup instructions are in [integrations/README.md](integrations/README.md). CSV export remains available when Sheets is not connected.
