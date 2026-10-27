# Delaware Mandir Workshop Tickets

Everything is inside this folder: the public request site, admin/staff dashboard, Google integration, and optional private-server deployment files.

- `src/`: public request form, queue and tracker.
- `server.js` and `lib/`: authentication, review workflow, material records and Textbee.
- `staff-dashboard/`: admin/staff interface and existing prototype files.
- `integrations/`: Google Apps Script backend.
- `deploy/`: container configuration.

## Run from this folder

Use Node 22 or newer. For the GitHub Pages build, set `VITE_GOOGLE_SCRIPT_URL` to the Apps Script `/exec` URL, then:

```bash
npm run setup
npm run build:pages
```

`setup` installs both applications' exact dependencies. `build:pages` packages the public request site and staff dashboard together under `dist/`. No Node server or shared secret is required for that deployment.

```bash
npm run build:all
npm run test:all
npm run check
```

`check` runs both builds, both test suites and the local-data audit. The dashboard retains its own package manifest because it uses a different React/toolchain version. All files and dependencies are inside this project; there are no sibling-folder dependencies.

GitHub Pages builds use `VITE_GOOGLE_SCRIPT_URL` for both the public request form and the staff dashboard. Local or privately hosted server mode remains optional and can instead use `WORKSHOP_GOOGLE_SCRIPT_URL` and `WORKSHOP_SHARED_SECRET`. See [setup and rollout](docs/workshop-setup.md) before updating the live system.

## Container

From this folder:

```bash
docker build -f deploy/Dockerfile -t mandir-workshop .
```

The included `.dockerignore` excludes private credentials, dependencies and data. See the setup guide for HTTPS hosting, persistent storage, account settings and Textbee requirements.
