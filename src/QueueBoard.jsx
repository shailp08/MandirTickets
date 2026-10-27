import { useEffect, useState } from 'react';
import { fetchSheetsQueue } from './sheets-api.js';

const labels = {
  'pending-review': 'In Review',
  queued: 'Waiting',
  'in-progress': 'Being made',
};

const ALLOWED_STATUSES = new Set(['pending-review', 'queued', 'in-progress']);
const QUEUE_TYPES = [
  ['printer', 'Poster printing'],
  ['foam', 'Foam cutting'],
];
const QUEUE_CACHE_MAX_AGE = 5 * 60 * 1000;

function queueCacheKey(apiBase, sheetsUrl) {
  return `mandir-queue:${sheetsUrl || apiBase || 'same-origin'}`;
}

export function readCachedQueue(storage, key, now = Date.now()) {
  if (!storage) return null;
  try {
    const cached = JSON.parse(storage.getItem(key) || 'null');
    if (!cached || !Number.isFinite(cached.savedAt) || now - cached.savedAt > QUEUE_CACHE_MAX_AGE || !Array.isArray(cached.data?.machines)) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function writeCachedQueue(storage, key, data) {
  if (!storage) return;
  try { storage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch {}
}

function browserQueueStorage() {
  // The queue is public data. Keep the last good snapshot across tabs so the
  // page renders immediately while a cold Apps Script instance wakes up.
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export async function fetchQueueApi(apiBase, { fetcher = fetch, timeout = 8000 } = {}) {
  const base = (apiBase || '').replace(/\/$/, '');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  try {
    const response = await fetcher(`${base}/api/queue`, { signal: controller.signal });
    if (!response.ok) {
      let details = '';
      try {
        const body = await response.json();
        details = body?.error || body?.message || '';
      } catch {}
      throw new Error(details || `HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error('The queue request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getPositionText(t) {
  const status = String(t?.status || '').toLowerCase();
  if (status === 'in-progress') {
    return 'Currently in production';
  }
  if (status === 'pending-review') {
    return 'Awaiting karyakar approval';
  }
  if (typeof t?.position !== 'number' || t.position < 1) {
    return 'Position pending';
  }
  if (t.position === 1) {
    return 'No jobs ahead';
  }
  return `${t.position - 1} ${t.position === 2 ? 'job' : 'jobs'} ahead`;
}

export default function QueueBoard({ apiBase, sheetsUrl, preview, recentTicket }) {
  const storage = browserQueueStorage();
  const cacheKey = queueCacheKey(apiBase, sheetsUrl);
  const [data, setData] = useState(() => readCachedQueue(storage, cacheKey)), [error, setError] = useState(''), [machine, setMachine] = useState('printer');
  const [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (recentTicket?.machine) setMachine(recentTicket.machine);
  }, [recentTicket]);

  useEffect(() => {
    let live = true;
    let busy = false;
    let hasLoadedData = Boolean(data);
    async function load() {
      if (busy || preview) return;
      busy = true;
      if (live) setLoading(true);
      try {
        let next;
        if (sheetsUrl) {
          next = await fetchSheetsQueue(sheetsUrl);
        } else {
          next = await fetchQueueApi(apiBase);
        }
        if (next && next.ok === false) {
          throw new Error(next.error || 'Failed to load queue data');
        }
        if (!Array.isArray(next?.machines)) {
          throw new Error('Invalid queue data received');
        }
        if (live) {
          hasLoadedData = true;
          setData(next);
          setError('');
          writeCachedQueue(storage, cacheKey, next);
        }
      } catch (err) {
        if (live) {
          const detail = err?.message || '';
          if (hasLoadedData) {
            setError(detail
              ? `Queue updates are temporarily unavailable (${detail}). Positions shown below are from the last successful update. Please refresh before relying on them.`
              : 'Queue updates are temporarily unavailable. Positions shown below are from the last successful update. Please refresh before relying on them.');
          } else {
            setError(detail || 'Unable to load the workshop queue. Please check your connection and refresh.');
          }
        }
      } finally {
        busy = false;
        if (live) setLoading(false);
      }
    }
    load();
    const timer = setInterval(load, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [apiBase, sheetsUrl, preview, refresh, recentTicket]);

  const machines = Array.isArray(data?.machines) ? data.machines : [];
  const selected = machines.find(m => m.id === machine);
  const tickets = Array.isArray(selected?.tickets)
    ? selected.tickets.filter(t => ALLOWED_STATUSES.has(String(t?.status || '').toLowerCase()))
    : [];
  const waitingCount = tickets.filter(t => String(t?.status || '').toLowerCase() === 'queued').length;
  const inProgressCount = tickets.filter(t => String(t?.status || '').toLowerCase() === 'in-progress').length;

  const displayError = !data && (error.includes('positions shown below') || error.includes('Positions shown below'))
    ? 'Unable to load the workshop queue. Please check your connection and refresh.'
    : error;

  const moveTabFocus = (event, currentId) => {
    const currentIndex = QUEUE_TYPES.findIndex(([id]) => id === currentId);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % QUEUE_TYPES.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + QUEUE_TYPES.length) % QUEUE_TYPES.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = QUEUE_TYPES.length - 1;
    else return;

    event.preventDefault();
    const nextId = QUEUE_TYPES[nextIndex][0];
    setMachine(nextId);
    document.getElementById(`queue-tab-${nextId}`)?.focus();
  };

  return (
    <section className="queue-board" id="queue" aria-labelledby="queue-title">
      <div className="queue-heading">
        <div>
          <p className="eyebrow">Live workshop queue</p>
          <h2 id="queue-title">See where things stand.</h2>
        </div>
        <button
          className="button button-secondary"
          type="button"
          disabled={loading || preview}
          onClick={() => setRefresh(n => n + 1)}
        >
          {loading ? 'Updating' : 'Refresh queue'}
        </button>
      </div>
      <p className="queue-intro">Choose a service to see tickets that are in review, waiting, or being made.</p>
      <details className="queue-help">
        <summary>How queue positions work</summary>
        <p>Only approved jobs receive a position. Positions follow submission order, but staff may group jobs by material or adjust the working order. A position is not a promised completion time.</p>
      </details>
      <div className="queue-tabs" role="tablist" aria-label="Queue type">
        {QUEUE_TYPES.map(([id, label]) => {
          const m = machines.find(item => item.id === id);
          const count = data && Array.isArray(data?.machines)
            ? (m?.waiting || 0) + (m?.inReview || 0)
            : 'Loading';
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`queue-tab-${id}`}
              aria-selected={machine === id}
              aria-controls={`queue-panel-${id}`}
              tabIndex={machine === id ? 0 : -1}
              onClick={() => setMachine(id)}
              onKeyDown={event => moveTabFocus(event, id)}
            >
              {label} <span>{count}</span>
            </button>
          );
        })}
      </div>
      {preview && <p className="notice">Connect the ticket service to see the live queue.</p>}
      {error && <p role="alert" className="notice error">{displayError}</p>}
      {!data && !error && !preview && <p className="queue-loading" role="status">Loading the workshop queue</p>}
      {selected && (
        <div className="queue-panel" id={`queue-panel-${machine}`} role="tabpanel" aria-labelledby={`queue-tab-${machine}`} tabIndex="0">
          <div className="queue-summary" aria-label="Queue totals">
            <span><strong>{waitingCount}</strong> waiting</span>
            <span><strong>{inProgressCount}</strong> being made</span>
            <span><strong>{selected.inReview || 0}</strong> in review</span>
          </div>
          {tickets.length === 0 ? (
            <p className="queue-empty">No requests in review, waiting, or being made in this queue.</p>
          ) : (
            <div className="queue-table" role="table" aria-label={`${selected.name || 'Workshop'} queue`}>
              <div className="queue-columns" role="row">
                <span role="columnheader">Position</span>
                <span role="columnheader">Ticket</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Progress</span>
              </div>
              <ol className="public-queue" role="rowgroup">
                {tickets.map((t, index) => {
                  const isYourTicket = Boolean(recentTicket?.ticketNumber) && Boolean(t?.ticketNumber) && t.ticketNumber === recentTicket.ticketNumber;
                  const status = String(t?.status || '').toLowerCase();
                  const statusLabel = labels[status] || t?.status || 'Waiting';
                  return (
                    <li
                      key={t?.ticketNumber || `ticket-${index}`}
                      className={isYourTicket ? 'your-ticket' : ''}
                      role="row"
                    >
                      <span className="queue-position" role="cell">
                        <small>Position</small>
                        <strong>{typeof t?.position === 'number' && t.position > 0 ? t.position : 'Pending'}</strong>
                      </span>
                      <strong className="queue-ticket-info" role="cell">
                        <span>{t?.ticketNumber || 'Ticket'}</span>
                        <small className="queue-requester-name">
                          {t?.customerName?.trim() || 'Requester name unavailable'}
                        </small>
                      </strong>
                      <span className="queue-status" role="cell"><small>Status</small>{statusLabel}</span>
                      <span className="queue-progress" role="cell"><small>Progress</small>{getPositionText(t)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
