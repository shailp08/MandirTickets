# Production audit

Reviewed October 16, 2026.

## Scope

The review covered the React client, Express endpoints, session boundary, origin checks, uploads, content validation, persistent store, queue privacy, status revisions, Google Sheets replication, CSV export, static deployment, and recovery behavior.

## Findings resolved

### GitHub Pages could not load a repository-subpath build

The client used root-relative assets and same-origin API URLs. The Vite build now emits relative assets, bundles the Geist font, and accepts `VITE_API_BASE_URL` for a separately hosted API. An unconfigured Pages build displays a frontend-preview notice.

### A Pages frontend could not authenticate to an API host

The server rejected all cross-site mutations, did not return CORS headers, and issued `SameSite=Strict` staff cookies. It now permits credentialed requests only from the exact configured `APP_ORIGIN`, handles preflight requests, and uses secure `SameSite=None` cookies only when the frontend and API origins differ.

### Upload capacity was unbounded

Upload concurrency was bounded, but per-request file count and file size were not. Configurable limits now default to ten files and 250 MiB per file. Multer failures clean up partially accepted files before returning a specific client error.

### Legacy records could break exports or the staff desk

Old records without `files` or `history` arrays were not fully normalized. Store startup now supplies safe empty arrays. A separate privacy-preserving data audit detects duplicate identifiers, invalid statuses and revisions, malformed history, missing referenced uploads, unsafe names, and orphaned files.

### Public-source hygiene needed work

The obsolete pre-React frontend was still copied into the production artifact, and integration notes contained a specific private Sheet identifier. The dead client was removed and the Sheets documentation now uses installation-specific placeholders. Secret-pattern scanning reports no committed credentials.

## Verification

- Production Vite build succeeds with repository-relative assets.
- All 34 automated tests pass.
- Dependency audit reports zero known production vulnerabilities.
- The HTTP suite verifies health, login, upload, idempotency, download authorization, privacy, status revisions, export, cross-origin preflight, secure cross-site cookies, and upload-limit cleanup.
- The persistence suite verifies concurrent numbering, restart behavior, legacy sequences, atomic updates, stale-write rejection, status history, Sheets retry behavior, and CSV formula escaping.
- The upload suite verifies filename restrictions, static SVG parsing, ASCII DXF structure, PDF/image envelopes, hashing, and fail-closed malware scanning.
- The configured local data directory passes the integrity audit with no errors or orphaned files.

## Remaining operational requirements

GitHub Pages cannot host the API or ticket data. A live shared deployment still needs an HTTPS Node host with persistent storage, current ClamAV signatures, backups, disk monitoring, and `VITE_API_BASE_URL` configured in GitHub Actions.

The current staff model is appropriate for one controlled workshop desk but uses one shared password and in-memory sessions. Broader deployment should add individual staff identities, an external session store, audit attribution, request-abuse controls at the edge, and multiple-instance-safe database storage.
