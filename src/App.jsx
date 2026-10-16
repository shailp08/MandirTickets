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

const MACHINES = {
  printer: '24-inch roll printer',
  foam: 'Foam cutting machine',
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = path => `${API_BASE_URL}${path}`;
const staticPreview = location.hostname.endsWith('.github.io') && !API_BASE_URL;

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
      <span className="header-note">Print and foam production</span>
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

function TicketForm({ machine, onChangeMachine }) {
  const formRef = useRef(null);
  const requestKey = useRef(createRequestKey());
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

  const addFiles = incoming => setFiles(current => [...current, ...Array.from(incoming)]);

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
    files.forEach(file => data.append('files', file));
    setSubmitting(true);
    setProgress(0);
    setNotice({ text: 'Uploading files and reserving your ticket number.', error: false });
    try {
      const response = await upload(data);
      setTicket(response.ticket);
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
        <p>{MACHINES[ticket.machine]} · {ticket.department}{ticket.position ? ` · Position ${ticket.position}` : ''}</p>
        <p className="receipt-help">Save this number and bring it with you when collecting the finished job.</p>
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
            <small>PDF, static SVG, ASCII DXF, PNG, JPG, or TIFF</small>
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

function App() {
  const [machine, setMachine] = useState(null);

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
        {machine && <div id="ticket-form"><TicketForm machine={machine} onChangeMachine={chooseMachine} /></div>}
      </main>
      <footer><strong>Mandir Workshop Tickets</strong><span>Request printing or foam cutting in one place.</span></footer>
    </div>
  );
}

export default App;
