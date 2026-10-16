import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClockCounterClockwise,
  FileArrowUp,
  MagnifyingGlass,
  Printer,
  Scissors,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import { createSheetsTicket, trackSheetsTicket, validateSheetsFiles } from './sheets-api.js';

const MACHINES = {
  printer: '24-inch roll printer',
  foam: 'Foam cutting machine',
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const SHEETS_API_URL = (import.meta.env.VITE_GOOGLE_SCRIPT_URL || '').replace(/\/$/, '');
const apiUrl = path => `${API_BASE_URL}${path}`;
const staticPreview = location.hostname.endsWith('.github.io') && !API_BASE_URL && !SHEETS_API_URL;

const STATUS_LABELS = {
  queued: 'Queued',
  'in-progress': 'In progress',
  ready: 'Ready for pickup',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

const createRequestKey = () => Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  value => value.toString(16).padStart(2, '0'),
).join('');

function Header() {
  return (
    <header className="site-header">
      <a className="brand" href={location.pathname} aria-label="Mandir workshop ticket home">
        <span className="brand-mark" aria-hidden="true">M</span>
        <span><strong>Mandir</strong><small>Workshop tickets</small></span>
      </a>
      <a className="header-note" href="#tracker"><MagnifyingGlass aria-hidden="true" /> Track a ticket</a>
    </header>
  );
}

function MachineChoice({ value, onChange }) {
  return (
    <section className="machine-step" aria-labelledby="ticket-question">
      <p className="eyebrow">Open a workshop ticket</p>
      <h1 id="ticket-question">What are you opening a ticket for?</h1>
      <p className="intro">Choose the machine that will produce the finished piece. We will only ask for the details that job needs.</p>
      <div className="machine-choices" role="radiogroup" aria-label="Ticket type">
        <button className={value === 'printer' ? 'machine-choice selected' : 'machine-choice'} type="button" role="radio" aria-checked={value === 'printer'} onClick={() => onChange('printer')}>
          <span className="choice-icon"><Printer size={34} weight="duotone" aria-hidden="true" /></span>
          <span className="choice-copy"><strong>Roll printing</strong><small>Posters, signs, adhesive graphics, and canvas up to 24 inches wide</small></span>
          <span className="choice-select">Select <ArrowRight weight="bold" aria-hidden="true" /></span>
        </button>
        <button className={value === 'foam' ? 'machine-choice selected' : 'machine-choice'} type="button" role="radio" aria-checked={value === 'foam'} onClick={() => onChange('foam')}>
          <span className="choice-icon"><Scissors size={34} weight="duotone" aria-hidden="true" /></span>
          <span className="choice-copy"><strong>Foam cutting</strong><small>Letters, custom forms, dimensional pieces, and display elements</small></span>
          <span className="choice-select">Select <ArrowRight weight="bold" aria-hidden="true" /></span>
        </button>
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
    onChangeMachine(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (ticket) {
    return (
      <section className="receipt-card" id="ticket-receipt" tabIndex="-1" aria-labelledby="receipt-title">
        <span className="receipt-check"><Check size={25} weight="bold" aria-hidden="true" /></span>
        <p className="eyebrow">Ticket submitted</p>
        <h2 id="receipt-title">Your request is in the queue.</h2>
        <p className="receipt-label">Ticket number</p>
        <strong className="receipt-number">{ticket.ticketNumber}</strong>
        {ticket.trackingCode && <><p className="receipt-label">Tracking code</p><strong className="tracking-code">{ticket.trackingCode}</strong></>}
        <p>{MACHINES[ticket.machine] || ticket.machineName} · {ticket.department}{ticket.position ? ` · Position ${ticket.position}` : ''}</p>
        <p className="receipt-help">Save the ticket number{ticket.trackingCode ? ' and tracking code' : ''}. You will need them to check progress or collect the finished job.</p>
        <div className="receipt-actions">
          <button className="button button-secondary" type="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print receipt</button>
          <a className="button button-secondary" href="#tracker"><MagnifyingGlass aria-hidden="true" /> Track ticket</a>
          <button className="button button-primary" type="button" onClick={startAnother}>Open another ticket <ArrowRight aria-hidden="true" /></button>
        </div>
      </section>
    );
  }

  return (
    <section className="form-section" aria-labelledby="form-title">
      <div className="form-heading">
        <button className="change-machine" type="button" onClick={() => onChangeMachine(null)}><ArrowLeft aria-hidden="true" /> Change ticket type</button>
        <span className="selected-machine">{machine === 'printer' ? <Printer aria-hidden="true" /> : <Scissors aria-hidden="true" />}{MACHINES[machine]}</span>
        <h2 id="form-title">Tell us about the job.</h2>
        <p>Required fields are marked. Submit one ticket for each distinct finished piece.</p>
      </div>

      <form ref={formRef} onSubmit={submit}>
        <input type="hidden" name="machine" value={machine} />

        <fieldset className="form-card">
          <legend>Contact and purpose</legend>
          <div className="field-grid">
            <label>Name <span>Required</span><input name="customerName" autoComplete="name" required maxLength="100" placeholder="Your name" /></label>
            <label>Department <span>Required</span><input name="department" required maxLength="100" placeholder="Decorations, Events, Youth" /></label>
            <label className="field-full">What is this for? <span>Required</span><textarea name="purpose" required maxLength="2000" rows="4" placeholder="Describe the event, project, and how the finished piece will be used." /></label>
            <label>Needed by <span>Required</span><select name="neededBy" required defaultValue="No rush"><option>Today</option><option>Tomorrow</option><option>This week</option><option>No rush</option></select></label>
            <label>Phone <span>Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength="40" placeholder="For questions about the job" /></label>
          </div>
        </fieldset>

        <fieldset className="form-card">
          <legend>Production details</legend>
          <div className="field-grid details-grid">
            {machine === 'printer' ? (
              <label>Paper type <span>Required</span><select name="paperType" defaultValue="Standard"><option>Polypropylene</option><option>Adhesive</option><option>Canvas</option><option>Glossy</option><option>Standard</option></select></label>
            ) : (
              <label>Foam thickness <span>Inches</span><input name="thickness" type="number" min="0.01" max="1000" step="any" placeholder="2" required /></label>
            )}
            <label>Quantity <span>Required</span><input name="quantity" type="number" min="1" max="10000" step="1" defaultValue="1" required /></label>
            <label>Width <span>Inches</span><input name="width" type="number" min="0.01" max={machine === 'printer' ? '24' : '10000'} step="any" placeholder={machine === 'printer' ? '24' : '20'} required /></label>
            <label>Length <span>Inches</span><input name="length" type="number" min="0.01" max="100000" step="any" placeholder="36" required /></label>
          </div>
          <p className="field-help">{machine === 'printer' ? 'The maximum finished print width is 24 inches.' : 'Enter the finished dimensions and add a cut layout or clear reference when available.'}</p>

          <label className="upload-label">Design files <span>{machine === 'printer' ? 'Required' : 'Optional'}</span></label>
          <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
            <UploadSimple size={30} weight="duotone" aria-hidden="true" />
            <strong>Choose files or drop them here</strong>
            <small>PDF, static SVG, ASCII DXF, PNG, JPG, or TIFF{SHEETS_API_URL ? ' · 5 files · 5 MB each' : ''}</small>
            <input type="file" name="files" accept=".pdf,.svg,.dxf,.png,.jpg,.jpeg,.tif,.tiff" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }} aria-label="Upload design files" />
          </div>

          {files.length > 0 && (
            <ul className="file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}-${index}`}><FileArrowUp aria-hidden="true" /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" onClick={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X aria-hidden="true" /></button></li>
              ))}
            </ul>
          )}

          <details className="instructions">
            <summary>Add finishing instructions <span>Optional</span></summary>
            <label>Instructions<textarea name="notes" rows="3" maxLength="4000" placeholder="Finishing, placement, color, or anything else the workshop should know." /></label>
          </details>
        </fieldset>

        <div className="submit-area">
          <p>Your ticket is saved before its queue number is issued. Requested timing depends on staff and material availability.</p>
          <button className="button button-primary submit-button" type="submit" disabled={submitting}>{submitting ? 'Submitting ticket' : 'Submit ticket'} <ArrowRight weight="bold" aria-hidden="true" /></button>
        </div>
        {submitting && <progress max="100" value={progress} aria-label="Upload progress" />}
        {notice.text && <p className={notice.error ? 'notice error' : 'notice'} role="status">{notice.text}</p>}
      </form>
    </section>
  );
}

function TicketTracker({ recentTicket }) {
  const [ticketNumber, setTicketNumber] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!recentTicket) return;
    setTicketNumber(recentTicket.ticketNumber || '');
    setTrackingCode(recentTicket.trackingCode || '');
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
        tracked = await trackSheetsTicket(SHEETS_API_URL, { ticket: ticketNumber, code: trackingCode });
      } else if (!staticPreview) {
        const response = await fetch(apiUrl(`/api/track/${encodeURIComponent(ticketNumber.trim())}`), { credentials: 'include', signal: AbortSignal.timeout(15000) });
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
        <span className="tracker-icon"><ClockCounterClockwise size={28} weight="duotone" aria-hidden="true" /></span>
        <div><p className="eyebrow">Ticket tracker</p><h2 id="tracker-title">Check your request.</h2><p>Enter the details printed on the ticket receipt to see its current workshop status.</p></div>
      </div>
      <form className={SHEETS_API_URL ? 'tracker-form' : 'tracker-form tracker-form-compact'} onSubmit={track}>
        <label>Ticket number <span>Required</span><input value={ticketNumber} onChange={event => setTicketNumber(event.target.value.toUpperCase())} required maxLength="12" placeholder="P-0001" autoComplete="off" /></label>
        {SHEETS_API_URL && <label>Tracking code <span>Required</span><input value={trackingCode} onChange={event => setTrackingCode(event.target.value.toUpperCase())} required minLength="8" maxLength="8" placeholder="ABCD2345" autoComplete="off" /></label>}
        <button className="button button-primary" type="submit" disabled={loading}>{loading ? 'Checking' : 'Track ticket'} <MagnifyingGlass aria-hidden="true" /></button>
      </form>
      {notice && <p className="notice error" role="alert">{notice}</p>}
      {result && (
        <div className="tracker-result" aria-live="polite">
          <span className={`status-dot status-${result.status}`} aria-hidden="true" />
          <div><small>{result.ticketNumber}</small><strong>{STATUS_LABELS[result.status] || result.status}</strong><p>{result.machineName || MACHINES[result.machine]}{result.position ? ` · Queue position ${result.position}` : ''}</p></div>
        </div>
      )}
    </section>
  );
}

function App() {
  const [machine, setMachine] = useState(null);
  const [recentTicket, setRecentTicket] = useState(null);

  const chooseMachine = value => {
    setMachine(value);
    if (value) window.setTimeout(() => document.getElementById('ticket-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to ticket request</a>
      <Header />
      {staticPreview && <div className="deployment-banner" role="status"><strong>Ticket service not connected</strong><span>Use the local workshop address to submit a live request.</span></div>}
      <main id="main">
        <MachineChoice value={machine} onChange={chooseMachine} />
        {machine && <div id="ticket-form"><TicketForm machine={machine} onChangeMachine={chooseMachine} onTicket={setRecentTicket} /></div>}
        <TicketTracker recentTicket={recentTicket} />
      </main>
      <footer><strong>Mandir Workshop Tickets</strong><span>Request printing or foam cutting in one place.</span></footer>
    </div>
  );
}

export default App;
