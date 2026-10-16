export const SHEETS_MAX_FILES = 5;
export const SHEETS_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const SHEETS_MAX_TOTAL_BYTES = 10 * 1024 * 1024;

const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export function validateSheetsFiles(files) {
  if (files.length > SHEETS_MAX_FILES) throw new Error(`Attach no more than ${SHEETS_MAX_FILES} files.`);
  let total = 0;
  for (const file of files) {
    if (!/\.(pdf|svg|dxf|png|jpe?g|tiff?)$/i.test(file.name)) throw new Error('Use PDF, SVG, DXF, PNG, JPG, or TIFF files.');
    if (file.size < 1 || file.size > SHEETS_MAX_FILE_BYTES) throw new Error('Each file must be 5 MB or smaller.');
    total += file.size;
  }
  if (total > SHEETS_MAX_TOTAL_BYTES) throw new Error('Attachments must total 10 MB or less.');
}

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32768, bytes.length)));
  }
  return btoa(binary);
}

async function encodeFiles(files, onProgress) {
  validateSheetsFiles(files);
  const encoded = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    encoded.push({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: bytesToBase64(await file.arrayBuffer()) });
    onProgress?.(Math.round(((index + 1) / Math.max(files.length, 1)) * 45));
  }
  return encoded;
}

export function sheetsJsonp(url, parameters, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const callback = `__mandirTicket_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => finish(new Error('The ticket service took too long to respond.')), timeout);
    const finish = (error, value) => {
      window.clearTimeout(timer);
      script.remove();
      delete window[callback];
      if (error) reject(error); else resolve(value);
    };
    window[callback] = value => finish(null, value);
    script.onerror = () => finish(new Error('The ticket service could not be reached.'));
    const query = new URLSearchParams({ ...parameters, callback, cache: Date.now().toString() });
    script.src = `${url}?${query}`;
    document.head.append(script);
  });
}

export async function trackSheetsTicket(url, { ticket, code, requestKey } = {}) {
  const response = await sheetsJsonp(url, {
    action: 'track',
    ...(requestKey ? { requestKey } : { ticket: String(ticket || '').trim().toUpperCase(), code: String(code || '').trim().toUpperCase() }),
  });
  if (!response?.ok) throw new Error(response?.error || 'The ticket could not be found.');
  return response.ticket;
}

export async function createSheetsTicket(url, details, files, onProgress) {
  const encodedFiles = await encodeFiles(files, onProgress);
  onProgress?.(50);
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'createTicket', ...details, files: encodedFiles }),
  });
  onProgress?.(80);
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const ticket = await trackSheetsTicket(url, { requestKey: details.requestKey });
      onProgress?.(100);
      return ticket;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(500 * (attempt + 1));
    }
  }
  throw lastError || new Error('The ticket could not be confirmed. Please try again with the same form.');
}
