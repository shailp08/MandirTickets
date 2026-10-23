/* ===========================================================================
   Runtime configuration.
   The Apps Script web-app URL is supplied via a build-time env var so no
   secret is baked into source. When unset, the app runs on mock data — which
   keeps the GitHub Pages demo working with no backend.
   =========================================================================== */

/** Deployed Google Apps Script web-app URL (the /exec endpoint). */
export const SHEET_URL: string = (process.env.REACT_APP_SHEET_URL ?? '').trim();

/** Local backend (printer bridge) URL. Runs on the shop PC. When unreachable
 *  the app falls back to simulated ink + no real printing. */
export const BACKEND_URL: string =
  (process.env.REACT_APP_BACKEND_URL ?? 'http://localhost:4000').trim();

/** True when a live Sheet sync is configured. */
export const HAS_LIVE_SYNC = SHEET_URL.length > 0;

/** How often the queue re-polls the sheet, in milliseconds. */
export const POLL_INTERVAL_MS = 30_000;

/** localStorage key for the last-known-good job snapshot (offline cache). */
export const JOBS_CACHE_KEY = 'printtrack.jobs.cache.v1';

/** localStorage keys for the inventory store. v2 = roll-instance model. */
export const INVENTORY_KEY = 'printtrack.inventory.v2';
export const INVENTORY_EVENTS_KEY = 'printtrack.inventory.events.v2';

/** localStorage key for locally-flagged "rush" jobs (priority overrides). */
export const RUSH_KEY = 'printtrack.rush.v1';

/** localStorage key for the manual queue order (drag-to-reorder). */
export const QUEUE_ORDER_KEY = 'printtrack.queueorder.v1';

/** localStorage key for editable settings (thresholds, load-waste, DPI). */
export const SETTINGS_KEY = 'printtrack.settings.v1';

/** localStorage keys for the maintenance log and vendor list. */
export const MAINTENANCE_KEY = 'printtrack.maintenance.v1';
export const VENDORS_KEY = 'printtrack.vendors.v1';

/** localStorage keys for per-job operator metadata (notes, deadline). */
export const JOB_META_KEY = 'printtrack.jobmeta.v1';

/** localStorage key for per-job status-change log (print history timeline). */
export const STATUS_LOG_KEY = 'printtrack.statuslog.v1';

/** localStorage key for UI language preference. */
export const LANG_KEY = 'printtrack.lang.v1';

/** Default paper trimmed each time a roll is loaded (skew correction + lead
 *  edge). The T210 won't report this, so we estimate it; the operator can
 *  recalibrate against a real measurement. ~9 inches. */
export const DEFAULT_LOAD_WASTE_FT = 0.75;

/** Fresh-roll lengths per material, in feet. Source of truth for "Load roll". */
export const ROLL_LENGTH_FT: Record<string, number> = {
  Canvas: 60,
  Glossy: 100,
  Regular: 150,
  Sticky: 98,
  Outdoor: 100,
};
