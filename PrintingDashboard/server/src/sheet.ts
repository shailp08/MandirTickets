/* ===========================================================================
   Retrieves the uploaded artwork for a print job.

   The Google Form's file-upload question stores the file in the form owner's
   Drive. The Apps Script (running as that owner) can read it and return the
   bytes base64-encoded via `?action=getFile&rowId=<n>`. The backend decodes
   and hands the buffer to the printer.
   =========================================================================== */
const SHEET_URL = (process.env.SHEET_URL ?? '').trim();

export interface Artwork {
  buffer: Buffer;
  filename: string;
  mime: string;
}

export const hasSheet = SHEET_URL.length > 0;

/** Fetch the artwork file for a given sheet row. Null if unavailable. */
export async function getArtwork(rowId: string): Promise<Artwork | null> {
  if (!hasSheet) return null;

  const url = `${SHEET_URL}?action=getFile&rowId=${encodeURIComponent(rowId)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`getFile failed: HTTP ${res.status}`);

  const data = await res.json() as {
    ok?: boolean; base64?: string; filename?: string; mime?: string; error?: string;
  };
  if (!data.ok || !data.base64) {
    if (data.error) throw new Error(data.error);
    return null;
  }

  return {
    buffer: Buffer.from(data.base64, 'base64'),
    filename: data.filename || `job-${rowId}`,
    mime: data.mime || 'application/octet-stream',
  };
}

export interface FilePeek { filename: string; mime: string; }

/** Check if a file exists for a row (fast — no download). */
export async function peekFile(rowId: string): Promise<FilePeek | null> {
  if (!hasSheet) return null;
  const url = `${SHEET_URL}?action=peekFile&rowId=${encodeURIComponent(rowId)}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; filename?: string; mime?: string };
    return data.ok && data.filename ? { filename: data.filename, mime: data.mime || 'application/octet-stream' } : null;
  } catch {
    return null;
  }
}

/** Fetch a small Drive-generated thumbnail (base64) for preview, or null. */
export async function getThumbnail(rowId: string): Promise<string | null> {
  if (!hasSheet) return null;
  const url = `${SHEET_URL}?action=getThumbnail&rowId=${encodeURIComponent(rowId)}`;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) return null;
    const data = await res.json() as { ok?: boolean; base64?: string };
    return data.ok && data.base64 ? data.base64 : null;
  } catch {
    return null;
  }
}
