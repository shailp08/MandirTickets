import { useEffect, useState } from 'react';
import { sheetsJsonp } from './sheets-api.js';
const labels = { 'pending-review': 'In Review', queued: 'Waiting', 'in-progress': 'Being made' };
export default function QueueBoard({ apiBase, sheetsUrl, preview, recentTicket }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [machine, setMachine] = useState('printer');
  const [loading, setLoading] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => { if (recentTicket?.machine) setMachine(recentTicket.machine); }, [recentTicket]);
  useEffect(() => {
    let live = true, busy = false;
    async function load() {
      if (busy || preview) return;
      busy = true; if (live) setLoading(true);
      try {
        let next;
        if (sheetsUrl) next = await sheetsJsonp(sheetsUrl, { action: 'queue' });
        else { const response = await fetch(`${apiBase}/api/queue`, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(); next = await response.json(); }
        if (!Array.isArray(next?.machines)) throw new Error();
        if (live) { setData(next); setError(''); }
      } catch { if (live) setError('Queue updates are unavailable. Any positions shown below are from the last successful update. Please refresh before relying on them.'); }
      finally { busy = false; if (live) setLoading(false); }
    }
    load(); const timer = setInterval(load, 30000);
    return () => { live = false; clearInterval(timer); };
  }, [apiBase, sheetsUrl, preview, refresh, recentTicket]);
  const selected = data?.machines.find(m => m.id === machine);
  const tickets = selected?.tickets.filter(t => ['pending-review', 'queued', 'in-progress'].includes(t.status)) || [];
  return <section className="queue-board" id="queue" aria-labelledby="queue-title">
    <div className="queue-heading"><div><h2 id="queue-title">Workshop queue</h2><p>Only approved jobs receive a position. Staff may adjust the order for material or machine setup.</p></div><button className="button button-secondary" disabled={loading || preview} onClick={() => setRefresh(n => n + 1)}>{loading ? 'Updating…' : 'Refresh'}</button></div>
    <div className="queue-tabs" role="group" aria-label="Queue type">{[['printer', 'Poster printing'], ['foam', 'Foam cutting']].map(([id, label]) => <button key={id} aria-pressed={machine === id} onClick={() => setMachine(id)}>{label} <span>{data ? (data.machines.find(m => m.id === id)?.waiting || 0) + (data.machines.find(m => m.id === id)?.inReview || 0) : '—'}</span></button>)}</div>
    {preview && <p className="notice">Connect the ticket service to see the live queue.</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {!data && !error && !preview && <p role="status">Loading the workshop queue…</p>}
    {selected && <><p className="queue-summary"><strong>{selected.waiting}</strong> approved jobs · {selected.inReview || 0} in review · {machine === 'printer' ? 'HP DesignJet T210 · 24-inch printer' : '2525 hot-wire foam cutter'}</p>
    {tickets.length === 0 ? <p className="queue-empty">No requests in review, waiting, or being made in this queue.</p> : <ol className="public-queue">{tickets.map(t => <li key={t.ticketNumber} className={t.ticketNumber === recentTicket?.ticketNumber ? 'your-ticket' : ''}><span className="queue-position">{t.position ?? '—'}</span><strong className="queue-ticket-info">
  <span>{t.ticketNumber}</span>
  <small className="queue-requester-name">
    {t.customerName || 'Requester name unavailable'}
  </small>
</strong><span>{labels[t.status]}</span><span>{t.status === 'pending-review' ? 'Awaiting karyakar approval' : t.position === 1 ? 'No jobs ahead' : `${t.position - 1} ${t.position === 2 ? 'job' : 'jobs'} ahead`}</span></li>)}</ol>}
    </>}
  </section>;
}
