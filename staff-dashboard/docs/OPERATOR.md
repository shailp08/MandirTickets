# PrintTrack — operator guide

A quick guide for whoever is manning the print station.

## The alert bar (top)
Scrolls live warnings: low paper, low ink, out-of-stock supplies. If something
is red, handle it before starting a big print.

## Print queue
Requests come in from the Google Form automatically (refreshes every 30s).

- **Bolt button** → mark a job as **Rush** so it jumps to the top.
- **Print** → opens the pre-print checklist.
- **Mark done** → after a job finishes printing. This deducts the paper used
  and (if email is set up) notifies the requester.

### The pre-print checklist
Before anything prints, confirm:
1. **Paper check** — green means the loaded roll has enough; red means swap to
   a fresh roll first (it tells you how many feet are needed vs. left).
2. **Ink levels** — pulled live from the printer. A low color is flagged; make
   sure you have a spare cartridge.
3. **Three confirmations** — correct roll loaded, paper aligned, no error
   lights. The **Send to printer** button stays locked until all three are
   checked.

## Inventory
- **Load new roll / Swap** — do this whenever you physically change a roll. The
  tracker assumes a fresh roll and subtracts the load-waste trim automatically.
- **Recalibrate (ruler icon)** — if the tracked footage drifts from reality,
  measure the roll and enter the real number here. Do this occasionally to keep
  paper counts honest (the T210 can't report this itself).
- **Receive new supplies** — when a shipment of rolls or cartridges arrives,
  log it here so stock counts stay correct.
- **Ink Replace / +** — log a cartridge swap, or add spares to stock.

## History
Shows paper used per material, a reorder list (what's running low), and a full
activity log of everything that happened.

## If something looks off
Open **Settings** and hit **Re-check**. It shows whether the backend, printer,
and Google Sheet are all connected. If the printer shows "Simulated," the
backend can't reach it — check the network and `PRINTER_IP`.
