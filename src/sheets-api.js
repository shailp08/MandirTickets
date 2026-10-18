export const SHEETS_MAX_FILES = 5;
export const SHEETS_MAX_FILE_BYTES = 200 * 1024 * 1024;
export const SHEETS_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const DRIVE_CHUNK_BYTES = 10 * 1024 * 1024;
const SHEETS_REQUEST_ATTEMPTS = 3;
const wait = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export function validateSheetsFiles(files) {
  if (files.length > SHEETS_MAX_FILES) throw new Error(`Attach no more than ${SHEETS_MAX_FILES} files.`);
  let total = 0;
  for (const file of files) {
    if (!/\.(pdf|svg|dxf|png|jpe?g|tiff?)$/i.test(file.name)) throw new Error('Use PDF, SVG, DXF, PNG, JPG, or TIFF files.');
    if (file.size < 1 || file.size > SHEETS_MAX_FILE_BYTES) throw new Error('Each file must be 200 MB or smaller.');
    total += file.size;
  }
  if (total > SHEETS_MAX_TOTAL_BYTES) throw new Error('Attachments must total 200 MB or less.');
}

function sheetsJsonpAttempt(url, parameters, timeout) {
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

export async function retrySheetsTransport(request, { attempts = SHEETS_REQUEST_ATTEMPTS, pause = wait } = {}) {
  const attemptCount = Math.max(1, Math.floor(attempts));
  let lastError;
  for (let attempt = 1; attempt <= attemptCount; attempt++) {
    try {
      return await request(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attemptCount) await pause(350 * attempt);
    }
  }
  throw lastError;
}

export async function sheetsJsonp(url, parameters, timeout = 15000) {
  try {
    return await retrySheetsTransport(() => sheetsJsonpAttempt(url, parameters, timeout));
  } catch (cause) {
    throw new Error('The ticket service could not be reached after three attempts. Check your connection and try again.', { cause });
  }
}

export async function trackSheetsTicket(url, { ticket, code, requestKey } = {}) {
  const response = await sheetsJsonp(url, {
    action: 'track',
    ...(requestKey ? { requestKey } : { ticket: String(ticket || '').trim().toUpperCase(), code: String(code || '').trim().toUpperCase() }),
  });
  if (!response?.ok) throw new Error(response?.error || 'The ticket could not be found.');
  return response.ticket;
}

function putDriveChunk(sessionUrl, file, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${file.size}`);
    xhr.upload.onprogress = event => onProgress(start + event.loaded);
    xhr.onerror = () => reject(new Error('The file upload was interrupted. Check your connection and try again.'));
    xhr.onload = () => {
      if (xhr.status === 308) {
        resolve(null);
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error('Google Drive could not save the file. Please try again.'));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        reject(new Error('Google Drive saved the file but did not return a file receipt. Please try again.'));
      }
    };
    xhr.send(file.slice(start, end, file.type || 'application/octet-stream'));
  });
}

async function uploadDriveFile(sessionUrl, file, onProgress) {
  let completed;
  for (let start = 0; start < file.size; start += DRIVE_CHUNK_BYTES) {
    const end = Math.min(start + DRIVE_CHUNK_BYTES, file.size);
    completed = await putDriveChunk(sessionUrl, file, start, end, onProgress);
  }
  if (!completed?.id) throw new Error('Google Drive did not finish the file upload. Please try again.');
  return completed;
}

async function uploadFiles(url, details, files, onProgress) {
  validateSheetsFiles(files);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  let completedBytes = 0;
  const uploaded = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const response = await sheetsJsonp(url, {
      action: 'beginUpload',
      requestKey: details.requestKey,
      startedAt: details.startedAt,
      index,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      origin: location.origin,
    });
    if (!response?.ok || !response.sessionUrl) throw new Error(response?.error || 'The file upload could not be started.');
    const receipt = await uploadDriveFile(response.sessionUrl, file, loaded => {
      const fraction = totalBytes ? (completedBytes + Math.min(loaded, file.size)) / totalBytes : 1;
      onProgress?.(Math.max(1, Math.round(fraction * 90)));
    });
    uploaded.push({ id: receipt.id, index, name: file.name, type: file.type || 'application/octet-stream', size: file.size });
    completedBytes += file.size;
  }
  return uploaded;
}

export async function createSheetsTicket(url, details, files, onProgress) {
  const uploadedFiles = await uploadFiles(url, details, files, onProgress);
  onProgress?.(92);
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    cache: 'no-store',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'createTicket', ...details, files: uploadedFiles }),
  });
  onProgress?.(95);
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
