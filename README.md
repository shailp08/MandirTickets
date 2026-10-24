# Delaware Mandir Workshop Tickets

Everything is inside this folder: the public request site, private server, admin/staff dashboard, Google integration, and deployment files.

- `src/`: public request form, queue and tracker.
- `server.js` and `lib/`: authentication, review workflow, material records and Textbee.
- `staff-dashboard/`: admin/staff interface and existing prototype files.
- `integrations/`: Google Apps Script backend.
- `deploy/`: container configuration.

## Run from this folder

Use Node 22 or newer. Configure the private `.env` using `.env.example`, then:

```bash
npm run setup
npm start
```

`setup` installs both applications' exact dependencies. `start` builds both and launches one server. Open `http://localhost:3000/` for requests and `/staff/` for admin/staff sign-in.

```bash
npm run build:all
npm run test:all
npm run check
```

`check` runs both builds, both test suites and the local-data audit. The dashboard retains its own package manifest because it uses a different React/toolchain version. All files and dependencies are inside this project; there are no sibling-folder dependencies.

Without `WORKSHOP_GOOGLE_SCRIPT_URL`, this uses a separate local test database. With that URL and `WORKSHOP_SHARED_SECRET`, the desk uses the existing live Google Sheet. See [setup and rollout](docs/workshop-setup.md) before updating the live system.

## Container

From this folder:

```bash
docker build -f deploy/Dockerfile -t mandir-workshop .
```

The included `.dockerignore` excludes private credentials, dependencies and data. See the setup guide for HTTPS hosting, persistent storage, account settings and Textbee requirements.
