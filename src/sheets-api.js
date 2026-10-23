export const SHEETS_MAX_FILES = 5;
export const SHEETS_MAX_FILE_BYTES = 200 * 1024 * 1024;
export const SHEETS_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const DRIVE_CHUNK_BYTES = 10 * 1024 * 1024;
const DRIVE_MAX_RECOVERY_ATTEMPTS = 5;
const DRIVE_REQUEST_TIMEOUT = 5 * 60 * 1000;
const SHEETS_REQUEST_ATTEMPTS = 5;
const uploadedFilesByRequest = new Map();
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
      if (attempt < attemptCount) await pause(Math.min(1000 * (2 ** (attempt - 1)), 8000));
    }
  }
  throw lastError;
}

export async function sheetsJsonp(url, parameters, timeout = 15000) {
  try {
    return await retrySheetsTransport(() => sheetsJsonpAttempt(url, parameters, timeout));
  } catch (cause) {
    throw new Error('Google did not respond after several attempts. Your form and files are still here, so wait a moment and choose Try again.', { cause });
  }
}

export async function trackSheetsTicket(url, { trackingNumber, ticket, code, requestKey } = {}) {
  const response = await sheetsJsonp(url, {
    action: 'track',
    ...(requestKey ? { requestKey } : trackingNumber
      ? { tracking: String(trackingNumber).trim().toUpperCase() }
      : { ticket: String(ticket || '').trim().toUpperCase(), code: String(code || '').trim().toUpperCase() }),
  });
  if (!response?.ok) throw new Error(response?.error || 'The ticket could not be found.');
  return response.ticket;
}

export function driveNextOffset(rangeHeader, fallback) {
  const match = /^bytes=0-(\d+)$/.exec(String(rangeHeader || '').trim());
  if (!match) return fallback;
  const offset = Number(match[1]) + 1;
  return Number.isSafeInteger(offset) ? offset : fallback;
}

function driveRequestError(message, retryable = false) {
  const error = new Error(message);
  error.retryable = retryable;
  return error;
}

function putDriveChunk(sessionUrl, file, start, end, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.timeout = DRIVE_REQUEST_TIMEOUT;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${file.size}`);
    xhr.upload.onprogress = event => onProgress(start + event.loaded);
    xhr.onerror = () => reject(driveRequestError('The file upload was interrupted.', true));
    xhr.ontimeout = () => reject(driveRequestError('The file upload paused for too long.', true));
    xhr.onabort = () => reject(driveRequestError('The file upload was interrupted.', true));
    xhr.onload = () => {
      if (xhr.status === 308) {
        resolve({ nextOffset: driveNextOffset(xhr.getResponseHeader('Range'), end) });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(driveRequestError('Google Drive could not save the file.', xhr.status === 408 || xhr.status === 429 || xhr.status >= 500));
        return;
      }
      try {
        resolve({ nextOffset: file.size, receipt: JSON.parse(xhr.responseText) });
      } catch {
        reject(driveRequestError('Google Drive saved the file but did not return a file receipt.', true));
      }
    };
    xhr.send(file.slice(start, end, file.type || 'application/octet-stream'));
  });
}

function queryDriveUpload(sessionUrl, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', sessionUrl);
    xhr.timeout = DRIVE_REQUEST_TIMEOUT;
    xhr.setRequestHeader('Content-Range', `bytes */${file.size}`);
    xhr.onerror = () => reject(driveRequestError('Google Drive upload recovery was interrupted.', true));
    xhr.ontimeout = () => reject(driveRequestError('Google Drive upload recovery took too long.', true));
    xhr.onabort = () => reject(driveRequestError('Google Drive upload recovery was interrupted.', true));
    xhr.onload = () => {
      if (xhr.status === 308) {
        resolve({ nextOffset: driveNextOffset(xhr.getResponseHeader('Range'), 0) });
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(driveRequestError('Google Drive could not recover the file upload.', xhr.status === 408 || xhr.status === 429 || xhr.status >= 500));
        return;
      }
      try {
        resolve({ nextOffset: file.size, receipt: JSON.parse(xhr.responseText) });
      } catch {
        reject(driveRequestError('Google Drive did not return the recovered file receipt.', true));
      }
    };
    xhr.send();
  });
}

export async function uploadDriveFile(sessionUrl, file, onProgress, {
  put = putDriveChunk,
  query = queryDriveUpload,
  pause = wait,
  maxRecoveryAttempts = DRIVE_MAX_RECOVERY_ATTEMPTS,
} = {}) {
  const reportProgress = typeof onProgress === 'function' ? onProgress : () => {};
  let nextOffset = 0;
  let reportedOffset = 0;
  let recoveryAttempts = 0;
  let needsQuery = false;
  while (true) {
    try {
      const result = !needsQuery && nextOffset < file.size
        ? await put(sessionUrl, file, nextOffset, Math.min(nextOffset + DRIVE_CHUNK_BYTES, file.size), loaded => {
          reportedOffset = Math.max(reportedOffset, Math.min(loaded, file.size));
          reportProgress(reportedOffset);
        })
        : await query(sessionUrl, file);
      if (result?.receipt?.id) {
        reportProgress(file.size);
        return result.receipt;
      }
      const confirmedOffset = Number(result?.nextOffset);
      if (!Number.isSafeInteger(confirmedOffset) || confirmedOffset < 0 || confirmedOffset > file.size) {
        throw driveRequestError('Google Drive returned an invalid upload position.');
      }
      if (confirmedOffset > nextOffset) recoveryAttempts = 0;
      else recoveryAttempts++;
      nextOffset = confirmedOffset;
      needsQuery = false;
      reportedOffset = Math.max(reportedOffset, nextOffset);
      reportProgress(reportedOffset);
      if (recoveryAttempts > maxRecoveryAttempts) throw driveRequestError('Google Drive could not make progress on the file upload.');
      if (recoveryAttempts) await pause(Math.min(1000 * (2 ** (recoveryAttempts - 1)), 8000));
    } catch (error) {
      if (!error?.retryable) throw error;
      recoveryAttempts++;
      needsQuery = true;
      if (recoveryAttempts > maxRecoveryAttempts) {
        throw new Error('The file upload could not recover after several attempts. Your form and file are still selected; choose Try again.');
      }
      await pause(Math.min(1000 * (2 ** (recoveryAttempts - 1)), 8000));
    }
  }
}

async function uploadFiles(url, details, files, onProgress) {
  validateSheetsFiles(files);
  const fingerprint = JSON.stringify(files.map(file => [file.name, file.size, file.type || '', file.lastModified || 0]));
  let cached = uploadedFilesByRequest.get(details.requestKey);
  if (!cached || cached.fingerprint !== fingerprint) {
    cached = { fingerprint, uploaded: [] };
    uploadedFilesByRequest.set(details.requestKey, cached);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const uploaded = cached.uploaded.slice();
  let completedBytes = uploaded.reduce((sum, file) => sum + file.size, 0);
  if (completedBytes) onProgress?.(Math.max(1, Math.round((completedBytes / totalBytes) * 90)));
  for (let index = uploaded.length; index < files.length; index++) {
    const file = files[index];
    let response;
    try {
      response = await sheetsJsonp(url, {
        action: 'beginUpload',
        requestKey: details.requestKey,
        startedAt: details.startedAt,
        index,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        origin: location.origin,
      });
    } catch (cause) {
      throw new Error('Google did not start the file upload. Your form and file are still selected; wait a moment and choose Try again.', { cause });
    }
    if (!response?.ok || !response.sessionUrl) throw new Error(response?.error || 'The file upload could not be started.');
    const receipt = await uploadDriveFile(response.sessionUrl, file, loaded => {
      const fraction = totalBytes ? (completedBytes + Math.min(loaded, file.size)) / totalBytes : 1;
      onProgress?.(Math.max(1, Math.round(fraction * 90)));
    });
    if (!/^[a-f0-9]{32}$/i.test(String(receipt.md5Checksum || ''))) throw new Error('Google Drive did not return a file integrity check. Please try again.');
    uploaded.push({
      id: receipt.id,
      index,
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      md5Checksum: receipt.md5Checksum.toLowerCase(),
    });
    cached.uploaded = uploaded.slice();
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
      uploadedFilesByRequest.delete(details.requestKey);
      return ticket;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(500 * (attempt + 1));
    }
  }
  throw new Error('Your files were uploaded, but Google has not confirmed the ticket yet. Choose Try again to finish without uploading the files again.', { cause: lastError });
}
