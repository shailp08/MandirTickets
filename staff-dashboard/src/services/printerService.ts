/* ===========================================================================
   Frontend → local backend (printer bridge). Falls back gracefully when the
   backend isn't running (e.g. the GitHub Pages demo), so the UI still works.
   =========================================================================== */
import { BACKEND_URL } from '../config';
import { InkReading } from '../lib/precheck';

export interface InkResponse {
  ink: InkReading[];
  simulated: boolean;
}

export interface PrintResult {
  submitted: boolean;
  simulated: boolean;
  jobId?: number;
  message?: string;
  note?: string;
}

export interface BackendHealth {
  ok: boolean;
  hasPrinter: boolean;
  hasSheet: boolean;
}

export interface PrinterState {
  online: boolean;
  model: string;
  widthIn: number;
  state: string;
  errors: string[];
  simulated: boolean;
}

/** Backend config/health, or null if the backend isn't reachable. */
export async function fetchHealth(): Promise<BackendHealth | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Printer reachability/state, or null if the backend is down. */
export async function fetchPrinterStatus(): Promise<PrinterState | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/printer/status`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Live ink levels from the printer. Returns null if the backend is down so
 *  callers can fall back to the inventory's last-known levels. */
export async function fetchInk(): Promise<InkResponse | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/printer/ink`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface ArtworkInfo {
  hasFile: boolean;
  mime?: string;
  filename?: string;
  widthPx?: number;
  heightPx?: number;
  type?: string;
  thumbnailBase64?: string | null;
}

/** Direct URL to stream a job's artwork file (for inline preview). */
export function artworkFileUrl(rowId: string): string {
  return `${BACKEND_URL}/api/artwork/${encodeURIComponent(rowId)}/file`;
}

/** Inspect a job's artwork (dimensions + thumbnail). Null if backend is down. */
export async function inspectArtwork(rowId: string): Promise<ArtworkInfo | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/artwork/${encodeURIComponent(rowId)}/inspect`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Submit a job to the printer via the backend. */
export async function submitPrint(rowId: string): Promise<PrintResult> {
  const res = await fetch(`${BACKEND_URL}/api/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rowId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Print failed: HTTP ${res.status}`);
  }
  return res.json();
}
