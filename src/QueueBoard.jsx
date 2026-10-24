import { useEffect, useState } from 'react';
import { sheetsJsonp } from './sheets-api.js';

const labels = {
  'pending-review': 'In Review',
  queued: 'Waiting',
  'in-progress': 'Being made',
};

const ALLOWED_STATUSES = new Set(['pending-review', 'queued', 'in-progress']);

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
  const [data, setData] = useState(null), [error, setError] = useState(''), [machine, setMachine] = useState('printer');
  const [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (recentTicket?.machine) setMachine(recentTicket.machine);
  }, [recentTicket]);

  useEffect(() => {
    let live = true;
    let busy = false;
    let hasLoadedData = false;
    async function load() {
      if (busy || preview) return;
      busy = true;
      if (live) setLoading(true);
      try {
        let next;
        if (sheetsUrl) {
          next = await sheetsJsonp(sheetsUrl, { action: 'queue' });
        } else {
          const base = (apiBase || '').replace(/\/$/, '');
          const response = await fetch(`${base}/api/queue`, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) {
            let details = '';
            try {
              const body = await response.json();
              details = body?.error || body?.message || '';
            } catch {}
            throw new Error(details || `HTTP ${response.status}`);
          }
          next = await response.json();
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

  const displayError = !data && (error.includes('positions shown below') || error.includes('Positions shown below'))
    ? 'Unable to load the workshop queue. Please check your connection and refresh.'
    : error;

  return (
    <section className="queue-board" id="queue" aria-labelledby="queue-title">
      <div className="queue-heading">
        <div>
          <p className="eyebrow">Live workshop queue</p>
          <h2 id="queue-title">See where things stand.</h2>
        </div>
        <button
          className="button button-secondary"
          disabled={loading || preview}
          onClick={() => setRefresh(n => n + 1)}
        >
          {loading ? 'Updating…' : 'Refresh queue'}
        </button>
      </div>
      <p>Requests awaiting karyakar approval appear as In Review. Only approved jobs receive a production queue position. Positions follow submission order, but staff may group jobs by material or adjust the working order. Positions count jobs, not people, and do not promise a completion time.</p>
      <div className="queue-tabs" role="group" aria-label="Queue type">
        {[
          ['printer', 'Poster printing'],
          ['foam', 'Foam cutting'],
        ].map(([id, label]) => {
          const m = machines.find(item => item.id === id);
          const count = data && Array.isArray(data?.machines)
            ? (m?.waiting || 0) + (m?.inReview || 0)
            : '—';
          return (
            <button
              key={id}
              aria-pressed={machine === id}
              onClick={() => setMachine(id)}
            >
              {label} <span>{count}</span>
            </button>
          );
        })}
      </div>
      {preview && <p className="notice">Connect the ticket service to see the live queue.</p>}
      {error && <p role="alert" className="notice error">{displayError}</p>}
      {!data && !error && !preview && <p role="status">Loading the workshop queue…</p>}
      {selected && (
        <>
          <p className="queue-summary">
            <strong>{selected.waiting || 0}</strong> approved jobs · {selected.inReview || 0} in review
          </p>
          {tickets.length === 0 ? (
            <p className="queue-empty">No requests in review, waiting, or being made in this queue.</p>
          ) : (
            <ol className="public-queue">
              {tickets.map((t, index) => {
                const isYourTicket = Boolean(recentTicket?.ticketNumber) && Boolean(t?.ticketNumber) && t.ticketNumber === recentTicket.ticketNumber;
                const status = String(t?.status || '').toLowerCase();
                const statusLabel = labels[status] || t?.status || 'Waiting';
                return (
                  <li
                    key={t?.ticketNumber || `ticket-${index}`}
                    className={isYourTicket ? 'your-ticket' : ''}
                  >
                    <span className="queue-position">
                      {typeof t?.position === 'number' && t.position > 0 ? t.position : '—'}
                    </span>
                    <strong className="queue-ticket-info">
                      <span>{t?.ticketNumber || 'Ticket'}</span>
                      <small className="queue-requester-name">
                        {t?.customerName?.trim() || 'Requester name unavailable'}
                      </small>
                    </strong>
                    <span>{statusLabel}</span>
                    <span>{getPositionText(t)}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
