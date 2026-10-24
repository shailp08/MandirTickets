/* ===========================================================================
   Sheet service — talks to the Google Apps Script web app.

   Design notes:
   - GET-only. Apps Script serves GET responses with permissive CORS, while
     POST with a JSON body triggers a preflight Apps Script can't answer.
     Status writes therefore also go over GET with an `action` param.
   - The Apps Script already returns normalized camelCase JSON, so mapping
     here is a light validation pass rather than a column dance.
   - Reads are cached to localStorage so the dashboard survives the shop PC
     losing internet (the printer's own network has none).
   =========================================================================== */
import { HAS_LIVE_SYNC, JOBS_CACHE_KEY, SHEET_URL } from '../config';
import { printJobs as mockJobs } from '../data/mockData';
import { JobStatus, Material, PrintJob } from '../types';

export type DataSource = 'live' | 'cache' | 'mock';

export interface JobsResult {
  jobs: PrintJob[];
  source: DataSource;
  syncedAt: number; // epoch ms
}

const VALID_STATUS: JobStatus[] = ['pending', 'in_progress', 'ready', 'completed'];
const VALID_MATERIAL: Material[] = ['Canvas', 'Glossy', 'Regular', 'Sticky', 'Outdoor'];

/** Coerce one raw Apps Script row into a typed PrintJob, or null if unusable. */
function normalizeJob(raw: any): PrintJob | null {
  if (!raw || raw.id == null || !raw.content) return null;

  const status: JobStatus = VALID_STATUS.includes(raw.status) ? raw.status : 'pending';
  const material: Material = VALID_MATERIAL.includes(raw.material) ? raw.material : 'Glossy';

  return {
    id: String(raw.id),
    content: String(raw.content),
    material,
    widthIn: Number(raw.widthIn) || 0,
    heightIn: Number(raw.heightIn) || 0,
    quantity: Math.max(1, Number(raw.quantity) || 1),
    department: raw.department || 'Sabha',
    notes: raw.notes ? String(raw.notes) : undefined,
    status,
    submittedAt: raw.submittedAt || new Date().toISOString(),
    requester: raw.requester ? String(raw.requester) : undefined,
    fileId: raw.fileId ? String(raw.fileId) : undefined,
  };
}

function readCache(): PrintJob[] | null {
  try {
    const raw = localStorage.getItem(JOBS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.jobs) ? parsed.jobs : null;
  } catch {
    return null;
  }
}

function writeCache(jobs: PrintJob[]): void {
  try {
    localStorage.setItem(JOBS_CACHE_KEY, JSON.stringify({ jobs, syncedAt: Date.now() }));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

/** Fetch the live job list, falling back to cache, then mock data. */
export async function fetchJobs(): Promise<JobsResult> {
  if (!HAS_LIVE_SYNC) {
    return { jobs: mockJobs, source: 'mock', syncedAt: Date.now() };
  }

  try {
    const res = await fetch(SHEET_URL, { method: 'GET', redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows: any[] = Array.isArray(data) ? data : data.jobs ?? [];
    const jobs = rows.map(normalizeJob).filter((j): j is PrintJob => j !== null);
    writeCache(jobs);
    return { jobs, source: 'live', syncedAt: Date.now() };
  } catch (err) {
    const cached = readCache();
    if (cached) return { jobs: cached, source: 'cache', syncedAt: Date.now() };
    throw err;
  }
}

/** Update a job's status on the sheet (write path; wired up in Phase 3). */
export async function updateJobStatus(rowId: string, status: JobStatus): Promise<void> {
  if (!HAS_LIVE_SYNC) return; // no-op in demo mode
  const url = `${SHEET_URL}?action=updateStatus&rowId=${encodeURIComponent(rowId)}&status=${encodeURIComponent(status)}`;
  const res = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!res.ok) throw new Error(`Status update failed: HTTP ${res.status}`);
}
