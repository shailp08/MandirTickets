# Deploying PrintTrack on the shop PC

PrintTrack has two parts that run on the **dedicated print-station PC**:

1. the **dashboard** (this React app), and
2. the **backend** (`server/`) that talks to the T210 and Drive.

The PC must be on the **same network as the printer** and have **internet**
(for Google Sheets + Drive).

---

## 1. One-time install

```bash
# Dashboard
cd PrintingDashboard
npm install
cp .env.example .env          # set REACT_APP_SHEET_URL (see google/SETUP.md)

# Backend
cd server
npm install
cp .env.example .env          # set PRINTER_IP, SHEET_URL, SNMP_COMMUNITY
cd ..
```

Find the **printer IP** on the T210's front panel (Network menu) or your router.

## 2. Run it (two terminals)

```bash
# Terminal 1 — backend (printer bridge)
cd server && npm run dev

# Terminal 2 — dashboard
PORT=3100 npm start
```

Open `http://localhost:3100`. The **Settings** page shows live connection
status for the backend, printer, and sheet — use it to confirm everything is
green before a shift.

## 3. Kiosk mode (fullscreen, no browser)

Install Electron once, then launch the dashboard as a fullscreen app:

```bash
npm install --save-dev electron

# Production kiosk (build first):
npm run build
npm run kiosk

# Or point the kiosk at the live dev server:
npm run kiosk:dev
```

Exit kiosk with **Ctrl/Cmd + Shift + Q**.

## 4. Keeping it running

For an always-on station, have the OS auto-start both processes on login
(Windows Task Scheduler / a `.bat`, or macOS Login Items / `launchd`). Start
the backend first, then the dashboard/kiosk.

---

## Optional: public demo on GitHub Pages

The dashboard runs on mock data when no sheet/backend is configured, so it can
be published as a read-only demo:

```bash
npm run deploy        # builds and pushes to the gh-pages branch
```

Set the repo's Pages source to the `gh-pages` branch. Note: the demo can't
reach a printer or live sheet — it's for showing the UI only.
