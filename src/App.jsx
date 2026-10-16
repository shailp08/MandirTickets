import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowsClockwise,
  Check,
  CheckCircle,
  Copy,
  DownloadSimple,
  FileArrowUp,
  LockKey,
  MagnifyingGlass,
  Printer,
  Scissors,
  SignOut,
  UploadSimple,
  X,
} from '@phosphor-icons/react';

gsap.registerPlugin(ScrollTrigger, useGSAP);

const STATUS_LABELS = {
  queued: 'Queued',
  'in-progress': 'In progress',
  ready: 'Ready for pickup',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

const MACHINES = {
  printer: '24-inch roll printer',
  foam: 'Foam cutting machine',
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const apiUrl = path => `${API_BASE_URL}${path}`;
const staticPreview = location.hostname.endsWith('.github.io') && !API_BASE_URL;

const STATUS_HELP = {
  queued: 'Your request is saved and waiting for staff to start.',
  'in-progress': 'The workshop is producing your job now.',
  ready: 'Your job is ready. Bring your ticket number to the desk.',
  collected: 'This job has been collected.',
  cancelled: 'This request was cancelled. Contact the desk if you need it reopened.',
};

const api = async (url, options = {}) => {
  const response = await fetch(apiUrl(url), { credentials: 'include', signal: AbortSignal.timeout(30000), ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The desk could not be reached. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
};

const formatDate = value => new Date(value).toLocaleString(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const createRequestKey = () => Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  value => value.toString(16).padStart(2, '0'),
).join('');

function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

function useRoute() {
  const readRoute = () => {
    const requested = location.hash.slice(1).split('?')[0];
    return ['request', 'queue', 'staff'].includes(requested) ? requested : 'request';
  };
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const change = () => {
      setRoute(readRoute());
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return route;
}

function Navigation({ route }) {
  return (
    <>
      <header className="site-header">
        <a className="brand" href="#request" aria-label="Mandir Workshop Desk home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span className="brand-copy"><strong>Mandir</strong><small>Workshop desk</small></span>
        </a>
        <a className="nav-action" href="#queue">
          Live queue <ArrowUpRight weight="bold" aria-hidden="true" />
        </a>
      </header>
      <nav className="main-nav" aria-label="Main navigation">
        <a href="#request" aria-current={route === 'request' ? 'page' : undefined}>Request</a>
        <a href="#queue" aria-current={route === 'queue' ? 'page' : undefined}>Track</a>
        <a href="#staff" aria-current={route === 'staff' ? 'page' : undefined}>Staff</a>
      </nav>
    </>
  );
}

const guidance = [
  {
    title: 'A number you can keep',
    text: 'Every confirmed request receives a permanent ticket number for tracking and pickup.',
  },
  {
    title: 'One view for the desk',
    text: 'Staff can see files, timing, dimensions, and status history without searching through messages.',
  },
  {
    title: 'A queue without guesswork',
    text: 'The live board shows arrival order and pickup readiness without exposing personal details.',
  },
];

function GuidanceCarousel() {
  const [index, setIndex] = useState(0);
  const move = direction => setIndex(current => (current + direction + guidance.length) % guidance.length);
  return (
    <div className="guidance-carousel">
      <div aria-live="polite">
        <p className="card-kicker">What changes</p>
        <h3>{guidance[index].title}</h3>
        <p>{guidance[index].text}</p>
      </div>
      <div className="carousel-controls">
        <span>{String(index + 1).padStart(2, '0')} / {String(guidance.length).padStart(2, '0')}</span>
        <div>
          <button type="button" onClick={() => move(-1)} aria-label="Previous point"><ArrowLeft aria-hidden="true" /></button>
          <button type="button" onClick={() => move(1)} aria-label="Next point"><ArrowRight aria-hidden="true" /></button>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  const heroRef = useRef(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.hero-copy > *', { y: 34, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out' });
      gsap.from('.hero-visual', { x: 70, scale: 0.9, opacity: 0, duration: 1.2, ease: 'power3.out' });
    });
    media.add('(prefers-reduced-motion: reduce)', () => gsap.set('.hero-copy > *, .hero-visual', { opacity: 1, x: 0, y: 0, scale: 1 }));
    return () => media.revert();
  }, { scope: heroRef });

  const scrollToForm = () => document.getElementById('request-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <section className="hero" ref={heroRef}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="hero-copy">
        <p className="overline">Print and foam production</p>
        <h1 className="max-w-6xl w-full">Bring the idea. We will keep the work moving.</h1>
        <p className="hero-lede">Send your files, receive a permanent ticket number, and follow the job from the workshop queue to pickup.</p>
        <div className="hero-actions">
          <button className="button button-saffron" type="button" onClick={scrollToForm}>Start a request <ArrowRight weight="bold" aria-hidden="true" /></button>
          <a className="button button-ghost" href="#queue">Track a ticket <ArrowUpRight weight="bold" aria-hidden="true" /></a>
        </div>
      </div>
      <figure className="hero-visual image-hover">
        <img src="https://picsum.photos/seed/mandir-workshop-craft/1200/1500" alt="Detailed material work in a creative workshop" />
        <figcaption><span>From file</span><ArrowRight aria-hidden="true" /><span>to workshop</span><ArrowRight aria-hidden="true" /><span>to pickup</span></figcaption>
      </figure>
    </section>
  );
}

function InterestSection() {
  return (
    <section className="interest-section">
      <div className="chapter-heading">
        <p className="overline dark">A clearer handoff</p>
        <h2>Built for work that moves from <span className="inline-heading-image"><img src="https://picsum.photos/seed/saffron-paper-roll/420/180" alt="" /></span> screen to material.</h2>
      </div>
      <div className="bento-grid">
        <article className="bento-card bento-wide bento-image image-hover">
          <img src="https://picsum.photos/seed/large-format-print-detail/1400/800" alt="Large-format printed material being prepared" />
          <div className="bento-overlay">
            <Printer size={30} weight="duotone" aria-hidden="true" />
            <div><p className="card-kicker">24-inch roll printer</p><h3>Upload the final artwork and tell us the finished size.</h3></div>
          </div>
        </article>
        <article className="bento-card bento-small bento-saffron">
          <p className="card-kicker">Keep it close</p>
          <h3>Your ticket number is the thread through the whole job.</h3>
          <ArrowUpRight size={28} weight="bold" aria-hidden="true" />
        </article>
        <article className="bento-card bento-small bento-carousel">
          <GuidanceCarousel />
        </article>
        <article className="bento-card bento-wide accordion-card">
          <div className="accordion-intro"><p className="card-kicker">Two machines, one desk</p><h3>Choose the material path that fits the job.</h3></div>
          <div className="horizontal-accordion">
            <div className="accordion-panel printer-panel" tabIndex="0">
              <Printer size={28} aria-hidden="true" />
              <div><strong>Print</strong><p>Posters, signage, adhesive, canvas, and color graphics up to 24 inches wide.</p></div>
            </div>
            <div className="accordion-panel foam-panel" tabIndex="0">
              <Scissors size={28} aria-hidden="true" />
              <div><strong>Cut</strong><p>Letters, custom forms, stage pieces, and dimensional foam elements.</p></div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

const journey = [
  { title: 'Describe the job once', text: 'Choose the machine, dimensions, quantity, timing, and purpose. The request stays attached to the work.', accent: 'saffron' },
  { title: 'Hand off the real files', text: 'Add print-ready artwork or reference files directly to the ticket so production starts from the right source.', accent: 'cream' },
  { title: 'Watch the status change', text: 'Queued, in progress, ready, and collected: a small set of states that keeps everyone aligned.', accent: 'green' },
];

function JourneySection() {
  const sectionRef = useRef(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.utils.toArray('.journey-card').forEach((card, index) => {
        gsap.fromTo(card,
          { y: 110, scale: 0.9, opacity: 0.35 },
          {
            y: index * -8,
            scale: 1,
            opacity: 1,
            ease: 'none',
            scrollTrigger: { trigger: card, start: 'top 90%', end: 'top 46%', scrub: 0.8 },
          },
        );
      });
    });
    media.add('(prefers-reduced-motion: no-preference) and (min-width: 900px)', () => {
      ScrollTrigger.create({
        trigger: '.journey-layout',
        start: 'top 14%',
        end: 'bottom 88%',
        pin: '.journey-copy',
        pinSpacing: false,
      });
    });
    media.add('(prefers-reduced-motion: reduce)', () => gsap.set('.journey-card', { opacity: 1, scale: 1, y: 0 }));
    return () => media.revert();
  }, { scope: sectionRef });

  return (
    <section className="journey-section" ref={sectionRef}>
      <div className="journey-layout">
        <div className="journey-copy">
          <p className="overline">A calm production path</p>
          <h2>The handoff should feel as considered as the final piece.</h2>
          <p>Every request arrives with what the workshop needs, while you keep one simple number to follow.</p>
        </div>
        <div className="journey-cards">
          {journey.map((item, index) => (
            <article className={`journey-card journey-${item.accent}`} key={item.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <CheckCircle size={34} weight="duotone" aria-hidden="true" />
              <div><h3>{item.title}</h3><p>{item.text}</p></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function getRecentTickets() {
  try {
    const data = JSON.parse(localStorage.getItem('mandir-ticket-numbers') || '[]');
    return Array.isArray(data) ? data.filter(value => typeof value === 'string' && /^[PF]-[0-9]+$/.test(value)).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function RequestForm() {
  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const requestKey = useRef(createRequestKey());
  const [machine, setMachine] = useState('printer');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [ticket, setTicket] = useState(null);
  const [recent, setRecent] = useState(getRecentTickets);

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

  const remember = number => {
    const next = [number, ...getRecentTickets().filter(item => item !== number)].slice(0, 5);
    try { localStorage.setItem('mandir-ticket-numbers', JSON.stringify(next)); } catch { /* Local history is optional. */ }
    setRecent(next);
  };

  const upload = data => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/tickets'));
    xhr.withCredentials = true;
    xhr.setRequestHeader('idempotency-key', requestKey.current);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Connection lost. Retrying this request will keep the same ticket number.'));
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('The desk could not confirm your ticket. Please retry.')); return; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'The request could not be submitted.'));
    };
    xhr.send(data);
  });

  const submit = async event => {
    event.preventDefault();
    if (submitting || !formRef.current.reportValidity()) return;
    if (machine === 'printer' && files.length === 0) {
      setNotice({ text: 'Add at least one file for a print request.', error: true });
      return;
    }
    const data = new FormData(formRef.current);
    data.delete('files');
    files.forEach(file => data.append('files', file));
    setSubmitting(true);
    setProgress(0);
    setNotice({ text: 'Uploading files and reserving your ticket number.', error: false });
    try {
      const result = await upload(data);
      setTicket(result.ticket);
      remember(result.ticket.ticketNumber);
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
    formRef.current?.reset();
    requestKey.current = createRequestKey();
    setMachine('printer');
    setFiles([]);
    setTicket(null);
    setNotice({ text: '', error: false });
  };

  const copyTracking = async () => {
    const url = `${location.origin}${location.pathname}#queue?ticket=${encodeURIComponent(ticket.ticketNumber)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ text: 'Tracking link copied.', error: false });
    } catch {
      setNotice({ text: 'Open the tracking page and copy the address from your browser.', error: false });
    }
  };

  return (
    <section className="request-section" id="request-form">
      <div className="request-heading">
        <p className="overline dark">Send it to the workshop</p>
        <h2>Ready when the files are.</h2>
        <p>Complete one request for each distinct job. Required fields are marked.</p>
      </div>

      {recent.length > 0 && !ticket && (
        <div className="recent-strip">
          <span>Recent on this device</span>
          {recent.map(number => <a key={number} href={`#queue?ticket=${encodeURIComponent(number)}`}>{number}<ArrowUpRight aria-hidden="true" /></a>)}
          <button type="button" onClick={() => { localStorage.removeItem('mandir-ticket-numbers'); setRecent([]); }}>Clear</button>
        </div>
      )}

      {ticket ? (
        <article className="receipt-card" id="ticket-receipt" tabIndex="-1">
          <Check size={28} weight="bold" aria-hidden="true" />
          <p className="overline dark">Request received</p>
          <h3>You are in the queue.</h3>
          <p>Your ticket number</p>
          <strong>{ticket.ticketNumber}</strong>
          <p>{MACHINES[ticket.machine]} · {ticket.department}{ticket.position ? ` · Position ${ticket.position} at submission` : ''}</p>
          <p>Save this number. It is the only detail you need to check the job status.</p>
          {notice.text && <p className={notice.error ? 'form-notice error' : 'form-notice'} role="status">{notice.text}</p>}
          <div className="receipt-actions">
            <button type="button" className="button button-light" onClick={() => window.print()}><Printer aria-hidden="true" /> Print receipt</button>
            <a className="button button-dark" href={`#queue?ticket=${encodeURIComponent(ticket.ticketNumber)}`}>Track ticket <ArrowRight aria-hidden="true" /></a>
            <button type="button" className="button button-light" onClick={copyTracking}><Copy aria-hidden="true" /> Copy link</button>
            <button type="button" className="text-action" onClick={startAnother}>Start another request</button>
          </div>
        </article>
      ) : (
        <form className="ticket-form" ref={formRef} onSubmit={submit}>
          <fieldset className="machine-picker">
            <legend>What are we making? <span>Required</span></legend>
            <div className="machine-options">
              <label className={machine === 'printer' ? 'machine-option selected' : 'machine-option'}>
                <input type="radio" name="machine" value="printer" checked={machine === 'printer'} onChange={() => setMachine('printer')} />
                <Printer size={30} weight="duotone" aria-hidden="true" />
                <span><strong>Roll printing</strong><small>Posters, signage, graphics</small></span>
                <span className="radio-mark"><Check weight="bold" aria-hidden="true" /></span>
              </label>
              <label className={machine === 'foam' ? 'machine-option selected' : 'machine-option'}>
                <input type="radio" name="machine" value="foam" checked={machine === 'foam'} onChange={() => setMachine('foam')} />
                <Scissors size={30} weight="duotone" aria-hidden="true" />
                <span><strong>Foam cutting</strong><small>Letters, forms, display pieces</small></span>
                <span className="radio-mark"><Check weight="bold" aria-hidden="true" /></span>
              </label>
            </div>
          </fieldset>

          <div className="form-block">
            <div className="form-block-heading"><div><p>Contact and purpose</p><h3>Tell the desk who needs this.</h3></div><span>Required unless marked optional</span></div>
            <div className="field-grid">
              <label>Name<input name="customerName" autoComplete="name" required maxLength="100" placeholder="Your name" /></label>
              <label>Department<input name="department" required maxLength="100" placeholder="Decorations, Events, Youth" /></label>
              <label className="field-full">What is this for?<textarea name="purpose" required maxLength="2000" rows="4" placeholder="Describe the event, project, or how the finished piece will be used." /></label>
              <label>Needed by<select name="neededBy" required defaultValue="No rush"><option>Today</option><option>Tomorrow</option><option>This week</option><option>No rush</option></select></label>
              <label>Phone <span className="optional-label">Optional</span><input name="phone" type="tel" autoComplete="tel" maxLength="40" placeholder="For questions about the job" /></label>
            </div>
          </div>

          <div className="form-block">
            <div className="form-block-heading"><div><p>Production details</p><h3>Define the finished piece.</h3></div><span>Dimensions are in inches</span></div>
            <div className="field-grid field-grid-four">
              {machine === 'printer' ? (
                <label>Paper type<select name="paperType" defaultValue="Standard"><option>Polypropylene</option><option>Adhesive</option><option>Canvas</option><option>Glossy</option><option>Standard</option></select></label>
              ) : (
                <label>Foam thickness<input name="thickness" type="number" min="0.01" max="1000" step="any" placeholder="2" required /></label>
              )}
              <label>Quantity<input name="quantity" type="number" min="1" max="10000" step="1" defaultValue="1" required /></label>
              <label>Width<input name="width" type="number" min="0.01" max={machine === 'printer' ? '24' : '10000'} step="any" placeholder={machine === 'printer' ? '24' : '20'} required /></label>
              <label>Length<input name="length" type="number" min="0.01" max="100000" step="any" placeholder="36" required /></label>
            </div>
            <p className="field-help">{machine === 'printer' ? 'All prints are in color. Maximum finished width is 24 inches.' : 'Enter the finished dimensions. Add a cut layout below or describe the shape in the purpose field.'}</p>

            <label className="upload-label">Design files {machine === 'foam' && <span className="optional-label">Optional</span>}</label>
            <div className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
              <UploadSimple size={30} weight="duotone" aria-hidden="true" />
              <strong>Choose files or drop them here</strong>
              <span>PDF, static SVG, ASCII DXF, PNG, JPG, or TIFF</span>
              <input ref={fileInputRef} type="file" name="files" accept=".pdf,.svg,.dxf,.png,.jpg,.jpeg,.tif,.tiff" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }} aria-label="Upload design files" />
            </div>
            {files.length > 0 && (
              <ul className="file-list">
                {files.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}><FileArrowUp aria-hidden="true" /><span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span><button type="button" onClick={() => setFiles(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${file.name}`}><X aria-hidden="true" /></button></li>
                ))}
              </ul>
            )}

            <details className="instructions-details">
              <summary>Add finishing instructions <span>Optional</span></summary>
              <label>Instructions<textarea name="notes" rows="3" maxLength="4000" placeholder="Finishing, placement, color, or anything else the workshop should know." /></label>
            </details>
          </div>

          <div className="submit-row">
            <p>Your request is saved before the ticket number is issued. Timing depends on staff and material availability.</p>
            <button className="button button-dark button-large" type="submit" disabled={submitting}>{submitting ? 'Submitting request' : 'Submit request'} <ArrowRight weight="bold" aria-hidden="true" /></button>
          </div>
          {submitting && <progress max="100" value={progress} aria-label="Upload progress" />}
          {notice.text && <p className={notice.error ? 'form-notice error' : 'form-notice'} role="status">{notice.text}</p>}
        </form>
      )}
    </section>
  );
}

function RequestPage() {
  return <><Hero /><InterestSection /><JourneySection /><RequestForm /></>;
}

function QueuePage() {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const initialTicket = query.get('ticket')?.trim().toUpperCase() || '';
  const [queue, setQueue] = useState(null);
  const [queueNotice, setQueueNotice] = useState('');
  const [number, setNumber] = useState(initialTicket);
  const [tracking, setTracking] = useState(null);
  const [trackError, setTrackError] = useState('');
  const [loading, setLoading] = useState(false);

  const trackTicket = useCallback(async ticketNumber => {
    if (!ticketNumber) return;
    setTrackError('');
    try {
      setTracking(await api(`/api/track/${encodeURIComponent(ticketNumber)}`));
    } catch (error) {
      setTracking(null);
      setTrackError(error.message);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/queue');
      setQueue(data);
      setQueueNotice(`Updated ${formatDate(data.updatedAt)}. The board refreshes every 15 seconds.`);
    } catch {
      setQueueNotice('The connection was interrupted. The board may be out of date.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
    if (initialTicket) trackTicket(initialTicket);
    const interval = window.setInterval(() => { if (!document.hidden) loadQueue(); }, 15000);
    return () => window.clearInterval(interval);
  }, [initialTicket, loadQueue, trackTicket]);

  const submitTracking = event => {
    event.preventDefault();
    const normalized = number.trim().toUpperCase();
    if (!normalized) return;
    setNumber(normalized);
    history.replaceState(null, '', `#queue?ticket=${encodeURIComponent(normalized)}`);
    trackTicket(normalized);
  };

  const steps = ['queued', 'in-progress', 'ready', 'collected'];
  const currentStep = tracking ? steps.indexOf(tracking.status) : -1;

  return (
    <div className="utility-page queue-page">
      <header className="utility-hero">
        <p className="overline">Live production queue</p>
        <h1>Know where the work stands.</h1>
        <p>Use your ticket number for a private status check, or scan the public board for current workshop flow.</p>
      </header>

      <section className="tracking-search">
        <form onSubmit={submitTracking}>
          <label htmlFor="track-number">Ticket number</label>
          <div><MagnifyingGlass aria-hidden="true" /><input id="track-number" value={number} onChange={event => setNumber(event.target.value)} placeholder="P-0001 or F-0001" maxLength="40" required /><button className="button button-saffron" type="submit">Find ticket <ArrowRight aria-hidden="true" /></button></div>
        </form>
        {trackError && <p className="tracking-error" role="status">{trackError}</p>}
        {tracking && (
          <article className="tracking-result" aria-live="polite">
            <div className="tracking-title"><div><span>{tracking.machine}</span><h2>{tracking.ticketNumber}</h2></div><StatusPill status={tracking.status} /></div>
            <p>{STATUS_HELP[tracking.status]}</p>
            {tracking.position && <p className="queue-position">Current queue position: <strong>{tracking.position}</strong>. This is not an estimated completion time.</p>}
            {currentStep >= 0 && <ol className="status-timeline" aria-label="Ticket progress">{steps.map((step, index) => <li className={index <= currentStep ? 'reached' : ''} aria-current={index === currentStep ? 'step' : undefined} key={step}><span><Check aria-hidden="true" /></span>{STATUS_LABELS[step]}</li>)}</ol>}
          </article>
        )}
      </section>

      <section className="queue-board-section">
        <div className="board-heading"><div><p className="overline dark">Workshop board</p><h2>Active jobs, without private details.</h2><p>{queueNotice}</p></div><button className="button button-light" type="button" onClick={loadQueue} disabled={loading}><ArrowsClockwise className={loading ? 'spinning' : ''} aria-hidden="true" /> Refresh</button></div>
        <div className="queue-board">
          {(queue?.machines || []).map(machine => (
            <article className="queue-column" key={machine.id}>
              <div className="queue-column-title"><span>{machine.id === 'printer' ? <Printer aria-hidden="true" /> : <Scissors aria-hidden="true" />}</span><div><h3>{machine.name}</h3><p>{machine.waiting} active {machine.waiting === 1 ? 'job' : 'jobs'}</p></div></div>
              {machine.tickets.length ? <div className="queue-rows">{machine.tickets.map(ticketItem => <div className="queue-row" key={ticketItem.ticketNumber}><strong>{ticketItem.ticketNumber}</strong>{ticketItem.position && <span>Position {ticketItem.position}</span>}<StatusPill status={ticketItem.status} /></div>)}</div> : <div className="empty-state"><CheckCircle size={34} weight="duotone" aria-hidden="true" /><strong>The queue is clear.</strong><p>The next project can start here.</p></div>}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function StaffPage() {
  const [signedIn, setSignedIn] = useState(false);
  const [tickets, setTickets] = useState([]);
  const [sheets, setSheets] = useState(null);
  const [notice, setNotice] = useState({ text: '', error: false });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [machine, setMachine] = useState('all');
  const [status, setStatus] = useState('active');

  const loadStaff = useCallback(async (quiet = false) => {
    try {
      const data = await api('/api/tickets');
      setTickets(data.tickets);
      setSheets(data.sheets);
      setSignedIn(true);
      if (!quiet) setNotice({ text: '', error: false });
    } catch (error) {
      if (error.status === 401) {
        setSignedIn(false);
        setTickets([]);
      } else if (!quiet) {
        setNotice({ text: error.message, error: true });
      }
    }
  }, []);

  useEffect(() => {
    loadStaff(true);
    const interval = window.setInterval(() => { if (!document.hidden && signedIn) loadStaff(true); }, 15000);
    return () => window.clearInterval(interval);
  }, [loadStaff, signedIn]);

  const login = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const password = new FormData(form).get('password');
    setLoading(true);
    try {
      await api('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      form.reset();
      await loadStaff();
    } catch (error) {
      setNotice({ text: error.message, error: true });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    try { await api('/api/session', { method: 'DELETE' }); } catch { /* Local sign-out still clears the desk. */ }
    setSignedIn(false);
    setTickets([]);
    setNotice({ text: 'Signed out.', error: false });
  };

  const updateTicket = async (ticket, nextStatus) => {
    if (nextStatus === 'cancelled' && !window.confirm('Cancel this ticket? It will remain in the records and can be reopened.')) return;
    setLoading(true);
    try {
      const data = await api(`/api/tickets/${encodeURIComponent(ticket.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, expectedRevision: ticket.revision }),
      });
      setTickets(current => current.map(item => item.id === data.ticket.id ? data.ticket : item));
      setNotice({ text: `${data.ticket.ticketNumber} is ${STATUS_LABELS[data.ticket.status].toLowerCase()}.`, error: false });
    } catch (error) {
      setNotice({ text: error.message, error: true });
      if (error.status === 409 || error.status === 401) await loadStaff(true);
    } finally {
      setLoading(false);
    }
  };

  const syncSheets = async () => {
    setLoading(true);
    try {
      const data = await api('/api/sheets/sync', { method: 'POST' });
      setSheets(data.sheets);
      setNotice({ text: 'Spreadsheet sync finished.', error: false });
    } catch (error) {
      setNotice({ text: error.message, error: true });
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => tickets
    .filter(ticket => machine === 'all' || ticket.machine === machine)
    .filter(ticket => status === 'all' || (status === 'active' ? ['queued', 'in-progress', 'ready'].includes(ticket.status) : ticket.status === status))
    .filter(ticket => [ticket.ticketNumber, ticket.customerName, ticket.department, ticket.purpose].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [tickets, search, machine, status]);

  const stats = ['queued', 'in-progress', 'ready', 'collected'];
  const nextAction = {
    queued: ['in-progress', 'Start job'],
    'in-progress': ['ready', 'Mark ready'],
    ready: ['collected', 'Mark collected'],
    collected: ['queued', 'Reopen'],
    cancelled: ['queued', 'Reopen'],
  };

  return (
    <div className="utility-page staff-page">
      <header className="utility-hero staff-hero">
        <div><p className="overline">Private workshop view</p><h1>One desk for every handoff.</h1><p>Review the request, download production files, and move each job through the workshop.</p></div>
        {signedIn && <button className="button button-ghost" type="button" onClick={logout}><SignOut aria-hidden="true" /> Sign out</button>}
      </header>

      {notice.text && <p className={notice.error ? 'page-notice error' : 'page-notice'} role="status">{notice.text}</p>}

      {!signedIn ? (
        <section className="login-card">
          <div><LockKey size={32} weight="duotone" aria-hidden="true" /><p className="overline dark">Staff access</p><h2>Open the workshop desk.</h2><p>Use the local staff password configured for this installation.</p></div>
          <form onSubmit={login}><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button className="button button-dark button-large" disabled={loading}>Sign in <ArrowRight aria-hidden="true" /></button></form>
        </section>
      ) : (
        <section className="dashboard">
          <div className="stats-grid">
            {stats.map(item => <button type="button" key={item} onClick={() => { setSearch(''); setMachine('all'); setStatus(item); }}><strong>{tickets.filter(ticket => ticket.status === item).length}</strong><span>{STATUS_LABELS[item]}</span><ArrowUpRight aria-hidden="true" /></button>)}
          </div>

          <div className="records-bar">
            <div><strong>Ticket records</strong><p>{!sheets?.configured ? 'Google Sheets is not connected. Local records and CSV export are available.' : sheets.lastError || (sheets.pending ? `${sheets.pending} records are waiting to sync.` : 'All tickets are recorded in Google Sheets.')}</p></div>
          <div>{sheets?.configured && <button type="button" className="button button-light" onClick={syncSheets} disabled={loading}><ArrowsClockwise aria-hidden="true" /> Sync</button>}<a className="button button-light" href={apiUrl('/api/export')} download><DownloadSimple aria-hidden="true" /> Export CSV</a></div>
          </div>

          <div className="staff-toolbar">
            <label className="search-field"><span>Search</span><div><MagnifyingGlass aria-hidden="true" /><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Number, name, department, purpose" /></div></label>
            <label><span>Machine</span><select value={machine} onChange={event => setMachine(event.target.value)}><option value="all">Both machines</option><option value="printer">Roll printer</option><option value="foam">Foam cutter</option></select></label>
            <label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="active">Active jobs</option><option value="all">All tickets</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <button type="button" className="button button-light refresh-button" onClick={() => loadStaff()} disabled={loading}><ArrowsClockwise className={loading ? 'spinning' : ''} aria-hidden="true" /> Refresh</button>
          </div>

          <p className="results-count">{filtered.length} {filtered.length === 1 ? 'ticket' : 'tickets'} · oldest first</p>
          <div className="staff-ticket-list">
            {filtered.map(ticket => {
              const action = nextAction[ticket.status];
              return (
                <article className="staff-ticket" key={ticket.id}>
                  <div className="ticket-top"><div><strong className="ticket-number">{ticket.ticketNumber}</strong><span>{MACHINES[ticket.machine]}</span></div><StatusPill status={ticket.status} /></div>
                  <div className="ticket-body"><div><h2>{ticket.customerName}</h2><p className="department">{ticket.department}</p><p className="purpose">{ticket.purpose}</p></div><div className="ticket-action"><span>Needed {ticket.neededBy} · Quantity {ticket.quantity || 1}</span>{action && <button className="button button-dark" type="button" onClick={() => updateTicket(ticket, action[0])} disabled={loading}>{action[1]} <ArrowRight aria-hidden="true" /></button>}</div></div>
                  <details>
                    <summary>Production details and files <span>Open</span></summary>
                    <div className="ticket-details-grid">
                      <div><span>Dimensions</span><strong>{ticket.width || '—'} × {ticket.length || '—'}{ticket.machine === 'foam' ? ` × ${ticket.thickness || '—'}` : ''} in</strong></div>
                      {ticket.paperType && <div><span>Paper</span><strong>{ticket.paperType}</strong></div>}
                      {ticket.phone && <div><span>Phone</span><strong>{ticket.phone}</strong></div>}
                      <div><span>Requested</span><strong>{formatDate(ticket.createdAt)}</strong></div>
                    </div>
                      <div className="ticket-files">{ticket.files?.length ? ticket.files.map(file => <a key={file.storedName} href={apiUrl(`/api/tickets/${encodeURIComponent(ticket.id)}/files/${encodeURIComponent(file.storedName)}`)}><DownloadSimple aria-hidden="true" /> {file.originalName}</a>) : <span>No reference files attached.</span>}</div>
                    {ticket.notes && <p className="ticket-notes">{ticket.notes}</p>}
                    <div className="status-editor"><label>Change status<select value={ticket.status} onChange={event => updateTicket(ticket, event.target.value)} disabled={loading}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                    <ol className="history-list">{(ticket.history || []).map((entry, index) => <li key={`${entry.at}-${index}`}><span>{STATUS_LABELS[entry.status]}</span><time>{formatDate(entry.at)}</time></li>)}</ol>
                  </details>
                </article>
              );
            })}
            {filtered.length === 0 && <div className="empty-state staff-empty"><MagnifyingGlass size={34} aria-hidden="true" /><strong>No matching tickets.</strong><p>Adjust the search or filter to see more records.</p></div>}
          </div>
        </section>
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div><span className="brand-mark" aria-hidden="true">M</span><div><strong>Mandir Workshop Desk</strong><p>Large-format printing and foam cutting.</p></div></div>
      <nav aria-label="Footer navigation"><a href="#request">New request</a><a href="#queue">Live queue</a><a href="#staff">Staff desk</a></nav>
      <p>Built for a clearer handoff from idea to pickup.</p>
    </footer>
  );
}

export default function App() {
  const route = useRoute();
  return (
    <div className="app-shell overflow-x-hidden w-full max-w-full">
      <a className="skip-link" href="#content">Skip to content</a>
      <Navigation route={route} />
      {staticPreview && <div className="deployment-banner" role="status"><strong>Frontend preview</strong><span>Connect a hosted API before accepting live workshop requests.</span></div>}
      <main id="content">
        {route === 'request' && <RequestPage />}
        {route === 'queue' && <QueuePage />}
        {route === 'staff' && <StaffPage />}
      </main>
      <Footer />
    </div>
  );
}
