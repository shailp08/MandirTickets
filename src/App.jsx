import { useEffect, useRef, useState } from 'react';
import QueueBoard from './QueueBoard.jsx';
import { createSheetsTicket, trackSheetsTicket, validateSheetsFiles } from './sheets-api.js';

const MACHINES = {
  printer: 'Poster printing',
  foam: 'Foam cutting',
};

const LEGACY_MACHINE_NAMES = {
  '24-inch roll printer': MACHINES.printer,
  'Foam cutting machine': MACHINES.foam,
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SHEETS_API_URL = (import.meta.env.VITE_GOOGLE_SCRIPT_URL || '').replace(/\/$/, '');
const apiUrl = path => `${API_BASE_URL}${path}`;
const staticPreview = location.hostname.endsWith('.github.io') && !API_BASE_URL && !SHEETS_API_URL;

const STATUS_LABELS = {
  'pending-review': 'Awaiting review',
  declined: 'Declined',
  queued: 'Waiting',
  'in-progress': 'Being made',
  ready: 'Ready for pickup',
  collected: 'Picked up',
  cancelled: 'Cancelled',
};

const machineName = ticket => MACHINES[ticket?.machine]
  || LEGACY_MACHINE_NAMES[ticket?.machineName]
  || ticket?.machineName
  || 'Workshop request';

const focusSection = id => window.setTimeout(() => {
  const target = document.getElementById(id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  });
}, 0);

const createRequestKey = () => Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  value => value.toString(16).padStart(2, '0'),
).join('');

function Header() {
  return (
    <header className="site-header">
      <a className="brand" data-nav-entry href={location.pathname} aria-label="Delaware Mandir workshop ticket home">
        <strong>Delaware Mandir</strong>
        <span>Workshop tickets</span>
      </a>
      <nav className="header-links">
        <a className="header-note" data-nav-entry href="#queue">View queue</a>
        <a className="header-note" data-nav-entry href="#tracker">Track a ticket</a>
      </nav>
    </header>
  );
}

function CostEstimate({ estimate }) {
  if (!estimate) return null;
  return (
    <div className="cost-estimate">
      <small>Approximate material cost</small>
      <strong>{estimate.amountDisplay}</strong>
      <p>{estimate.basis}</p>
      <p>{estimate.disclaimer}</p>
    </div>
  );
}

function MachineChoice({ value, onChange }) {
  return (
    <section className="machine-step" aria-labelledby="ticket-question">
      <div className="hero-copy">
        <h1 id="ticket-question" data-rise style={{ '--i': 0 }} tabIndex="-1">Choose what you need</h1>
        <p className="intro" data-rise style={{ '--i': 1 }}>Start a request for poster printing or foam cutting. We’ll only show the questions for that job.</p>
        <p className="hero-detail" data-rise style={{ '--i': 2 }}>After you submit, you’ll get one ticket code to save.</p>
      </div>
      <div className="machine-stage">
        <div className="machine-panel" data-ticket-open>
          <h2>Pick one service</h2>
          <div className="machine-choices" role="group" aria-label="Choose a ticket type">
            <button className={value === 'printer' ? 'machine-choice selected' : 'machine-choice'} data-choice type="button" aria-labelledby="poster-printing-title" aria-describedby="poster-printing-description" onClick={() => onChange('printer')}>
              <span className="choice-copy"><strong id="poster-printing-title">Poster printing</strong><small id="poster-printing-description">Posters, signs, stickers, and canvas up to 24 inches wide</small></span>
              <span className="choice-select" aria-hidden="true">Choose</span>
            </button>
            <button className={value === 'foam' ? 'machine-choice selected' : 'machine-choice'} data-choice type="button" aria-labelledby="foam-cutting-title" aria-describedby="foam-cutting-description" onClick={() => onChange('foam')}>
              <span className="choice-copy"><strong id="foam-cutting-title">Foam cutting</strong><small id="foam-cutting-description">Foam letters, shapes, signs, and display pieces</small></span>
              <span className="choice-select" aria-hidden="true">Choose</span>
            </button>
          </div>
          <p className="help-note">Not sure which one to choose? Ask a workshop volunteer for help.</p>
        </div>
      </div>
    </section>
  );
}

function TicketForm({ machine, onChangeMachine, onTicket }) {
  const formRef = useRef(null);
  const requestKey = useRef(createRequestKey());
  const startedAt = useRef(Date.now());
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [canRetry, setCanRetry] = useState(false);
  const [ticket, setTicket] = useState(null);

  useEffect(() => {
    const warn = event => {
      if (submitting) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [submitting]);

  const addFiles = incoming => {
    const nextFiles = [...files, ...Array.from(incoming)];
    try {
      if (SHEETS_API_URL) validateSheetsFiles(nextFiles);
      setFiles(nextFiles);
      setNotice({ text: '', error: false });
      setCanRetry(false);
    } catch (error) {
      setNotice({ text: error.message, error: true });
    }
  };

  const upload = data => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/tickets'));
    xhr.withCredentials = true;
    xhr.setRequestHeader('idempotency-key', requestKey.current);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('The connection was interrupted. Retrying will keep the same ticket number.'));
    xhr.onload = () => {
      let response;
      try { response = JSON.parse(xhr.responseText); }
      catch { reject(new Error('The workshop could not confirm the ticket. Please try again.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(response);
      else reject(new Error(response.error || 'The ticket could not be submitted.'));
    };
    xhr.send(data);
  });

  const submit = async event => {
    event.preventDefault();
    if (submitting || !formRef.current.reportValidity()) return;
    if (machine === 'printer' && files.length === 0) {
      setNotice({ text: 'Add at least one file for a print ticket.', error: true });
      return;
    }
    if (staticPreview) {
      setNotice({ text: 'The hosted ticket API has not been connected yet. Use the local workshop site to submit this request.', error: true });
      return;
    }
    const data = new FormData(formRef.current);
    data.delete('files');
    setSubmitting(true);
    setCanRetry(false);
    setProgress(0);
    setNotice({ text: 'Uploading files and reserving your ticket number.', error: false });
    try {
      let submittedTicket;
      if (SHEETS_API_URL) {
        const details = Object.fromEntries(data.entries());
        submittedTicket = await createSheetsTicket(SHEETS_API_URL, {
          ...details,
          requestKey: requestKey.current,
          startedAt: startedAt.current,
          website: '',
        }, files, setProgress);
        submittedTicket = { ...submittedTicket, machine, department: details.department };
      } else {
        files.forEach(file => data.append('files', file));
        const response = await upload(data);
        submittedTicket = response.ticket;
      }
      setTicket(submittedTicket);
      onTicket(submittedTicket);
      setNotice({ text: '', error: false });
      window.setTimeout(() => document.getElementById('ticket-receipt')?.focus(), 0);
    } catch (error) {
      setNotice({ text: error.message, error: true });
      setCanRetry(true);
    } finally {
      setSubmitting(false);
      setProgress(0);
    }
  };

  const startAnother = () => {
    requestKey.current = createRequestKey();
    startedAt.current = Date.now();
    setFiles([]);
    setTicket(null);
    setNotice({ text: '', error: false });
    setCanRetry(false);
    onChangeMachine(null);
    focusSection('ticket-question');
  };

  if (ticket) {
    return (
      <section className="receipt-card" id="ticket-receipt" tabIndex="-1" aria-labelledby="receipt-title">
        <h2 id="receipt-title">Ticket submitted</h2>
        <p>Your request is awaiting an admin review before it enters the production queue.</p>
        <p className="receipt-label">Ticket code</p>
        <strong className="receipt-number receipt-code">{ticket.trackingNumber || ticket.trackingCode || ticket.ticketNumber}</strong>
        <p>{machineName(ticket)} · {ticket.department}{ticket.position ? ` · Number in line ${ticket.position}` : ''}</p>
        <CostEstimate estimate={ticket.costEstimate} />
        <p className="receipt-help"><strong>Write down or print this code.</strong> You will need it to check the review, follow progress, and collect the finished job.</p>
        <div className="receipt-actions">
          <button className="button button-secondary" type="button" onClick={() => window.print()}>Print this page</button>
          <a className="button button-secondary" href="#tracker">Track this ticket</a>
          <button className="button button-primary" type="button" onClick={startAnother}>Open another ticket</button>
        </div>
      </section>
    );
  }

  return (
    <section className="form-section" aria-labelledby="form-title">
      <div className="form-heading">
        <button className="change-machine" type="button" onClick={() => { onChangeMachine(null); focusSection('ticket-question'); }}>Change request type</button>
        <p className="selected-machine">Request type: <strong>{MACHINES[machine]}</strong></p>
        <h1 id="form-title" tabIndex="-1">Tell us about your job</h1>
        <p>Fill in the form below. Fields marked “Required” must be completed.</p>
      </div>

      <form ref={formRef} onSubmit={submit} aria-busy={submitting}>
        <input type="hidden" name="machine" value={machine} />

        <fieldset className="form-card">
          <legend>Your information</legend>
          <div className="field-grid">
            <label>Your name <span>Required</span><input name="customerName" autoComplete="name" required maxLength="100" /></label>
            <label>Department or group <span>Required</span><input name="department" required maxLength="100" placeholder="Example: Events or Youth" /></label>
            <label>Email address <span>Required</span><input name="email" type="email" autoComplete="email" required maxLength="254" placeholder="name@example.com" /></label>
            <label>Phone number <span>Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength="40" /></label>
            <label className="field-full sms-consent"><input type="checkbox" name="smsConsent" value="true" /> Text me when this request is ready, declined, or cancelled. Message and data rates may apply.</label>
            <label className="field-full">What is this for? <span>Required</span><textarea name="purpose" required maxLength="2000" rows="4" placeholder="Example: A welcome sign for the Diwali event" /></label>
            <label>When is it needed? <span>Required</span><select name="neededBy" defaultValue="No rush" required><option>Today</option><option>Tomorrow</option><option>This week</option><option>No rush</option></select><small className="input-help">Choose the closest deadline; an admin will confirm timing.</small></label>
          </div>
        </fieldset>

        <fieldset className="form-card">
          <legend>Job details</legend>
          <div className="field-grid details-grid">
            {machine === 'foam' && (
              <label>Foam thickness <span>Required</span><select name="thickness" defaultValue="" required><option value="" disabled>Choose a thickness</option><option value="1">1 inch</option><option value="2">2 inches</option></select></label>
            )}
            <label>How many? <span>Required</span><input name="quantity" type="number" min="1" max="10000" step="1" defaultValue="1" required /></label>
            <label>Finished width in inches <span>Required</span><input name="width" type="number" min="0.01" max={machine === 'printer' ? '24' : '10000'} step="any" placeholder={machine === 'printer' ? 'Example: 24' : 'Example: 20'} required /></label>
            <label>Finished length in inches <span>Required</span><input name="length" type="number" min="0.01" max="100000" step="any" placeholder="Example: 36" required /></label>
          </div>
          <p className="field-help">{machine === 'printer' ? 'The widest print we can make is 24 inches. An admin will review the artwork and choose the print material.' : 'Enter the final size. Add a drawing or example file if you have one.'}</p>

          <label className="upload-label" htmlFor="artwork-files">Artwork or example files <span>{machine === 'printer' ? 'Required' : 'Optional'}</span></label>
          <div className="file-picker">
            <input id="artwork-files" type="file" name="files" accept=".pdf,.svg,.dxf,.png,.jpg,.jpeg,.tif,.tiff" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
            <p>Choose files from your computer or phone. You can use PDF, SVG, DXF, PNG, JPG, or TIFF files, up to 200 MB total.</p>
          </div>

          {files.length > 0 && (
            <ul className="file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}-${index}`}><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" onClick={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}>Remove</button></li>
              ))}
            </ul>
          )}

          <label className="notes-field">Anything else we should know? <span>Optional</span><textarea name="notes" rows="3" maxLength="4000" placeholder="Add colors, finishing, placement, or other instructions." /></label>
        </fieldset>

        <div className="submit-area">
          <p>After you submit, an admin reviews the request before it enters the workshop queue. Approved jobs normally follow submission order, but staff may group jobs by material or machine setup.</p>
          <button className="button button-primary submit-button" type="submit" disabled={submitting}>{submitting ? 'Submitting ticket…' : canRetry ? 'Try submitting again' : 'Submit ticket'}</button>
        </div>
        {submitting && <progress max="100" value={progress} aria-label={`Upload progress: ${progress}%`} />}
        {notice.text && <p className={notice.error ? 'notice error' : 'notice'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      </form>
    </section>
  );
}

function TicketTracker({ recentTicket }) {
  const [ticketCode, setTicketCode] = useState('');
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recentTicket) return;
    setTicketCode(recentTicket.trackingNumber || recentTicket.trackingCode || recentTicket.ticketNumber || '');
    setResult(recentTicket);
  }, [recentTicket]);

  const track = async event => {
    event.preventDefault();
    setLoading(true);
    setNotice('');
    setResult(null);
    try {
      let tracked;
      if (SHEETS_API_URL) {
        tracked = await trackSheetsTicket(SHEETS_API_URL, { trackingNumber: ticketCode });
      } else if (!staticPreview) {
        const response = await fetch(apiUrl(`/api/track/${encodeURIComponent(ticketCode.trim())}`), { credentials: 'include', signal: AbortSignal.timeout(15000) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'The ticket could not be found.');
        tracked = data;
      } else {
        throw new Error('The hosted ticket backend has not been connected yet.');
      }
      setResult(tracked);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="tracker-section" id="tracker" aria-labelledby="tracker-title">
      <div className="tracker-heading">
        <h2 id="tracker-title">Track a ticket</h2>
        <p>Enter the ticket code from your receipt to check its progress.</p>
      </div>
      <form className="tracker-form tracker-form-compact" onSubmit={track} aria-busy={loading}>
        <label>Ticket code <span>Required</span><input value={ticketCode} onChange={event => setTicketCode(event.target.value.toUpperCase())} required minLength="6" maxLength="20" placeholder="DM-ABCD2345EFGH" autoComplete="off" /></label>
        <button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Checking…' : 'Check ticket'}</button>
      </form>
      {notice && <p className="notice error" role="alert">{notice}</p>}
      {result && (
        <div className="tracker-result" role="status" aria-live="polite">
          <span className={`status-dot status-${result.status}`} aria-hidden="true" />
          <div><small>{result.trackingNumber || result.trackingCode || result.ticketNumber}</small><strong>{STATUS_LABELS[result.status] || result.status}</strong>{result.reason && <p>{result.reason}</p>}{result.status === 'pending-review' && <p>This request has not entered the production queue yet.</p>}<p>{machineName(result)}{result.position ? ` · Number in line ${result.position}` : ''}</p><CostEstimate estimate={result.costEstimate} /></div>
        </div>
      )}
    </section>
  );
}

function App() {
  const [machine, setMachine] = useState(null);
  const [recentTicket, setRecentTicket] = useState(null);

  useEffect(() => {
    document.documentElement.classList.add('js');
    return () => document.documentElement.classList.remove('js');
  }, []);

  const chooseMachine = value => {
    setMachine(value);
    if (value) focusSection('form-title');
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to ticket request</a>
      <Header />
      {staticPreview && <div className="deployment-banner" role="status"><strong>Ticket service not connected</strong><span>Use the local workshop address to submit a live request.</span></div>}
      <main id="main" tabIndex="-1">
        {!machine && <MachineChoice value={machine} onChange={chooseMachine} />}
        {machine && <div id="ticket-form"><TicketForm machine={machine} onChangeMachine={chooseMachine} onTicket={setRecentTicket} /></div>}
        <QueueBoard apiBase={API_BASE_URL} sheetsUrl={SHEETS_API_URL} preview={staticPreview} recentTicket={recentTicket} />
        <TicketTracker recentTicket={recentTicket} />
      </main>
    </div>
  );
}

export default App;
