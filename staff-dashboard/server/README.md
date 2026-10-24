# PrintTrack backend

Runs on the **dedicated shop PC**. The browser can't reach the printer's
SNMP/IPP ports or the Drive artwork directly, so this small service bridges:

- `GET /api/printer/status` — reachability + state (SNMP)
- `GET /api/printer/ink` — live ink levels (SNMP Printer-MIB)
- `POST /api/print` `{ rowId }` — pull the artwork from Drive (via Apps Script)
  and submit it to the T210 over IPP
- `GET /api/health` — config sanity check

## Run

```bash
cd server
npm install
cp .env.example .env     # then fill in PRINTER_IP and SHEET_URL
npm run dev              # http://localhost:4000
```

Without `PRINTER_IP` it runs in **simulation mode** — mock ink levels and
simulated (no-op) printing — so you can develop without the hardware.

## On the shop PC
- Set `PRINTER_IP` to the T210's LAN address (Front panel ▸ Network, or router).
- Set `SHEET_URL` to the same Apps Script `/exec` URL the frontend uses.
- The PC must be on the same network as the printer **and** have internet for Drive.

## Notes
- Ink is read live from the printer. Paper is **not** — the T210 doesn't report
  remaining roll length, so the dashboard owns paper tracking (see the app's
  inventory store).
- IPP endpoint assumed at `ipp://<ip>:631/ipp/print`. If the T210 rejects the
  document format, convert artwork to PDF before upload.
