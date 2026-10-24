# Delaware Mandir Workshop Desk

Authenticated staff interface for the MandirTickets backend. Printing and foam-cutting tabs share the live Google-backed ticket records through a private server connection. The desk includes an admin review inbox, editable request details, approval/decline decisions, flexible work queues, ticket details and artwork links, pickup workflow and Textbee notification status, material/waste entries, usage totals, and CSV export.

## Build and serve

Use Node 22+. Install dependencies with `npm ci`. From the parent `MandirTickets` folder run `npm run build:staff`, then start that server. The dashboard is served at `/staff/`, alongside its authenticated API.

See `../docs/workshop-setup.md` for the complete online rollout. GitHub Pages hosts the staff frontend at `/MandirTickets/staff/`. The Pages workflow supplies the existing Google Apps Script URL directly to the dashboard, so the review queue, status updates, and material ledger work without a separate Node host after the updated Apps Script source is published. The optional private-server mode remains available through `STAFF_API_URL`.

## Tests

```bash
CI=true npm test -- --watchAll=false --runInBand
```

## Existing prototype

The original interface is preserved in `src/LegacyPrototype.tsx`; its old components, print bridge, inventory store, and related tests remain. It is not mounted by the production app. The shared desk does not use its mock hardware readings, local-only inventory, manual reorder, or rush shortcuts. The new material ledger records consumption, not remaining stock.
