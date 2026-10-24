# PrintTrack — Google Form & Sheet setup (Phase 1)

This connects incoming print requests to the dashboard. One-time setup, ~15 min.

## 1. Create the Google Form

Create a form with these questions (the **exact titles matter** — they map to columns):

| Question title    | Type            | Notes |
|-------------------|-----------------|-------|
| `Name`            | Short answer    | Who is requesting |
| `Content name`    | Short answer    | What is being printed |
| `Material`        | Multiple choice | Options: Canvas, Glossy, Sticky, Outdoor |
| `Width (in)`      | Short answer    | Number, inches |
| `Height (in)`     | Short answer    | Number, inches |
| `Quantity`        | Short answer    | Number |
| `Department`      | Multiple choice | Options: BKY, Sabha, Deco, IBKY |
| `Notes`           | Paragraph       | Optional |
| `Artwork`         | File upload     | The print file (PDF preferred) — see note below |

> **File upload requires sign-in.** Google Forms only allows file-upload
> questions when respondents sign in with a Google account (and, for some
> Workspace setups, the same organization). If your requesters can't sign in,
> skip the Artwork question and use the operator's local copy of the file
> instead. The `Material` options must be exactly:
> `Canvas, Glossy, Regular, Sticky, Outdoor`.

> Tip: turn on **Settings ▸ Responses ▸ Collect email addresses** if you want
> to message requesters later (Phase 5).

## 2. Send responses to a Sheet

In the Form, **Responses ▸ Link to Sheets ▸ Create new spreadsheet**.
This makes a sheet/tab called **`Form Responses 1`** with a `Timestamp` column
plus one column per question.

## 3. Add a Status column

In that sheet, add one more header in the first empty column: **`Status`**.
Leave the cells blank — blank is treated as *Pending*. The dashboard writes
`Pending` / `In Progress` / `Done` here.

## 4. Add the Apps Script

1. In the sheet: **Extensions ▸ Apps Script**.
2. Delete the starter code, paste the contents of [`Code.gs`](./Code.gs).
3. If your question titles differ from the table above, edit `COLUMN_MAP`
   at the top of `Code.gs` to match.
4. Save.

## 5. Deploy as a web app

1. **Deploy ▸ New deployment ▸ Web app**.
2. Execute as: **Me**. Who has access: **Anyone**.
3. Authorize when prompted.
4. Copy the **Web app URL** (ends in `/exec`).

## 6. Point the dashboard at it

Create a file named `.env` in the project root (next to `package.json`):

```
REACT_APP_SHEET_URL=https://script.google.com/macros/s/XXXXXXXX/exec
```

Restart `npm start`. The queue's status line should switch from
**"Demo data"** to **"Synced from Google Sheets"**.

---

### How it behaves
- The dashboard polls the sheet every 30 seconds (and on tab focus).
- The last good response is cached locally, so if the shop PC loses internet
  the queue keeps showing the most recent data ("Offline — cached" indicator).
- Status write-back ("Print" → In Progress, "Mark done" → Done) writes to the
  `Status` column via the Apps Script.

### Email notifications (Phase 5)
- To email requesters when their print is done, turn on
  **Settings ▸ Responses ▸ Collect email addresses** in the Form. This adds an
  `Email Address` column.
- The Apps Script then emails the requester when a job is marked **Done**
  (controlled by `NOTIFY_ON_DONE` at the top of `Code.gs`; set to `false` to
  disable). No email column = notifications are simply skipped.
- Re-paste `Code.gs` and create a new deployment after enabling this. The first
  send will prompt you to authorize the script to send mail as you.

### Printing (Phase 3)
- The local backend (see `server/`) reads the artwork for a job through the
  Apps Script's `?action=getFile&rowId=<n>` endpoint, which returns the Drive
  file as base64, then submits it to the printer over IPP.
- For this to work, the Apps Script's `COLUMN_MAP.fileUrl` must match your
  Artwork question's column header (default `Artwork`). Re-paste `Code.gs`
  and **create a new deployment** after adding the Artwork question.
