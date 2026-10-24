import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileArrowUp,
  Printer,
  Scissors,
  UploadSimple,
  X,
} from '@phosphor-icons/react';
import QueueBoard from './QueueBoard.jsx';
import { createSheetsTicket, validateSheetsFiles } from './sheets-api.js';

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

const STATUS_LABELS = { 'pending-review': 'In Review', declined: 'Declined',
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
      <a className="brand" href={location.pathname} aria-label="Mandir workshop ticket home">
        <span><strong>Mandir</strong><small>Workshop tickets</small></span>
      </a>
      <nav className="header-links" aria-label="Page navigation"><a className="header-note" href="#queue">View queue</a><a className="header-note" href="./staff/">Staff</a></nav>
    </header>
  );
}

function MachineChoice({ value, onChange }) {
  return (
    <section className="machine-step" aria-labelledby="ticket-question">
      <p className="eyebrow">Open a workshop ticket</p>
      <h1 id="ticket-question" tabIndex="-1">What are you opening a ticket for?</h1>
      <div className="machine-choices" role="group" aria-label="Choose a ticket type">
        <button className={value === 'printer' ? 'machine-choice selected' : 'machine-choice'} type="button" aria-labelledby="poster-printing-title" aria-describedby="poster-printing-description" onClick={() => onChange('printer')}>
          <span className="choice-icon"><Printer size={34} weight="duotone" aria-hidden="true" /></span>
          <span className="choice-copy"><strong id="poster-printing-title">Poster printing</strong><small id="poster-printing-description">Posters, signs, stickers, and canvas up to 24 inches wide</small></span>
          <span className="choice-select" aria-hidden="true">Select <ArrowRight weight="bold" /></span>
        </button>
        <button className={value === 'foam' ? 'machine-choice selected' : 'machine-choice'} type="button" aria-labelledby="foam-cutting-title" aria-describedby="foam-cutting-description" onClick={() => onChange('foam')}>
          <span className="choice-icon"><Scissors size={34} weight="duotone" aria-hidden="true" /></span>
          <span className="choice-copy"><strong id="foam-cutting-title">Foam cutting</strong><small id="foam-cutting-description">Foam letters, shapes, signs, and display pieces</small></span>
          <span className="choice-select" aria-hidden="true">Select <ArrowRight weight="bold" /></span>
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
        <span className="receipt-check"><Check size={25} weight="bold" aria-hidden="true" /></span>
        <p className="eyebrow">Ticket submitted</p>
        <h2 id="receipt-title">Your request is awaiting review.</h2>
        <p className="receipt-label">Ticket number</p>
        <strong className="receipt-number">{ticket.ticketNumber}</strong>
        {ticket.trackingCode && <><p className="receipt-label">Tracking code</p><strong className="tracking-code">{ticket.trackingCode}</strong></>}
        <p>{machineName(ticket)} · {ticket.department}{ticket.position ? ` · ${ticket.position - 1} ${ticket.position === 2 ? 'job' : 'jobs'} ahead of you` : ''}</p>
        <p className="receipt-help">A karyakar will check your files and dimensions before your request joins the staff queue. Save the ticket number{ticket.trackingCode ? ' and tracking code' : ''}. You will need them to check progress or collect the finished job.</p>
        <div className="receipt-actions">
          <button className="button button-secondary" type="button" onClick={() => window.print()}><Printer aria-hidden="true" /> Print receipt</button>
          <button className="button button-primary" type="button" onClick={startAnother}>Open another ticket <ArrowRight aria-hidden="true" /></button>
        </div>
      </section>
    );
  }

  return (
    <section className="form-section" aria-labelledby="form-title">
      <div className="form-heading">
        <button className="change-machine" type="button" onClick={() => { onChangeMachine(null); focusSection('ticket-question'); }}><ArrowLeft aria-hidden="true" /> Change request type</button>
        <span className="selected-machine">{machine === 'printer' ? <Printer aria-hidden="true" /> : <Scissors aria-hidden="true" />}{MACHINES[machine]}</span>
        <h2 id="form-title" tabIndex="-1">Tell us about the job.</h2>
        <p>Required fields are marked. Send one ticket for each item or design.</p>
      </div>

      <form ref={formRef} onSubmit={submit} aria-busy={submitting}>
        <input type="hidden" name="machine" value={machine} />

        <fieldset className="form-card">
          <legend>Contact and purpose</legend>
          <div className="field-grid">
            <label>Name <span>Required</span><input name="customerName" autoComplete="name" required maxLength="100" placeholder="Your name" /></label>
            <label>Department <span>Required</span><input name="department" required maxLength="100" placeholder="Decorations, Events, Youth" /></label>
            <label className="field-full">What is this for? <span>Required</span><textarea name="purpose" required maxLength="2000" rows="4" placeholder="Describe the event, project, and how the finished piece will be used." /></label>
            <label>Needed by <span>Required</span><select name="neededBy" required defaultValue="No rush"><option>Today</option><option>Tomorrow</option><option>This week</option><option>No rush</option></select></label>
          </div>
        </fieldset>

        <fieldset className="form-card">
          <legend>Job details</legend>
          <div className="field-grid details-grid">
            {machine === 'foam' && <label>Foam thickness <span>Inches</span><input name="thickness" type="number" min="0.01" max="1000" step="any" placeholder="2" required /></label>}
            <label>Quantity <span>Required</span><input name="quantity" type="number" min="1" max="10000" step="1" defaultValue="1" required /></label>
            <label>Width <span>Inches</span><input name="width" type="number" min="0.01" max={machine === 'printer' ? '24' : '10000'} step="any" placeholder={machine === 'printer' ? '24' : '20'} required /></label>
            <label>Length <span>Inches</span><input name="length" type="number" min="0.01" max="100000" step="any" placeholder="36" required /></label>
          </div>
          <p className="field-help">{machine === 'printer' ? 'The maximum finished print width is 24 inches. A karyakar will review the artwork and choose the paper material.' : 'Enter the finished dimensions and add a cut layout or clear reference when available.'}</p>

          <label className="upload-label">Artwork files <span>{machine === 'printer' ? 'Required' : 'Optional'}</span></label>
          <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
            <UploadSimple size={30} weight="duotone" aria-hidden="true" />
            <strong>Choose files or drop them here</strong>
            <small>PDF, SVG, DXF, PNG, JPG, or TIFF · up to 200 MB total</small>
            <input type="file" name="files" accept=".pdf,.svg,.dxf,.png,.jpg,.jpeg,.tif,.tiff" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }} aria-label="Upload artwork files" />
          </div>

          {files.length > 0 && (
            <ul className="file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${file.lastModified}-${index}`}><FileArrowUp aria-hidden="true" /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" onClick={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X aria-hidden="true" /></button></li>
              ))}
            </ul>
          )}

          <details className="instructions">
            <summary>Add more details <span>Optional</span></summary>
            <label>Details<textarea name="notes" rows="3" maxLength="4000" placeholder="Finishing, placement, color, or anything else the workshop should know." /></label>
          </details>
        </fieldset>

        <div className="submit-area">
          <p>Your ticket is saved before you receive a ticket number. A karyakar reviews each request before it enters the work queue. Approved jobs normally follow submission order, but staff may group jobs by material or adjust the working order. Timing depends on staff and material availability.</p>
          <button className="button button-primary submit-button" type="submit" disabled={submitting}>{submitting ? 'Submitting ticket' : canRetry ? 'Try again' : 'Submit ticket'} <ArrowRight weight="bold" aria-hidden="true" /></button>
        </div>
        {submitting && <progress max="100" value={progress} aria-label={`Upload progress: ${progress}%`} />}
        {notice.text && <p className={notice.error ? 'notice error' : 'notice'} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
      </form>
    </section>
  );
}

function App() {
  const [machine, setMachine] = useState(null);
  const [recentTicket, setRecentTicket] = useState(null);

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
        <MachineChoice value={machine} onChange={chooseMachine} />
        {machine && <div id="ticket-form"><TicketForm machine={machine} onChangeMachine={chooseMachine} onTicket={setRecentTicket} /></div>}
        <QueueBoard apiBase={API_BASE_URL} sheetsUrl={SHEETS_API_URL} preview={staticPreview} recentTicket={recentTicket} />
      </main>
      <footer><strong>Mandir Workshop Tickets</strong><span>Poster printing and foam cutting requests in one place.</span></footer>
    </div>
  );
}

export default App;
