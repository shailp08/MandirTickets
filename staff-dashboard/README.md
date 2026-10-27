# Delaware Mandir Workshop Desk

Staff interface for the MandirTickets backend. Printing and foam-cutting tabs share the live Google-backed ticket records directly through Apps Script when hosted on GitHub Pages. The desk includes an admin review inbox, editable request details, approval/decline decisions, flexible work queues, ticket details and artwork links, pickup workflow, material/waste entries, usage totals, and CSV export.

## Build and serve

Use Node 22+. Install dependencies with `npm ci`. From the parent `MandirTickets` folder run `npm run build:pages`; the dashboard is packaged under `/staff/` for GitHub Pages.

See `../docs/workshop-setup.md` for the complete online rollout. The Pages workflow passes `VITE_GOOGLE_SCRIPT_URL` to the staff build as `REACT_APP_GOOGLE_SCRIPT_URL`, so ticket reads and workshop actions do not require a separate Node host. The optional Node-server mode remains available through `STAFF_API_URL`.

## Tests

```bash
CI=true npm test -- --watchAll=false --runInBand
```

## Existing prototype

The original interface is preserved in `src/LegacyPrototype.tsx`; its old components, print bridge, inventory store, and related tests remain. It is not mounted by the production app. The shared desk does not use its mock hardware readings, local-only inventory, manual reorder, or rush shortcuts. The new material ledger records consumption, not remaining stock.
